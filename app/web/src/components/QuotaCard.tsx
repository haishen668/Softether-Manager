"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Quota, type QuotaMetric, type QuotaUnit } from "../lib/api";
import { useToast } from "../lib/toast";
import { formatBytes, formatDate } from "../lib/util";
import { CheckRow, Field, usePoll } from "./bits";
import { Sheet } from "../ui/Sheet";
import { IconTrash } from "../ui/Icon";
import { Pill } from "../ui/Status";
import { SwitchRow, useToggle } from "../ui/Switch";

/**
 * The traffic ceiling: how much may move, which direction counts, and whether
 * it is armed. Three decisions and no more.
 *
 * The pieces are split by who owns the Save button. A **config's** limit is
 * part of its profile, so the fields ride inside the Edit-profile sheet and
 * are saved with everything else -- one form, one commit. A **hub's** limit
 * has no such form to join, so it keeps a card of its own here.
 *
 * The meter is drawn against the metric's own figure, not the combined total:
 * a download-only limit reading 90% means 90% of the download allowance, and
 * the two direction figures underneath say where that came from. Once a quota
 * bites, the subject is genuinely cut off -- access denied for a config,
 * offline for a hub -- so the summary says so in those words rather than
 * colouring a bar red and leaving the operator to guess.
 */

export const METRIC_OPTIONS: { value: QuotaMetric; label: string; hint: string }[] = [
  { value: "total", label: "双向", hint: "下载与上传之和。" },
  { value: "download", label: "下载", hint: "仅统计下载流量。" },
  { value: "upload", label: "上传", hint: "仅统计上传流量。" },
];

const UNITS: QuotaUnit[] = ["MB", "GB", "TB"];

/** What the metric is called in a sentence. */
export const METRIC_WORD: Record<QuotaMetric, string> = {
  total: "下载 + 上传",
  download: "下载",
  upload: "上传",
};

/** A pair of raw or net byte counters, in the panel's own words. */
export interface Bytes {
  /** What the subject uploaded. */
  send: number;
  /** What the subject downloaded. */
  recv: number;
}

/**
 * The Transfer the panel shows: SoftEther's lifetime counter, less whatever a
 * reset put behind us.
 *
 * SoftEther has no way to zero a counter, so a reset is a baseline this panel
 * keeps and every figure subtracts. Passing the raw counters through here is
 * what makes the Transfer column and the quota meter beside it the same
 * number, computed from the same reading, rather than two figures a tick
 * apart.
 */
export function netBytes(raw: Bytes, quota?: Quota | null): Bytes {
  if (!quota) return raw;
  return {
    send: Math.max(0, raw.send - quota.base_send_bytes),
    recv: Math.max(0, raw.recv - quota.base_recv_bytes),
  };
}

/** The one of those figures a metric measures. */
export function meteredBytes(net: Bytes, metric: QuotaMetric): number {
  if (metric === "upload") return net.send;
  if (metric === "download") return net.recv;
  return net.send + net.recv;
}

/** How far into its ceiling a subject is, 0-100. */
function percentOf(used: number, limitBytes: number): number {
  if (limitBytes <= 0) return 0;
  return Math.max(0, Math.min(100, (used / limitBytes) * 100));
}

/** Neutral until it is worth looking at, warning near the end, spent at it. */
export function quotaTone(quota: Quota, percent = quota.percent): "accent" | "warn" | "err" {
  if (!quota.enabled) return "accent";
  if (percent >= 100) return "err";
  if (percent >= 80) return "warn";
  return "accent";
}

const TONE_COLOR = {
  accent: "var(--accent)",
  warn: "var(--warn)",
  err: "var(--err)",
} as const;

/** The bar itself — shared by the summary and by the table cell. */
export function QuotaMeter({ quota, used }: { quota: Quota; used?: number }) {
  const spent = used ?? quota.used_bytes;
  const percent = percentOf(spent, quota.limit_bytes);
  return (
    <div
      className="meter"
      role="meter"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`已用 ${formatBytes(spent)} / ${formatBytes(quota.limit_bytes)}`}
    >
      <div
        className="meter__fill"
        style={{ width: `${percent}%`, background: TONE_COLOR[quotaTone(quota, percent)] }}
      />
    </div>
  );
}

