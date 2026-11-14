"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Empty,
  LoadingBlock,
  PageHead,
  SearchBox,
  SortTh,
  sortRows,
  usePoll,
  useSort,
} from "../components/bits";
import {
  QuotaCell,
  meteredBytes,
  netBytes,
  quotaKey,
  quotaSortValue,
  useQuotaIndex,
} from "../components/QuotaCard";
import { UserSheet } from "../components/UserSheet";
import { VpnFileSheet } from "../components/VpnFileSheet";
import { api, type Wire } from "../lib/api";
import { navigate, seg } from "../lib/router";
import { AUTH_TYPES, isNever, userBytes, userSortValue } from "../lib/se";
import { formatBytes, formatCount, formatDate, timeAgo } from "../lib/util";
import { IconChevron, IconDownload, IconPlus } from "../ui/Icon";
import { UserStatePill } from "./hub/HubUsers";

/**
 * Every user on the server, across all Virtual Hubs -- the one table an
 * operator scans when the question is "who exists here", not "what is in
 * this hub". Rows link into the user's own page; creating asks which hub
 * the user should live in.
 */
export function AllUsers() {
  const [data, setData] = useState<{ hubs: string[]; users: Wire[]; errors: { hub: string; error: string }[] } | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [createHub, setCreateHub] = useState("");
  const [vpnFor, setVpnFor] = useState<{ hub: string; name: string } | null>(null);
  const quotas = useQuotaIndex([]);
  const { sort, toggle } = useSort();
  const quotaOf = (u: Wire) =>
    quotas.get(quotaKey("user", String(u.HubName_str), String(u.Name_str)));
  // Transfer is the lifetime counter less whatever a reset put behind us, so
  // the column and the meter next to it are the same number.
  const movedBy = (u: Wire) => netBytes(userBytes(u), quotaOf(u));

  const load = useCallback(async () => {
    setData(await api.allUsers().catch(() => null));
  }, []);
  usePoll(load, "list", []);

  const filtered = useMemo(() => {
    if (!data) return null;
    const q = query.trim().toLowerCase();
    const matched = !q
      ? data.users
      : data.users.filter((u) =>
          [u.Name_str, u.Realname_utf, u.GroupName_str, u.Note_utf, u.HubName_str]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
        );
    // Sorting is applied after the poll refreshes the list, so a chosen order
    // survives every refresh rather than snapping back to the server's.
    return sortRows(matched, sort, (u, key) => {
      if (key === "quota") return quotaSortValue(quotaOf(u), movedBy(u));
      // Transfer sorts by what the panel shows, which a reset changes.
      if (key === "transfer") {
        const moved = movedBy(u);
        return moved.send + moved.recv;
      }
      return userSortValue(u, key);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, query, sort, quotas]);

  const open = (u: Wire) => navigate(`/hub/${seg(String(u.HubName_str))}/user/${seg(String(u.Name_str))}`);

  return (
    <div className="page">
      <PageHead
        title="用户"
        sub={data ? `${data.hubs.length} 个虚拟 HUB 共 ${data.users.length} 个用户` : "本服务器上的全部用户。"}
        actions={
          <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap" }}>
            <SearchBox value={query} onChange={setQuery} placeholder="名称、HUB、用户组、备注…" />
            <button
              className="btn btn--primary"
              onClick={() => {
                setCreateHub(data?.hubs[0] ?? "");
                setCreating(true);
              }}
              disabled={!data || data.hubs.length === 0}
            >
              <IconPlus size={15} /> 新建用户
            </button>
          </div>
        }
      />

      {data?.errors.map((e) => (
        <div key={e.hub} className="alert alert--warn">
          虚拟 HUB <b>{e.hub}</b> 无法列出：{e.error}
        </div>
      ))}

      {filtered === null ? (
        <LoadingBlock label="正在加载用户" />
      ) : filtered.length === 0 ? (
        <Empty title={query ? "无匹配结果" : "还没有用户"}>
          {query
            ? "没有匹配该搜索的用户、HUB、用户组或备注。"
            : "一个用户就是一个 VPN 身份，隶属于一个虚拟 HUB。"}
        </Empty>
      ) : (
        <>
          {/* desktop table */}
          <div className="only-desktop-b">
            <div className="card tcard">
              <div className="tscroll">
                <table className="dtable">
                  <thead>
                    <tr>
                      <SortTh sortKey="user" sort={sort} onSort={toggle}>用户</SortTh>
                      <SortTh sortKey="hub" sort={sort} onSort={toggle}>虚拟 HUB</SortTh>
                      <SortTh sortKey="status" sort={sort} onSort={toggle} style={{ width: 110 }}>状态</SortTh>
                      <SortTh sortKey="group" sort={sort} onSort={toggle}>用户组</SortTh>
                      <SortTh sortKey="auth" sort={sort} onSort={toggle}>认证</SortTh>
                      <SortTh sortKey="login" sort={sort} onSort={toggle}>最近登录</SortTh>
                      <SortTh sortKey="logins" sort={sort} onSort={toggle} style={{ width: 90 }}>登录次数</SortTh>
                      <SortTh sortKey="transfer" sort={sort} onSort={toggle}>流量</SortTh>
                      <SortTh sortKey="quota" sort={sort} onSort={toggle}>限额</SortTh>
                      <SortTh sortKey="expires" sort={sort} onSort={toggle}>过期</SortTh>
                      <th className="tact" style={{ width: 96 }} aria-label="操作" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((u) => {
                      const bytes = movedBy(u);
                      const expires = u.Expires_dt ?? u.ExpireTime_dt;
                      return (
                        <tr key={`${u.HubName_str}/${u.Name_str}`} className="clickable" onClick={() => open(u)}>
                          <td>
                            <span className="tname mono">{String(u.Name_str)}</span>
                            {u.Realname_utf ? <span className="tsub">{String(u.Realname_utf)}</span> : null}
                          </td>
                          <td><span className="chip chip--brand">{String(u.HubName_str)}</span></td>
                          <td><UserStatePill user={u} /></td>
                          <td className="tmono">{String(u.GroupName_str || "—")}</td>
                          <td>{AUTH_TYPES[Number(u.AuthType_u32)] ?? "?"}</td>
                          <td className="tmono">{timeAgo(u.LastLoginTime_dt as string)}</td>
                          <td className="tmono">{formatCount(Number(u.NumLogin_u32))}</td>
                          <td className="tmono">{formatBytes(bytes.send + bytes.recv)}</td>
                          <td><QuotaCell quota={quotaOf(u)} net={bytes} /></td>
                          <td className="tmono">{isNever(expires as string) ? "永不" : formatDate(expires as string)}</td>
                          <td className="tact">
                            <button
                              className="btn btn--sm btn--ghost"
                              title="下载 .vpn 连接文件"
                              aria-label="下载 .vpn 连接文件"
                              onClick={(e) => {
                                e.stopPropagation();
                                setVpnFor({ hub: String(u.HubName_str), name: String(u.Name_str) });
                              }}
                            >
                              <IconDownload size={14} />
                            </button>
                            <span className="pcard__go"><IconChevron size={15} /></span>
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
            {filtered.map((u) => {
              const bytes = movedBy(u);
              const quota = quotaOf(u);
              return (
                <button key={`${u.HubName_str}/${u.Name_str}`} className="row" onClick={() => open(u)}>
                  <div className="row__main">
                    <div className="row__name">
                      <span className="mono">{String(u.Name_str)}</span>
                      <UserStatePill user={u} />
                    </div>
                    <div className="spec">
                      <span className="chip chip--brand">{String(u.HubName_str)}</span>
                      <span className="chip"><i>组</i>{String(u.GroupName_str || "—")}</span>
                      <span className="chip"><i>流量</i>{formatBytes(bytes.send + bytes.recv)}</span>
                      <span className="chip"><i>活跃</i>{timeAgo(u.LastLoginTime_dt as string)}</span>
                      {quota?.has_limit && (
                        <span className={`chip${quota.blocked ? "" : " chip--brand"}`}>
                          <i>限额</i>
                          {formatBytes(meteredBytes(bytes, quota.metric))} /{" "}
                          {formatBytes(quota.limit_bytes)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="row__side">
                    <IconChevron size={15} />
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {vpnFor && <VpnFileSheet hub={vpnFor.hub} name={vpnFor.name} onClose={() => setVpnFor(null)} />}
      {creating && createHub && (
        <UserSheet
          hub={createHub}
          hubChoices={data?.hubs}
          onHubChange={setCreateHub}
          onClose={() => setCreating(false)}
          onSaved={(name) => {
            setCreating(false);
            void load();
            navigate(`/hub/${seg(createHub)}/user/${seg(name)}`);
          }}
        />
      )}
    </div>
  );
}
