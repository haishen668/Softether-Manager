"use client";

import { useCallback, useState } from "react";
import { CheckRow, ConfirmSheet, Empty, ErrorAlert, Field, LoadingBlock, SectionTitle, usePoll } from "../../components/bits";
import { api, type Wire } from "../../lib/api";
import { ACCESS_PROTOCOLS } from "../../lib/se";
import { useToast } from "../../lib/toast";
import { IconPlus, IconShield, IconTrash } from "../../ui/Icon";
import { Sheet } from "../../ui/Sheet";
import { Pill } from "../../ui/Status";

/**
 * Access control: the hub's packet filter, and the source-IP limit list.
 *
 * A rule reads the way a person says it: "pass/discard <protocol> from
 * <source> to <destination>". The editor asks in that order, and the list
 * renders each rule as that sentence.
 */
export function HubAccess({ hub }: { hub: string }) {
  const [rules, setRules] = useState<Wire[] | null>(null);
  const [editing, setEditing] = useState<Wire | "new" | null>(null);
  const [deleting, setDeleting] = useState<Wire | null>(null);
  const { guard } = useToast();

  const load = useCallback(async () => {
    const r = await api.accessList(hub).catch(() => null);
    if (r) setRules((r.AccessList as Wire[]) ?? []);
  }, [hub]);
  usePoll(load, "list", [hub]);

  return (
    <>
      <SectionTitle
        count={rules?.length}
        actions={
          <button className="btn btn--primary btn--sm" onClick={() => setEditing("new")}>
            <IconPlus size={14} /> 新建规则
          </button>
        }
      >
        访问列表
      </SectionTitle>

      {rules === null ? (
        <LoadingBlock label="正在加载规则" />
      ) : rules.length === 0 ? (
        <Empty
          title="暂无规则 — 全部放行"
          action={
            <button className="btn btn--primary" onClick={() => setEditing("new")}>
              <IconPlus size={15} /> 添加第一条规则
            </button>
          }
        >
          访问规则在虚拟 HUB 内部按协议、地址、端口和用户过滤数据包。优先级数字越小越先执行；
          首条匹配即生效。
        </Empty>
      ) : (
        <div className="rows">
          {[...rules]
            .sort((a, b) => Number(a.Priority_u32) - Number(b.Priority_u32))
            .map((r) => (
              <div key={String(r.Id_u32)} className="row" style={{ cursor: "pointer" }} onClick={() => setEditing(r)}>
                <div className="row__main">
                  <div className="row__name">
                    <span className="mono micro" style={{ color: "var(--text-faint)" }}>#{String(r.Priority_u32)}</span>
                    <Pill kind={r.Discard_bool ? "err" : "ok"} label={r.Discard_bool ? "丢弃" : "放行"} />
                    {!r.Active_bool && <Pill kind="idle" label="已停用" />}
                    <span>{ruleSentence(r)}</span>
                  </div>
                  {r.Note_utf ? <div className="row__note">{String(r.Note_utf)}</div> : null}
                </div>
                <div className="row__side">
                  <button
                    className="btn btn--sm btn--ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleting(r);
                    }}
                    aria-label="删除规则"
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}

      <AcList hub={hub} />

      {editing && (
        <AccessRuleSheet
         
          hub={hub}
          rule={editing === "new" ? null : editing}
          allRules={rules ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      {deleting && (
        <ConfirmSheet
          title="删除该规则？"
          verb="删除规则"
          body={<>{ruleSentence(deleting)}</>}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.deleteAccess(hub, Number(deleting.Id_u32));
            void load();
          }}
        />
      )}
    </>
  );
}

function ruleSentence(r: Wire): string {
  const proto = ACCESS_PROTOCOLS[Number(r.Protocol_u32)] ?? `协议 ${r.Protocol_u32}`;
  const v6 = r.IsIPv6_bool;
  const src = r.SrcUsername_str
    ? `用户 ${r.SrcUsername_str}`
    : (v6 ? "" : (r.SrcIpAddress_ip && r.SrcIpAddress_ip !== "0.0.0.0" ? `${r.SrcIpAddress_ip}/${r.SrcSubnetMask_ip}` : "")) || "任意来源";
  const dst = r.DestUsername_str
    ? `用户 ${r.DestUsername_str}`
    : (v6 ? "" : (r.DestIpAddress_ip && r.DestIpAddress_ip !== "0.0.0.0" ? `${r.DestIpAddress_ip}/${r.DestSubnetMask_ip}` : "")) || "任意目标";
  const ports =
    Number(r.DestPortStart_u32) > 0
      ? ` 端口 ${r.DestPortStart_u32}${Number(r.DestPortEnd_u32) > Number(r.DestPortStart_u32) ? `–${r.DestPortEnd_u32}` : ""}`
      : "";
  return `${proto}${v6 ? "（IPv6）" : ""}：从 ${src} 到 ${dst}${ports}`;
}

function AccessRuleSheet({ hub,
  rule,
  allRules,
  onClose,
  onSaved,
}: {
    hub: string;
  rule: Wire | null;
  allRules: Wire[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = Boolean(rule);
  const [draft, setDraft] = useState<Wire>(() =>
    rule
      ? { ...rule }
      : {
          Active_bool: true,
          Discard_bool: false,
          Priority_u32: (Math.max(0, ...allRules.map((r) => Number(r.Priority_u32))) || 0) + 100,
          Protocol_u32: 0,
          IsIPv6_bool: false,
          Note_utf: "",
        },
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { push } = useToast();
  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      if (editing) {
        // The API has no "edit one rule": the list is replaced with this rule
        // swapped in, atomically.
        const next = allRules.map((r) => (r.Id_u32 === rule?.Id_u32 ? draft : r));
        await api.setAccessList(hub, next);
      } else {
        await api.addAccess(hub, draft);
      }
      push("ok", editing ? "规则已保存。" : "规则已添加。");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const tcpish = Number(draft.Protocol_u32) === 6 || Number(draft.Protocol_u32) === 17;

  return (
    <Sheet
      title={editing ? "编辑规则" : "新建访问规则"}
      subtitle={`虚拟 HUB ${hub}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn--primary" onClick={save} disabled={busy}>
            {busy && <span className="spin" />}
            {editing ? "保存规则" : "添加规则"}
          </button>
        </>
      }
    >
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <div style={{ display: "grid", gap: "var(--s1)" }}>
        <div className="seg">
          <button className={!draft.Discard_bool ? "on" : ""} onClick={() => set("Discard_bool", false)}>放行</button>
          <button className={draft.Discard_bool ? "on" : ""} onClick={() => set("Discard_bool", true)}>丢弃</button>
        </div>
        <div className="row2">
          <Field label="优先级" hint="数字越小越先执行。">
            <input className="input mono" type="number" min={1} value={Number(draft.Priority_u32)} onChange={(e) => set("Priority_u32", Number(e.target.value))} />
          </Field>
          <Field label="协议">
            <select className="select" value={Number(draft.Protocol_u32)} onChange={(e) => set("Protocol_u32", Number(e.target.value))}>
              {Object.entries(ACCESS_PROTOCOLS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="备注">
          <input className="input" value={String(draft.Note_utf ?? "")} onChange={(e) => set("Note_utf", e.target.value)} />
        </Field>

        <SectionTitle>来源</SectionTitle>
        <div className="row2">
          <Field label="IPv4 地址" hint="留空匹配任意来源。">
            <input className="input mono" placeholder="10.0.0.0" value={String(draft.SrcIpAddress_ip ?? "")} onChange={(e) => set("SrcIpAddress_ip", e.target.value)} spellCheck={false} inputMode="decimal" />
          </Field>
          <Field label="子网掩码">
            <input className="input mono" placeholder="255.255.255.0" value={String(draft.SrcSubnetMask_ip ?? "")} onChange={(e) => set("SrcSubnetMask_ip", e.target.value)} spellCheck={false} inputMode="decimal" />
          </Field>
        </div>
        <Field label="或来源用户" hint="匹配该用户会话发出的数据包。">
          <input className="input mono" value={String(draft.SrcUsername_str ?? "")} onChange={(e) => set("SrcUsername_str", e.target.value)} spellCheck={false} autoCapitalize="none" />
        </Field>

        <SectionTitle>目标</SectionTitle>
        <div className="row2">
          <Field label="IPv4 地址" hint="留空匹配任意目标。">
            <input className="input mono" placeholder="10.0.0.8" value={String(draft.DestIpAddress_ip ?? "")} onChange={(e) => set("DestIpAddress_ip", e.target.value)} spellCheck={false} inputMode="decimal" />
          </Field>
          <Field label="子网掩码">
            <input className="input mono" placeholder="255.255.255.255" value={String(draft.DestSubnetMask_ip ?? "")} onChange={(e) => set("DestSubnetMask_ip", e.target.value)} spellCheck={false} inputMode="decimal" />
          </Field>
        </div>
        <Field label="或目标用户">
          <input className="input mono" value={String(draft.DestUsername_str ?? "")} onChange={(e) => set("DestUsername_str", e.target.value)} spellCheck={false} autoCapitalize="none" />
        </Field>
        {tcpish && (
          <div className="row2">
            <Field label="目标端口" hint="起始 – 结束；单个端口填同一个数字。">
              <div style={{ display: "flex", gap: "var(--s2)" }}>
                <input className="input mono" type="number" min={0} max={65535} placeholder="起始" value={Number(draft.DestPortStart_u32 ?? 0) || ""} onChange={(e) => set("DestPortStart_u32", Number(e.target.value))} />
                <input className="input mono" type="number" min={0} max={65535} placeholder="结束" value={Number(draft.DestPortEnd_u32 ?? 0) || ""} onChange={(e) => set("DestPortEnd_u32", Number(e.target.value))} />
              </div>
            </Field>
            <Field label="来源端口">
              <div style={{ display: "flex", gap: "var(--s2)" }}>
                <input className="input mono" type="number" min={0} max={65535} placeholder="起始" value={Number(draft.SrcPortStart_u32 ?? 0) || ""} onChange={(e) => set("SrcPortStart_u32", Number(e.target.value))} />
                <input className="input mono" type="number" min={0} max={65535} placeholder="结束" value={Number(draft.SrcPortEnd_u32 ?? 0) || ""} onChange={(e) => set("SrcPortEnd_u32", Number(e.target.value))} />
              </div>
            </Field>
          </div>
        )}

        <SectionTitle>网络模拟（可选）</SectionTitle>
        <div className="row2">
          <Field label="延迟" hint="为匹配的数据包增加的毫秒数 — 用于模拟恶劣链路。">
            <input className="input mono" type="number" min={0} max={10000} value={Number(draft.Delay_u32 ?? 0)} onChange={(e) => set("Delay_u32", Number(e.target.value))} />
          </Field>
          <Field label="丢包" hint="匹配数据包的丢弃百分比。">
            <input className="input mono" type="number" min={0} max={100} value={Number(draft.Loss_u32 ?? 0)} onChange={(e) => set("Loss_u32", Number(e.target.value))} />
          </Field>
        </div>
        <CheckRow checked={Boolean(draft.Active_bool)} onChange={(v) => set("Active_bool", v)} label="启用该规则" />
      </div>
    </Sheet>
  );
}

/* ── the source-IP limit list ─────────────────────────────────────────────── */

function AcList({ hub }: { hub: string }) {
  const [rules, setRules] = useState<Wire[] | null>(null);
  const [adding, setAdding] = useState(false);
  const { guard } = useToast();

  const load = useCallback(async () => {
    const r = await api.acList(hub).catch(() => null);
    if (r) setRules((r.ACList as Wire[]) ?? []);
  }, [hub]);
  usePoll(load, "list", [hub]);

  const remove = (rule: Wire) =>
    guard(async () => {
      const next = (rules ?? []).filter((r) => r.Id_u32 !== rule.Id_u32);
      await api.setAcList(hub, next);
      await load();
    }, "条目已移除。");

  return (
    <>
      <SectionTitle
        count={rules?.length}
        actions={
          <button className="btn btn--sm" onClick={() => setAdding(true)}>
            <IconPlus size={14} /> 添加条目
          </button>
        }
      >
        来源 IP 限制
      </SectionTitle>
      {rules === null ? (
        <LoadingBlock />
      ) : rules.length === 0 ? (
        <Empty title="暂无限制 — 客户端可从任意地址连接">
          这里的条目按客户端来源 IP 允许或拒绝连接到该虚拟 HUB 的行为，
          甚至在认证尝试之前就已生效。
        </Empty>
      ) : (
        <div className="rows">
          {[...rules]
            .sort((a, b) => Number(a.Priority_u32) - Number(b.Priority_u32))
            .map((r, i) => (
              <div key={i} className="row">
                <div className="row__main">
                  <div className="row__name">
                    <span className="mono micro" style={{ color: "var(--text-faint)" }}>#{String(r.Priority_u32)}</span>
                    <Pill kind={r.Deny_bool ? "err" : "ok"} label={r.Deny_bool ? "拒绝" : "允许"} />
                    <span className="mono">
                      {String(r.IpAddress_ip)}
                      {r.Masked_bool ? `/${r.SubnetMask_ip}` : ""}
                    </span>
                  </div>
                </div>
                <div className="row__side">
                  <button className="btn btn--sm btn--ghost" onClick={() => void remove(r)} aria-label="移除">
                    <IconTrash size={14} />
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}
      {adding && (
        <AcSheet
          existing={rules ?? []}
          onClose={() => setAdding(false)}
          onSave={async (entry) => {
            await api.setAcList(hub, [...(rules ?? []), entry]);
            setAdding(false);
            await load();
          }}
        />
      )}
    </>
  );
}

function AcSheet({ existing, onClose, onSave }: { existing: Wire[]; onClose: () => void; onSave: (e: Wire) => Promise<void> }) {
  const [deny, setDeny] = useState(false);
  const [ip, setIp] = useState("");
  const [masked, setMasked] = useState(false);
  const [mask, setMask] = useState("255.255.255.0");
  const [priority, setPriority] = useState((Math.max(0, ...existing.map((r) => Number(r.Priority_u32))) || 0) + 100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave({
        Priority_u32: priority,
        Deny_bool: deny,
        Masked_bool: masked,
        IpAddress_ip: ip.trim(),
        SubnetMask_ip: masked ? mask.trim() : "255.255.255.255",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="来源 IP 条目"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn--primary" onClick={save} disabled={busy || !ip.trim()}>
            {busy && <span className="spin" />} 添加
          </button>
        </>
      }
    >
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <div className="seg" style={{ marginBottom: "var(--s3)" }}>
        <button className={!deny ? "on" : ""} onClick={() => setDeny(false)}>允许</button>
        <button className={deny ? "on" : ""} onClick={() => setDeny(true)}>拒绝</button>
      </div>
      <Field label="IP 地址">
        <input className="input mono" value={ip} onChange={(e) => setIp(e.target.value)} placeholder="203.0.113.7" spellCheck={false} inputMode="decimal" />
      </Field>
      <CheckRow checked={masked} onChange={setMasked} label="整个子网" hint="作用于一个网段而非单个地址。" />
      {masked && (
        <Field label="子网掩码">
          <input className="input mono" value={mask} onChange={(e) => setMask(e.target.value)} spellCheck={false} inputMode="decimal" />
        </Field>
      )}
      <Field label="优先级" hint="数字越小越先执行。">
        <input className="input mono" type="number" min={1} value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
      </Field>
    </Sheet>
  );
}