// --- the draft a form edits -------------------------------------------------------

/** A limit being edited. `limit` stays a string so typing into it is normal. */
export interface QuotaDraft {
  /** Off means "no ceiling on this config" — saving with it off removes one. */
  on: boolean;
  limit: string;
  unit: QuotaUnit;
  metric: QuotaMetric;
  enforce: boolean;
  /** Zero the config's transfer when this draft is saved. Independent of the
   *  ceiling: a transfer is worth resetting with or without one. */
  reset: boolean;
}

export const EMPTY_DRAFT: QuotaDraft = {
  on: false,
  limit: "50",
  unit: "GB",
  metric: "total",
  enforce: true,
  reset: false,
};

/** A saved quota, back in editable form. A record with no ceiling — one that
 *  exists only to remember a reset — edits as "no limit". */
export function draftOf(quota: Quota | null): QuotaDraft {
  if (!quota || !quota.has_limit) return { ...EMPTY_DRAFT, on: false };
  return {
    on: true,
    limit: String(quota.limit),
    unit: quota.unit,
    metric: quota.metric,
    enforce: quota.enabled,
    reset: false,
  };
}

/** The amount, validated. Throws the message the operator should read. */
export function draftAmount(draft: QuotaDraft): number {
  const amount = Number(draft.limit);
  if (!isFinite(amount) || amount <= 0) {
    throw new Error("请为流量限额填写一个大于零的数字。");
  }
  return amount;
}

/**
 * Apply a draft to one config, as part of whatever save is in progress.
 *
 * The ceiling first, the reset second, so a reset always lands on the limit
 * the operator just chose. Removing a ceiling keeps the record if it still
 * holds a baseline — that is the backend's call, and it is what lets a reset
 * survive an operator who later decides against a limit.
 */
export async function saveUserQuotaDraft(
  hub: string,
  name: string,
  draft: QuotaDraft,
  existed: boolean,
): Promise<void> {
  if (draft.on) {
    await api.setUserQuota(hub, name, {
      limit: draftAmount(draft),
      unit: draft.unit,
      metric: draft.metric,
      enabled: draft.enforce,
    });
  } else if (existed) {
    await api.deleteUserQuota(hub, name);
  }
  // Creates the record when there is none: resetting a transfer never depends
  // on a limit having been set first.
  if (draft.reset) await api.resetUserTransfer(hub, name);
}

/** The amount, the unit and what they count. The rows every quota form shares. */
export function QuotaFields({
  draft,
  onChange,
}: {
  draft: QuotaDraft;
  onChange: (next: QuotaDraft) => void;
}) {
  const set = (patch: Partial<QuotaDraft>) => onChange({ ...draft, ...patch });
  return (
    <div className="row2">
      <Field label="限额" hint="达到上限前允许的流量。">
        <div className="qsplit">
          <input
            className="input mono"
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={draft.limit}
            onChange={(e) => set({ limit: e.target.value })}
          />
          <select
            className="select"
            aria-label="单位"
            value={draft.unit}
            onChange={(e) => set({ unit: e.target.value as QuotaUnit })}
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
      </Field>
      <Field label="统计方式" hint={METRIC_OPTIONS.find((m) => m.value === draft.metric)?.hint}>
        <div className="seg" role="radiogroup" aria-label="限额统计方式">
          {METRIC_OPTIONS.map((m) => (
            <button
              key={m.value}
              role="radio"
              aria-checked={draft.metric === m.value}
              className={draft.metric === m.value ? "on" : ""}
              onClick={() => set({ metric: m.value })}
            >
              {m.label}
            </button>
          ))}
        </div>
      </Field>
    </div>
  );
}

/**
 * Read-only: where the subject has got to, and what that has cost it.
 *
 * `net` overrides the cached figures with the counters the caller already
 * holds, which is how this and the Transfer beside it agree to the byte.
 */
