"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckRow, ConfirmSheet, Empty, ErrorAlert, Field, KV, LoadingBlock, PageHead, SectionTitle, usePoll } from "../components/bits";
import { api, type Wire } from "../lib/api";
import { Link } from "../lib/router";
import { useToast } from "../lib/toast";
import { downloadBase64, fileToBase64, formatBytes, formatDate, timeAgo } from "../lib/util";
import { IconDownload, IconPlus, IconTrash, IconUpload } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
import { OnlinePill, Pill } from "../ui/Status";
import { OutcomeNote, Switch, SwitchRow, useToggle } from "../ui/Switch";

/**
 * Everything server-wide, as one scrolling document of cards -- listeners,
 * protocols, encryption, bridges, layer-3 switches, clustering, keep-alive,
 * syslog, the configuration file, and the danger zone. Tabs would hide
 * state; a document lets an operator scan all of it.
 */
export function ServerSettings({ section }: { section?: string }) {
  useEffect(() => {
    if (section) {
      requestAnimationFrame(() =>
        document.getElementById(`ss-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
  }, [section]);

  return (
    <div className="page">
      <PageHead title="服务器设置" sub={<Link to="/" className="linkish">← 仪表盘</Link>} />
      <div className="setdoc">
        <ListenersCard />
        <ProtocolsCard />
        <EncryptionCard />
        <BridgeCard />
        <L3Card />
        <EtherIpCard />
        <FarmCard />
        <KeepSyslogCard />
        <ConfigCard />
        <DangerZone />
      </div>
    </div>
  );
}

/* ── listeners ────────────────────────────────────────────────────────────── */

function ListenersCard() {
  const [listeners, setListeners] = useState<Wire[] | null>(null);
  const [special, setSpecial] = useState<Wire | null>(null);
  const [adding, setAdding] = useState(false);
  const [newPort, setNewPort] = useState(5555);
  const { guard } = useToast();

  const load = useCallback(async () => {
    const r = await api.listeners().catch(() => null);
    const list = r ? ((r.ListenerList as Wire[]) ?? []) : null;
    if (list) setListeners(list);
    setSpecial(await api.specialListener().catch(() => null));
    return list;
  }, []);
  usePoll(load, "list", []);

  return (
    <section id="ss-listeners">
      <SectionTitle
        count={listeners?.length}
        actions={
          <button className="btn btn--sm" onClick={() => setAdding(true)}>
            <IconPlus size={14} /> 添加端口
          </button>
        }
      >
        TCP 监听
      </SectionTitle>
      <div className="card" style={{ padding: "var(--s3) var(--s4)" }}>
        {listeners === null ? (
          <LoadingBlock />
        ) : (
          listeners.map((l) => (
            <div key={String(l.Ports_u32)} className="lrow">
              <span className="mono" style={{ fontSize: "var(--t-data)", fontWeight: 600 }}>{String(l.Ports_u32)}</span>
              {l.Errors_bool ? (
                <span title="该端口已启用但无法打开 — 被其他程序占用。"><Pill kind="err" label="无法打开" /></span>
              ) : (
                <OnlinePill online={Boolean(l.Enables_bool)} onLabel="监听中" offLabel="已停用" />
              )}
              <span style={{ flex: 1 }} />
              <ListenerSwitch listener={l} reload={load} />
              <button
                className="btn btn--sm btn--ghost"
                onClick={() => void guard(async () => {
                  await api.deleteListener(Number(l.Ports_u32));
                  await load();
                }, `监听端口 ${l.Ports_u32} 已删除。`)}
                aria-label="删除监听端口"
              >
                <IconTrash size={14} />
              </button>
            </div>
          ))
        )}
        {special && (
          <div style={{ marginTop: "var(--s3)" }}>
            <SpecialListenerSwitch
              special={special}
              field="VpnOverIcmpListener_bool"
              label="VPN over ICMP"
              hint="客户端把流量封装在 ping 包中 — 可穿过几乎什么都不放行的网络。"
              onFresh={setSpecial}
            />
            <SpecialListenerSwitch
              special={special}
              field="VpnOverDnsListener_bool"
              label="VPN over DNS"
              hint="封装在 UDP 53 的 DNS 查询中。速度慢，属于最后手段。"
              onFresh={setSpecial}
            />
          </div>
        )}
      </div>
      {adding && (
        <Sheet
          title="新建监听端口"
          onClose={() => setAdding(false)}
          footer={
            <>
              <button className="btn" onClick={() => setAdding(false)}>取消</button>
              <button
                className="btn btn--primary"
                onClick={() => void guard(async () => {
                  await api.createListener(newPort, true);
                  setAdding(false);
                  await load();
                }, `正在监听 ${newPort}。`)}
              >
                添加
              </button>
            </>
          }
        >
          <Field label="TCP 端口">
            <input className="input mono" type="number" min={1} max={65535} value={newPort} onChange={(e) => setNewPort(Number(e.target.value))} inputMode="numeric" />
          </Field>
        </Sheet>
      )}
    </section>
  );
}

/** One listener's switch. The word beside it is the request; the pill in the
 *  row is the server's answer, read back after every change. */
function ListenerSwitch({ listener, reload }: { listener: Wire; reload: () => Promise<Wire[] | null> }) {
  const port = Number(listener.Ports_u32);
  const toggle = useToggle({
    value: Boolean(listener.Enables_bool),
    apply: async (next) => {
      const r = await api.toggleListener(port, next);
      return Boolean(r.enabled);
    },
    reload: async () => {
      const list = await reload();
      const me = list?.find((x) => Number(x.Ports_u32) === port);
      return me ? Boolean(me.Enables_bool) : null;
    },
    noun: `监听端口 ${port}`,
    onWord: "已启用",
    offWord: "已停用",
  });
  return (
    <span className="switchbox">
      <Switch
        on={Boolean(listener.Enables_bool)}
        pending={toggle.pending}
        target={toggle.target}
        onToggle={() => void toggle.toggle()}
        label={`端口 ${port} 的监听`}
      />
      <OutcomeNote outcome={toggle.outcome} />
    </span>
  );
}

/** VPN-over-ICMP and VPN-over-DNS share one settings object; each switch
 *  rewrites its own flag and reads the object back. */
function SpecialListenerSwitch({
  special,
  field,
  label,
  hint,
  onFresh,
}: {
  special: Wire;
  field: "VpnOverIcmpListener_bool" | "VpnOverDnsListener_bool";
  label: string;
  hint: string;
  onFresh: (fresh: Wire) => void;
}) {
  const on = Boolean(special[field]);
  const toggle = useToggle({
    value: on,
    apply: async (next) => {
      const r = await api.setSpecialListener({ ...special, [field]: next });
      onFresh(r);
      return Boolean(r[field]);
    },
    reload: async () => {
      const r = await api.specialListener().catch(() => null);
      if (r) onFresh(r);
      return r ? Boolean(r[field]) : null;
    },
    noun: label,
    onWord: "已启用",
    offWord: "已停用",
  });
  return (
    <SwitchRow
      label={label}
      hint={hint}
      toggle={toggle}
      on={on}
      status={<Pill kind={on ? "ok" : "idle"} label={on ? "已启用" : "已停用"} />}
    />
  );
}

/* ── protocols ────────────────────────────────────────────────────────────── */

/** VPN Azure: the switch, and beside it what the relay itself reports --
 *  enabled is a wish until the server says "connected". */
function AzureSwitch({ azure, onFresh }: { azure: Wire; onFresh: (fresh: Wire) => void }) {
  const on = Boolean(azure.IsEnabled_bool);
  const connected = Boolean(azure.IsConnected_bool);
  const toggle = useToggle({
    value: on,
    apply: async (next) => {
      const r = await api.setAzure(next);
      onFresh(r);
      return Boolean(r.IsEnabled_bool);
    },
    reload: async () => {
      const r = await api.azure().catch(() => null);
      if (r) onFresh(r);
      return r ? Boolean(r.IsEnabled_bool) : null;
    },
    noun: "VPN Azure",
    onWord: "已启用",
    offWord: "已停用",
  });
  return (
    <SwitchRow
      label="VPN Azure 中继"
      hint="即使身在 NAT 之后也可通过 <hostname>.vpnazure.net 访问。"
      toggle={toggle}
      on={on}
      status={
        on ? (
          <Pill kind={connected ? "ok" : "busy"} label={connected ? "已连接" : "连接中"} />
        ) : (
          <Pill kind="idle" label="已停用" />
        )
      }
    />
  );
}

function ProtocolsCard() {
  const [ipsec, setIpsec] = useState<Wire | null>(null);
  const [openvpn, setOpenvpn] = useState<Wire | null>(null);
  const [azure, setAzure] = useState<Wire | null>(null);
  const [ddns, setDdns] = useState<Wire | null>(null);
  const [hubs, setHubs] = useState<string[]>([]);
  const [secret, setSecret] = useState("");
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [ddnsHost, setDdnsHost] = useState("");
  const { guard } = useToast();

  const load = useCallback(async () => {
    const [i, o, a, d, h] = await Promise.all([
      api.ipsec().catch(() => null),
      api.openvpn().catch(() => null),
      api.azure().catch(() => null),
      api.ddns().catch(() => null),
      api.hubs().catch(() => null),
    ]);
    if (!dirty.ipsec && i) { setIpsec(i); setSecret(String(i.IPsec_Secret_str ?? "")); }
    if (!dirty.openvpn && o) setOpenvpn(o);
    if (a) setAzure(a);
    if (d) setDdns(d);
    if (h) setHubs(((h.HubList as Wire[]) ?? []).map((x) => String(x.HubName_str)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  usePoll(load, "list", []);

  return (
    <section id="ss-protocols">
      <SectionTitle>接入协议</SectionTitle>
      <div className="setgrid">
        {/* IPsec / L2TP */}
        <div className="card" style={{ padding: "var(--s4)" }}>
          <div className="section__t" style={{ marginBottom: "var(--s3)" }}>L2TP / IPsec / EtherIP</div>
          {!ipsec ? (
            <LoadingBlock />
          ) : (
            <>
              <CheckRow checked={Boolean(ipsec.L2TP_IPsec_bool)} onChange={(v) => { setIpsec({ ...ipsec, L2TP_IPsec_bool: v }); setDirty((d) => ({ ...d, ipsec: true })); }}
                label="L2TP over IPsec" hint="iOS、Android 和 Windows 内置的 VPN。" />
              <CheckRow checked={Boolean(ipsec.L2TP_Raw_bool)} onChange={(v) => { setIpsec({ ...ipsec, L2TP_Raw_bool: v }); setDirty((d) => ({ ...d, ipsec: true })); }}
                label="裸 L2TP（无加密）" hint="仅供不支持 IPsec 的设备。" />
              <CheckRow checked={Boolean(ipsec.EtherIP_IPsec_bool)} onChange={(v) => { setIpsec({ ...ipsec, EtherIP_IPsec_bool: v }); setDirty((d) => ({ ...d, ipsec: true })); }}
                label="EtherIP / L2TPv3 over IPsec" hint="供路由器做站对站连接；客户端 ID 在下方定义。" />
              <Field label="IPsec 预共享密钥" hint="客户端输入的“预共享密钥”。保持简短 — 某些设备在 9 个字符处截断。">
                <input className="input mono" value={secret} onChange={(e) => { setSecret(e.target.value); setDirty((d) => ({ ...d, ipsec: true })); }} autoCapitalize="none" spellCheck={false} />
              </Field>
              <Field label="默认虚拟 HUB" hint="L2TP 用户未指明虚拟 HUB 时的落脚点。">
                <select className="select" value={String(ipsec.L2TP_DefaultHub_str ?? "")} onChange={(e) => { setIpsec({ ...ipsec, L2TP_DefaultHub_str: e.target.value }); setDirty((d) => ({ ...d, ipsec: true })); }}>
                  {hubs.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </Field>
              {dirty.ipsec && (
                <button className="btn btn--primary" onClick={() => void guard(async () => {
                  await api.setIpsec({
                    L2TP_Raw_bool: Boolean(ipsec.L2TP_Raw_bool),
                    L2TP_IPsec_bool: Boolean(ipsec.L2TP_IPsec_bool),
                    EtherIP_IPsec_bool: Boolean(ipsec.EtherIP_IPsec_bool),
                    IPsec_Secret_str: secret,
                    L2TP_DefaultHub_str: String(ipsec.L2TP_DefaultHub_str ?? ""),
                  });
                  setDirty((d) => ({ ...d, ipsec: false }));
                }, "IPsec 设置已保存。")}>
                  保存 IPsec
                </button>
              )}
            </>
          )}
        </div>

        {/* OpenVPN / SSTP */}
        <div className="card" style={{ padding: "var(--s4)" }}>
          <div className="section__t" style={{ marginBottom: "var(--s3)" }}>OpenVPN 与 SSTP 克隆</div>
          {!openvpn ? (
            <LoadingBlock />
          ) : (
            <>
              <CheckRow checked={Boolean(openvpn.EnableOpenVPN_bool)} onChange={(v) => { setOpenvpn({ ...openvpn, EnableOpenVPN_bool: v }); setDirty((d) => ({ ...d, openvpn: true })); }}
                label="OpenVPN 服务器" hint="原生 OpenVPN 客户端可直接连接本服务器。" />
              <Field label="OpenVPN UDP 端口" hint="以逗号分隔。">
                <input className="input mono" value={String(openvpn.OpenVPNPortList_str ?? "")} onChange={(e) => { setOpenvpn({ ...openvpn, OpenVPNPortList_str: e.target.value }); setDirty((d) => ({ ...d, openvpn: true })); }} spellCheck={false} inputMode="numeric" />
              </Field>
              <CheckRow checked={Boolean(openvpn.EnableSSTP_bool)} onChange={(v) => { setOpenvpn({ ...openvpn, EnableSSTP_bool: v }); setDirty((d) => ({ ...d, openvpn: true })); }}
                label="SSTP 服务器" hint="基于 443 端口的 Microsoft SSTP。需要客户端信任服务器证书。" />
              <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap" }}>
                {dirty.openvpn && (
                  <button className="btn btn--primary" onClick={() => void guard(async () => {
                    await api.setOpenvpn({
                      EnableOpenVPN_bool: Boolean(openvpn.EnableOpenVPN_bool),
                      OpenVPNPortList_str: String(openvpn.OpenVPNPortList_str ?? "1194"),
                      EnableSSTP_bool: Boolean(openvpn.EnableSSTP_bool),
                    });
                    setDirty((d) => ({ ...d, openvpn: false }));
                  }, "OpenVPN/SSTP 设置已保存。")}>
                    保存
                  </button>
                )}
                <button className="btn" onClick={() => void guard(async () => {
                  const r = await api.openvpnSample();
                  downloadBase64(r.filename, r.zip_base64, "application/zip");
                }, "示例客户端配置已下载。")}>
                  <IconDownload size={14} /> 示例客户端配置
                </button>
              </div>
            </>
          )}
        </div>

        {/* Azure + DDNS */}
        <div className="card" style={{ padding: "var(--s4)" }}>
          <div className="section__t" style={{ marginBottom: "var(--s3)" }}>VPN Azure 与动态 DNS</div>
          {!azure || !ddns ? (
            <LoadingBlock />
          ) : (
            <>
              <AzureSwitch azure={azure} onFresh={setAzure} />
              <KV rows={[
                ["DDNS 主机名", String(ddns.CurrentHostName_str || "—")],
                ["FQDN", String(ddns.CurrentFqdn_str || "—")],
                ["IPv4", String(ddns.CurrentIPv4_str || "—")],
                ["最近错误", Number(ddns.Err_IPv4_u32 ?? 0) === 0 ? "无" : String(ddns.ErrStr_IPv4_utf || `代码 ${ddns.Err_IPv4_u32}`)],
              ]} />
              <Field label="更改 DDNS 主机名" hint="<name>.softether.net 中 <name> 的部分 — 必须全球唯一。">
                <div style={{ display: "flex", gap: "var(--s2)" }}>
                  <input className="input mono" value={ddnsHost} onChange={(e) => setDdnsHost(e.target.value)} placeholder={String(ddns.CurrentHostName_str ?? "")} autoCapitalize="none" spellCheck={false} />
                  <button className="btn" disabled={!ddnsHost.trim()} onClick={() => void guard(async () => {
                    await api.setDdnsHostname(ddnsHost.trim());
                    setDdnsHost("");
                    await load();
                  }, "DDNS 主机名已更改。")}>
                    应用
                  </button>
                </div>
              </Field>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/* ── encryption & certificate ─────────────────────────────────────────────── */

function EncryptionCard() {
  const [cipher, setCipher] = useState<string | null>(null);
  const [cipherDirty, setCipherDirty] = useState(false);
  const [adminPw, setAdminPw] = useState("");
  const [regenCn, setRegenCn] = useState("");
  const [confirmingRegen, setConfirmingRegen] = useState(false);
  const { guard } = useToast();

  useEffect(() => {
    void api.cipher().then((r) => setCipher(String(r.String_str ?? ""))).catch(() => {});
  }, []);

  const uploadCertAndKey = async (certFile: File, keyFile: File) => {
    const [c, k] = await Promise.all([fileToBase64(certFile), fileToBase64(keyFile)]);
    await guard(() => api.setCert(c, k), "证书已替换。");
  };

  return (
    <section id="ss-encryption">
      <SectionTitle>加密与证书</SectionTitle>
      <div className="setgrid">
        <div className="card" style={{ padding: "var(--s4)" }}>
          <div className="section__t" style={{ marginBottom: "var(--s3)" }}>加密算法</div>
          <Field label="VPN 会话的 TLS 加密算法" hint="名称以 SoftEther 的写法为准，例如 AES128-SHA。服务器实际接受哪些取决于其构建。">
            <input className="input mono" value={cipher ?? ""} onChange={(e) => { setCipher(e.target.value); setCipherDirty(true); }} spellCheck={false} />
          </Field>
          {cipherDirty && (
            <button className="btn btn--primary" onClick={() => void guard(async () => {
              await api.setCipher(cipher ?? "");
              setCipherDirty(false);
            }, "加密算法已保存。")}>
              保存加密算法
            </button>
          )}
          <div className="section__t" style={{ margin: "var(--s4) 0 var(--s3)" }}>管理员密码</div>
          <Field label="新密码" hint="修改 VPN 服务器自身的管理员密码；面板会同步更新自己保存的副本。">
            <div style={{ display: "flex", gap: "var(--s2)" }}>
              <input className="input" type="password" value={adminPw} onChange={(e) => setAdminPw(e.target.value)} autoComplete="off" />
              <button className="btn" disabled={!adminPw} onClick={() => void guard(async () => {
                await api.setAdminPassword(adminPw);
                setAdminPw("");
              }, "管理员密码已修改。")}>
                修改
              </button>
            </div>
          </Field>
        </div>

        <div className="card" style={{ padding: "var(--s4)" }}>
          <div className="section__t" style={{ marginBottom: "var(--s3)" }}>服务器证书</div>
          <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap", marginBottom: "var(--s3)" }}>
            <button className="btn" onClick={() => void guard(async () => {
              const r = await api.cert();
              downloadBase64("server.cer", String(r.cert_base64 ?? ""), "application/pkix-cert");
            })}>
              <IconDownload size={14} /> 下载证书
            </button>
            <button className="btn" onClick={() => setConfirmingRegen(true)}>重新生成自签名证书</button>
          </div>
          <CertUpload onUpload={uploadCertAndKey} />
        </div>
      </div>
      {confirmingRegen && (
        <Sheet
          title="重新生成服务器证书"
          onClose={() => setConfirmingRegen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmingRegen(false)}>取消</button>
              <button className="btn btn--danger" disabled={!regenCn.trim()} onClick={() => void guard(async () => {
                await api.regenerateCert(regenCn.trim());
                setConfirmingRegen(false);
              }, "证书已重新生成。")}>
                重新生成
              </button>
            </>
          }
        >
          <div className="lede" style={{ marginBottom: "var(--s3)" }}>
            新的自签名证书会立即替换当前证书。固定了旧证书的客户端（以及 SSTP 客户端）
            在信任新证书之前会报错。
          </div>
          <Field label="通用名（CN）" hint="通常为服务器的公网主机名。">
            <input className="input mono" value={regenCn} onChange={(e) => setRegenCn(e.target.value)} placeholder="vpn.example.net" spellCheck={false} autoCapitalize="none" />
          </Field>
        </Sheet>
      )}
    </section>
  );
}

function CertUpload({ onUpload }: { onUpload: (cert: File, key: File) => Promise<void> }) {
  const [cert, setCert] = useState<File | null>(null);
  const [key, setKey] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Field label="替换为你自己的证书（证书 + 私钥）">
        <input className="input" type="file" accept=".cer,.crt,.pem" onChange={(e) => setCert(e.target.files?.[0] ?? null)} />
      </Field>
      <Field label="私钥">
        <input className="input" type="file" accept=".key,.pem" onChange={(e) => setKey(e.target.files?.[0] ?? null)} />
      </Field>
      <button
        className="btn btn--primary"
        disabled={!cert || !key || busy}
        onClick={async () => {
          if (!cert || !key) return;
          setBusy(true);
          await onUpload(cert, key);
          setBusy(false);
          setCert(null);
          setKey(null);
        }}
      >
        {busy && <span className="spin" />} <IconUpload size={14} /> 安装证书
      </button>
    </>
  );
}

/* ── local bridge ─────────────────────────────────────────────────────────── */

function BridgeCard() {
  const [bridges, setBridges] = useState<Wire[] | null>(null);
  const [support, setSupport] = useState<Wire | null>(null);
  const [adding, setAdding] = useState(false);
  const { guard } = useToast();

  const load = useCallback(async () => {
    const [b, s] = await Promise.all([
      api.bridges().catch(() => null),
      api.bridgeSupport().catch(() => null),
    ]);
    if (b) setBridges((b.LocalBridgeList as Wire[]) ?? []);
    if (s) setSupport(s);
  }, []);
  usePoll(load, "list", []);

  return (
    <section id="ss-bridge">
      <SectionTitle
        count={bridges?.length}
        actions={
          <button className="btn btn--sm" onClick={() => setAdding(true)} disabled={support ? !support.IsBridgeSupportedOs_bool : false}>
            <IconPlus size={14} /> 新建网桥
          </button>
        }
      >
        本地网桥
      </SectionTitle>
      {support && !support.IsBridgeSupportedOs_bool && (
        <div className="alert alert--warn">当前操作系统不支持本地网桥。</div>
      )}
      {bridges === null ? (
        <LoadingBlock />
      ) : bridges.length === 0 ? (
        <Empty title="暂无本地网桥">
          本地网桥把一个虚拟 HUB 接到物理网卡上，让 VPN 客户端成为本服务器身后局域网的正式成员。
        </Empty>
      ) : (
        <div className="rows">
          {bridges.map((b, i) => (
            <div key={i} className="row">
              <div className="row__main">
                <div className="row__name">
                  <span className="mono">{String(b.DeviceName_str)}</span>
                  <span className="micro">↔</span>
                  <span className="mono">{String(b.HubNameLB_str)}</span>
                  {b.TapMode_bool && <Pill kind="idle" label="TAP 模式" />}
                  <Pill kind={b.Active_bool ? "ok" : b.Online_bool ? "busy" : "idle"} label={b.Active_bool ? "运行中" : b.Online_bool ? "启动中" : "离线"} />
                </div>
              </div>
              <div className="row__side">
                <button className="btn btn--sm btn--ghost" aria-label="删除网桥" onClick={() => void guard(async () => {
                  await api.deleteBridge(String(b.DeviceName_str), String(b.HubNameLB_str));
                  await load();
                }, "网桥已删除。")}>
                  <IconTrash size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {adding && <BridgeSheet onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void load(); }} />}
    </section>
  );
}

function BridgeSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [devices, setDevices] = useState<Wire[] | null>(null);
  const [hubs, setHubs] = useState<string[]>([]);
  const [device, setDevice] = useState("");
  const [hub, setHub] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { push } = useToast();

  useEffect(() => {
    void api.bridgeDevices().then((r) => setDevices((r.EthList as Wire[]) ?? [])).catch(() => setDevices([]));
    void api.hubs().then((r) => setHubs(((r.HubList as Wire[]) ?? []).map((h) => String(h.HubName_str)))).catch(() => {});
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.addBridge(device, hub);
      push("ok", "网桥已创建。");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="新建本地网桥"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn--primary" onClick={save} disabled={busy || !device || !hub}>
            {busy && <span className="spin" />} 创建网桥
          </button>
        </>
      }
    >
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <Field label="网络适配器">
        {devices === null ? (
          <LoadingBlock />
        ) : (
          <select className="select" value={device} onChange={(e) => setDevice(e.target.value)}>
            <option value="">— 请选择 —</option>
            {devices.map((d) => (
              <option key={String(d.DeviceName_str)} value={String(d.DeviceName_str)}>
                {String(d.DeviceName_str)}{d.NetworkConnectionName_utf ? ` (${d.NetworkConnectionName_utf})` : ""}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="虚拟 HUB">
        <select className="select" value={hub} onChange={(e) => setHub(e.target.value)}>
          <option value="">— 请选择 —</option>
          {hubs.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
      </Field>
      <div className="hint">
        桥接服务器自身在用的网卡在某些网卡上会中断其连接；使用一块专用网卡才稳妥。
      </div>
    </Sheet>
  );
}

/* ── L3 switches ──────────────────────────────────────────────────────────── */

function L3Card() {
  const [switches, setSwitches] = useState<Wire[] | null>(null);
  const [name, setName] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const { guard } = useToast();

  const load = useCallback(async () => {
    const r = await api.l3().catch(() => null);
    const list = r ? ((r.L3SWList as Wire[]) ?? []) : null;
    if (list) setSwitches(list);
    return list;
  }, []);
  usePoll(load, "list", []);

  return (
    <section id="ss-l3">
      <SectionTitle count={switches?.length}>虚拟三层交换机</SectionTitle>
      <div className="card" style={{ padding: "var(--s4)" }}>
        <div className="lede" style={{ marginBottom: "var(--s3)" }}>
          虚拟 HUB 之间的 IP 路由器：每个接口位于一个虚拟 HUB 中并持有一个地址，
          路由表负责在它们之间转发数据包。
        </div>
        {switches === null ? (
          <LoadingBlock />
        ) : (
          <>
            {switches.map((s) => (
              <div key={String(s.Name_str)} className="lrow">
                <span className="mono" style={{ fontWeight: 600 }}>{String(s.Name_str)}</span>
                <Pill kind={s.Active_bool ? "ok" : "idle"} label={s.Active_bool ? "运行中" : "已停止"} />
                <span className="micro">{String(s.NumInterfaces_u32 ?? 0)} 个接口 · {String(s.NumTables_u32 ?? 0)} 条路由</span>
                <span style={{ flex: 1 }} />
                <button className="btn btn--sm" onClick={() => setOpen(String(s.Name_str))}>配置</button>
                <L3Switch sw={s} reload={load} />
                <button className="btn btn--sm btn--ghost" aria-label="删除" onClick={() => void guard(async () => {
                  await api.delL3(String(s.Name_str));
                  await load();
                }, "交换机已删除。")}>
                  <IconTrash size={14} />
                </button>
              </div>
            ))}
            <div style={{ display: "flex", gap: "var(--s2)", marginTop: "var(--s3)" }}>
              <input className="input mono" placeholder="交换机名称" value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 240 }} autoCapitalize="none" spellCheck={false} />
              <button className="btn" disabled={!name.trim()} onClick={() => void guard(async () => {
                await api.addL3(name.trim());
                setName("");
                await load();
              }, "交换机已创建。")}>
                <IconPlus size={14} /> 添加
              </button>
            </div>
          </>
        )}
      </div>
      {open && <L3Sheet name={open} onClose={() => { setOpen(null); void load(); }} />}
    </section>
  );
}

/** Running / stopped for one layer-3 switch. */
function L3Switch({ sw, reload }: { sw: Wire; reload: () => Promise<Wire[] | null> }) {
  const name = String(sw.Name_str);
  const toggle = useToggle({
    value: Boolean(sw.Active_bool),
    apply: async (next) => {
      const r = await (next ? api.startL3(name) : api.stopL3(name));
      return Boolean(r.active);
    },
    reload: async () => {
      const list = await reload();
      const me = list?.find((x) => String(x.Name_str) === name);
      return me ? Boolean(me.Active_bool) : null;
    },
    noun: `三层交换机 ${name}`,
    onWord: "运行中",
    offWord: "已停止",
  });
  return (
    <span className="switchbox">
      <Switch
        on={Boolean(sw.Active_bool)}
        pending={toggle.pending}
        target={toggle.target}
        onToggle={() => void toggle.toggle()}
        label={`三层交换机 ${name}`}
        onWord="运行中"
        offWord="已停止"
      />
      <OutcomeNote outcome={toggle.outcome} />
    </span>
  );
}

function L3Sheet({ name, onClose }: { name: string; onClose: () => void }) {
  const [ifs, setIfs] = useState<Wire[] | null>(null);
  const [routes, setRoutes] = useState<Wire[] | null>(null);
  const [hubs, setHubs] = useState<string[]>([]);
  const [ifDraft, setIfDraft] = useState({ hub: "", ip: "", mask: "255.255.255.0" });
  const [routeDraft, setRouteDraft] = useState({ net: "", mask: "255.255.255.0", gw: "", metric: 1 });
  const { guard } = useToast();

  const load = useCallback(async () => {
    const [i, r, h] = await Promise.all([
      api.l3Ifs(name).catch(() => null),
      api.l3Routes(name).catch(() => null),
      api.hubs().catch(() => null),
    ]);
    if (i) setIfs((i.L3IFList as Wire[]) ?? []);
    if (r) setRoutes((r.L3Table as Wire[]) ?? []);
    if (h) setHubs(((h.HubList as Wire[]) ?? []).map((x) => String(x.HubName_str)));
  }, [name]);
  useEffect(() => void load(), [load]);

  return (
    <Sheet title={`三层交换机 ${name}`} subtitle="修改前请先停止交换机；SoftEther 拒绝在运行时编辑。" onClose={onClose} wide>
      <SectionTitle count={ifs?.length ?? undefined}>接口</SectionTitle>
      {(ifs ?? []).map((i, index) => (
        <div key={index} className="lrow">
          <span className="mono">{String(i.HubName_str)}</span>
          <span className="mono">{String(i.IpAddress_ip)}/{String(i.SubnetMask_ip)}</span>
          <span style={{ flex: 1 }} />
          <button className="btn btn--sm btn--ghost" aria-label="删除" onClick={() => void guard(async () => {
            await api.delL3If(name, { HubName_str: i.HubName_str });
            await load();
          })}>
            <IconTrash size={14} />
          </button>
        </div>
      ))}
      <div className="row2" style={{ marginTop: "var(--s2)" }}>
        <select className="select" value={ifDraft.hub} onChange={(e) => setIfDraft({ ...ifDraft, hub: e.target.value })}>
          <option value="">— 虚拟 HUB —</option>
          {hubs.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
        <div style={{ display: "flex", gap: "var(--s2)" }}>
          <input className="input mono" placeholder="192.168.1.1" value={ifDraft.ip} onChange={(e) => setIfDraft({ ...ifDraft, ip: e.target.value })} spellCheck={false} />
          <input className="input mono" placeholder="掩码" value={ifDraft.mask} onChange={(e) => setIfDraft({ ...ifDraft, mask: e.target.value })} spellCheck={false} />
        </div>
      </div>
      <button className="btn btn--sm" style={{ marginTop: "var(--s2)" }} disabled={!ifDraft.hub || !ifDraft.ip} onClick={() => void guard(async () => {
        await api.addL3If(name, { HubName_str: ifDraft.hub, IpAddress_ip: ifDraft.ip, SubnetMask_ip: ifDraft.mask });
        setIfDraft({ hub: "", ip: "", mask: "255.255.255.0" });
        await load();
      }, "接口已添加。")}>
        <IconPlus size={14} /> 添加接口
      </button>

      <SectionTitle count={routes?.length ?? undefined}>路由表</SectionTitle>
      {(routes ?? []).map((r, index) => (
        <div key={index} className="lrow">
          <span className="mono">{String(r.NetworkAddress_ip)}/{String(r.SubnetMask_ip)}</span>
          <span className="micro">经由</span>
          <span className="mono">{String(r.GatewayAddress_ip)}</span>
          <span className="micro">跃点数 {String(r.Metric_u32)}</span>
          <span style={{ flex: 1 }} />
          <button className="btn btn--sm btn--ghost" aria-label="删除" onClick={() => void guard(async () => {
            await api.delL3Route(name, {
              NetworkAddress_ip: r.NetworkAddress_ip, SubnetMask_ip: r.SubnetMask_ip,
              GatewayAddress_ip: r.GatewayAddress_ip, Metric_u32: r.Metric_u32,
            });
            await load();
          })}>
            <IconTrash size={14} />
          </button>
        </div>
      ))}
      <div className="row2" style={{ marginTop: "var(--s2)" }}>
        <div style={{ display: "flex", gap: "var(--s2)" }}>
          <input className="input mono" placeholder="10.0.0.0" value={routeDraft.net} onChange={(e) => setRouteDraft({ ...routeDraft, net: e.target.value })} spellCheck={false} />
          <input className="input mono" placeholder="掩码" value={routeDraft.mask} onChange={(e) => setRouteDraft({ ...routeDraft, mask: e.target.value })} spellCheck={false} />
        </div>
        <div style={{ display: "flex", gap: "var(--s2)" }}>
          <input className="input mono" placeholder="网关" value={routeDraft.gw} onChange={(e) => setRouteDraft({ ...routeDraft, gw: e.target.value })} spellCheck={false} />
          <input className="input mono" type="number" min={1} style={{ maxWidth: 90 }} value={routeDraft.metric} onChange={(e) => setRouteDraft({ ...routeDraft, metric: Number(e.target.value) })} />
        </div>
      </div>
      <button className="btn btn--sm" style={{ marginTop: "var(--s2)" }} disabled={!routeDraft.net || !routeDraft.gw} onClick={() => void guard(async () => {
        await api.addL3Route(name, {
          NetworkAddress_ip: routeDraft.net, SubnetMask_ip: routeDraft.mask,
          GatewayAddress_ip: routeDraft.gw, Metric_u32: routeDraft.metric,
        });
        setRouteDraft({ net: "", mask: "255.255.255.0", gw: "", metric: 1 });
        await load();
      }, "路由已添加。")}>
        <IconPlus size={14} /> 添加路由
      </button>
    </Sheet>
  );
}

/* ── EtherIP ids ──────────────────────────────────────────────────────────── */

function EtherIpCard() {
  const [ids, setIds] = useState<Wire[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [hubs, setHubs] = useState<string[]>([]);
  const [draft, setDraft] = useState({ id: "", hub: "", user: "", password: "" });
  const { guard } = useToast();

  const load = useCallback(async () => {
    const r = await api.etherip().catch(() => null);
    if (r) setIds((r.Settings as Wire[]) ?? []);
  }, []);
  usePoll(load, "list", []);

  useEffect(() => {
    void api.hubs().then((r) => setHubs(((r.HubList as Wire[]) ?? []).map((h) => String(h.HubName_str)))).catch(() => {});
  }, []);

  return (
    <section id="ss-etherip">
      <SectionTitle
        count={ids?.length}
        actions={
          <button className="btn btn--sm" onClick={() => setAdding(true)}>
            <IconPlus size={14} /> 添加客户端 ID
          </button>
        }
      >
        EtherIP / L2TPv3 客户端 ID
      </SectionTitle>
      {ids === null ? (
        <LoadingBlock />
      ) : ids.length === 0 ? (
        <Empty title="暂无客户端 ID">
          路由器之间的 EtherIP/L2TPv3 over IPsec 需要把每台设备的 ISAKMP ID
          映射到这里的某个虚拟 HUB 和某个用户。
        </Empty>
      ) : (
        <div className="rows">
          {ids.map((entry) => (
            <div key={String(entry.Id_str)} className="row">
              <div className="row__main">
                <div className="row__name mono">{String(entry.Id_str)}</div>
                <div className="spec">
                  <span className="chip"><i>HUB</i>{String(entry.HubName_str ?? "?")}</span>
                  <span className="chip"><i>用户</i>{String(entry.UserName_str ?? "?")}</span>
                </div>
              </div>
              <div className="row__side">
                <button className="btn btn--sm btn--ghost" aria-label="删除" onClick={() => void guard(async () => {
                  await api.deleteEtherip(String(entry.Id_str));
                  await load();
                }, "客户端 ID 已移除。")}>
                  <IconTrash size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {adding && (
        <Sheet
          title="EtherIP 客户端 ID"
          onClose={() => setAdding(false)}
          footer={
            <>
              <button className="btn" onClick={() => setAdding(false)}>取消</button>
              <button className="btn btn--primary" disabled={!draft.id || !draft.hub || !draft.user} onClick={() => void guard(async () => {
                await api.addEtherip({
                  Id_str: draft.id.trim(), HubName_str: draft.hub, UserName_str: draft.user.trim(), Password_str: draft.password,
                });
                setAdding(false);
                setDraft({ id: "", hub: "", user: "", password: "" });
                await load();
              }, "客户端 ID 已添加。")}>
                添加
              </button>
            </>
          }
        >
          <Field label="ISAKMP 阶段 1 ID" hint="设备所申报的标识，例如其主机名或 IP。">
            <input className="input mono" value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} spellCheck={false} autoCapitalize="none" />
          </Field>
          <Field label="虚拟 HUB">
            <select className="select" value={draft.hub} onChange={(e) => setDraft({ ...draft, hub: e.target.value })}>
              <option value="">— 请选择 —</option>
              {hubs.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </Field>
          <div className="row2">
            <Field label="用户名">
              <input className="input mono" value={draft.user} onChange={(e) => setDraft({ ...draft, user: e.target.value })} spellCheck={false} autoCapitalize="none" />
            </Field>
            <Field label="密码">
              <input className="input" type="password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} autoComplete="off" />
            </Field>
          </div>
        </Sheet>
      )}
    </section>
  );
}

/* ── clustering ───────────────────────────────────────────────────────────── */

function FarmCard() {
  const [farm, setFarm] = useState<Wire | null>(null);
  const [members, setMembers] = useState<Wire[] | null>(null);

  const load = useCallback(async () => {
    setFarm(await api.farm().catch(() => null));
    const m = await api.farmMembers().catch(() => null);
    if (m) setMembers((m.FarmMemberList as Wire[]) ?? []);
  }, []);
  usePoll(load, "list", []);

  const TYPES: Record<number, string> = { 0: "独立", 1: "集群控制器", 2: "集群成员" };

  return (
    <section id="ss-farm">
      <SectionTitle>集群</SectionTitle>
      <div className="card" style={{ padding: "var(--s4)" }}>
        {!farm ? (
          <LoadingBlock />
        ) : (
          <>
            <KV rows={[
              ["角色", TYPES[Number(farm.ServerType_u32)] ?? "?"],
              ["控制器", Number(farm.ServerType_u32) === 2 ? `${farm.ControllerName_str}:${farm.ControllerPort_u32}` : "—"],
              ["公网 IP", String(farm.PublicIp_ip || "—")],
              ["权重", String(farm.Weight_u32 ?? "—")],
            ]} />
            {Number(farm.ServerType_u32) === 1 && members && (
              <>
                <div className="section__t" style={{ margin: "var(--s4) 0 var(--s2)" }}>成员</div>
                {members.map((m) => (
                  <div key={String(m.Id_u32)} className="lrow">
                    <Pill kind={m.Controller_bool ? "busy" : "ok"} label={m.Controller_bool ? "控制器" : "成员"} />
                    <span className="mono">{String(m.Hostname_str)}</span>
                    <span className="micro">{String(m.NumSessions_u32 ?? 0)} 会话 · {String(m.NumHubs_u32 ?? 0)} 个 HUB</span>
                  </div>
                ))}
              </>
            )}
            <div className="hint" style={{ marginTop: "var(--s3)" }}>
              更改集群角色会重启 VPN 服务器并清除部分状态；SoftEther
              把它视为装机时的决定。因此它只暴露在 API 控制台（SetFarmSetting）中，
              而不是这里随手一拨的开关。
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/* ── keep-alive & syslog ──────────────────────────────────────────────────── */

function KeepSyslogCard() {
  const [keep, setKeep] = useState<Wire | null>(null);
  const [syslog, setSyslog] = useState<Wire | null>(null);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const { guard } = useToast();

  useEffect(() => {
    void api.keepalive().then(setKeep).catch(() => {});
    void api.syslog().then(setSyslog).catch(() => {});
  }, []);

  const SYSLOG_MODES = [
    "关闭",
    "仅服务器日志",
    "服务器 + HUB 安全日志",
    "服务器 + HUB 安全 + 数据包日志",
  ];

  return (
    <section id="ss-keep">
      <SectionTitle>Keep-alive 与 syslog</SectionTitle>
      <div className="setgrid">
        <div className="card" style={{ padding: "var(--s4)" }}>
          <div className="section__t" style={{ marginBottom: "var(--s3)" }}>Internet keep-alive</div>
          {!keep ? (
            <LoadingBlock />
          ) : (
            <>
              <CheckRow checked={Boolean(keep.UseKeepConnect_bool)} onChange={(v) => { setKeep({ ...keep, UseKeepConnect_bool: v }); setDirty((d) => ({ ...d, keep: true })); }}
                label="发送 keep-alive 数据包" hint="防止空闲的拨号/NAT 链路被回收。" />
              <div className="row2">
                <Field label="主机">
                  <input className="input mono" value={String(keep.KeepConnectHost_str ?? "")} onChange={(e) => { setKeep({ ...keep, KeepConnectHost_str: e.target.value }); setDirty((d) => ({ ...d, keep: true })); }} spellCheck={false} />
                </Field>
                <Field label="端口">
                  <input className="input mono" type="number" value={Number(keep.KeepConnectPort_u32) || 80} onChange={(e) => { setKeep({ ...keep, KeepConnectPort_u32: Number(e.target.value) }); setDirty((d) => ({ ...d, keep: true })); }} />
                </Field>
              </div>
              <div className="row2">
                <Field label="协议">
                  <select className="select" value={Number(keep.KeepConnectProtocol_u32) || 0} onChange={(e) => { setKeep({ ...keep, KeepConnectProtocol_u32: Number(e.target.value) }); setDirty((d) => ({ ...d, keep: true })); }}>
                    <option value={0}>TCP</option>
                    <option value={1}>UDP</option>
                  </select>
                </Field>
                <Field label="间隔（秒）">
                  <input className="input mono" type="number" min={5} value={Number(keep.KeepConnectInterval_u32) || 50} onChange={(e) => { setKeep({ ...keep, KeepConnectInterval_u32: Number(e.target.value) }); setDirty((d) => ({ ...d, keep: true })); }} />
                </Field>
              </div>
              {dirty.keep && (
                <button className="btn btn--primary" onClick={() => void guard(async () => {
                  await api.setKeepalive({
                    UseKeepConnect_bool: Boolean(keep.UseKeepConnect_bool),
                    KeepConnectHost_str: String(keep.KeepConnectHost_str ?? ""),
                    KeepConnectPort_u32: Number(keep.KeepConnectPort_u32) || 80,
                    KeepConnectProtocol_u32: Number(keep.KeepConnectProtocol_u32) || 0,
                    KeepConnectInterval_u32: Number(keep.KeepConnectInterval_u32) || 50,
                  });
                  setDirty((d) => ({ ...d, keep: false }));
                }, "Keep-alive 已保存。")}>
                  保存 keep-alive
                </button>
              )}
            </>
          )}
        </div>

        <div className="card" style={{ padding: "var(--s4)" }}>
          <div className="section__t" style={{ marginBottom: "var(--s3)" }}>Syslog 转发</div>
          {!syslog ? (
            <LoadingBlock />
          ) : (
            <>
              <Field label="模式">
                <select className="select" value={Number(syslog.SaveType_u32) || 0} onChange={(e) => { setSyslog({ ...syslog, SaveType_u32: Number(e.target.value) }); setDirty((d) => ({ ...d, syslog: true })); }}>
                  {SYSLOG_MODES.map((m, i) => <option key={i} value={i}>{m}</option>)}
                </select>
              </Field>
              <div className="row2">
                <Field label="Syslog 主机">
                  <input className="input mono" value={String(syslog.Hostname_str ?? "")} onChange={(e) => { setSyslog({ ...syslog, Hostname_str: e.target.value }); setDirty((d) => ({ ...d, syslog: true })); }} spellCheck={false} />
                </Field>
                <Field label="端口">
                  <input className="input mono" type="number" value={Number(syslog.Port_u32) || 514} onChange={(e) => { setSyslog({ ...syslog, Port_u32: Number(e.target.value) }); setDirty((d) => ({ ...d, syslog: true })); }} />
                </Field>
              </div>
              {dirty.syslog && (
                <button className="btn btn--primary" onClick={() => void guard(async () => {
                  await api.setSyslog({
                    SaveType_u32: Number(syslog.SaveType_u32) || 0,
                    Hostname_str: String(syslog.Hostname_str ?? ""),
                    Port_u32: Number(syslog.Port_u32) || 514,
                  });
                  setDirty((d) => ({ ...d, syslog: false }));
                }, "Syslog 设置已保存。")}>
                  保存 syslog
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/* ── configuration file ───────────────────────────────────────────────────── */

function ConfigCard() {
  const [restoring, setRestoring] = useState<File | null>(null);
  const { guard } = useToast();

  return (
    <section id="ss-config">
      <SectionTitle>配置文件</SectionTitle>
      <div className="card" style={{ padding: "var(--s4)" }}>
        <div className="lede" style={{ marginBottom: "var(--s3)" }}>
          服务器的全部状态，即它保存在磁盘上的 vpn_server.config。可下载作为备份；
          恢复会替换一切并重启服务。
        </div>
        <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap" }}>
          <button className="btn" onClick={() => void guard(async () => {
            const r = await api.getConfig();
            downloadBase64(r.filename || "vpn_server.config", r.config_base64, "text/plain");
          }, "配置已下载。")}>
            <IconDownload size={14} /> 下载备份
          </button>
          <label className="btn">
            <IconUpload size={14} /> 从文件恢复
            <input type="file" hidden onChange={(e) => setRestoring(e.target.files?.[0] ?? null)} />
          </label>
          <button className="btn" onClick={() => void guard(() => api.flush(), "易失状态已写入磁盘。")}>
            写入磁盘
          </button>
        </div>
      </div>
      {restoring && (
        <ConfirmSheet
          title="恢复该配置？"
          verb="恢复并重启"
          typed="恢复"
          body={
            <>
              <b>{restoring.name}</b> 将替换该 VPN 服务器的全部配置 — 虚拟 HUB、用户、一切 —
              服务器随后重启以加载它。
            </>
          }
          onClose={() => setRestoring(null)}
          onConfirm={async () => {
            const b64 = await fileToBase64(restoring);
            await api.setConfig(b64);
          }}
        />
      )}
    </section>
  );
}

/* ── the danger zone ──────────────────────────────────────────────────────── */

function DangerZone() {
  const [confirm, setConfirm] = useState<null | "reboot" | "crash">(null);
  return (
    <section id="ss-danger" className="danger">
      <SectionTitle>危险操作</SectionTitle>
      <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap" }}>
        <button className="btn" onClick={() => setConfirm("reboot")}>重启 VPN 服务</button>
        <button className="btn" onClick={() => setConfirm("crash")}>强制崩溃进程</button>
      </div>
      {confirm === "reboot" && (
        <ConfirmSheet
          title="重启 VPN 服务器服务？"
          verb="重启"
          body={<>所有会话都会断开并重连。需要几秒钟。</>}
          onClose={() => setConfirm(null)}
          onConfirm={() => api.reboot().then(() => undefined)}
        />
      )}
      {confirm === "crash" && (
        <ConfirmSheet
          title="强制崩溃 VPN 服务器？"
          verb="强制崩溃"
          typed="崩溃"
          body={
            <>
              API 中最暴力的调用：进程不保存任何东西直接自行中止。
              仅用于卡死到连正常重启都无响应的服务器。若它由 systemd 托管，
              会自行恢复。
            </>
          }
          onClose={() => setConfirm(null)}
          onConfirm={() => api.crashServer().then(() => undefined)}
        />
      )}
    </section>
  );
}
