"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Wire } from "../lib/api";
import { useToast } from "../lib/toast";
import { downloadText } from "../lib/util";
import { IconDownload } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
import { CheckRow, ErrorAlert, Field } from "./bits";

/**
 * Hand a user their connection: a ready-to-import SoftEther VPN Client
 * .vpn file.
 *
 * The address defaults to how *you* reached this panel -- the panel lives on
 * the VPN server, so that address usually is the server -- with the DDNS name
 * offered when the server has one. The names come from the templates in
 * Settings and stay editable here. The credential is embedded by default
 * (the panel holds SoftEther's own hash -- saved when the user was created
 * here, or recovered once from the server's configuration); typing the
 * password is only needed when neither source has it.
 */
export function VpnFileSheet({
  hub,
  name,
  onClose,
}: {
  hub: string;
  name: string;
  onClose: () => void;
}) {
  const [host, setHost] = useState(() => window.location.hostname);
  const [port, setPort] = useState<number>(443);
  const [ports, setPorts] = useState<number[]>([]);
  const [customPort, setCustomPort] = useState(false);
  const [ddnsFqdn, setDdnsFqdn] = useState("");
  const [embed, setEmbed] = useState(true);
  const [credential, setCredential] = useState<{ available: boolean } | null>(null);
  const [password, setPassword] = useState("");
  const [accountName, setAccountName] = useState("");
  const [filename, setFilename] = useState("");
  const [templates, setTemplates] = useState<{ account: string; file: string } | null>(null);
  const namesTouched = useRef({ account: false, file: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { push } = useToast();

  useEffect(() => {
    void api
      .listeners()
      .then((r) => {
        const enabled = ((r.ListenerList as Wire[]) ?? [])
          .filter((l) => l.Enables_bool)
          .map((l) => Number(l.Ports_u32))
          .sort((a, b) => a - b);
        setPorts(enabled);
        if (enabled.length && !enabled.includes(443)) setPort(enabled[0]);
      })
      .catch(() => {});
    void api
      .ddns()
      .then((r) => setDdnsFqdn(String(r.CurrentFqdn_str || "")))
      .catch(() => {});
    void api
      .vpnTemplate()
      .then((r) => {
        setEmbed(Boolean(r.embed_password_default));
        setTemplates({
          account: String(r.account_name_template || "{hub} - {username}"),
          file: String(r.filename_template || "{hub}-{username}"),
        });
      })
      .catch(() => setTemplates({ account: "{hub} - {username}", file: "{hub}-{username}" }));
    void api
      .userCredentialState(hub, name)
      .then(setCredential)
      .catch(() => setCredential({ available: false }));
  }, [hub, name]);

  // The naming templates follow the live host/port until the operator types
  // their own name -- then their text wins.
  const render = (template: string) =>
    template
      .replaceAll("{hub}", hub)
      .replaceAll("{username}", name)
      .replaceAll("{host}", host.trim())
      .replaceAll("{port}", String(port));
  useEffect(() => {
    if (!templates) return;
    if (!namesTouched.current.account) setAccountName(render(templates.account));
    if (!namesTouched.current.file) setFilename(render(templates.file));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, host, port]);

  const portChoices = useMemo(() => (ports.length ? ports : [443, 992, 1194, 5555]), [ports]);
  const needsPassword = embed && credential !== null && !credential.available && !password;

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.userVpnFile(hub, name, {
        host: host.trim(),
        port,
        embed_password: embed,
        password: embed ? password || undefined : undefined,
        account_name: accountName.trim() || undefined,
        filename: filename.trim() || undefined,
      });
      downloadText(r.filename, r.content);
      push("ok", `${r.filename} 已下载。`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="下载连接文件"
      subtitle={`${name} · 虚拟 HUB ${hub}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn--primary" onClick={download} disabled={busy || !host.trim() || !port}>
            {busy ? <span className="spin" /> : <IconDownload size={15} />}
            下载 .vpn
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gap: "var(--s1)" }}>
        {error && <ErrorAlert>{error}</ErrorAlert>}
        <div className="lede" style={{ marginBottom: "var(--s2)" }}>
          该文件可直接导入 SoftEther VPN Client — 双击即可创建连接，指向本服务器并以
          <b className="mono">{name}</b> 身份登录。
        </div>
        <Field
          label="服务器地址"
          hint={
            ddnsFqdn ? (
              <>
                客户端将拨叫的地址。{" "}
                <button className="linkish" onClick={() => setHost(ddnsFqdn)} type="button">
                  使用 DDNS 名称（{ddnsFqdn}）
                </button>
              </>
            ) : (
              "客户端将拨叫的地址 — 本机的公网地址。"
            )
          }
        >
          <input
            className="input mono"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
          />
        </Field>
        <Field label="端口" hint="任意 SoftEther 监听端口；443 在大多数网络中都能通行。">
          {customPort ? (
            <input
              className="input mono"
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              inputMode="numeric"
            />
          ) : (
            <select
              className="select"
              value={String(port)}
              onChange={(e) => {
                if (e.target.value === "custom") setCustomPort(true);
                else setPort(Number(e.target.value));
              }}
            >
              {portChoices.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
              <option value="custom">其他…</option>
            </select>
          )}
        </Field>
        <div className="row2">
          <Field label="文件名">
            <input
              className="input mono"
              value={filename}
              onChange={(e) => {
                namesTouched.current.file = true;
                setFilename(e.target.value);
              }}
              spellCheck={false}
            />
          </Field>
          <Field label="客户端中的连接名称">
            <input
              className="input mono"
              value={accountName}
              onChange={(e) => {
                namesTouched.current.account = true;
                setAccountName(e.target.value);
              }}
              spellCheck={false}
            />
          </Field>
        </div>
        <CheckRow
          checked={embed}
          onChange={setEmbed}
          label="在文件中内嵌密码"
          hint={
            credential === null
              ? "正在检查面板是否持有该用户的凭据…"
              : credential.available
                ? "面板持有该用户的凭据 — 会以 SoftEther 自身的哈希形式写入，无需输入。任何持有该文件的人都可以连接。"
                : "面板没有该用户的密码，也无法从服务器恢复 — 请在下方输入一次，之后会记住它。"
          }
        />
        {embed && (
          <Field
            label={credential?.available ? "密码（仅用于替换已保存的密码）" : "密码"}
            hint="以哈希形式保存，与客户端的保存方式一致 — 绝不以明文存储。"
          >
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
            />
          </Field>
        )}
        {needsPassword && (
          <p className="hint hint--err">没有密码将被拒绝下载 — 或取消勾选内嵌，导出不含凭据的文件。</p>
        )}
      </div>
    </Sheet>
  );
}