export function QuotaSummary({
  quota,
  subject,
  net,
}: {
  quota: Quota;
  subject: "hub" | "user";
  net?: Bytes;
}) {
  const moved: Bytes = net ?? { send: quota.upload_bytes, recv: quota.download_bytes };
  const used = meteredBytes(moved, quota.metric);
  const percent = percentOf(used, quota.limit_bytes);
  const left = quota.has_limit ? Math.max(0, quota.limit_bytes - used) : null;
  return (
    <div className="quota">
      <div className="quota__head">
        <span className="quota__used mono">{formatBytes(used)}</span>
        <span className="quota__of micro">
          {quota.has_limit
            ? `共 ${formatBytes(quota.limit_bytes)}（${METRIC_WORD[quota.metric]}）`
            : "已用流量 — 未设上限"}
        </span>
        {/* Worst state first. "spent" without a block means the ceiling was
            crossed but the cut-off has not landed yet -- the tick is due, or it
            could not reach the server -- which is worth saying rather than
            showing the same pill as a block that took. */}
        {!quota.has_limit ? null : quota.blocked ? (
          <Pill kind="err" label={subject === "hub" ? "已离线 — 超出限额" : "已断开 — 超出限额"} />
        ) : !quota.enabled ? (
          <Pill kind="idle" label="未强制执行" />
        ) : percent >= 100 ? (
          <Pill kind="busy" label="已用尽 — 正在断开" />
        ) : percent >= 80 ? (
          <Pill kind="warn" label="即将用尽" />
        ) : (
          <Pill kind="ok" label="限额内" />
        )}
      </div>
      {quota.has_limit && <QuotaMeter quota={quota} used={used} />}
      <div className="quota__facts">
        <span className="chip"><i>↓ 下载</i>{formatBytes(moved.recv)}</span>
        <span className="chip"><i>↑ 上传</i>{formatBytes(moved.send)}</span>
        {left != null && <span className="chip"><i>剩余</i>{formatBytes(left)}</span>}
        <span className="chip"><i>起算时间</i>{formatDate(quota.cycle_start)}</span>
      </div>
      {quota.blocked && (
        <div className="alert alert--warn">
          {subject === "hub" ? (
            <>
              该虚拟 HUB 在达到限额时已离线，其中所有会话均被断开。提高限额或重置流量即可恢复 —
              面板会自动将其重新上线。
            </>
          ) : (
            <>
              该账号在达到限额时已被拒绝访问，其会话也已被断开。提高限额或重置流量后，面板会原样恢复其原有的安全策略。
            </>
          )}
        </div>
      )}
    </div>
  );
}

// --- a config's limit, inside its profile form ------------------------------------

/**
 * The config's ceiling as a block of an existing form: a switch, the fields it
 * reveals, and -- once there is something to reset -- the option to start a
 * new cycle with the save. Nothing here talks to the server; the sheet that
 * owns the Save button does, through `saveUserQuotaDraft`.
 */
