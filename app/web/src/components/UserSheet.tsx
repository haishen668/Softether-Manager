"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type Quota, type Wire } from "../lib/api";
import { AUTH_TYPE_OPTIONS, isNever, userBytes } from "../lib/se";
import { useToast } from "../lib/toast";
import { fileToBase64 } from "../lib/util";
import { Sheet } from "../ui/Sheet";
import { ErrorAlert, Field } from "./bits";
import {
  EMPTY_DRAFT,
  UserQuotaBlock,
  draftAmount,
  draftOf,
  saveUserQuotaDraft,
  type QuotaDraft,
} from "./QuotaCard";

/**
 * Create a user, or edit one's identity: name, group, authentication, expiry,
 * and how much traffic it may move. The security policy is deliberately NOT
 * here -- it is a different decision with forty knobs, and it lives on the
 * user's own page.
 *
 * Editing merges into what the server already has (GetUser -> SetUser), so an
 * untouched field survives the round trip. The password is only ever sent
 * when a new one was typed.
 *
 * The traffic limit is a panel record rather than a SoftEther one, so it is a
 * second write after the user exists -- which is also why it cannot be part
 * of the same atomic save. The amount is validated *before* anything is sent,
 * so a typo cannot leave a user created with no limit; if the second write
 * fails anyway, the sheet stays open and says exactly what did land.
 *
 * Resetting the transfer rides the same write. SoftEther counts forever and
 * has no RPC to zero a counter, so the panel keeps its own zero and every
 * figure it shows subtracts it -- which is why this is a checkbox on the
 * profile rather than a button that fires out of an unsaved form.
 */
