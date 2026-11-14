"use client";

import { useCallback, useState } from "react";
import { CheckRow, ConfirmSheet, Empty, ErrorAlert, Field, KV, LoadingBlock, SectionTitle, usePoll } from "../../components/bits";
import { api, type Wire } from "../../lib/api";
import { useToast } from "../../lib/toast";
import { formatBytes, formatDate, timeAgo } from "../../lib/util";
import { IconCascade, IconPlus, IconTrash } from "../../ui/Icon";
import { Sheet } from "../../ui/Sheet";
import { Pill } from "../../ui/Status";
import { OutcomeNote, Switch, useToggle } from "../../ui/Switch";

/**
 * Cascade connections: this hub dialing out to a hub on another server and
 * bridging the two into one Ethernet segment. Each link is a stored client
 * account with its own lifecycle (offline / connecting / established).
 */
export function HubLinks({ hub }: { hub: string }) {
  const [links, setLinks] = useState<Wire[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [statusOf, setStatusOf] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { guard } = useToast();

  const load = useCallback(async () => {
    const r = await api.links(hub).catch(() => null);
    if (r) setLinks((r.LinkList as Wire[]) ?? []);
    return r ? ((r.LinkList as Wire[]) ?? []) : null;
  }, [hub]);
  usePoll(load, "detail", [hub]);

  return (
    <>
      <SectionTitle
        count={links?.length}
        actions={
          <button className="btn btn--primary btn--sm" onClick={() => setCreating(true)}>
            <IconPlus size={14} /> 新建级联
          </button>
        }
      >
        级联连接
      </SectionTitle>

      {links === null ? (
        <LoadingBlock />
      ) : links.length === 0 ? (
        <Empty
          title="暂无级联"
          action={
            <button className="btn btn--primary" onClick={() => setCreating(true)}>
              <IconPlus size={15} /> 创建级联
            </button>
          }
        >
          级联把该虚拟 HUB 与另一台 SoftEther 服务器上的虚拟 HUB 桥接起来，使两者组成同一个二层网络。
          站对站 VPN，一个对象搞定。
        </Empty>
      ) : (
        <div className="rows">
          {links.map((l) => {
            const name = String(l.AccountName_utf);
            return (
              <div key={name} className="row" style={{ cursor: "pointer" }} onClick={() => setStatusOf(name)}>
                <div className="row__main">
                  <div className="row__name">
                    <IconCascade size={15} />
                    <span className="mono">{name}</span>
                    {l.Online_bool ? (
                      l.Connected_bool ? (
                        <Pill kind="ok" label="已建立" />
                      ) : (
                        <Pill kind="busy" label="连接中" />
                      )
                    ) : (
                      <Pill kind="idle" label="离线" />
                    )}
                  </div>
                  <div className="spec">
                    <span className="chip"><i>至</i>{String(l.Hostname_str)}</span>
                    <span className="chip"><i>HUB</i>{String(l.TargetHubName_str)}</span>
                    {l.Connected_bool ? <span className="chip"><i>始于</i>{timeAgo(l.ConnectedTime_dt as string)}</span> : null}
                  </div>
                </div>
                <div className="row__side" onClick={(e) => e.stopPropagation()}>
                  <LinkSwitch hub={hub} link={l} reload={load} />
                  <button className="btn btn--sm btn--ghost" onClick={() => setDeleting(name)} aria-label="删除">
                    <IconTrash size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {creating && (
        <LinkSheet
         
          hub={hub}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void load();
          }}
        />
      )}
      {statusOf && <LinkStatusSheet hub={hub} name={statusOf} onClose={() => setStatusOf(null)} />}
      {deleting && (
        <ConfirmSheet
          title={`删除级联 ${deleting}？`}
          verb="删除"
          body={<>通向另一个网络的桥接将被拆除，存储的账号也会被移除。</>}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.deleteLink(hub, deleting);
            void load();
          }}
        />
      )}
    </>
  );
}

/** Online / offline for one cascade, verified against the list read back. */
function LinkSwitch({ hub, link, reload }: { hub: string; link: Wire; reload: () => Promise<Wire[] | null> }) {
  const name = String(link.AccountName_utf);
  const toggle = useToggle({
    value: Boolean(link.Online_bool),
    apply: async (next) => {
      const r = await api.linkOnline(hub, name, next);
      return Boolean(r.online);
    },
    reload: async () => {
      const list = await reload();
      const me = list?.find((x) => String(x.AccountName_utf) === name);
      return me ? Boolean(me.Online_bool) : null;
    },
    noun: `级联 ${name}`,
    onWord: "在线",
    offWord: "离线",
  });
  return (
    <span className="switchbox">
      <Switch
        on={Boolean(link.Online_bool)}
        pending={toggle.pending}
        target={toggle.target}
        onToggle={() => void toggle.toggle()}
        label={`级联 ${name}`}
        onWord="在线"
        offWord="离线"
      />
      <OutcomeNote outcome={toggle.outcome} />
    </span>
  );
}

function LinkSheet({ hub, onClose, onSaved }: { hub: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(443);
  const [targetHub, setTargetHub] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { push } = useToast();

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.createLink(hub, {
        AccountName_utf: name.trim() || `${host}-${targetHub}`,
        Hostname_str: host.trim(),
        Port_u32: port,
        HubName_str: targetHub.trim(),
        Username_str: username.trim(),
        // Wire auth type 2 = plain password; the server hashes it itself.
        AuthType_u32: 2,
        PlainPassword_str: password,
        UseEncrypt_bool: true,
        MaxConnection_u32: 8,
        AdditionalConnectionInterval_u32: 1,
        ConnectionDisconnectSpan_u32: 0,
      });
      const account = name.trim() || `${host}-${targetHub}`;
      if (online) await api.linkOnline(hub, account, true);
      push("ok", "级联已创建。");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="新建级联"
      subtitle={`来自虚拟 HUB ${hub}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn--primary" onClick={save} disabled={busy || !host.trim() || !targetHub.trim() || !username.trim()}>
            {busy && <span className="spin" />} 创建
          </button>
        </>
      }
    >
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <Field label="名称" hint="该级联在此处的名称。留空则自动生成。">
        <input className="input mono" value={name} onChange={(e) => setName(e.target.value)} autoCapitalize="none" spellCheck={false} />
      </Field>
      <div className="row2">
        <Field label="目标服务器">
          <input className="input mono" value={host} onChange={(e) => setHost(e.target.value)} placeholder="vpn2.example.net" spellCheck={false} autoCapitalize="none" inputMode="url" />
        </Field>
        <Field label="端口">
          <input className="input mono" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(Number(e.target.value))} />
        </Field>
      </div>
      <Field label="目标虚拟 HUB">
        <input className="input mono" value={targetHub} onChange={(e) => setTargetHub(e.target.value)} autoCapitalize="none" spellCheck={false} />
      </Field>
      <div className="row2">
        <Field label="用户名" hint="目标虚拟 HUB 上的一个用户。">
          <input className="input mono" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" spellCheck={false} />
        </Field>
        <Field label="密码">
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
        </Field>
      </div>
      <CheckRow checked={online} onChange={setOnline} label="立即连接" />
    </Sheet>
  );
}

function LinkStatusSheet({ hub, name, onClose }: { hub: string; name: string; onClose: () => void }) {
  const [status, setStatus] = useState<Wire | null>(null);
  const [error, setError] = useState<string | null>(null);

  usePoll(
    async () => {
      try {
        setStatus(await api.linkStatus(hub, name));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    5000,
    [hub, name],
  );

  return (
    <Sheet title="级联状态" subtitle={name} onClose={onClose} wide>
      {error && <ErrorAlert>{error} — 该链路可能已离线。</ErrorAlert>}
      {!status && !error && <LoadingBlock />}
      {status && (
        <KV
          rows={[
            ["状态", status.Connected_bool ? "已建立" : status.Active_bool ? "连接中" : "离线"],
            ["服务器", `${status.ServerName_str ?? "—"}:${status.ServerPort_u32 ?? ""}`],
            ["产品", `${status.ServerProductName_str ?? "—"}`],
            ["加密算法", String(status.CipherName_str || "—")],
            ["协议", String(status.UnderlayProtocol_str || "—")],
            ["TCP 连接", `${status.NumTcpConnections_u32 ?? 0} / ${status.MaxTcpConnections_u32 ?? 0}`],
            ["开始时间", formatDate(status.StartTime_dt as string)],
            ["已发送", formatBytes(Number(status.TotalSendSizeReal_u64 ?? status.TotalSendSize_u64))],
            ["已接收", formatBytes(Number(status.TotalRecvSizeReal_u64 ?? status.TotalRecvSize_u64))],
          ]}
        />
      )}
    </Sheet>
  );
}
