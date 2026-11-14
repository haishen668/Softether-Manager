"use client";

import { useCallback, useMemo, useState } from "react";
import { CpuCard, DiskCard, MemoryCard, NetworkCard, SwapCard } from "../components/ResourceCards";
import { Empty, ErrorAlert, Field, LoadingBlock, SectionTitle, usePoll } from "../components/bits";
import { QuotaStatePill, quotaKey, useQuotaIndex } from "../components/QuotaCard";
import { api, type Wire } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useServer } from "../lib/server";
import { Link, navigate, seg } from "../lib/router";
import { useToast } from "../lib/toast";
import { HUB_TYPES } from "../lib/se";
import { formatBytes, formatCount, formatDuration } from "../lib/util";
import { Sheet } from "../ui/Sheet";
import {
  IconChevron,
  IconLogs,
  IconPlus,
  IconPulse,
  IconSettings,
  IconTerminal,
} from "../ui/Icon";
import { OnlinePill } from "../ui/Status";

/**
 * The home screen, laid out as a deck: a greeting, a row of KPIs, the hubs
 * as a feed, and — on the light hero card — the server itself with its
 * uptime and the two actions an operator reaches for first.
 */
export function Dashboard() {
  const { probe, health, refresh } = useServer();
  const { user } = useAuth();
  const [resources, setResources] = useState<Wire | null>(null);
  const [overview, setOverview] = useState<Wire | null>(null);
  const [creatingHub, setCreatingHub] = useState(false);
  // Every limit on the server in one request, so each hub row can say
  // where it stands without a call per hub.
  const quotas = useQuotaIndex([]);

  const loadResources = useCallback(async () => {
    setResources(await api.resources().catch(() => null));
  }, []);
  usePoll(loadResources, "live", []);

  const loadOverview = useCallback(async () => {
    if (health === "online") setOverview(await api.overview().catch(() => null));
  }, [health]);
  usePoll(loadOverview, "detail", [health]);

  const history = useMemo(() => {
    const points = (resources?.history as Wire[]) ?? [];
    return {
      cpu: points.map((p) => Number(p.cpu) || 0),
      memory: points.map((p) => Number(p.memory) || 0),
      rx: points.map((p) => Number(p.rx) || 0),
      tx: points.map((p) => Number(p.tx) || 0),
    };
  }, [resources]);

  const section = (key: string): Wire | null =>
    overview?.[key]?.ok ? (overview[key].data as Wire) : null;
  const status = section("status");
  const hubs = section("hubs")?.HubList as Wire[] | undefined;
  const listeners = section("listeners")?.ListenerList as Wire[] | undefined;
  const ipsec = section("ipsec");
  const openvpn = section("openvpn");
  const azure = section("azure");
  const ddns = section("ddns");

  const uptimeSeconds = useMemo(() => {
    if (!status?.StartTime_dt || !status?.CurrentTime_dt) return null;
    return (new Date(status.CurrentTime_dt).getTime() - new Date(status.StartTime_dt).getTime()) / 1000;
  }, [status]);

  const hour = new Date().getHours();
  const daypart = hour < 5 ? "深夜好" : hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";

  return (
    <div className="page">
      <div className="hello">
        <div style={{ minWidth: 0 }}>
          <h1 className="hello__t">{daypart}{user ? `，${user}` : ""}</h1>
          <div className="hello__s">
            {probe?.online ? (
              <>VPN 服务器运行正常。<span className="mono">{probe.hostname} · {probe.version}</span></>
            ) : health === "offline" ? (
              "VPN 服务器没有响应。"
            ) : (
              "这里是本机及其 VPN 服务器的总览。"
            )}
          </div>
        </div>
      </div>

      {health === "unconfigured" ? (
        <Empty
          title="尚未连接 SoftEther"
          action={
            <Link to="/connect" className="btn btn--primary">
              连接服务器
            </Link>
          }
        >
          告诉面板本机 SoftEther 实例的管理端口和管理员密码，其余的一切随之点亮。
        </Empty>
      ) : health === "offline" ? (
        <ErrorAlert>
          <div className="alert__t">VPN 服务器没有响应。</div>
          {probe?.error} — <Link to="/connect" className="linkish">检查连接</Link>
        </ErrorAlert>
      ) : (
        <div className="dash">
          {/* ── main column ─────────────────────────────────────────────── */}
          <div className="dash__main">
            <div className="kpis stagger">
              <Kpi label="在线会话" value={formatCount(status?.NumSessionsTotal_u32)} sub="所有虚拟 HUB 合计" />
              <Kpi label="用户" value={formatCount(status?.NumUsers_u32)} sub="服务器上的账号" />
              <Kpi
                label="已接收"
                value={formatBytes((status?.["Recv.UnicastBytes_u64"] ?? 0) + (status?.["Recv.BroadcastBytes_u64"] ?? 0))}
                sub="自服务器启动以来"
              />
              <Kpi
                label="已发送"
                value={formatBytes((status?.["Send.UnicastBytes_u64"] ?? 0) + (status?.["Send.BroadcastBytes_u64"] ?? 0))}
                sub="自服务器启动以来"
              />
            </div>

            <div className="card panelcard">
              <div className="panelcard__h">
                <div style={{ minWidth: 0 }}>
                  <div className="panelcard__t">虚拟 HUB</div>
                  <div className="panelcard__s">
                    {hubs?.length
                      ? `本服务器上的 ${hubs.length} 个虚拟 HUB`
                      : "用户、会话与访问控制所在之处"}
                  </div>
                </div>
                <button className="btn btn--sm" onClick={() => setCreatingHub(true)}>
                  <IconPlus size={14} /> 新建 HUB
                </button>
              </div>
              {!hubs ? (
                <LoadingBlock label="正在加载虚拟 HUB" />
              ) : hubs.length === 0 ? (
                <p className="lede" style={{ margin: 0 }}>
                  虚拟 HUB 是用户、会话与访问控制所在之处。创建第一个吧。
                </p>
              ) : (
                <div className="feed">
                  {hubs.map((h) => {
                    const name = String(h.HubName_str ?? "");
                    const online = Boolean(h.Online_bool);
                    return (
                      <button key={name} className="feed__i" onClick={() => navigate(`/hub/${seg(name)}`)}>
                        <span className={`feed__ava${online ? " feed__ava--on" : ""}`}>{name.slice(0, 1)}</span>
                        <span className="feed__m">
                          <span className="feed__t">{name}</span>
                          <span className="feed__s">
                            {formatCount(h.NumUsers_u32)} 用户 · {formatCount(h.NumSessions_u32)} 会话 ·{" "}
                            {h.HubType_u32 !== undefined ? HUB_TYPES[h.HubType_u32 as number]?.split(" ")[0] : "—"}
                          </span>
                        </span>
                        <span className="feed__side">
                          <QuotaStatePill quota={quotas.get(quotaKey("hub", name))} />
                          <OnlinePill online={online} />
                          <IconChevron size={15} style={{ color: "var(--text-faint)" }} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* the machine under it all */}
            {resources === null ? null : resources.available === false ? (
              <div className="alert alert--info" style={{ marginBottom: 0 }}>
                <div>
                  <div className="alert__t">资源监控处于休眠状态。</div>
                  {String(resources.reason ?? "它只在存在 /proc 的环境运行 — 即 Linux 主机。")}
                </div>
              </div>
            ) : (
              <>
                <SectionTitle>本机</SectionTitle>
                <div className="metrics" style={{ marginBottom: 0 }}>
                  <CpuCard snapshot={resources} history={history.cpu} />
                  <MemoryCard snapshot={resources} history={history.memory} />
                  <SwapCard snapshot={resources} />
                  <DiskCard snapshot={resources} />
                  <NetworkCard snapshot={resources} rxHistory={history.rx} txHistory={history.tx} />
                </div>
              </>
            )}
          </div>

          {/* ── side column ─────────────────────────────────────────────── */}
          <div className="dash__side">
            <div className="inverse hero">
              <div className="hero__k">本服务器</div>
              <div className="hero__name mono truncate" title={probe?.hostname ?? ""}>
                {probe?.hostname ?? "—"}
              </div>
              <div className="hero__v">{uptimeSeconds ? formatDuration(uptimeSeconds) : "—"}</div>
              <div className="hero__s">VPN 运行时长 · {probe?.version ?? "版本未知"}</div>
              <div className="hero__actions">
                <button className="btn btn--sm" onClick={() => setCreatingHub(true)}>
                  <IconPlus size={14} /> 新建 HUB
                </button>
                <Link to="/server-settings" className="btn btn--sm btn--ghost">
                  <IconSettings size={14} /> 服务器设置
                </Link>
              </div>
            </div>

            <div className="card panelcard">
              <div className="panelcard__h">
                <div>
                  <div className="panelcard__t">接入协议</div>
                  <div className="panelcard__s">进入本服务器的方式</div>
                </div>
              </div>
              <div className="feed">
                <ProtocolRow label="SoftEther" on detail={`${(listeners ?? []).filter((l) => l.Enables_bool).map((l) => l.Ports_u32).join(", ") || "无监听端口"}`} />
                <ProtocolRow label="L2TP/IPsec" on={Boolean(ipsec?.L2TP_IPsec_bool)} detail={ipsec ? (ipsec.L2TP_IPsec_bool ? `默认 HUB ${ipsec.L2TP_DefaultHub_str || "—"}` : "未启用") : "—"} />
                <ProtocolRow label="OpenVPN" on={Boolean(openvpn?.EnableOpenVPN_bool)} detail={openvpn?.EnableOpenVPN_bool ? `UDP ${openvpn.OpenVPNPortList_str}` : "未启用"} />
                <ProtocolRow label="SSTP" on={Boolean(openvpn?.EnableSSTP_bool)} detail={openvpn?.EnableSSTP_bool ? "已启用" : "未启用"} />
                <ProtocolRow label="VPN Azure" on={Boolean(azure?.IsEnabled_bool)} detail={azure?.IsEnabled_bool ? (ddns?.CurrentHostName_str ? `${ddns.CurrentHostName_str}.vpnazure.net` : "已启用") : "未启用"} />
                <ProtocolRow label="DDNS" on={Boolean(ddns?.CurrentHostName_str)} detail={ddns?.CurrentFqdn_str || "—"} />
              </div>
            </div>

            <div className="card panelcard">
              <div className="panelcard__h">
                <div>
                  <div className="panelcard__t">工具</div>
                </div>
              </div>
              <div className="feed">
                <ToolRow to="/connections" icon={<IconPulse size={16} />} title="连接" sub="进入服务器的 TCP 连接，实时" />
                <ToolRow to="/logs" icon={<IconLogs size={16} />} title="日志" sub="服务器、HUB 安全与数据包日志" />
                <ToolRow to="/console" icon={<IconTerminal size={16} />} title="API 控制台" sub="全部 RPC 方法，可直接原生调用" />
                <ToolRow to="/server-settings" icon={<IconSettings size={16} />} title="服务器设置" sub="监听端口、证书、网桥…" />
              </div>
            </div>
          </div>
        </div>
      )}

      {creatingHub && (
        <CreateHubSheet
          onClose={() => setCreatingHub(false)}
          onCreated={() => {
            setCreatingHub(false);
            void loadOverview();
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="kpi">
      <div className="kpi__l">{label}</div>
      <div className="kpi__v">{value}</div>
      {sub && <div className="kpi__s">{sub}</div>}
    </div>
  );
}

function ProtocolRow({ label, on, detail }: { label: string; on: boolean; detail: string }) {
  return (
    <div className="feed__i" style={{ cursor: "default" }}>
      <span
        className="lamp__dot"
        style={{ marginInline: 6 }}
        data-on={on || undefined}
        aria-hidden="true"
      />
      <span className="feed__m">
        <span className="feed__t" style={{ fontSize: "var(--t-small)" }}>{label}</span>
        <span className="feed__s mono" title={detail}>{detail}</span>
      </span>
    </div>
  );
}

function ToolRow({ to, icon, title, sub }: { to: string; icon: React.ReactNode; title: string; sub: string }) {
  return (
    <Link to={to} className="feed__i">
      <span className="feed__ava" style={{ color: "var(--accent)" }}>{icon}</span>
      <span className="feed__m">
        <span className="feed__t" style={{ fontSize: "var(--t-small)" }}>{title}</span>
        <span className="feed__s">{sub}</span>
      </span>
      <IconChevron size={15} style={{ color: "var(--text-faint)" }} />
    </Link>
  );
}

function CreateHubSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const { guard } = useToast();

  const create = async () => {
    setBusy(true);
    const body: Wire = { HubName_str: name.trim(), Online_bool: online, HubType_u32: 0 };
    if (password) body.AdminPasswordPlainText_str = password;
    const ok = await guard(() => api.createHub(body), `虚拟 HUB ${name.trim()} 已创建。`);
    setBusy(false);
    if (ok) onCreated();
  };

  return (
    <Sheet
      title="新建虚拟 HUB"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn--primary" onClick={create} disabled={busy || !name.trim()}>
            {busy && <span className="spin" />} 创建 HUB
          </button>
        </>
      }
    >
      <Field label="名称" hint="字母、数字和 - _ 是安全字符。">
        <input className="input mono" value={name} onChange={(e) => setName(e.target.value)} autoFocus autoCapitalize="none" spellCheck={false} />
      </Field>
      <Field label="HUB 管理密码" hint="可选 — 允许某人只管理该 HUB。">
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
      </Field>
      <label className="checkrow">
        <input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)} />
        <span><span className="t">创建后立即上线</span></span>
      </label>
    </Sheet>
  );
}
