"use client";

import { useCallback, useState } from "react";
import { CheckRow, ConfirmSheet, Empty, Field, LoadingBlock, SectionTitle, usePoll } from "../../components/bits";
import { api, type Wire } from "../../lib/api";
import { useToast } from "../../lib/toast";
import { formatBytes, formatCount, formatDate, timeAgo } from "../../lib/util";
import { Pill } from "../../ui/Status";
import { OutcomeNote, Switch, useToggle } from "../../ui/Switch";

/**
 * SecureNAT: the hub's built-in router. One switch, a NAT/DHCP options form,
 * and the two live tables (NAT sessions, DHCP leases) that show what it is
 * actually doing.
 *
 * Whether it is on comes from the hub status flag the backend folds into the
 * overview -- `GetSecureNATStatus` answers happily either way and says
 * nothing about it. The switch confirms before it moves in both directions
 * (enabling next to a real DHCP server is a classic way to break a LAN), then
 * shows the state read back rather than the state clicked.
 */
export function HubSecureNat({ hub }: { hub: string }) {
  const [data, setData] = useState<Wire | null>(null);
  const [options, setOptions] = useState<Wire | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState<null | boolean>(null);
  const { guard } = useToast();

  const absorb = useCallback(
    (r: Wire) => {
      setData(r);
      setOptions((current) => (dirty ? current : (r.options as Wire)));
    },
    [dirty],
  );

  const load = useCallback(async () => {
    const r = await api.securenat(hub).catch(() => null);
    if (r) absorb(r);
    return r ? Boolean(r.enabled) : null;
  }, [hub, absorb]);
  usePoll(load, "detail", [hub]);

  const enabled = Boolean(data?.enabled);
  const toggle = useToggle({
    value: data ? enabled : null,
    apply: async (next) => {
      const r = await api.securenatEnable(hub, next);
      absorb(r);
      return Boolean(r.enabled);
    },
    reload: load,
    noun: "SecureNAT",
    onWord: "已启用",
    offWord: "已停用",
  });

  if (!data || !options) return <LoadingBlock label="正在查询 HUB" />;

  const status = data.status as Wire;
  const hubOnline = data.hub_online !== false;

  const set = (k: string, v: unknown) => {
    setOptions((o) => ({ ...(o ?? {}), [k]: v }));
    setDirty(true);
  };

  const save = () =>
    guard(async () => {
      const body = { ...options };
      delete body.RpcHubName_str;
      await api.setSecurenatOptions(hub, body);
      setDirty(false);
      await load();
    }, "SecureNAT 选项已保存。");

  return (
    <>
      <SectionTitle
        actions={
          <span className="switchbox">
            <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--s3)" }}>
              <Pill kind={enabled ? "ok" : "idle"} label={enabled ? "已启用" : "已停用"} />
              <Switch
                on={enabled}
                pending={toggle.pending}
                target={toggle.target}
                onToggle={() => setConfirming(!enabled)}
                label="SecureNAT"
                onWord="已启用"
                offWord="已停用"
              />
            </span>
            <OutcomeNote outcome={toggle.outcome} />
          </span>
        }
      >
        SecureNAT
      </SectionTitle>

      <div className={`alert ${enabled ? "alert--ok" : ""}`} style={{ marginBottom: "var(--s4)" }}>
        <div>
          <div className="alert__t">
            {enabled ? "SecureNAT 已启用" : "SecureNAT 已停用"}
            {toggle.pending ? " — 正在切换…" : ""}
          </div>
          {enabled ? (
            <>
              虚拟 NAT{options.UseNat_bool ? "" : "（已在选项中关闭）"}与 DHCP 服务器
              {options.UseDhcp_bool ? "" : "（已在选项中关闭）"}运行在 <b>{hub}</b> 内
              {status?.Ip_ip ? <>，地址为 <span className="mono">{String(status.Ip_ip)}</span></> : null}。
              {!hubOnline && " 虚拟 HUB 本身当前离线，在它恢复之前不会提供任何服务。"}
            </>
          ) : (
            <>连接到 <b>{hub}</b> 的客户端将没有虚拟路由器：无法通过 NAT 上网，也没有 DHCP 租约。下方的选项会保留，一旦启用立即生效。</>
          )}
        </div>
      </div>

      <div className="fleet">
        <div className="fleet__cell"><div className="fleet__n">{enabled ? formatCount(Number(status?.NumTcpSessions_u32)) : "—"}</div><div className="micro">TCP 会话</div></div>
        <div className="fleet__cell"><div className="fleet__n">{enabled ? formatCount(Number(status?.NumUdpSessions_u32)) : "—"}</div><div className="micro">UDP 会话</div></div>
        <div className="fleet__cell"><div className="fleet__n">{enabled ? formatCount(Number(status?.NumIcmpSessions_u32)) : "—"}</div><div className="micro">ICMP</div></div>
        <div className="fleet__cell"><div className="fleet__n">{enabled ? formatCount(Number(status?.NumDhcpClients_u32)) : "—"}</div><div className="micro">DHCP 客户端</div></div>
        <div className="fleet__cell"><div className="fleet__n">{status?.IsKernelMode_bool ? "内核" : status?.IsRawIpMode_bool ? "raw IP" : "用户态"}</div><div className="micro">NAT 模式</div></div>
      </div>

      <SectionTitle>虚拟路由器</SectionTitle>
      <div className="card" style={{ padding: "var(--s4)", maxWidth: 720 }}>
        <div className="row2">
          <Field label="虚拟 IP" hint="路由器在虚拟 HUB 内部自己的地址。">
            <input className="input mono" value={String(options.Ip_ip ?? "")} onChange={(e) => set("Ip_ip", e.target.value)} spellCheck={false} inputMode="decimal" />
          </Field>
          <Field label="子网掩码">
            <input className="input mono" value={String(options.Mask_ip ?? "")} onChange={(e) => set("Mask_ip", e.target.value)} spellCheck={false} inputMode="decimal" />
          </Field>
        </div>
        <div className="row2">
          <Field label="MTU">
            <input className="input mono" type="number" min={576} max={1500} value={Number(options.Mtu_u32 ?? 1500)} onChange={(e) => set("Mtu_u32", Number(e.target.value))} />
          </Field>
          <div />
        </div>

        <CheckRow checked={Boolean(options.UseNat_bool)} onChange={(v) => set("UseNat_bool", v)}
          label="虚拟 NAT" hint="客户端经虚拟 HUB 上网，地址被转换为宿主机地址。" />
        {Boolean(options.UseNat_bool) && (
          <div className="row2">
            <Field label="TCP 超时（秒）">
              <input className="input mono" type="number" min={1} value={Number(options.NatTcpTimeout_u32 ?? 1800)} onChange={(e) => set("NatTcpTimeout_u32", Number(e.target.value))} />
            </Field>
            <Field label="UDP 超时（秒）">
              <input className="input mono" type="number" min={1} value={Number(options.NatUdpTimeout_u32 ?? 60)} onChange={(e) => set("NatUdpTimeout_u32", Number(e.target.value))} />
            </Field>
          </div>
        )}

        <CheckRow checked={Boolean(options.UseDhcp_bool)} onChange={(v) => set("UseDhcp_bool", v)}
          label="虚拟 DHCP 服务器" hint="客户端连接时向其分发地址。" />
        {Boolean(options.UseDhcp_bool) && (
          <>
            <div className="row2">
              <Field label="租约范围起始">
                <input className="input mono" value={String(options.DhcpLeaseIPStart_ip ?? "")} onChange={(e) => set("DhcpLeaseIPStart_ip", e.target.value)} spellCheck={false} inputMode="decimal" />
              </Field>
              <Field label="租约范围结束">
                <input className="input mono" value={String(options.DhcpLeaseIPEnd_ip ?? "")} onChange={(e) => set("DhcpLeaseIPEnd_ip", e.target.value)} spellCheck={false} inputMode="decimal" />
              </Field>
            </div>
            <div className="row2">
              <Field label="下发的网关" hint="通常为上方的虚拟 IP。">
                <input className="input mono" value={String(options.DhcpGatewayAddress_ip ?? "")} onChange={(e) => set("DhcpGatewayAddress_ip", e.target.value)} spellCheck={false} inputMode="decimal" />
              </Field>
              <Field label="租约时长（秒）">
                <input className="input mono" type="number" min={60} value={Number(options.DhcpExpireTimeSpan_u32 ?? 7200)} onChange={(e) => set("DhcpExpireTimeSpan_u32", Number(e.target.value))} />
              </Field>
            </div>
            <div className="row2">
              <Field label="DNS 服务器">
                <input className="input mono" value={String(options.DhcpDnsServerAddress_ip ?? "")} onChange={(e) => set("DhcpDnsServerAddress_ip", e.target.value)} spellCheck={false} inputMode="decimal" />
              </Field>
              <Field label="DNS 服务器 2">
                <input className="input mono" value={String(options.DhcpDnsServerAddress2_ip ?? "")} onChange={(e) => set("DhcpDnsServerAddress2_ip", e.target.value)} spellCheck={false} inputMode="decimal" />
              </Field>
            </div>
            <Field label="域名">
              <input className="input mono" value={String(options.DhcpDomainName_str ?? "")} onChange={(e) => set("DhcpDomainName_str", e.target.value)} spellCheck={false} />
            </Field>
            <Field label="下发的静态路由" hint="以逗号分隔的 网络/掩码/网关 三元组，例如 192.168.5.0/255.255.255.0/10.0.0.2">
              <input className="input mono" value={String(options.DhcpPushRoutes_str ?? "")} onChange={(e) => { set("DhcpPushRoutes_str", e.target.value); set("ApplyDhcpPushRoutes_bool", true); }} spellCheck={false} />
            </Field>
          </>
        )}
        <CheckRow checked={Boolean(options.SaveLog_bool)} onChange={(v) => set("SaveLog_bool", v)}
          label="记录 SecureNAT 日志" />

        {dirty && (
          <button className="btn btn--primary" onClick={() => void save()}>保存选项</button>
        )}
      </div>

      <NatTables hub={hub} enabled={enabled} />

      {confirming !== null && (
        <ConfirmSheet
          title={confirming ? "启用 SecureNAT？" : "停用 SecureNAT？"}
          verb={confirming ? "启用" : "停用"}
          danger={!confirming}
          body={
            confirming ? (
              <>
                虚拟 NAT 与 DHCP 服务器将在 <b>{hub}</b> 内启动。切勿在已桥接到含有 DHCP
                服务器的网络上启用 — 两者会互相冲突。
              </>
            ) : (
              <>依赖虚拟路由器的客户端将立即失去上网路径。</>
            )
          }
          onClose={() => setConfirming(null)}
          onConfirm={() => {
            // The sheet closes at once; the switch shows the request in
            // flight and then whatever the server reports.
            void toggle.toggle(confirming);
          }}
        />
      )}
    </>
  );
}

