"use client";

import { useCallback, useState } from "react";
import { CheckRow, ConfirmSheet, Empty, ErrorAlert, Field, LoadingBlock, SectionTitle, usePoll } from "../../components/bits";
import { QuotaCard } from "../../components/QuotaCard";
import { api, type Wire } from "../../lib/api";
import { navigate } from "../../lib/router";
import { HUB_TYPES } from "../../lib/se";
import { useToast } from "../../lib/toast";
import { IconTrash } from "../../ui/Icon";

/**
 * The hub object itself: its switch, size, type and password; what it logs;
 * the message shown to connecting clients; and the two expert option lists
 * (admin options and extended options), edited as what they are -- named
 * integers -- with the raw honesty that implies.
 */
export function HubSettings({ hub, onChanged }: { hub: string; onChanged: () => void }) {
  return (
    <>
      <BasicsCard hub={hub} onChanged={onChanged} />
      <QuotaSection hub={hub} onChanged={onChanged} />
      <LogCard hub={hub} />
      <MessageCard hub={hub} />
      <OptionsCard hub={hub} kind="admin" />
      <OptionsCard hub={hub} kind="ext" />
      <DangerCard hub={hub} />
    </>
  );
}

/** The hub's traffic ceiling. Reached, the hub goes offline -- which is a
 *  change to the header's online pill, so the page is told to re-read. */
function QuotaSection({ hub, onChanged }: { hub: string; onChanged: () => void }) {
  return (
    <>
      <SectionTitle>流量限额</SectionTitle>
      <QuotaCard hub={hub} onChanged={onChanged} />
    </>
  );
}

