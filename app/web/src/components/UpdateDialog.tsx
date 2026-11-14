"use client";

import { Terminal } from "./Terminal";
import { useUpdate } from "../lib/update";
import { Sheet } from "../ui/Sheet";
import { Pill } from "../ui/Status";

/**
 * The updater, opened from the version pill anywhere in the app.
 *
 * Applying an update restarts the panel under this very dialog; the poll in
 * lib/update quietly rides through the gap and reports what the transient
 * systemd unit says happened.
 */
export function UpdateDialog() {
  const { status, error, isChecking, isStarting, startError, applying, reloading, isOpen, close, check, start } =
    useUpdate();
  if (!isOpen) return null;

  const checkInfo = status?.check ?? {};
  const state = status?.state ?? {};
  const stage = String(state.stage ?? "idle");
  const latest = checkInfo.latest ?? {};
  const available = Boolean(checkInfo.update_available);
  const canApply = Boolean(checkInfo.can_apply);
  const log: string[] = Array.isArray(state.log) ? (state.log as string[]) : [];

  return (
    <Sheet
      title="更新"
      subtitle={`当前运行 ${checkInfo.current_version ?? "—"}`}
      onClose={close}
      wide
      footer={
        <>
          <button className="btn" onClick={() => void check()} disabled={isChecking || applying}>
            {isChecking && <span className="spin" />} 重新检查
          </button>
          <button
            className="btn btn--primary"
            onClick={() => void start()}
            disabled={!available || !canApply || applying || isStarting}
          >
            {(applying || isStarting) && <span className="spin" />}
            {applying ? "更新中…" : available ? `安装 ${latest.version}` : "已是最新"}
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gap: "var(--s3)" }}>
        {error && <div className="alert alert--err">{error}</div>}
        {startError && <div className="alert alert--err">{startError}</div>}

        <div style={{ display: "flex", alignItems: "center", gap: "var(--s2)", flexWrap: "wrap" }}>
          {stage === "running" && <Pill kind="busy" label="正在更新" />}
          {stage === "succeeded" && <Pill kind="ok" label="已更新" />}
          {reloading && <span className="micro">正在重新加载面板…</span>}
          {stage === "failed" && <Pill kind="err" label="更新失败" />}
          {available && stage !== "running" && <Pill kind="warn" label={`${latest.version} 可用`} />}
          {!available && stage === "idle" && !checkInfo.error && (
            <span className="micro">
              {checkInfo.checked_at ? "已是最新版本。" : "尚未检查。"}
            </span>
          )}
        </div>

        {checkInfo.error ? <div className="hint hint--err">{String(checkInfo.error)}</div> : null}
        {checkInfo.note ? <div className="hint">{String(checkInfo.note)}</div> : null}
        {state.error ? <div className="alert alert--err">{String(state.error)}</div> : null}
        {!canApply && checkInfo.unavailable_reason ? (
          <div className="hint">{String(checkInfo.unavailable_reason)}</div>
        ) : null}

        {available && latest.notes ? (
          <div className="notes">
            <div className="notes__h">
              <span>{String(latest.name || latest.version)}</span>
              {latest.url ? (
                <a href={String(latest.url)} target="_blank" rel="noreferrer">
                  发布页面 ↗
                </a>
              ) : null}
            </div>
            <pre>{String(latest.notes)}</pre>
          </div>
        ) : null}

        {(stage === "running" || stage === "failed" || log.length > 0) && (
          <Terminal lines={log} live={stage === "running"} label="update.log" tall />
        )}
      </div>
    </Sheet>
  );
}