export function UserSheet({
  hub,
  hubChoices,
  onHubChange,
  existing,
  onClose,
  onSaved,
}: {
  hub: string;
  /** When creating from the all-users page: pick which hub the user lives in. */
  hubChoices?: string[];
  onHubChange?: (hub: string) => void;
  /** The GetUser payload when editing; absent when creating. */
  existing?: Wire;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const editing = Boolean(existing);
  const [name, setName] = useState(String(existing?.Name_str ?? ""));
  const [realname, setRealname] = useState(String(existing?.Realname_utf ?? ""));
  const [note, setNote] = useState(String(existing?.Note_utf ?? ""));
  const [group, setGroup] = useState(String(existing?.GroupName_str ?? ""));
  const [groups, setGroups] = useState<string[]>([]);
  const [authType, setAuthType] = useState<number>(Number(existing?.AuthType_u32 ?? 1));
  const [password, setPassword] = useState("");
  const [radiusUser, setRadiusUser] = useState(String(existing?.RadiusUsername_utf ?? ""));
  const [ntUser, setNtUser] = useState(String(existing?.NtUsername_utf ?? ""));
  const [commonName, setCommonName] = useState(String(existing?.CommonName_utf ?? ""));
  const [certBase64, setCertBase64] = useState("");
  const [expires, setExpires] = useState(() => {
    const raw = existing?.ExpireTime_dt as string | undefined;
    if (!raw || isNever(raw)) return "";
    const d = new Date(raw);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [quotaDraft, setQuotaDraft] = useState<QuotaDraft>(EMPTY_DRAFT);
  const [quotaTouched, setQuotaTouched] = useState(false);
  const { push } = useToast();

  useEffect(() => {
    void api
      .groups(hub)
      .then((r) => setGroups(((r.GroupList as Wire[]) ?? []).map((g) => String(g.Name_str))))
      .catch(() => {});
  }, [hub]);

  // The config's ceiling, if it has one. A 404 is the ordinary answer for
  // "no limit here" and leaves the block switched off.
  useEffect(() => {
    if (!editing) return;
    let stale = false;
    void api
      .userQuota(hub, String(existing?.Name_str))
      .then((q) => {
        if (stale) return;
        setQuota(q);
        // Only seed the form if it has not been touched: the read is fast, but
        // an operator who got there first must not have their edit overwritten.
        setQuotaDraft((current) => (quotaTouched ? current : draftOf(q)));
      })
      .catch((e) => {
        if (!stale && (!(e instanceof ApiError) || e.status !== 404)) {
          push("err", e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, hub, existing, push]);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const body: Wire = {};
      if (editing) {
        // Round-trip the server's own record so unsent fields are not wiped.
        for (const [k, v] of Object.entries(existing ?? {})) {
          if (k.startsWith("Recv.") || k.startsWith("Send.") || k === "Auth_Password_str") continue;
          body[k] = v;
        }
      }
      body.Realname_utf = realname;
      body.Note_utf = note;
      body.AuthType_u32 = authType;
      body.ExpireTime_dt = expires ? new Date(expires).toISOString() : "1970-01-01T00:00:00.000";
      if (editing) body.GroupName_str = group;
      if (authType === 1 && password) body.Auth_Password_str = password;
      if (authType === 2 && certBase64) body.UserX_bin = certBase64;
      if (authType === 3) body.CommonName_utf = commonName;
      if (authType === 4) body.RadiusUsername_utf = radiusUser;
      if (authType === 5) body.NtUsername_utf = ntUser;

      const userName = editing ? String(existing?.Name_str) : name.trim();
      // Validated before the first write, so a bad limit cannot leave a user
      // half-configured behind it.
      if (quotaDraft.on) draftAmount(quotaDraft);
      if (editing) {
        await api.setUser(hub, userName, body);
      } else {
        if (authType === 1 && !password) throw new Error("密码认证的用户必须设置密码。");
        body.Name_str = userName;
        await api.createUser(hub, body);
        // CreateUser cannot assign a group; a follow-up SetUser does.
        if (group) {
          const fresh = await api.user(hub, userName);
          const merged: Wire = {};
          for (const [k, v] of Object.entries(fresh)) {
            if (k.startsWith("Recv.") || k.startsWith("Send.") || k === "Auth_Password_str") continue;
            merged[k] = v;
          }
          merged.GroupName_str = group;
          await api.setUser(hub, userName, merged);
        }
      }
      try {
        await saveUserQuotaDraft(hub, userName, quotaDraft, Boolean(quota));
      } catch (e) {
        setError(
          `${editing ? "资料已保存" : `用户 ${userName} 已创建`}，但其流量限额未能保存：` +
            `${e instanceof Error ? e.message : String(e)}`,
        );
        return;
      }
      push("ok", editing ? "用户已更新。" : `用户 ${userName} 已创建。`);
      onSaved(userName);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={editing ? `编辑 ${existing?.Name_str}` : "新建用户"}
      subtitle={`虚拟 HUB ${hub}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button
            className="btn btn--primary"
            onClick={save}
            disabled={busy || (!editing && !name.trim())}
          >
            {busy && <span className="spin" />}
            {editing ? "保存" : "新建用户"}
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gap: "var(--s1)" }}>
        {error && <ErrorAlert>{error}</ErrorAlert>}
        {!editing && hubChoices && hubChoices.length > 1 && onHubChange && (
          <Field label="虚拟 HUB" hint="该用户所属的虚拟 HUB。">
            <select className="select" value={hub} onChange={(e) => onHubChange(e.target.value)}>
              {hubChoices.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </Field>
        )}
        {!editing && (
          <Field label="用户名" hint="客户端登录时使用的名称。字母、数字和 - _ . 是安全字符。">
            <input className="input mono" value={name} onChange={(e) => setName(e.target.value)}
              autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </Field>
        )}
        <div className="row2">
          <Field label="全名">
            <input className="input" value={realname} onChange={(e) => setRealname(e.target.value)} />
          </Field>
          <Field label="用户组" hint="组成员继承该组的安全策略。">
            <select className="select" value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">— 无 —</option>
              {groups.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="备注">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        <Field label="认证方式">
          <select className="select" value={authType} onChange={(e) => setAuthType(Number(e.target.value))}>
            {AUTH_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <div className="hint">{AUTH_TYPE_OPTIONS.find((o) => o.value === authType)?.hint}</div>
        </Field>

        {authType === 1 && (
          <Field label={editing ? "新密码（留空保持不变）" : "密码"}>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </Field>
        )}
        {authType === 2 && (
          <Field label={editing && existing?.UserX_bin ? "替换证书（可选）" : "用户证书"} hint="X.509 格式，DER 或 PEM 编码。">
            <input
              className="input"
              type="file"
              accept=".cer,.crt,.pem,.der"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setCertBase64(await fileToBase64(f));
              }}
            />
          </Field>
        )}
        {authType === 3 && (
          <Field label="限制证书 CN" hint="可选：只接受携带该 CN 的证书。留空则接受任何受信签发的证书。">
            <input className="input mono" value={commonName} onChange={(e) => setCommonName(e.target.value)} spellCheck={false} />
          </Field>
        )}
        {authType === 4 && (
          <Field label="RADIUS 用户名" hint="留空则使用 VPN 用户名。">
            <input className="input mono" value={radiusUser} onChange={(e) => setRadiusUser(e.target.value)} spellCheck={false} autoCapitalize="none" />
          </Field>
        )}
        {authType === 5 && (
          <Field label="NT 域用户名" hint="留空则使用 VPN 用户名。">
            <input className="input mono" value={ntUser} onChange={(e) => setNtUser(e.target.value)} spellCheck={false} autoCapitalize="none" />
          </Field>
        )}

        <Field label="过期时间" hint="过期后该用户将无法连接。留空表示永不过期。">
          <input className="input mono" type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>

        <UserQuotaBlock
          quota={quota}
          draft={quotaDraft}
          raw={existing ? userBytes(existing) : undefined}
          onChange={(next) => {
            setQuotaDraft(next);
            setQuotaTouched(true);
          }}
        />
      </div>
    </Sheet>
  );
}