function BasicsCard({ hub, onChanged }: { hub: string; onChanged: () => void }) {
  const [data, setData] = useState<Wire | null>(null);
  const [password, setPassword] = useState("");
  const [dirty, setDirty] = useState(false);
  const { guard } = useToast();

  const load = useCallback(async () => {
    const r = await api.hub(hub).catch(() => null);
    if (r) setData((c) => (dirty ? c : r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub, dirty]);
  usePoll(load, 3600_000, [hub]);

  if (!data) return <LoadingBlock />;
  const set = (k: string, v: unknown) => {
    setData((d) => ({ ...(d ?? {}), [k]: v }));
    setDirty(true);
  };

  const save = () =>
    guard(async () => {
      const body: Wire = {
        Online_bool: Boolean(data.Online_bool),
        MaxSession_u32: Number(data.MaxSession_u32) || 0,
        NoEnum_bool: Boolean(data.NoEnum_bool),
        HubType_u32: Number(data.HubType_u32) || 0,
      };
      if (password) body.AdminPasswordPlainText_str = password;
      await api.setHub(hub, body);
      setDirty(false);
      setPassword("");
      onChanged();
    }, "HUB 设置已保存。");

  return (
    <>
      <SectionTitle>虚拟 HUB</SectionTitle>
      <div className="card" style={{ padding: "var(--s4)", maxWidth: 640 }}>
        <div className="row2">
          <Field label="最大并发会话数" hint="0 表示不限。">
            <input className="input mono" type="number" min={0} value={Number(data.MaxSession_u32) || 0} onChange={(e) => set("MaxSession_u32", Number(e.target.value))} />
          </Field>
          <Field label="HUB 类型" hint="静态/动态仅在集群中有区别。">
            <select className="select" value={Number(data.HubType_u32) || 0} onChange={(e) => set("HubType_u32", Number(e.target.value))}>
              {Object.entries(HUB_TYPES).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Field>
        </div>
        <CheckRow checked={Boolean(data.NoEnum_bool)} onChange={(v) => set("NoEnum_bool", v)}
          label="对匿名枚举隐藏" hint="客户端登录前列出虚拟 HUB 时看不到这一个。" />
        <Field label="HUB 管理密码" hint="仅在你输入新密码时才会发送。允许某人只管理该 HUB。">
          <input className="input" type="password" value={password} onChange={(e) => { setPassword(e.target.value); setDirty(true); }} autoComplete="off" />
        </Field>
        {dirty && (
          <button className="btn btn--primary" onClick={() => void save()}>保存 HUB 设置</button>
        )}
      </div>
    </>
  );
}

const SWITCH_TYPES = [
  { v: 0, l: "单文件（不轮转）" },
  { v: 1, l: "每秒" },
  { v: 2, l: "每分钟" },
  { v: 3, l: "每小时" },
  { v: 4, l: "每天" },
  { v: 5, l: "每月" },
];

const PACKET_KINDS = [
  { i: 0, l: "TCP 连接" },
  { i: 1, l: "所有 TCP 数据包" },
  { i: 2, l: "DHCP" },
  { i: 3, l: "UDP" },
  { i: 4, l: "ICMP" },
  { i: 5, l: "IP" },
  { i: 6, l: "ARP" },
  { i: 7, l: "以太网" },
];

function LogCard({ hub }: { hub: string }) {
  const [data, setData] = useState<Wire | null>(null);
  const [dirty, setDirty] = useState(false);
  const { guard } = useToast();

  const load = useCallback(async () => {
    const r = await api.hubLog(hub).catch(() => null);
    if (r) setData((c) => (dirty ? c : r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub, dirty]);
  usePoll(load, 3600_000, [hub]);

  if (!data) return null;
  const set = (k: string, v: unknown) => {
    setData((d) => ({ ...(d ?? {}), [k]: v }));
    setDirty(true);
  };
  const packetConfig: number[] = Array.isArray(data.PacketLogConfig_u32) ? [...(data.PacketLogConfig_u32 as number[])] : new Array(16).fill(0);

  const save = () =>
    guard(async () => {
      await api.setHubLog(hub, {
        SaveSecurityLog_bool: Boolean(data.SaveSecurityLog_bool),
        SecurityLogSwitchType_u32: Number(data.SecurityLogSwitchType_u32) || 0,
        SavePacketLog_bool: Boolean(data.SavePacketLog_bool),
        PacketLogSwitchType_u32: Number(data.PacketLogSwitchType_u32) || 0,
        PacketLogConfig_u32: packetConfig,
      });
      setDirty(false);
    }, "日志设置已保存。");

  return (
    <>
      <SectionTitle>日志</SectionTitle>
      <div className="card" style={{ padding: "var(--s4)", maxWidth: 640 }}>
        <CheckRow checked={Boolean(data.SaveSecurityLog_bool)} onChange={(v) => set("SaveSecurityLog_bool", v)}
          label="安全日志" hint="登录、断开连接、管理操作。" />
        {Boolean(data.SaveSecurityLog_bool) && (
          <Field label="安全日志轮转">
            <select className="select" value={Number(data.SecurityLogSwitchType_u32) || 0} onChange={(e) => set("SecurityLogSwitchType_u32", Number(e.target.value))}>
              {SWITCH_TYPES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
            </select>
          </Field>
        )}
        <CheckRow checked={Boolean(data.SavePacketLog_bool)} onChange={(v) => set("SavePacketLog_bool", v)}
          label="数据包日志" hint="逐包记录 — 功能强大但开销很大。请在下方选择类别。" />
        {Boolean(data.SavePacketLog_bool) && (
          <>
            <Field label="数据包日志轮转">
              <select className="select" value={Number(data.PacketLogSwitchType_u32) || 0} onChange={(e) => set("PacketLogSwitchType_u32", Number(e.target.value))}>
                {SWITCH_TYPES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
              </select>
            </Field>
            {PACKET_KINDS.map((k) => (
              <Field key={k.i} label={k.l}>
                <div className="seg">
                  {["关闭", "仅头部", "完整"].map((lbl, v) => (
                    <button
                      key={lbl}
                      className={packetConfig[k.i] === v ? "on" : ""}
                      onClick={() => {
                        packetConfig[k.i] = v;
                        set("PacketLogConfig_u32", packetConfig);
                      }}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </Field>
            ))}
          </>
        )}
        {dirty && <button className="btn btn--primary" onClick={() => void save()}>保存日志设置</button>}
      </div>
    </>
  );
}

function MessageCard({ hub }: { hub: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const { guard } = useToast();

  const load = useCallback(async () => {
    const r = await api.hubMsg(hub).catch(() => null);
    if (r) setMessage((c) => (dirty ? c : r.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub, dirty]);
  usePoll(load, 3600_000, [hub]);

  if (message === null) return null;
  return (
    <>
      <SectionTitle>每日消息</SectionTitle>
      <div className="card" style={{ padding: "var(--s4)", maxWidth: 640 }}>
        <Field label="客户端连接时显示的消息" hint="留空则不显示。">
          <textarea className="textarea" rows={4} value={message} onChange={(e) => { setMessage(e.target.value); setDirty(true); }} />
        </Field>
        {dirty && (
          <button
            className="btn btn--primary"
            onClick={() => void guard(() => api.setHubMsg(hub, message), "消息已保存。").then(() => setDirty(false))}
          >
            保存消息
          </button>
        )}
      </div>
    </>
  );
}

/**
 * Admin options and extended options are the same wire shape: a list of
 * {name, value} integers. They are expert switches; the honest UI is the
 * list itself, editable in place, with the reference one click away.
 */
function OptionsCard({ hub, kind }: { hub: string; kind: "admin" | "ext" }) {
  const [items, setItems] = useState<Wire[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState(false);
  const { guard } = useToast();

  const load = useCallback(async () => {
    const r = await (kind === "admin" ? api.adminOptions(hub) : api.extOptions(hub)).catch(() => null);
    if (r) setItems((c) => (dirty ? c : ((r.AdminOptionList as Wire[]) ?? [])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub, kind, dirty]);
  usePoll(load, 3600_000, [hub, kind]);

  if (items === null) return null;

  const save = () =>
    guard(async () => {
      const body = { AdminOptionList: items.map((i) => ({ Name_str: i.Name_str, Value_u32: Number(i.Value_u32) || 0 })) };
      await (kind === "admin" ? api.setAdminOptions(hub, body) : api.setExtOptions(hub, body));
      setDirty(false);
    }, "选项已保存。");

  return (
    <>
      <SectionTitle
        count={items.length}
        actions={
          <button className="btn btn--sm" onClick={() => setOpen((o) => !o)}>
            {open ? "收起" : "展开"}
          </button>
        }
      >
        {kind === "admin" ? "管理选项" : "扩展选项"}
      </SectionTitle>
      {open && (
        <div className="card" style={{ padding: "var(--s4)" }}>
          <div className="lede" style={{ marginBottom: "var(--s3)" }}>
            {kind === "admin"
              ? "对 HUB 管理员权限的限制。非零值即启用对应的限制项。"
              : "按虚拟 HUB 的行为开关，名称与 SoftEther 完全一致。"}
          </div>
          <div className="optgrid">
            {items.map((item, index) => (
              <label key={String(item.Name_str)} className="optrow">
                <span className="mono truncate" title={String(item.Name_str)}>{String(item.Name_str)}</span>
                <input
                  className="input mono"
                  type="number"
                  value={Number(item.Value_u32) || 0}
                  onChange={(e) => {
                    const next = [...items];
                    next[index] = { ...item, Value_u32: Number(e.target.value) };
                    setItems(next);
                    setDirty(true);
                  }}
                />
              </label>
            ))}
          </div>
          {items.length === 0 && <Empty title="服务器未报告任何选项" />}
          {dirty && (
            <button className="btn btn--primary" style={{ marginTop: "var(--s3)" }} onClick={() => void save()}>
              保存选项
            </button>
          )}
        </div>
      )}
    </>
  );
}

function DangerCard({ hub }: { hub: string }) {
  const [deleting, setDeleting] = useState(false);
  const { push } = useToast();
  return (
    <div className="danger">
      <button className="btn btn--ghost" onClick={() => setDeleting(true)}>
        <IconTrash size={14} /> 删除该虚拟 HUB
      </button>
      {deleting && (
        <ConfirmSheet
          title={`删除虚拟 HUB ${hub}？`}
          verb="删除 HUB"
          typed={hub}
          body={
            <>
              <b>{hub}</b> 内的所有用户、用户组、会话、规则和设置都将随之销毁。此操作无法撤销。
            </>
          }
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await api.deleteHub(hub);
            push("ok", `虚拟 HUB ${hub} 已删除。`);
            navigate(`/`);
          }}
        />
      )}
    </div>
  );
}
