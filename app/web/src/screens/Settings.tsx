"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  CheckRow,
  ConfirmSheet,
  ErrorAlert,
  Field,
  KV,
  LoadingBlock,
  MoreRows,
  PageHead,
  SectionTitle,
  usePoll,
  useReveal,
} from "../components/bits";
import { api, type DomainStatus, type Wire } from "../lib/api";
import { Link } from "../lib/router";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { useUpdate } from "../lib/update";
import { formatDate, timeAgo } from "../lib/util";
import { IconRefresh } from "../ui/Icon";
import { Pill } from "../ui/Status";
import { SwitchRow, useToggle } from "../ui/Switch";

/**
 * The panel about itself: the account, where it serves, its sampler, its
 * updates, and the audit trail of what every administrator did.
 */
export function Settings({ section }: { section?: string }) {
  useEffect(() => {
    if (section) {
      requestAnimationFrame(() =>
        document.getElementById(`s-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
  }, [section]);

  return (
    <div className="page">
      <PageHead title="设置" sub="面板本身 — 账号、地址、域名、采样、更新。" />
      <div className="setdoc">
        <AccountCard />
        <ConnectionCard />
        <PanelCard />
        <DomainCard />
        <MonitoringCard />
        <VpnFileTemplateCard />
        <UpdatesCard />
        <AuditCard />
        <AboutCard />
      </div>
    </div>
  );
}

function AccountCard() {
  const { user, logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { push } = useToast();

  const change = async () => {
    setError(null);
    if (next !== confirm) {
      setError("两次输入的密码不一致。");
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      push("ok", "密码已修改。");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="s-account">
      <SectionTitle>账号</SectionTitle>
      <div className="card" style={{ padding: "var(--s4)", maxWidth: 560 }}>
        <KV rows={[["当前登录", user ?? "—"]]} />
        <div className="section__t" style={{ margin: "var(--s4) 0 var(--s3)" }}>修改密码</div>
        {error && <ErrorAlert>{error}</ErrorAlert>}
        <Field label="当前密码">
          <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </Field>
        <div className="row2">
          <Field label="新密码">
            <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={1} />
          </Field>
          <Field label="确认">
            <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </Field>
        </div>
        <div style={{ display: "flex", gap: "var(--s2)" }}>
          <button className="btn btn--primary" onClick={change} disabled={busy || !current || !next}>
            {busy && <span className="spin" />} 修改密码
          </button>
          <button className="btn" onClick={logout}>退出登录</button>
        </div>
      </div>
    </section>
  );
}

function ConnectionCard() {
  const [info, setInfo] = useState<Wire | null>(null);
  useEffect(() => {
    void api.connection().then(setInfo).catch(() => {});
  }, []);
  return (
    <section id="s-connection">
      <SectionTitle>VPN 服务器</SectionTitle>
      <div className="card" style={{ padding: "var(--s4)", maxWidth: 560 }}>
        {!info ? (
          <LoadingBlock />
        ) : (
          <KV
            rows={[
              ["管理地址", `${info.host}:${info.port}`],
              ["状态", info.configured ? "已连接" : "未连接"],
            ]}
          />
        )}
        <div style={{ marginTop: "var(--s3)" }}>
          <Link to="/connect" className="btn">
            编辑连接
          </Link>
        </div>
        <p className="hint" style={{ marginTop: "var(--s2)" }}>
          SoftEther 管理员密码本身在 服务器设置 → 加密 中修改；在那里改密码会自动同步到本连接。
        </p>
      </div>
    </section>
  );
}

function PanelCard() {
  const [settings, setSettings] = useState<Wire | null>(null);
  const [dirty, setDirty] = useState(false);
  const [restartNeeded, setRestartNeeded] = useState(false);
  const { guard, push } = useToast();

  useEffect(() => {
    void api.settings().then(setSettings).catch(() => {});
  }, []);

  if (!settings) return null;
  const set = (k: string, v: unknown) => {
    setSettings((s) => ({ ...(s ?? {}), [k]: v }));
    setDirty(true);
  };

  const save = () =>
    guard(async () => {
      const out = await api.saveSettings({ web_path: String(settings.web_path ?? "") });
      setDirty(false);
      if ((out as Wire).restart_required) setRestartNeeded(true);
    }, "设置已保存。");

  return (
    <section id="s-panel">
      <SectionTitle>面板</SectionTitle>
      <div className="card" style={{ padding: "var(--s4)", maxWidth: 560 }}>
        <Field
          label="Web 路径"
          hint="面板对外服务的秘密前缀；留空则在根路径服务。重启后生效。"
        >
          <input className="input mono" value={String(settings.web_path ?? "")} onChange={(e) => set("web_path", e.target.value)} autoCapitalize="none" spellCheck={false} placeholder="（根路径）" />
        </Field>
        <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap" }}>
          {dirty && (
            <button className="btn btn--primary" onClick={() => void save()}>保存</button>
          )}
          {restartNeeded && (
            <button className="btn" onClick={() => void guard(() => api.restartPanel(), "正在重启 — 面板几秒后将在新路径上恢复。")}>
              <IconRefresh size={14} /> 立即重启面板
            </button>
          )}
        </div>
      </div>
    </section>
  );
}


/* ── the panel's own domain and certificate ─────────────────────────────── */

const domainForm = (s: DomainStatus | null) => ({
  domain: s?.domain ?? "",
  https_port: String(s?.https_port ?? 443),
  acme_email: s?.acme_email ?? "",
  acme_staging: Boolean(s?.acme_staging),
});

/** Label, verdict, explanation: one line per thing that can be wrong. */
function StatRow({ label, pill, children, error }: { label: string; pill: ReactNode; children?: ReactNode; error?: boolean }) {
  return (
    <div className="statrow">
      <span className="statrow__k">{label}</span>
      <span>{pill}</span>
      <span className={`statrow__v${error ? " statrow__v--err" : ""}`}>{children}</span>
    </div>
  );
}

/**
 * The panel's own name. Give it one and it obtains a certificate for it,
 * serves HTTPS, keeps port 80 for the validation and a redirect, and renews
 * the certificate a month before it expires. Every stage reports for itself
 * below, in words, so the operator can tell a DNS record that points
 * elsewhere from a firewall that blocks port 80 from a port SoftEther is
 * already sitting on.
 */
function DomainCard() {
  const [state, setState] = useState<DomainStatus | null>(null);
  const [form, setForm] = useState(domainForm(null));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [acting, setActing] = useState<"" | "issue" | "check">("");
  const [showEvents, setShowEvents] = useState(false);
  const { guard, push } = useToast();

  const absorb = useCallback(
    (s: DomainStatus) => {
      setState(s);
      if (!dirty) setForm(domainForm(s));
    },
    [dirty],
  );
  const load = useCallback(async () => {
    const s = await api.domain().catch(() => null);
    if (s) absorb(s);
    return s ? s.domain_only : null;
  }, [absorb]);
  // While a certificate is being obtained the page follows along closely;
  // otherwise it re-reads at the detail tier like everything else.
  usePoll(load, state?.busy ? 2500 : "detail", [state?.busy]);

  const onlyToggle = useToggle({
    value: state ? state.domain_only : null,
    apply: async (next) => {
      const s = await api.saveDomain({ domain_only: next });
      absorb(s);
      return s.domain_only;
    },
    reload: load,
    noun: "仅域名访问",
    onWord: "开",
    offWord: "关",
  });

  const set = (patch: Partial<ReturnType<typeof domainForm>>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };

  const save = async () => {
    const port = Number(form.https_port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      push("err", "HTTPS 端口必须是 1 到 65535 之间的数字。");
      return;
    }
    setSaving(true);
    await guard(async () => {
      const s = await api.saveDomain({
        domain: form.domain.trim(),
        https_port: port,
        acme_email: form.acme_email.trim(),
        acme_staging: form.acme_staging,
      });
      setDirty(false);
      setState(s);
      setForm(domainForm(s));
    }, form.domain.trim() ? "域名已保存 — 面板正在为其获取证书。" : "域名已移除。");
    setSaving(false);
  };

  const issue = async () => {
    setActing("issue");
    await guard(async () => {
      const s = await api.issueCertificate();
      absorb(s);
    }, "证书请求已开始。");
    setActing("");
  };

  const check = async () => {
    setActing("check");
    await guard(async () => {
      const s = await api.checkDomain();
      absorb(s);
    });
    setActing("");
  };

  const remove = async () => {
    await guard(async () => {
      const s = await api.removeDomain();
      setRemoving(false);
      setDirty(false);
      setState(s);
      setForm(domainForm(s));
    }, "域名已移除 — 面板重新应答所有名称。");
  };

  const s = state;
  const configured = Boolean(s?.configured);
  const busy = Boolean(s?.busy);
  const cert = s?.certificate;
  const certOk = Boolean(cert?.present && !cert?.stale);
  const daysLeft = cert?.days_left ?? null;
  // One line per problem. The last issuance error usually *is* the DNS or
  // port-80 problem already listed, so it is added only when it says
  // something the stage rows do not.
  const attention: string[] = [];
  if (s && configured && !busy) {
    if (s.config_error) attention.push(s.config_error);
    if (s.dns?.error) attention.push(s.dns.error);
    if (s.http.error) attention.push(`Port 80: ${s.http.error}`);
    if (s.https.error) attention.push(`HTTPS on port ${s.https.port}: ${s.https.error}`);
    const stageError = s.renewal.last_error_type === "dns" || s.renewal.last_error_type === "port80";
    if (s.renewal.last_error && (!certOk || s.renewal.due) && !stageError) attention.push(s.renewal.last_error);
  }
  const blockedBy =
    s?.renewal.last_error_type === "dns"
      ? "正在等待上方提到的 DNS 记录。"
      : s?.renewal.last_error_type === "port80"
        ? "正在等待上方提到的端口 80。"
        : "";

  return (
    <section id="s-domain">
      <SectionTitle
        actions={
          dirty ? (
            <button className="btn btn--sm btn--primary" onClick={() => void save()} disabled={saving}>
              {saving && <span className="spin" />} Save
            </button>
          ) : undefined
        }
      >
        域名 &amp; HTTPS
      </SectionTitle>
      <div className="card" style={{ padding: "var(--s4)", maxWidth: 760 }}>
        <p className="lede" style={{ marginBottom: "var(--s3)" }}>
          把一条 DNS 记录指向本服务器 — 一条 <span className="mono">A</span> 记录，IPv6 再加{" "}
          <span className="mono">AAAA</span> — 在防火墙放行 80 端口和 HTTPS
          端口，然后填入名称。面板会向 Let&rsquo;s Encrypt 申请证书，在下方的端口上提供 HTTPS
          服务，保留 80 端口用于验证和跳转，并在证书到期前一个月自动续期。纯 HTTP 地址仍可继续使用。
        </p>

        <div className="row2">
          <Field label="域名" hint="一个解析到本服务器的公网主机名，例如 panel.example.com。留空表示不使用域名。">
            <input className="input mono" value={form.domain} onChange={(e) => set({ domain: e.target.value })} placeholder="panel.example.com" autoCapitalize="none" spellCheck={false} inputMode="url" />
          </Field>
          <Field label="HTTPS 端口" hint={`浏览器默认使用 443。SoftEther 在默认安装时自己监听 443 — 请在服务器设置中停用该监听端口，或在此另选端口。${s ? ` 纯 HTTP 面板仍使用 ${s.bind_port}。` : ""}`}>
            <input className="input mono" type="number" min={1} max={65535} value={form.https_port} onChange={(e) => set({ https_port: e.target.value })} inputMode="numeric" />
          </Field>
        </div>
        <Field label="联系邮箱（可选）" hint="若证书即将过期且未能续期，Let's Encrypt 会向此邮箱发信。不作其他用途。">
          <input className="input mono" value={form.acme_email} onChange={(e) => set({ acme_email: e.target.value })} placeholder="ops@example.com" autoCapitalize="none" spellCheck={false} inputMode="email" />
        </Field>
        <CheckRow
          checked={form.acme_staging}
          onChange={(v) => set({ acme_staging: v })}
          label="使用 Let's Encrypt 测试环境"
          hint="签发浏览器不信任的证书，且不占用正式环境的速率限制 — 用于在正式申请前验证 DNS 和防火墙。之后关掉它即可换领受信任的证书。"
        />
        <p className="hint" style={{ marginTop: 0 }}>
          设置域名即代表你接受{" "}
          <a className="linkish" href="https://letsencrypt.org/repository/" target="_blank" rel="noreferrer">Let&rsquo;s Encrypt 订阅协议</a>{" "}
          。仅使用 <span className="mono">http-01</span> 验证，因此该名称必须直接解析到本服务器：不支持通配符，也不支持 CDN 后的名称。
        </p>
        {dirty && (
          <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap" }}>
            <button className="btn btn--primary" onClick={() => void save()} disabled={saving}>
              {saving && <span className="spin" />} {form.domain.trim() ? "保存并获取证书" : "保存"}
            </button>
            <button className="btn" onClick={() => { setForm(domainForm(state)); setDirty(false); }}>放弃更改</button>
          </div>
        )}

        {s === null ? (
          <LoadingBlock />
        ) : configured ? (
          <>
            <div className="tpl__group">状态</div>
            {busy && (
              <div className="progressline" role="status">
                <span className="spin" /> {s.phase === "renewing" ? "正在续期证书" : "正在获取证书"}
                {s.step ? ` — ${s.step}` : "…"}
              </div>
            )}
            {attention.length > 0 && (
              <div className="alert alert--err" style={{ display: "block" }}>
                <div className="alert__t">需要处理</div>
                <ul style={{ margin: "4px 0 0", paddingInlineStart: "1.2em" }}>
                  {attention.map((line, i) => <li key={i}>{line}</li>)}
                </ul>
              </div>
            )}
            <div className="statrows">
              <StatRow label="域名" pill={<Pill kind="ok" label="已配置" />}>
                <span className="mono">{s.domain}</span> · HTTPS 端口 <span className="mono">{s.https_port}</span>
                {s.acme_staging ? " · 测试环境" : ""}
              </StatRow>

              <StatRow
                label="DNS"
                error={Boolean(s.dns?.error)}
                pill={
                  !s.dns?.checked_at ? (
                    <Pill kind="idle" label="尚未检查" />
                  ) : s.dns.error ? (
                    <Pill kind="err" label="无法解析" />
                  ) : s.dns.match ? (
                    <Pill kind="ok" label="指向本机" />
                  ) : (
                    <Pill kind="warn" label="指向他处" />
                  )
                }
              >
                {!s.dns?.checked_at
                  ? "在申请证书时或点击“重新检查”时检查。"
                  : s.dns.error
                    ? s.dns.error
                    : s.dns.match
                      ? <>解析到 <span className="mono">{(s.dns.addresses ?? []).join(", ")}</span> — 是本机地址之一。</>
                      : <>解析到 <span className="mono">{(s.dns.addresses ?? []).join(", ")}</span>，但本机地址为 <span className="mono">{(s.dns.local_addresses ?? []).join(", ") || "未知"}</span>。若在 NAT 或端口转发之后仍可完成验证；否则请修正记录。</>}
              </StatRow>

              <StatRow
                label="端口 80"
                error={Boolean(s.http.error)}
                pill={s.http.listening ? <Pill kind="ok" label="监听中" /> : <Pill kind="err" label="不可用" />}
              >
                {s.http.listening
                  ? s.http.redirecting
                    ? "应答 Let's Encrypt 的验证请求，其余请求全部跳转到 HTTPS。"
                    : "应答 Let's Encrypt 的验证请求；证书就位后将开始跳转到 HTTPS。"
                  : `${s.http.error || "监听器未运行。"} 验证只经端口 80 到达，在此之前无法签发任何证书。`}
              </StatRow>

              <StatRow
                label="证书"
                error={!busy && !certOk && Boolean(s.renewal.last_error)}
                pill={
                  busy ? (
                    <Pill kind="busy" label={s.phase === "renewing" ? "续期中…" : "签发中…"} />
                  ) : certOk ? (
                    <Pill kind={daysLeft !== null && daysLeft < s.renewal.renew_before_days ? "warn" : "ok"} label={daysLeft !== null && daysLeft < s.renewal.renew_before_days ? "待续期" : "有效"} />
                  ) : cert?.present ? (
                    <Pill kind="warn" label="需要更换" />
                  ) : s.renewal.last_error ? (
                    <Pill kind="err" label="失败" />
                  ) : (
                    <Pill kind="idle" label="尚无" />
                  )
                }
              >
                {busy ? (
                  s.step || "处理中…"
                ) : certOk ? (
                  <>
                    有效期至 <span className="mono">{formatDate(cert!.expires_at)}</span>
                    {daysLeft !== null ? `（${Math.max(0, Math.floor(daysLeft))} 天）` : ""} · 签发者 {cert!.issuer || "Let's Encrypt"}
                    {cert!.staging ? " — 测试证书，浏览器不会信任。" : "。"}
                  </>
                ) : cert?.present ? (
                  cert.expired
                    ? `磁盘上的证书已于 ${formatDate(cert.expires_at)} 过期；正在请求新证书。`
                    : cert.domain !== s.domain
                      ? `磁盘上的证书属于 ${cert.domain}；正在请求用于 ${s.domain} 的证书。`
                      : `磁盘上的证书来自${cert.staging ? "测试" : "正式"}环境；正在请求${s.acme_staging ? "测试" : "正式"}环境的证书。`
                ) : s.renewal.last_error ? (
                  <>
                    {blockedBy || s.renewal.last_error}
                    {s.renewal.next_attempt_at ? <> 下次自动尝试 {timeAgo(s.renewal.next_attempt_at) === "刚刚" ? "即将进行" : `于 ${formatDate(s.renewal.next_attempt_at)}`}；问题修复后也可使用“立即签发”。</> : null}
                  </>
                ) : (
                  "域名保存后不久即会申请。"
                )}
              </StatRow>

              <StatRow
                label="续期"
                error={certOk && s.renewal.due && Boolean(s.renewal.last_error)}
                pill={
                  !certOk ? (
                    <Pill kind="idle" label="—" />
                  ) : s.renewal.due && s.renewal.last_error ? (
                    <Pill kind="err" label="失败中" />
                  ) : s.renewal.due ? (
                    <Pill kind="busy" label="到期待办" />
                  ) : (
                    <Pill kind="ok" label="自动" />
                  )
                }
              >
                {!certOk ? (
                  "证书就位后开始：到期前一个月自动续期。"
                ) : (
                  <>
                    将于 <span className="mono">{formatDate(s.renewal.renew_at)}</span>（到期前 {s.renewal.renew_before_days} 天）续期，每小时检查一次。
                    {s.renewal.last_attempt_at ? (
                      <>
                        {" "}上次{s.renewal.last_attempt_kind || "尝试"}（{timeAgo(s.renewal.last_attempt_at)}）：{" "}
                        {s.renewal.last_success_at && s.renewal.last_success_at >= s.renewal.last_attempt_at ? "成功。" : s.renewal.last_error ? `失败 — ${s.renewal.last_error}` : "进行中。"}
                      </>
                    ) : null}
                  </>
                )}
              </StatRow>

              <StatRow
                label="HTTPS"
                error={Boolean(s.https.error)}
                pill={
                  s.https.listening ? (
                    <Pill kind="ok" label="服务中" />
                  ) : s.https.error ? (
                    <Pill kind="err" label="端口不可用" />
                  ) : (
                    <Pill kind="idle" label="等待中" />
                  )
                }
              >
                {s.https.listening ? (
                  <>
                    端口 <span className="mono">{s.https.port}</span>
                    {s.https.since ? `，自 ${timeAgo(s.https.since)} 起` : ""} · <a className="linkish" href={s.url} target="_blank" rel="noreferrer">{s.url}</a>
                  </>
                ) : s.https.error ? (
                  <>
                    {s.https.error}。
                    {s.https.port === 443 ? " 默认安装时 SoftEther 自身的监听器占用了 443：请在 服务器设置 → TCP 监听 中停用它，或在上方另选 HTTPS 端口。" : ""}
                  </>
                ) : (
                  "有效证书就位的那一刻即启动。"
                )}
              </StatRow>
            </div>

            <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap", marginTop: "var(--s3)" }}>
              <button className={`btn ${certOk ? "" : "btn--primary"}`} onClick={() => void issue()} disabled={busy || acting !== "" || dirty}>
                {acting === "issue" && <span className="spin" />} {certOk ? "立即续期" : "立即签发证书"}
              </button>
              <button className="btn" onClick={() => void check()} disabled={acting !== ""}>
                {acting === "check" ? <span className="spin" /> : <IconRefresh size={14} />} 重新检查
              </button>
              <button className="btn btn--ghost" onClick={() => setRemoving(true)} disabled={busy}>移除域名…</button>
            </div>
            {dirty && <p className="hint">请先保存上方更改，再为其申请证书。</p>}

            <div className="tpl__group">访问</div>
            <SwitchRow
              label="仅在此域名上提供面板"
              hint={
                s.domain_only ? (
                  <>
                    已开启。按 IP 地址或其他任何名称发来的请求都会得到一个纯粹的 404 — 所有端口皆然。来自本机自身的请求和证书验证路径始终放行，因此续期不受影响。
                    若 DNS 变更把你锁在外面，在服务器上执行 <span className="mono">sem domain only off</span> 即可重新关闭。
                  </>
                ) : s.via_domain ? (
                  <>你当前正通过 <span className="mono">{s.domain}</span> 使用面板，因此可以放心开启而不会把自己锁在外面。</>
                ) : (
                  <>
                    只有在你通过该域名使用面板时才可开启，因此绝不会把你锁在外面 — 当前标签页是以{" "}
                    <span className="mono">{s.request_host || "未命名主机"}</span> 进来的。{" "}
                    {s.https.listening ? <>请打开 <a className="linkish" href={s.url} target="_blank" rel="noreferrer">{s.url}</a> 并在那里开启。</> : "HTTPS 服务启动后，请在域名上打开面板并在那里开启。"}
                  </>
                )
              }
              status={<Pill kind={s.domain_only ? "ok" : "idle"} label={s.domain_only ? "已限制" : "开放"} />}
              toggle={onlyToggle}
              on={s.domain_only}
              disabled={!s.domain_only && !s.via_domain}
              onWord="开"
              offWord="关"
            />

            {s.events.length > 0 && (
              <>
                <button className="btn btn--sm btn--ghost" onClick={() => setShowEvents((v) => !v)} aria-expanded={showEvents} style={{ marginTop: "var(--s2)" }}>
                  {showEvents ? "隐藏历史" : `历史（${s.events.length}）`}
                </button>
                {showEvents && (
                  <div className="eventlist">
                    {s.events.map((e, i) => (
                      <div key={i} className={`eventlist__i${e.kind === "failed" ? " eventlist__i--failed" : ""}`}>
                        <span className="mono">{formatDate(e.at)}</span>
                        <span>{e.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <p className="hint" style={{ marginBottom: 0 }}>
            未设置域名：面板在端口 {s.bind_port} 上以纯 HTTP 应答任何能到达它的名称或地址。
          </p>
        )}
      </div>
      {removing && (
        <ConfirmSheet
          title="移除该域名？"
          verb="移除域名"
          body={
            <>
              HTTPS 监听器和端口 80 监听器将停止，仅域名限制将解除，面板重新以纯
              <span className="mono">http://…:{s?.bind_port}</span> 应答所有名称。证书文件仍保留在磁盘上，
              在其有效期内重新添加同名域名会直接复用。
            </>
          }
          onClose={() => setRemoving(false)}
          onConfirm={remove}
        />
      )}
    </section>
  );
}

/** The per-user placeholders the generated document carries. */
const VPN_PARAMS: [string, string][] = [
  ["{host}", "下载对话框中选择的服务器地址"],
  ["{port}", "对话框中选择的 SoftEther 端口"],
  ["{hub}", "该用户所属的虚拟 HUB"],
  ["{username}", "该文件登录所用的 VPN 用户"],
  ["{account_name}", "连接的显示名称，来自下方的命名模板"],
  ["{auth_type}", "由用户认证类型决定：0 匿名，1 密码（哈希），2 RADIUS/NT，3 证书"],
  ["{hashed_password}", "内嵌时：SoftEther 的存储形式 SHA-0(password + UPPERCASE(username))，base64 编码"],
  ["{plain_password}", "明文 — 仅限 RADIUS/NT 用户；否则为“$”"],
];

const PROXY_TYPES: [number, string][] = [
  [0, "直接连接（无代理）"],
  [1, "HTTP 代理"],
  [2, "SOCKS4 代理"],
  [3, "SOCKS5 代理"],
];

const RETRY_FOREVER = 4294967295;

/**
 * The .vpn editor: every option the SoftEther client reads from a
 * connection file, shaped once here and applied to every download. The
 * per-user values stay as {placeholders}, visible in the preview.
 */
function VpnFileTemplateCard() {
  const [state, setState] = useState<Wire | null>(null);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);
  const { guard } = useToast();

  useEffect(() => {
    void api.vpnTemplate().then(setState).catch(() => {});
  }, []);
  if (!state) return null;

  const opt = (state.options ?? {}) as Wire;
  const setTop = (k: string, v: unknown) => {
    setState((s) => ({ ...(s ?? {}), [k]: v }));
    setDirty(true);
  };
  const setOpt = (k: string, v: unknown) => {
    setState((s) => ({ ...(s ?? {}), options: { ...((s?.options as Wire) ?? {}), [k]: v } }));
    setDirty(true);
  };

  const save = () =>
    guard(async () => {
      const out = await api.saveVpnTemplate({
        options: state.options,
        account_name_template: String(state.account_name_template ?? ""),
        filename_template: String(state.filename_template ?? ""),
        embed_password_default: Boolean(state.embed_password_default),
      });
      setState(out);
      setDirty(false);
    }, "连接文件模板已保存。");

  const resetDefaults = () => {
    setState((s) => ({ ...(s ?? {}), options: { ...((s?.defaults as Wire) ?? {}) } }));
    setDirty(true);
  };

  const num = (k: string) => Number(opt[k]) || 0;
  const boolOpt = (k: string) => Boolean(opt[k]);
  const proxied = num("ProxyType") !== 0;
  const retryForever = num("NumRetry") >= RETRY_FOREVER;

  // Light up the {parameters} so they stand out from the fixed document.
  const highlighted = (text: string) =>
    text.split(/(\{[a-z_]+\})/g).map((part, i) =>
      part.startsWith("{") ? <span key={i} className="tpl__ph">{part}</span> : part,
    );

  const numberField = (label: string, key: string, hint?: string, min = 0, max = RETRY_FOREVER) => (
    <Field label={label} hint={hint}>
      <input
        className="input mono"
        type="number"
        min={min}
        max={max}
        value={num(key)}
        onChange={(e) => setOpt(key, Number(e.target.value))}
      />
    </Field>
  );

  return (
    <section id="s-vpnfile">
      <SectionTitle
        actions={
          <>
            {dirty && <button className="btn btn--sm btn--primary" onClick={() => void save()}>保存</button>}
            <button className="btn btn--sm" onClick={resetDefaults}>恢复默认</button>
          </>
        }
      >
        连接文件（.vpn）
      </SectionTitle>
      <div className="card" style={{ padding: "var(--s4)" }}>
        <p className="lede" style={{ marginBottom: "var(--s3)" }}>
          面板发出的每一个 <span className="mono">.vpn</span> 文件都由此模板生成。
          这里设置的选项对所有下载生效；每个用户的专属值在下载时填入。
        </p>

        <div className="tpl__group">命名</div>
        <div className="row2">
          <Field
            label="文件名"
            hint={<>可用变量：<span className="mono">{"{hub} {username} {host} {port}"}</span> — 自动追加“.vpn”。</>}
          >
            <input className="input mono" value={String(state.filename_template ?? "")} onChange={(e) => setTop("filename_template", e.target.value)} spellCheck={false} />
          </Field>
          <Field label="客户端中的连接名称" hint="用户在其 VPN Client 连接列表中看到的名称。">
            <input className="input mono" value={String(state.account_name_template ?? "")} onChange={(e) => setTop("account_name_template", e.target.value)} spellCheck={false} />
          </Field>
        </div>
        <CheckRow
          checked={Boolean(state.embed_password_default)}
          onChange={(v) => setTop("embed_password_default", v)}
          label="默认内嵌用户密码"
          hint="下载对话框默认开启内嵌。凭据以 SoftEther 自身的哈希形式写入 — 取自面板已保存的内容，或从服务器配置中恢复。"
        />

        <div className="tpl__group">隧道</div>
        <CheckRow checked={boolOpt("UseEncrypt")} onChange={(v) => setOpt("UseEncrypt", v)} label="使用 SSL 加密" hint="关闭后 VPN 流量明文传输 — 仅适用于已有其他保护的链路。" />
        <CheckRow checked={boolOpt("UseCompress")} onChange={(v) => setOpt("UseCompress", v)} label="压缩数据" />
        <CheckRow checked={boolOpt("NoUdpAcceleration")} onChange={(v) => setOpt("NoUdpAcceleration", v)} label="停用 UDP 加速" />
        <CheckRow checked={boolOpt("HalfConnection")} onChange={(v) => setOpt("HalfConnection", v)} label="半双工连接" hint="每条 TCP 连接只承载一个方向；至少需要两条连接。" />
        <div className="row2">
          {numberField("TCP 连接数", "MaxConnection", "1–32；链路丢包多时增大可能有帮助。", 1, 32)}
          {numberField("UDP 端口", "PortUDP", "0 表示由客户端自选。", 0, 65535)}
        </div>

        <div className="tpl__group">可靠性</div>
        <CheckRow checked={retryForever} onChange={(v) => setOpt("NumRetry", v ? RETRY_FOREVER : 10)} label="无限重试" hint="持续重拨直到连接成功。" />
        <div className="row2">
          {!retryForever && numberField("重试次数", "NumRetry", undefined, 0, 4096)}
          {numberField("重试间隔（秒）", "RetryInterval", undefined, 5, 3600)}
          {numberField("额外连接间隔（秒）", "AdditionalConnectionInterval", "额外 TCP 连接之间的延迟。", 1, 3600)}
          {numberField("重连生命周期（秒）", "ConnectionDisconnectSpan", "0 表示保持连接直到其自行断开。")}
        </div>

        <div className="tpl__group">安全</div>
        <CheckRow checked={boolOpt("CheckServerCert")} onChange={(v) => setOpt("CheckServerCert", v)} label="验证服务器证书" hint="开启后，客户端会拒绝证书不受信任的服务器。" />
        <CheckRow checked={boolOpt("NoTls1")} onChange={(v) => setOpt("NoTls1", v)} label="停用 TLS 1.0" />

        <div className="tpl__group">代理</div>
        <Field label="连接方式">
          <select className="select" value={num("ProxyType")} onChange={(e) => setOpt("ProxyType", Number(e.target.value))}>
            {PROXY_TYPES.map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        </Field>
        {proxied && (
          <>
            <div className="row2">
              <Field label="代理主机">
                <input className="input mono" value={String(opt.ProxyName ?? "")} onChange={(e) => setOpt("ProxyName", e.target.value)} spellCheck={false} />
              </Field>
              {numberField("代理端口", "ProxyPort", undefined, 0, 65535)}
            </div>
            <div className="row2">
              <Field label="代理用户名" hint="代理无需登录时留空。">
                <input className="input mono" value={String(opt.ProxyUsername ?? "")} onChange={(e) => setOpt("ProxyUsername", e.target.value)} spellCheck={false} />
              </Field>
              <Field label="代理密码" hint="在文件中以混淆形式保存，与客户端自身的保存方式一致。">
                <input className="input" type="password" value={String(opt.ProxyPassword ?? "")} onChange={(e) => setOpt("ProxyPassword", e.target.value)} autoComplete="off" />
              </Field>
            </div>
          </>
        )}

        <div className="tpl__group">客户端行为</div>
        <CheckRow checked={boolOpt("StartupAccount")} onChange={(v) => setOpt("StartupAccount", v)} label="客户端启动时连接" />
        <CheckRow checked={boolOpt("HideStatusWindow")} onChange={(v) => setOpt("HideStatusWindow", v)} label="连接时隐藏状态窗口" />
        <CheckRow checked={boolOpt("HideNicInfoWindow")} onChange={(v) => setOpt("HideNicInfoWindow", v)} label="隐藏网卡信息窗口" />
        <CheckRow checked={boolOpt("NoRoutingTracking")} onChange={(v) => setOpt("NoRoutingTracking", v)} label="停用路由跟踪" hint="连接期间客户端不再调整路由表。" />
        <CheckRow checked={boolOpt("DisableQoS")} onChange={(v) => setOpt("DisableQoS", v)} label="停用 VoIP/QoS 处理" />
        <CheckRow checked={boolOpt("RequireMonitorMode")} onChange={(v) => setOpt("RequireMonitorMode", v)} label="监控模式" hint="请求混杂会话；需要虚拟 HUB 授权。" />
        <CheckRow checked={boolOpt("RequireBridgeRoutingMode")} onChange={(v) => setOpt("RequireBridgeRoutingMode", v)} label="网桥 / 路由模式" hint="客户端一侧为其他机器做网桥或路由时需要。" />
        <div className="row2">
          <Field label="虚拟网卡名称" hint="连接绑定的客户端侧网卡。">
            <input className="input mono" value={String(opt.DeviceName ?? "")} onChange={(e) => setOpt("DeviceName", e.target.value)} spellCheck={false} />
          </Field>
          <Field label="自定义 HTTP 头" hint="在 HTTP 代理连接阶段发送；极少用到。">
            <input className="input mono" value={String(opt.CustomHttpHeader ?? "")} onChange={(e) => setOpt("CustomHttpHeader", e.target.value)} spellCheck={false} />
          </Field>
        </div>

        <div style={{ display: "flex", gap: "var(--s2)", marginTop: "var(--s2)", flexWrap: "wrap" }}>
          {dirty && (
            <button className="btn btn--primary" onClick={() => void save()}>保存模板</button>
          )}
          <button className="btn" onClick={() => setPreview((p) => !p)} aria-expanded={preview}>
            {preview ? "隐藏文档" : "预览文档"}
          </button>
        </div>
        {preview && (
          <div style={{ marginTop: "var(--s3)" }}>
            {dirty && <p className="hint">预览显示的是上次保存的模板 — 保存后可刷新。</p>}
            <pre className="tpl">{highlighted(String(state.template ?? ""))}</pre>
            <div className="tpl__params" style={{ marginTop: "var(--s3)", marginBottom: 0 }}>
              {VPN_PARAMS.map(([name, what]) => (
                <div key={name} className="tpl__param">
                  <span className="mono tpl__ph">{name}</span>
                  <span className="micro">{what}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Every monitor the panel runs: what it reads, how often, and whether it
 * reads at all. Each is a thread or a tick that costs something -- one RPC
 * per hub, one per live session -- so each is switchable on its own.
 */
function MonitoringCard() {
  const [settings, setSettings] = useState<Wire | null>(null);
  const [dirty, setDirty] = useState(false);
  const { guard } = useToast();

  useEffect(() => {
    void api.settings().then(setSettings).catch(() => {});
  }, []);
  if (!settings) return null;

  const set = (k: string, v: unknown) => {
    setSettings((s) => ({ ...(s ?? {}), [k]: v }));
    setDirty(true);
  };
  const num = (k: string, fallback: number) => Number(settings[k]) || fallback;
  const on = (k: string) => Boolean(settings[k]);

  const save = () =>
    guard(async () => {
      setSettings(
        await api.saveSettings({
          resource_monitor_enabled: on("resource_monitor_enabled"),
          resource_interval_seconds: num("resource_interval_seconds", 3),
          resource_history_points: num("resource_history_points", 100),
          traffic_monitor_enabled: on("traffic_monitor_enabled"),
          sample_interval_minutes: num("sample_interval_minutes", 5),
          sample_retention_days: num("sample_retention_days", 90),
          session_monitor_enabled: on("session_monitor_enabled"),
          session_interval_seconds: num("session_interval_seconds", 60),
          session_traffic_enabled: on("session_traffic_enabled"),
          session_history_retention_days: num("session_history_retention_days", 30),
          quota_enforcement_enabled: on("quota_enforcement_enabled"),
          quota_interval_seconds: num("quota_interval_seconds", 60),
          ui_live_seconds: num("ui_live_seconds", 5),
          ui_detail_seconds: num("ui_detail_seconds", 15),
          ui_list_seconds: num("ui_list_seconds", 30),
        }),
      );
      setDirty(false);
    }, "监控设置已保存。");

  const numberField = (
    label: string,
    key: string,
    fallback: number,
    min: number,
    max: number,
    hint?: string,
  ) => (
    <Field label={label} hint={hint}>
      <input
        className="input mono"
        type="number"
        min={min}
        max={max}
        value={num(key, fallback)}
        onChange={(e) => set(key, Number(e.target.value))}
      />
    </Field>
  );

  return (
    <section id="s-monitoring">
      <SectionTitle
        actions={
          dirty ? (
            <button className="btn btn--sm btn--primary" onClick={() => void save()}>保存</button>
          ) : undefined
        }
      >
        监控
      </SectionTitle>
      <div className="card" style={{ padding: "var(--s4)", maxWidth: 720 }}>
        <p className="lede" style={{ marginBottom: "var(--s3)" }}>
          关闭某个监控只是停止读取；已记录的数据会保留到其保留窗口将其清理为止，
          而清理本身始终照常运行。
        </p>

        <div className="tpl__group">主机资源</div>
        <CheckRow
          checked={on("resource_monitor_enabled")}
          onChange={(v) => set("resource_monitor_enabled", v)}
          label="监控本机"
          hint="仪表盘上的 CPU、内存、交换空间、磁盘和网络。读取自 /proc，不影响本机之外的任何东西。"
        />
        {on("resource_monitor_enabled") && (
          <div className="row2">
            {numberField("读取间隔（秒）", "resource_interval_seconds", 3, 1, 3600, "读取本机计数器的频率。")}
            {numberField("历史点数", "resource_history_points", 100, 10, 2000, "迷你曲线图保留的读数数量。")}
          </div>
        )}

        <div className="tpl__group">流量（虚拟 HUB 与用户）</div>
        <CheckRow
          checked={on("traffic_monitor_enabled")}
          onChange={(v) => set("traffic_monitor_enabled", v)}
          label="记录虚拟 HUB 和用户流量"
          hint="用量图表的数据来源。每轮每个虚拟 HUB 一次 RPC，外加一次读取其用户列表。"
        />
        {on("traffic_monitor_enabled") && (
          <div className="row2">
            {numberField("采样间隔（分钟）", "sample_interval_minutes", 5, 1, 1440)}
            {numberField("样本保留（天）", "sample_retention_days", 90, 1, 3650)}
          </div>
        )}

        <div className="tpl__group">会话</div>
        <CheckRow
          checked={on("session_monitor_enabled")}
          onChange={(v) => set("session_monitor_enabled", v)}
          label="记录会话历史"
          hint="谁连接过、来自什么地址、何时开始与结束。按下方自己的节奏运行。"
        />
        {on("session_monitor_enabled") && (
          <>
            <CheckRow
              checked={on("session_traffic_enabled")}
              onChange={(v) => set("session_traffic_enabled", v)}
              label="记录每个会话的流量变化"
              hint="会话用量图表的数据来源。每轮每个在线会话多一次 RPC — 服务器繁忙时首先应关掉的项。"
            />
            <div className="row2">
              {numberField("采样间隔（秒）", "session_interval_seconds", 60, 5, 3600, "读取在线会话列表的频率。短于此值的会话可能完全被漏掉。")}
              {numberField("会话历史保留（天）", "session_history_retention_days", 30, 1, 3650, "同样适用于登录记录及其流量序列。")}
            </div>
          </>
        )}

        <div className="tpl__group">流量限额</div>
        <CheckRow
          checked={on("quota_enforcement_enabled")}
          onChange={(v) => set("quota_enforcement_enabled", v)}
          label="强制执行虚拟 HUB 和账号流量限额"
          hint="统计每个设限虚拟 HUB 和账号的流量并在到顶时切断。未设任何限额时不产生开销；设有限额时，每轮每个受限虚拟 HUB 一次 RPC。"
        />
        {on("quota_enforcement_enabled") && (
          <div className="row2">
            {numberField("检查间隔（秒）", "quota_interval_seconds", 60, 10, 3600, "上限生效的最大延迟。两次检查之间的流量仍会被计入 — 只是切断会稍等片刻。")}
          </div>
        )}

        <div className="tpl__group">页面刷新</div>
        <p className="hint" style={{ marginTop: 0 }}>
          打开的页面按所看内容的重要程度重新读取的频率。开销按每个打开的标签页计，
          而不是按每台服务器计。
        </p>
        <div className="row2">
          {numberField("实时视图（秒）", "ui_live_seconds", 5, 1, 3600, "仪表盘、会话、连接。")}
          {numberField("详情页面（秒）", "ui_detail_seconds", 15, 1, 3600, "虚拟 HUB、用户、地址表。")}
          {numberField("列表（秒）", "ui_list_seconds", 30, 1, 3600, "用户与用户组列表、服务器设置。")}
        </div>

        {dirty && (
          <div style={{ marginTop: "var(--s3)" }}>
            <button className="btn btn--primary" onClick={() => void save()}>保存监控设置</button>
          </div>
        )}
      </div>
    </section>
  );
}

function UpdatesCard() {
  const { status, check, isChecking, open } = useUpdate();
  const checkInfo = status?.check;
  return (
    <section id="s-updates">
      <SectionTitle>更新</SectionTitle>
      <div className="card" style={{ padding: "var(--s4)", maxWidth: 560 }}>
        <KV
          rows={[
            ["当前运行", String(checkInfo?.current_version ?? "—")],
            ["最新版本", String(checkInfo?.latest?.version || "未知")],
            ["来源", String(checkInfo?.source ?? "—")],
            ["上次检查", checkInfo?.checked_at ? timeAgo(String(checkInfo.checked_at)) : "从未"],
          ]}
        />
        {checkInfo?.update_available ? (
          <div className="alert alert--info" style={{ marginTop: "var(--s3)" }}>
            <div className="alert__t">{String(checkInfo.latest.version)} 已可用。</div>
            从版本徽标或下方按钮打开更新器。
          </div>
        ) : null}
        {checkInfo?.note ? <div className="hint">{String(checkInfo.note)}</div> : null}
        {checkInfo?.error ? <div className="hint hint--err">{String(checkInfo.error)}</div> : null}
        <div style={{ display: "flex", gap: "var(--s2)", marginTop: "var(--s3)" }}>
          <button className="btn" onClick={() => void check()} disabled={isChecking}>
            {isChecking && <span className="spin" />} 立即检查
          </button>
          <button className="btn btn--primary" onClick={open}>打开更新器</button>
        </div>
      </div>
    </section>
  );
}

function AuditCard() {
  const [rows, setRows] = useState<Wire[] | null>(null);
  const [exhausted, setExhausted] = useState(false);
  // The trail grows without bound; the page shows its head and lets an
  // operator walk back through it rather than rendering months of it.
  const { visible, reveal } = useReveal(5);

  const load = useCallback(async (beforeId = 0) => {
    const batch = await api.audit(beforeId).catch(() => []);
    setRows((current) => (beforeId ? [...(current ?? []), ...batch] : batch));
    if (batch.length < 100) setExhausted(true);
  }, []);
  useEffect(() => void load(), [load]);

  const shown = rows ? rows.slice(0, visible) : [];

  return (
    <section id="s-audit">
      <SectionTitle count={rows?.length}>审计日志</SectionTitle>
      {rows === null ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <div className="card" style={{ padding: "var(--s4)" }}>
          <span className="micro">每个改变状态的操作都会记录在这里 — 目前还没有。</span>
        </div>
      ) : (
        <div className="card tcard">
          <div className="tscroll">
            <table className="dtable">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>操作者</th>
                  <th>动作</th>
                  <th>对象</th>
                  <th>详情</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={String(r.id)}>
                    <td className="tmono">{timeAgo(String(r.created_date))}</td>
                    <td className="tmono">{String(r.username)}</td>
                    <td><Pill kind={String(r.action).includes("delete") || String(r.action).includes("crash") ? "warn" : "idle"} label={String(r.action)} /></td>
                    <td className="tmono">{[r.target_type, r.target_key].filter(Boolean).join(" · ")}</td>
                    <td className="micro">{String(r.detail || "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <MoreRows
            shown={shown.length}
            loaded={rows.length}
            exhausted={exhausted}
            noun="条记录"
            onReveal={reveal}
            onLoad={() => load(Number(rows[rows.length - 1].id))}
          />
        </div>
      )}
    </section>
  );
}

function AboutCard() {
  const [info, setInfo] = useState<Wire | null>(null);
  useEffect(() => {
    void api.systemInfo().then(setInfo).catch(() => {});
  }, []);
  return (
    <section id="s-about">
      <SectionTitle>关于</SectionTitle>
      <div className="card" style={{ padding: "var(--s4)", maxWidth: 560 }}>
        {!info ? (
          <LoadingBlock />
        ) : (
          <KV
            rows={[
              ["版本", String(info.version ?? "—")],
              ["发布仓库", String(info.release_repo ?? "—")],
              ["服务", `${(info.service as Wire)?.unit ?? "—"}（${(info.service as Wire)?.active || "未由 systemd 托管"}）`],
              ["环境变量文件", String(info.env_file ?? "—")],
            ]}
          />
        )}
        <p className="micro" style={{ marginTop: "var(--s3)" }}>
          SoftEther 管理器 — 基于 SoftEther VPN Server JSON-RPC API 的自托管管理面板。
        </p>
      </div>
    </section>
  );
}