export function UserQuotaBlock({
  quota,
  draft,
  onChange,
  raw,
}: {
  /** The config's traffic record, or null when it has neither limit nor reset. */
  quota: Quota | null;
  draft: QuotaDraft;
  onChange: (next: QuotaDraft) => void;
  /** The config's raw lifetime counters, when the caller has them. */
  raw?: Bytes;
}) {
  const set = (patch: Partial<QuotaDraft>) => onChange({ ...draft, ...patch });
  const moved = raw
    ? netBytes(raw, quota)
    : quota
      ? { send: quota.upload_bytes, recv: quota.download_bytes }
      : null;
  const transfer = moved ? moved.send + moved.recv : 0;
  return (
    <>
      <div className="tpl__group">流量限额</div>
      <CheckRow
        checked={draft.on}
        onChange={(v) => set({ on: v })}
        label="限制该账号的流量"
        hint={
          moved
            ? `以面板显示的该账号流量为基准（当前为 ${formatBytes(transfer)}），因此限额会计入已用的流量，而不只是之后的流量。`
            : "以面板显示的该账号流量为基准，因此限额会计入已用的流量，而不只是之后的流量。"
        }
      />
      {draft.on && (
        <>
          {quota?.has_limit && <QuotaSummary quota={quota} subject="user" net={moved ?? undefined} />}
          <QuotaFields draft={draft} onChange={onChange} />
          <CheckRow
            checked={draft.enforce}
            onChange={(v) => set({ enforce: v })}
            label="强制执行此限额"
            hint="关闭后仍会统计流量并填充进度条，但不会切断任何连接 — 适合在正式设限前观察账号的用量。"
          />
        </>
      )}
      {transfer > 0 && (
        <CheckRow
          checked={draft.reset}
          onChange={(v) => set({ reset: v })}
          label={`将该账号流量清零（当前 ${formatBytes(transfer)}）`}
          hint="SoftEther 会永久累计且无法清零，因此面板自行维护基准值并从每个数字中扣除。勾选后保存会把基准移到今天：流量列和限额都会重新开始计算。"
        />
      )}
      {!draft.on && quota?.blocked && (
        <div className="alert alert--warn">
          该账号当前已被限额切断。保存时移除限额即可恢复其访问。
        </div>
      )}
    </>
  );
}

// --- tables -----------------------------------------------------------------------

/** How a row finds its own quota. Usernames are case-folded because
 *  SoftEther matches them without case, exactly as the backend keys them. */
export const quotaKey = (subject: "hub" | "user", hub: string, username = "") =>
  `${subject}:${hub}:${username.toLowerCase()}`;

/**
 * Every quota on the server, keyed, in one request rather than one per row.
 *
 * The user tables render a meter per row; asking per row would be one call
 * per user on every poll, which is exactly the shape of request the panel
 * avoids everywhere else.
 */
export function useQuotaIndex(deps: unknown[] = []) {
  const [index, setIndex] = useState<Map<string, Quota>>(new Map());
  const load = useCallback(async () => {
    const rows = await api.quotas().catch(() => null);
    if (rows) setIndex(new Map(rows.map((q) => [quotaKey(q.subject, q.hub, q.username), q])));
  }, []);
  usePoll(load, "list", deps);
  return index;
}

/** A row's place in its quota, for sorting: unlimited sorts below everything
 *  limited, so the configs with a ceiling group together. */
export function quotaSortValue(quota: Quota | undefined, net?: Bytes): number {
  if (!quota?.has_limit) return -1;
  const moved = net ?? { send: quota.upload_bytes, recv: quota.download_bytes };
  return percentOf(meteredBytes(moved, quota.metric), quota.limit_bytes);
}

/**
 * The limit's state in one pill, for a hub's header and the dashboard feed:
 * whether one exists, whether it is armed, how far into it the hub is, and
 * -- worst first -- whether it has already bitten.
 */
export function QuotaStatePill({ quota, net }: { quota: Quota | undefined | null; net?: Bytes }) {
  if (!quota?.has_limit) return null;
  const moved: Bytes = net ?? { send: quota.upload_bytes, recv: quota.download_bytes };
  const percent = Math.round(percentOf(meteredBytes(moved, quota.metric), quota.limit_bytes));
  const title = `${formatBytes(meteredBytes(moved, quota.metric))} / 共 ${formatBytes(quota.limit_bytes)}（${METRIC_WORD[quota.metric]}）`;
  if (quota.blocked) return <span title={title}><Pill kind="err" label="超出限额" /></span>;
  if (!quota.enabled) return <span title={title}><Pill kind="idle" label={`限额停用 · ${percent}%`} /></span>;
  if (percent >= 100) return <span title={title}><Pill kind="busy" label="限额已用尽" /></span>;
  return <span title={title}><Pill kind={percent >= 80 ? "warn" : "ok"} label={`限额 ${percent}%`} /></span>;
}

/**
 * The one switch a limit has: armed or not. It talks to the server at once
 * and shows the state read back, never the state asked for. Shared by the
 * hub card and the user page.
 */
