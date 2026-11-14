"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Empty,
  LoadingBlock,
  SearchBox,
  SectionTitle,
  SortTh,
  sortRows,
  usePoll,
  useSort,
} from "../../components/bits";
import {
  QuotaCell,
  meteredBytes,
  netBytes,
  quotaKey,
  quotaSortValue,
  useQuotaIndex,
} from "../../components/QuotaCard";
import { UserSheet } from "../../components/UserSheet";
import { VpnFileSheet } from "../../components/VpnFileSheet";
import { api, type Quota, type Wire } from "../../lib/api";
import { navigate, seg } from "../../lib/router";
import { AUTH_TYPES, isNever, userBytes, userSortValue } from "../../lib/se";
import { formatBytes, formatCount, formatDate, timeAgo } from "../../lib/util";
import { IconChevron, IconDownload, IconPlus, IconUsers } from "../../ui/Icon";
import { Pill } from "../../ui/Status";

/**
 * The hub's users: the screen this panel exists for.
 *
 * The table answers the operator's questions in column order -- who is this,
 * can they connect, how do they authenticate, when were they last here, how
 * much have they moved. Everything about ONE user (policy, usage chart, live
 * sessions) is the user page, one tap deeper.
 */
export function HubUsers({ hub }: { hub: string }) {
  const [users, setUsers] = useState<Wire[] | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [vpnFor, setVpnFor] = useState<string | null>(null);
  // Case-folded, because SoftEther matches usernames without case.
  const [online, setOnline] = useState<Set<string>>(new Set());
  const quotas = useQuotaIndex([hub]);
  const { sort, toggle } = useSort();
  const quotaOf = (u: Wire) => quotas.get(quotaKey("user", hub, String(u.Name_str)));
  // Transfer is the lifetime counter less whatever a reset put behind us, so
  // the column and the meter next to it are the same number.
  const movedBy = (u: Wire) => netBytes(userBytes(u), quotaOf(u));

  const load = useCallback(async () => {
    const result = await api.users(hub).catch(() => null);
    if (result) setUsers((result.UserList as Wire[]) ?? []);
    const live = await api.hubUsersOnline(hub).catch(() => null);
    if (live) setOnline(new Set(live.usernames ?? []));
  }, [hub]);
  usePoll(load, "list", [hub]);

  const filtered = useMemo(() => {
    if (!users) return null;
    const q = query.trim().toLowerCase();
    const matched = !q
      ? users
      : users.filter((u) =>
          [u.Name_str, u.Realname_utf, u.GroupName_str, u.Note_utf]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
        );
    // Liveness comes from a separate call, so the status column sorts by the
    // same set the pill renders from rather than the stale Online_bool.
    return sortRows(matched, sort, (u, key) => {
      if (key === "quota") return quotaSortValue(quotaOf(u), movedBy(u));
      // Transfer sorts by what the panel shows, which a reset changes.
      if (key === "transfer") {
        const moved = movedBy(u);
        return moved.send + moved.recv;
      }
      return userSortValue(u, key, online.has(String(u.Name_str).toLowerCase()));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, query, sort, online, quotas, hub]);

  const open = (name: string) => navigate(`/hub/${seg(hub)}/user/${seg(name)}`);

  return (
    <>
      <SectionTitle
        count={users?.length}
        actions={
          <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap" }}>
            <SearchBox value={query} onChange={setQuery} placeholder="名称、用户组、备注…" />
            <button className="btn btn--primary btn--sm" onClick={() => setCreating(true)}>
              <IconPlus size={14} /> 新建用户
            </button>
          </div>
        }
      >
        用户
      </SectionTitle>

      {filtered === null ? (
        <LoadingBlock label="正在加载用户" />
      ) : filtered.length === 0 ? (
        <Empty
          title={query ? "无匹配结果" : "还没有用户"}
          action={
            !query && (
              <button className="btn btn--primary" onClick={() => setCreating(true)}>
                <IconPlus size={15} /> 创建第一个用户
              </button>
            )
          }
        >
          {query
            ? "没有匹配该搜索的用户、用户组或备注。"
            : "一个用户就是一个 VPN 身份：一个名字、一种认证方式，以及约束它的安全策略。"}
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
                    {filtered.map((u) => (
                      <UserRow
                        key={String(u.Name_str)}
                        user={u}
                        quota={quotaOf(u)}
                        moved={movedBy(u)}
                        online={online.has(String(u.Name_str).toLowerCase())}
                        onOpen={() => open(String(u.Name_str))}
                        onVpnFile={() => setVpnFor(String(u.Name_str))}
                      />
                    ))}
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
                <button key={String(u.Name_str)} className="row" onClick={() => open(String(u.Name_str))}>
                  <div className="row__main">
                    <div className="row__name">
                      <span className="mono">{String(u.Name_str)}</span>
                      <UserStatePill user={u} online={online.has(String(u.Name_str).toLowerCase())} />
                    </div>
                    <div className="spec">
                      <span className="chip"><i>组</i>{String(u.GroupName_str || "—")}</span>
                      <span className="chip"><i>认证</i>{AUTH_TYPES[Number(u.AuthType_u32)] ?? "?"}</span>
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
                    {u.Note_utf ? <div className="row__note truncate">{String(u.Note_utf)}</div> : null}
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

      {vpnFor && <VpnFileSheet hub={hub} name={vpnFor} onClose={() => setVpnFor(null)} />}
      {creating && (
        <UserSheet
         
          hub={hub}
          onClose={() => setCreating(false)}
          onSaved={(name) => {
            setCreating(false);
            void load();
            open(name);
          }}
        />
      )}
    </>
  );
}

export function UserStatePill({ user, online }: { user: Wire; online?: boolean }) {
  // Denied and expired win: they are why the account cannot be used, which
  // matters more than whether a session is still up at this instant.
  if (user.DenyAccess_bool) return <Pill kind="err" label="已拒绝" />;
  const expires = user.Expires_dt ?? user.ExpireTime_dt;
  if (!isNever(expires as string) && new Date(expires as string).getTime() < Date.now())
    return <Pill kind="warn" label="已过期" />;
  const connected = online ?? Boolean(user.Online_bool);
  if (connected) return <Pill kind="ok" label="在线" />;
  return <Pill kind="idle" label="离线" />;
}

function UserRow({ user: u, quota, moved, online, onOpen, onVpnFile }: { user: Wire; quota?: Quota; moved: { send: number; recv: number }; online: boolean; onOpen: () => void; onVpnFile: () => void }) {
  const bytes = moved;
  const expires = u.Expires_dt ?? u.ExpireTime_dt;
  return (
    <tr className="clickable" onClick={onOpen}>
      <td>
        <span className="tname mono">{String(u.Name_str)}</span>
        {u.Realname_utf ? <span className="tsub">{String(u.Realname_utf)}</span> : null}
      </td>
      <td>
        <UserStatePill user={u} online={online} />
      </td>
      <td className="tmono">{String(u.GroupName_str || "—")}</td>
      <td>{AUTH_TYPES[Number(u.AuthType_u32)] ?? "?"}</td>
      <td className="tmono">{timeAgo(u.LastLoginTime_dt as string)}</td>
      <td className="tmono">{formatCount(Number(u.NumLogin_u32))}</td>
      <td className="tmono" title={`↑ ${formatBytes(bytes.send)} · ↓ ${formatBytes(bytes.recv)}`}>
        {formatBytes(bytes.send + bytes.recv)}
      </td>
      <td><QuotaCell quota={quota} net={moved} /></td>
      <td className="tmono">{isNever(expires as string) ? "永不" : formatDate(expires as string)}</td>
      <td className="tact">
        <button
          className="btn btn--sm btn--ghost"
          title="下载 .vpn 连接文件"
          aria-label="下载 .vpn 连接文件"
          onClick={(e) => {
            e.stopPropagation();
            onVpnFile();
          }}
        >
          <IconDownload size={14} />
        </button>
        <span className="pcard__go">
          <IconChevron size={15} />
        </span>
      </td>
    </tr>
  );
}
