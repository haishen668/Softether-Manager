"use client";

import { useCallback, useEffect, useState } from "react";
import { ConfirmSheet, Empty, KV, LoadingBlock, SearchBox, SectionTitle, usePoll } from "../../components/bits";
import { api, type Wire } from "../../lib/api";
import { navigate, seg } from "../../lib/router";
import { SESSION_TYPE } from "../../lib/se";
import { useToast } from "../../lib/toast";
import { formatBytes, formatCount, formatDate, timeAgo } from "../../lib/util";
import { IconClose } from "../../ui/Icon";
import { Sheet } from "../../ui/Sheet";
import { Pill } from "../../ui/Status";

/**
 * Live sessions: who is on the wire right now. Polled every few seconds --
 * this is the screen an operator keeps open during an incident, and the one
 * whose kill button has to work the moment it is pressed.
 */
export function HubSessions({ hub }: { hub: string }) {
  const [sessions, setSessions] = useState<Wire[] | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [killing, setKilling] = useState<Wire | null>(null);
  const { guard } = useToast();

  const load = useCallback(async () => {
    const r = await api.sessions(hub).catch(() => null);
    if (r) setSessions((r.SessionList as Wire[]) ?? []);
  }, [hub]);
  usePoll(load, "live", [hub]);

  const q = query.trim().toLowerCase();
  const filtered = sessions?.filter(
    (s) =>
      !q ||
      [s.Name_str, s.Username_str, s.Hostname_str, s.ClientIP_ip]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
  );

  return (
    <>
      <SectionTitle
        count={sessions?.length}
        actions={<SearchBox value={query} onChange={setQuery} placeholder="用户、主机、IP…" />}
      >
        在线会话
      </SectionTitle>

      {filtered == null ? (
        <LoadingBlock label="正在加载会话" />
      ) : filtered.length === 0 ? (
        <Empty title={q ? "无匹配结果" : "当前无人连接"}>
          {q ? "没有匹配该搜索的会话。" : "客户端连接后会话会实时出现在这里。"}
        </Empty>
      ) : (
        <SessionsTable
          sessions={filtered}
          userLink={(u) => navigate(`/hub/${seg(hub)}/user/${seg(u)}`)}
          onOpen={(s) => setOpen(String(s.Name_str))}
          onKill={(s) => setKilling(s)}
        />
      )}

      {open && <SessionSheet hub={hub} name={open} onClose={() => setOpen(null)} />}
      {killing && (
        <ConfirmSheet
          title="断开该会话？"
          verb="断开"
          body={
            <>
              <span className="mono">{String(killing.Name_str)}</span>
              {killing.Username_str ? <> — 用户 <b>{String(killing.Username_str)}</b></> : null}
              将被立即切断。除非先停用该用户，否则客户端可能会直接重新连接。
            </>
          }
          onClose={() => setKilling(null)}
          onConfirm={async () => {
            await api.killSession(hub, String(killing.Name_str));
            await load();
          }}
        />
      )}
    </>
  );
}

