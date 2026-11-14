"use client";

import { useEffect, useState } from "react";
import { ErrorAlert, Field, PageHead } from "../components/bits";
import { api } from "../lib/api";
import { navigate } from "../lib/router";
import { useServer } from "../lib/server";
import { useToast } from "../lib/toast";
import { IconCheck } from "../ui/Icon";

/**
 * Connecting the panel to the SoftEther instance on this machine: the
 * management port and the administrator password, tested before saved.
 * The host stays editable for the odd deployment where SoftEther listens
 * somewhere unusual, but 127.0.0.1 is the design.
 */
export function Connect() {
  const { refresh } = useServer();
  const { push } = useToast();
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState(5555);
  const [password, setPassword] = useState("");
  const [configured, setConfigured] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);

  useEffect(() => {
    void api
      .connection()
      .then((c) => {
        setHost(c.host);
        setPort(c.port);
        setConfigured(c.configured);
      })
      .catch(() => {});
  }, []);

  const test = async () => {
    setBusy("test");
    setError(null);
    setTestResult(null);
    try {
      const r = await api.testConnection({ host, port, password });
      setTestResult(`${r.version} 已在 ${host}:${port} 应答。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      await api.saveConnection({
        host,
        port,
        password: password || (configured ? null : ""),
      });
      push("ok", "已连接。");
      await refresh();
      navigate("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <PageHead
        title="连接 SoftEther"
        sub="本机 SoftEther 实例的管理端口和管理员密码。"
      />
      <div className="card" style={{ padding: "var(--s5)", maxWidth: 560 }}>
        {error && <ErrorAlert>{error}</ErrorAlert>}
        {testResult && (
          <div className="alert alert--ok">
            <IconCheck size={14} /> {testResult}
          </div>
        )}
        <div className="row2">
          <Field label="主机" hint="默认 127.0.0.1，除非 SoftEther 刻意部署在别处。">
            <input className="input mono" value={host} onChange={(e) => setHost(e.target.value)}
              autoCapitalize="none" spellCheck={false} inputMode="url" />
          </Field>
          <Field label="管理端口" hint="默认安装为 5555；443 和 992 也可应答。">
            <input className="input mono" type="number" min={1} max={65535} value={port}
              onChange={(e) => setPort(Number(e.target.value))} inputMode="numeric" />
          </Field>
        </div>
        <Field
          label={configured ? "管理员密码（留空保持已保存的密码）" : "管理员密码"}
        >
          <input className="input" type="password" value={password}
            onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
        </Field>
        <div style={{ display: "flex", gap: "var(--s2)", marginTop: "var(--s2)" }}>
          <button className="btn" onClick={test} disabled={busy !== null || (!password && !configured)}>
            {busy === "test" && <span className="spin" />} 测试
          </button>
          <button className="btn btn--primary" onClick={save} disabled={busy !== null || (!password && !configured)}>
            {busy === "save" && <span className="spin" />} 保存并连接
          </button>
        </div>
        <p className="hint" style={{ marginTop: "var(--s3)" }}>
          本机还没有安装 SoftEther？请先安装 — 面板只管理已有实例，不会代为安装。
        </p>
      </div>
    </div>
  );
}
