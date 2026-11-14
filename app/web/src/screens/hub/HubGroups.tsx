"use client";

import { useCallback, useState } from "react";
import { ConfirmSheet, Empty, ErrorAlert, Field, LoadingBlock, SectionTitle, usePoll } from "../../components/bits";
import { PolicyEditor, extractPolicy } from "../../components/PolicyEditor";
import { api, type Wire } from "../../lib/api";
import { useToast } from "../../lib/toast";
import { formatCount } from "../../lib/util";
import { IconPlus, IconUsers } from "../../ui/Icon";
import { Sheet } from "../../ui/Sheet";

/**
 * Groups: a name, and a policy its members inherit. Users point at groups
 * from their own page; here the group itself is managed.
 */
export function HubGroups({ hub }: { hub: string }) {
  const [groups, setGroups] = useState<Wire[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api.groups(hub).catch(() => null);
    if (r) setGroups((r.GroupList as Wire[]) ?? []);
  }, [hub]);
  usePoll(load, "list", [hub]);

  return (
    <>
      <SectionTitle
        count={groups?.length}
        actions={
          <button className="btn btn--primary btn--sm" onClick={() => setCreating(true)}>
            <IconPlus size={14} /> 新建用户组
          </button>
        }
      >
        用户组
      </SectionTitle>

      {groups === null ? (
        <LoadingBlock label="正在加载用户组" />
      ) : groups.length === 0 ? (
        <Empty
          title="暂无用户组"
          action={
            <button className="btn btn--primary" onClick={() => setCreating(true)}>
              <IconPlus size={15} /> 创建用户组
            </button>
          }
        >
          一个用户组为多个用户承载同一份安全策略：带宽分级、整个团队的访问截止，
          一个开关代替五十个。
        </Empty>
      ) : (
        <div className="grid hubgrid">
          {groups.map((g) => (
            <button key={String(g.Name_str)} className="card hubtile" onClick={() => setEditing(String(g.Name_str))}>
              <div className="hubtile__head">
                <span className="hubtile__icon"><IconUsers size={17} /></span>
                <span className="hubtile__name truncate mono">{String(g.Name_str)}</span>
              </div>
              {g.Realname_utf ? <div className="micro truncate">{String(g.Realname_utf)}</div> : null}
              <div className="hubtile__stats">
                <span className="stat"><span className="stat__n">{formatCount(Number(g.NumUsers_u32))}</span><span className="micro">成员</span></span>
              </div>
            </button>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <GroupSheet
         
          hub={hub}
          name={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            void load();
          }}
          onDelete={(n) => {
            setEditing(null);
            setDeleting(n);
          }}
        />
      )}
      {deleting && (
        <ConfirmSheet
          title={`删除用户组 ${deleting}？`}
          verb="删除用户组"
          body={<>成员不会被删除；只是不再属于任何用户组。</>}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.deleteGroup(hub, deleting);
            void load();
          }}
        />
      )}
    </>
  );
}

function GroupSheet({ hub,
  name,
  onClose,
  onSaved,
  onDelete,
}: {
    hub: string;
  name: string | null;
  onClose: () => void;
  onSaved: () => void;
  onDelete: (name: string) => void;
}) {
  const editing = Boolean(name);
  const [groupName, setGroupName] = useState(name ?? "");
  const [realname, setRealname] = useState("");
  const [note, setNote] = useState("");
  const [policy, setPolicy] = useState<Wire>({ UsePolicy_bool: false });
  const [loaded, setLoaded] = useState(!editing);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { push } = useToast();

  usePoll(
    async () => {
      if (!editing || loaded) return;
      const g = await api.group(hub, name as string).catch(() => null);
      if (g) {
        setRealname(String(g.Realname_utf ?? ""));
        setNote(String(g.Note_utf ?? ""));
        setPolicy(extractPolicy(g));
        setLoaded(true);
      }
    },
    3600_000,
    [name],
  );

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const body: Wire = {
        Realname_utf: realname,
        Note_utf: note,
        ...policy,
      };
      if (editing) {
        await api.setGroup(hub, name as string, body);
      } else {
        body.Name_str = groupName.trim();
        await api.createGroup(hub, body);
      }
      push("ok", editing ? "用户组已保存。" : `用户组 ${groupName.trim()} 已创建。`);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={editing ? `用户组 ${name}` : "新建用户组"}
      subtitle={`虚拟 HUB ${hub}`}
      onClose={onClose}
      wide
      footer={
        <>
          {editing && (
            <button className="btn btn--danger" onClick={() => onDelete(name as string)} style={{ marginInlineEnd: "auto" }}>
              删除
            </button>
          )}
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn--primary" onClick={save} disabled={busy || (!editing && !groupName.trim()) || !loaded}>
            {busy && <span className="spin" />}
            {editing ? "保存" : "创建用户组"}
          </button>
        </>
      }
    >
      {error && <ErrorAlert>{error}</ErrorAlert>}
      {!loaded ? (
        <LoadingBlock />
      ) : (
        <div style={{ display: "grid", gap: "var(--s1)" }}>
          {!editing && (
            <Field label="用户组名称">
              <input className="input mono" value={groupName} onChange={(e) => setGroupName(e.target.value)}
                autoFocus autoCapitalize="none" spellCheck={false} />
            </Field>
          )}
          <div className="row2">
            <Field label="显示名称">
              <input className="input" value={realname} onChange={(e) => setRealname(e.target.value)} />
            </Field>
            <Field label="备注">
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          <PolicyEditor value={policy} onChange={setPolicy} subject="group" />
        </div>
      )}
    </Sheet>
  );
}