/** Shared by the hub page and the user page. */
export function SessionsTable({
  sessions,
  onOpen,
  onKill,
  userLink,
}: {
  sessions: Wire[];
  onOpen: (s: Wire) => void;
  onKill: (s: Wire) => void | Promise<unknown>;
  userLink?: (username: string) => void;
}) {
  return (
    <>
      {/* desktop table */}
      <div className="only-desktop-b">
        <div className="card tcard">
          <div className="tscroll">
            <table className="dtable">
              <thead>
                <tr>
                  <th>会话</th>
                  <th>用户</th>
                  <th>类型</th>
                  <th>来源</th>
                  <th style={{ width: 80 }}>TCP</th>
                  <th>数据包</th>
                  <th>流量</th>
                  <th>开始时间</th>
                  <th className="tact" style={{ width: 120 }} aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const kind = SESSION_TYPE(s);
                  const system = kind !== "客户端";
                  return (
                    <tr key={String(s.Name_str)} className="clickable" onClick={() => onOpen(s)}>
                      <td className="tmono">{String(s.Name_str)}</td>
                      <td>
                        {s.Username_str && userLink && !system ? (
                          <button
                            className="linkish mono"
                            onClick={(e) => {
                              e.stopPropagation();
                              userLink(String(s.Username_str));
                            }}
                          >
                            {String(s.Username_str)}
                          </button>
                        ) : (
                          <span className="tmono">{String(s.Username_str || "—")}</span>
                        )}
                      </td>
                      <td>
                        <Pill kind={system ? "idle" : "ok"} label={kind} />
                      </td>
                      <td className="tmono">
                        {String(s.Hostname_str || s.ClientIP_ip || "—")}
                        {s.ClientIP_ip && s.Hostname_str ? <span className="tsub">{String(s.ClientIP_ip)}</span> : null}
                      </td>
                      <td className="tmono">{s.CurrentNumTcp_u32 != null ? `${s.CurrentNumTcp_u32}/${s.MaxNumTcp_u32}` : "—"}</td>
                      <td className="tmono">{formatCount(Number(s.PacketNum_u64))}</td>
                      <td className="tmono">{formatBytes(Number(s.PacketSize_u64))}</td>
                      <td className="tmono">{timeAgo(s.CreatedTime_dt as string)}</td>
                      <td className="tact">
                        {!system && (
                          <button
                            className="btn btn--sm btn--danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              void onKill(s);
                            }}
                          >
                            <IconClose size={13} /> 切断
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* mobile cards */}
      <div className="rows only-mobile-b">
        {sessions.map((s) => {
          const kind = SESSION_TYPE(s);
          const system = kind !== "客户端";
          return (
            <button key={String(s.Name_str)} className="row" onClick={() => onOpen(s)}>
              <div className="row__main">
                <div className="row__name">
                  <span className="mono truncate">{String(s.Username_str || s.Name_str)}</span>
                  <Pill kind={system ? "idle" : "ok"} label={kind} />
                </div>
                <div className="spec">
                  {s.ClientIP_ip ? <span className="chip"><i>来源</i>{String(s.ClientIP_ip)}</span> : null}
                  <span className="chip"><i>流量</i>{formatBytes(Number(s.PacketSize_u64))}</span>
                  <span className="chip"><i>始于</i>{timeAgo(s.CreatedTime_dt as string)}</span>
                </div>
              </div>
              <div className="row__side">
                {!system && (
                  <button
                    className="btn btn--sm btn--danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      void onKill(s);
                    }}
                  >
                    切断
                  </button>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

/** Everything the server knows about one session, in a sheet. */
export function SessionSheet({ hub,
  name,
  onClose,
}: {
    hub: string;
  name: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Wire | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .sessionStatus(hub, name)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [hub, name]);

  return (
    <Sheet title="会话" subtitle={name} onClose={onClose} wide>
      {error && <div className="alert alert--err">{error}</div>}
      {!detail && !error && <LoadingBlock />}
      {detail && (
        <div style={{ display: "grid", gap: "var(--s4)" }}>
          <KV
            rows={[
              ["用户", String(detail.Username_str || "—")],
              ["客户端 IP", String(detail.Client_Ip_Address_ip || "—")],
              ["客户端主机", String(detail.SessionStatus_ClientHostName_str || detail.ClientHostname_str || "—")],
              ["协议", String(detail.UnderlayProtocol_str || "—")],
              ["加密算法", String(detail.CipherName_str || "明文")],
              ["UDP 加速", detail.IsUsingUdpAcceleration_bool ? "使用中" : detail.IsUdpAccelerationEnabled_bool ? "已启用" : "未启用"],
              ["TCP 连接", `${detail.NumTcpConnections_u32 ?? 0} / ${detail.MaxTcpConnections_u32 ?? 0}`],
              ["半连接", detail.HalfConnection_bool ? "是" : "否"],
              ["压缩", detail.UseCompress_bool ? "是" : "否"],
              ["开始时间", formatDate(detail.StartTime_dt as string)],
              ["客户端", `${detail.ClientProductName_str || "—"} ${detail.ClientProductVer_u32 ?? ""}`],
              ["客户端系统", String(detail.ClientOsName_str || "—")],
              ["已发送", formatBytes(Number(detail.TotalSendSizeReal_u64 ?? detail.TotalSendSize_u64))],
              ["已接收", formatBytes(Number(detail.TotalRecvSizeReal_u64 ?? detail.TotalRecvSize_u64))],
            ]}
          />
        </div>
      )}
    </Sheet>
  );
}