export function QuotaEnforceSwitch({
  quota,
  subject,
  onChanged,
}: {
  quota: Quota;
  subject: "hub" | "user";
  /** Called with the quota as the server reports it after the switch. */
  onChanged: (next: Quota) => void;
}) {
  const noun = subject === "hub" ? "虚拟 HUB 的流量限额" : "该账号的流量限额";
  const read = async () =>
    subject === "hub" ? api.hubQuota(quota.hub) : api.userQuota(quota.hub, quota.username);
  const toggle = useToggle({
    value: quota.enabled,
    apply: async (next) => {
      const fresh =
        subject === "hub"
          ? await api.setHubQuotaEnabled(quota.hub, next)
          : await api.setUserQuotaEnabled(quota.hub, quota.username, next);
      onChanged(fresh);
      return fresh.enabled;
    },
    reload: async () => {
      try {
        const fresh = await read();
        onChanged(fresh);
        return fresh.enabled;
      } catch {
        return null;
      }
    },
    noun,
    onWord: "已强制",
    offWord: "未强制",
  });
  return (
    <SwitchRow
      label="强制执行此限额"
      hint={
        quota.enabled
          ? subject === "hub"
            ? "已启用：达到上限后虚拟 HUB 将离线，直到提高限额或重置流量。"
            : "已启用：达到上限后该账号将被拒绝访问，其会话也会被断开。"
          : "关闭后仍会统计流量并填充进度条，但不会切断任何连接。重新开启后会立即恢复上限约束。"
      }
      status={
        quota.blocked ? (
          <Pill kind="err" label={subject === "hub" ? "HUB 已离线" : "已断开"} />
        ) : (
          <Pill kind={quota.enabled ? "ok" : "idle"} label={quota.enabled ? "已强制" : "未强制"} />
        )
      }
      toggle={toggle}
      on={quota.enabled}
      onWord="已强制"
      offWord="关闭"
    />
  );
}

/** Used / limit with a bar, for a table cell. `net` is the row's own
 *  Transfer, so the two columns can never disagree. */
export function QuotaCell({ quota, net }: { quota: Quota | undefined; net?: Bytes }) {
  if (!quota?.has_limit) return <span className="micro">—</span>;
  const moved: Bytes = net ?? { send: quota.upload_bytes, recv: quota.download_bytes };
  const used = meteredBytes(moved, quota.metric);
  return (
    <span
      className="qcell"
      title={`${METRIC_WORD[quota.metric]} · 已用 ${formatBytes(used)} / 共 ${formatBytes(quota.limit_bytes)}`}
    >
      <span className="qcell__t mono">
        {formatBytes(used)}
        <span className="muted"> / {formatBytes(quota.limit_bytes)}</span>
      </span>
      <QuotaMeter quota={quota} used={used} />
      {quota.blocked ? <Pill kind="err" label="超限" /> : !quota.enabled ? <Pill kind="idle" label="停用" /> : null}
    </span>
  );
}

// --- a hub's limit, on its own -----------------------------------------------------

/**
 * The hub's ceiling. Unlike a config's, it has no profile form to join, so it
 * carries its own Save, its own Reset and its own Remove.
 */