function NatTables({ hub, enabled }: { hub: string; enabled: boolean }) {
  const [tab, setTab] = useState<"nat" | "dhcp">("nat");
  const [nat, setNat] = useState<Wire[] | null>(null);
  const [dhcp, setDhcp] = useState<Wire[] | null>(null);

  const load = useCallback(async () => {
    if (tab === "nat") {
      const r = await api.natTable(hub).catch(() => null);
      if (r) setNat((r.NatTable as Wire[]) ?? []);
    } else {
      const r = await api.dhcpTable(hub).catch(() => null);
      if (r) setDhcp((r.DhcpTable as Wire[]) ?? []);
    }
  }, [hub, tab]);
  usePoll(load, "detail", [hub, tab]);

  const PROTO: Record<number, string> = { 0: "UDP", 1: "TCP", 2: "DNS", 3: "ICMP" };

  return (
    <>
      <SectionTitle
        actions={
          <div className="seg">
            <button className={tab === "nat" ? "on" : ""} onClick={() => setTab("nat")}>NAT 会话</button>
            <button className={tab === "dhcp" ? "on" : ""} onClick={() => setTab("dhcp")}>DHCP 租约</button>
          </div>
        }
      >
        实时表
      </SectionTitle>

      {tab === "nat" ? (
        nat === null ? (
          <LoadingBlock />
        ) : nat.length === 0 ? (
          <Empty title="暂无 NAT 会话">
            {enabled
              ? "客户端经由虚拟 NAT 通信时，转换条目会随之出现。"
              : "SecureNAT 已停用，因此没有任何地址转换。"}
          </Empty>
        ) : (
          <div className="card tcard">
            <div className="tscroll">
              <table className="dtable">
                <thead>
                  <tr>
                    <th>协议</th><th>来源</th><th>目标</th><th>流量</th><th>最近活动</th>
                  </tr>
                </thead>
                <tbody>
                  {nat.slice(0, 200).map((n) => (
                    <tr key={String(n.Id_u32)}>
                      <td>{PROTO[Number(n.Protocol_u32)] ?? n.Protocol_u32}</td>
                      <td className="tmono">{String(n.SrcIp_ip)}:{String(n.SrcPort_u32)}</td>
                      <td className="tmono">{String(n.DestHost_str || n.DestIp_ip)}:{String(n.DestPort_u32)}</td>
                      <td className="tmono">{formatBytes(Number(n.SendSize_u64) + Number(n.RecvSize_u64))}</td>
                      <td className="tmono">{timeAgo(n.LastCommTime_dt as string)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {nat.length > 200 && <div className="micro" style={{ padding: "var(--s2) var(--s4)" }}>显示前 200 条，共 {nat.length} 条</div>}
          </div>
        )
      ) : dhcp === null ? (
        <LoadingBlock />
      ) : dhcp.length === 0 ? (
        <Empty title="暂无租约">
          {enabled
            ? "虚拟 DHCP 服务器分发地址后，租约会随之出现。"
            : "SecureNAT 已停用，因此不会分发任何地址。"}
        </Empty>
      ) : (
        <div className="card tcard">
          <div className="tscroll">
            <table className="dtable">
              <thead>
                <tr><th>IP</th><th>MAC</th><th>主机名</th><th>租约时间</th><th>过期时间</th></tr>
              </thead>
              <tbody>
                {dhcp.map((l) => (
                  <tr key={String(l.Id_u32)}>
                    <td className="tmono">{String(l.IpAddress_ip)}</td>
                    <td className="tmono">{formatMac(String(l.MacAddress_bin ?? ""))}</td>
                    <td className="tmono">{String(l.Hostname_str || "—")}</td>
                    <td className="tmono">{timeAgo(l.LeasedTime_dt as string)}</td>
                    <td className="tmono">{formatDate(l.ExpireTime_dt as string)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/** Wire MACs are base64 bytes; people read colon-hex. */
export function formatMac(b64: string): string {
  try {
    return Array.from(atob(b64))
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join(":");
  } catch {
    return b64 || "—";
  }
}
