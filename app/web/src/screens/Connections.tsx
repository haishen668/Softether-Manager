"use client";

import { useCallback, useState } from "react";
import { ConfirmSheet, Empty, KV, LoadingBlock, PageHead, usePoll } from "../components/bits";
import { api, type Wire } from "../lib/api";
import { useToast } from "../lib/toast";
import { formatDate, timeAgo } from "../lib/util";
import { IconClose } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
import { Pill } from "../ui/Status";

/**
 * Raw TCP connections into the VPN server -- including half-open clients,
 * management links, and this very panel. The lowest-level live view there is.
 */

const CONNECTION_TYPES: Record<number, string> = {
  0: "客户端",
  1: "初始化",
  2: "登录中",
  3: "附加连接",
  4: "RPC / 集群",
  5: "管理",
  6: "管理连接",
  7: "管理连接",
};

export function Connections() {
  const [connections, setConnections] = useState<Wire[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [killing, setKilling] = useState<Wire | null>(null);

  const load = useCallback(async () => {
    const r = await api.connections().catch(() => null);
    if (r) setConnections((r.ConnectionList as Wire[]) ?? []);
  }, []);
  usePoll(load, "live", []);

  return (
    <div className="page">
      <PageHead title="连接" sub="进入 VPN 服务器的实时 TCP 连接" />
      {connections === null ? (
        <LoadingBlock label="正在加载连接" />
      ) : connections.length === 0 ? (
        <Empty title="暂无连接">这反而少见，因为本面板就是其中之一。</Empty>
      ) : (
        <div className="card tcard">
          <div className="tscroll">
            <table className="dtable">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>类型</th>
                  <th>来源</th>
                  <th>连接时间</th>
                  <th className="tact" style={{ width: 130 }} aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {connections.map((c) => (
                  <tr key={String(c.Name_str)} className="clickable" onClick={() => setOpen(String(c.Name_str))}>
                    <td className="tmono">{String(c.Name_str)}</td>
                    <td><Pill kind="idle" label={CONNECTION_TYPES[Number(c.Type_u32)] ?? `类型 ${c.Type_u32}`} /></td>
                    <td className="tmono">
                      {String(c.Hostname_str || c.Ip_ip)}:{String(c.Port_u32)}
                      {c.Hostname_str ? <span className="tsub">{String(c.Ip_ip)}</span> : null}
                    </td>
                    <td className="tmono">{timeAgo(c.ConnectedTime_dt as string)}</td>
                    <td className="tact">
                      <button
                        className="btn btn--sm btn--danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          setKilling(c);
                        }}
                      >
                        <IconClose size={13} /> 断开
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {open && <ConnectionSheet name={open} onClose={() => setOpen(null)} />}
      {killing && (
        <ConfirmSheet
          title="断开该连接？"
          verb="断开"
          body={
            <>
              来自 <span className="mono">{String(killing.Ip_ip)}</span> 的{" "}
              <span className="mono">{String(killing.Name_str)}</span> 将被切断。切断管理连接可能使管理员登出 —
              也可能是你自己。
            </>
          }
          onClose={() => setKilling(null)}
          onConfirm={async () => {
            await api.disconnectConnection(String(killing.Name_str));
            await load();
          }}
        />
      )}
    </div>
  );
}

function ConnectionSheet({ name, onClose }: { name: string; onClose: () => void }) {
  const [detail, setDetail] = useState<Wire | null>(null);
  const [error, setError] = useState<string | null>(null);

  usePoll(
    async () => {
      try {
        setDetail(await api.connectionInfo(name));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    3600_000,
    [name],
  );

  return (
    <Sheet title="连接" subtitle={name} onClose={onClose}>
      {error && <div className="alert alert--err">{error}</div>}
      {!detail && !error && <LoadingBlock />}
      {detail && (
        <KV
          rows={[
            ["来源", `${detail.Hostname_str || detail.Ip_ip}:${detail.Port_u32}`],
            ["连接时间", formatDate(detail.ConnectedTime_dt as string)],
            ["客户端", `${detail.ClientStr_str ?? "—"} ${detail.ClientVer_u32 ?? ""}`],
            ["服务端", `${detail.ServerStr_str ?? "—"} ${detail.ServerVer_u32 ?? ""}`],
          ]}
        />
      )}
    </Sheet>
  );
}