export function QuotaCard({ hub, onChanged }: { hub: string; onChanged?: () => void }) {
  const [quota, setQuota] = useState<Quota | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<QuotaDraft>(EMPTY_DRAFT);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { guard, push } = useToast();

  const adopt = useCallback((next: Quota | null) => {
    setQuota(next);
    setDraft(next ? draftOf(next) : { ...EMPTY_DRAFT });
    setDirty(false);
  }, []);

  // The enforcement switch changes the quota without touching whatever the
  // operator is typing into the form beside it.
  const absorb = useCallback(
    (next: Quota) => {
      setQuota(next);
      if (!dirty) setDraft(draftOf(next));
    },
    [dirty],
  );

  const load = useCallback(async () => {
    try {
      adopt(await api.hubQuota(hub));
    } catch (e) {
      // 404 is the ordinary answer for "no ceiling here"; anything else is a
      // real failure and the card simply stays in its unset state.
      if (!(e instanceof ApiError) || e.status !== 404) {
        push("err", e instanceof Error ? e.message : String(e));
      }
      adopt(null);
    } finally {
      setLoaded(true);
    }
  }, [hub, adopt, push]);

  useEffect(() => {
    void load();
  }, [load]);

  const change = (next: QuotaDraft) => {
    setDraft(next);
    setDirty(true);
  };

  const save = async () => {
    let amount: number;
    try {
      amount = draftAmount(draft);
    } catch (e) {
      push("err", e instanceof Error ? e.message : String(e));
      return;
    }
    setSaving(true);
    const ok = await guard(async () => {
      adopt(
        await api.setHubQuota(hub, {
          limit: amount,
          unit: draft.unit,
          metric: draft.metric,
          // The switch above the form is the one place an existing limit is
          // armed or disarmed; a save keeps whatever it says.
          enabled: quota?.has_limit ? quota.enabled : draft.enforce,
        }),
      );
    }, "流量限额已保存。");
    setSaving(false);
    if (ok) onChanged?.();
  };

  const reset = () =>
    guard(async () => {
      adopt(await api.resetHubTransfer(hub));
      onChanged?.();
    }, "流量已重置 — 虚拟 HUB 将从零重新计数。");

  const remove = () =>
    guard(async () => {
      await api.deleteHubQuota(hub);
      adopt(null);
      setRemoving(false);
      onChanged?.();
    }, "流量限额已移除。");

  if (!loaded) return null;

  return (
    <div className="card" style={{ padding: "var(--s4)", maxWidth: 640 }}>
      {quota?.has_limit && <QuotaEnforceSwitch quota={quota} subject="hub" onChanged={(next) => { absorb(next); onChanged?.(); }} />}
      {quota?.has_limit ? (
        <QuotaSummary quota={quota} subject="hub" />
      ) : (
        <p className="lede" style={{ marginBottom: "var(--s3)" }}>
          该虚拟 HUB 尚未设置流量限额。设置后，面板会基于 SoftEther
          自身的计数器统计流量（重启后依然有效），并在达到上限的一刻让虚拟 HUB 离线。
        </p>
      )}

      <QuotaFields draft={draft} onChange={change} />

      {!quota?.has_limit && (
        <CheckRow
          checked={draft.enforce}
          onChange={(v) => change({ ...draft, enforce: v })}
          label="从一开始就强制执行此限额"
          hint="关闭后仍会继续计数并填充进度条，但虚拟 HUB 永远不会离线 — 适合在正式设限前观察用量。之后可随时切换。"
        />
      )}

      <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap", marginTop: "var(--s3)" }}>
        {(dirty || !quota?.has_limit) && (
          <button className="btn btn--primary" onClick={() => void save()} disabled={saving}>
            {saving && <span className="spin" />} {quota?.has_limit ? "保存限额" : "设置限额"}
          </button>
        )}
        {dirty && quota?.has_limit && <button className="btn" onClick={() => adopt(quota)}>放弃更改</button>}
        {quota && !dirty && (
          <>
            <button className="btn" onClick={() => void reset()}>重置流量</button>
            {quota.has_limit && (
              <button className="btn btn--ghost" onClick={() => setRemoving(true)}>
                <IconTrash size={14} /> 移除限额
              </button>
            )}
          </>
        )}
      </div>

      {removing && (
        <Sheet
          title="移除流量限额？"
          subtitle={hub}
          onClose={() => setRemoving(false)}
          footer={
            <>
              <button className="btn" onClick={() => setRemoving(false)}>保留</button>
              <button className="btn btn--danger" onClick={() => void remove()}>移除限额</button>
            </>
          }
        >
          <p className="lede">
            上限及已统计的用量记录将被丢弃。
            {quota?.blocked && (
              <>
                {" "}由于该虚拟 HUB <b>因限额</b>而离线，移除限额后会自动将其重新上线。
              </>
            )}
          </p>
        </Sheet>
      )}
    </div>
  );
}
