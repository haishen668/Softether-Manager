"use client";

import { useCallback, useState } from "react";
import { ConfirmSheet, Empty, ErrorAlert, Field, KV, LoadingBlock, SectionTitle, usePoll } from "../../components/bits";
import { api, type Wire } from "../../lib/api";
import { useToast } from "../../lib/toast";
import { downloadBase64, fileToBase64, formatDate } from "../../lib/util";
import { IconDownload, IconPlus, IconShield, IconTrash } from "../../ui/Icon";
import { Sheet } from "../../ui/Sheet";

/**
 * The hub's trust: CA certificates it accepts, certificates it has revoked,
 * and the RADIUS server it can delegate authentication to.
 */
export function HubSecurity({ hub }: { hub: string }) {
  return (
    <>
      <CaSection hub={hub} />
      <CrlSection hub={hub} />
      <RadiusSection hub={hub} />
    </>
  );
}

/* ── trusted CAs ──────────────────────────────────────────────────────────── */

function CaSection({ hub }: { hub: string }) {
  const [cas, setCas] = useState<Wire[] | null>(null);
  const [deleting, setDeleting] = useState<Wire | null>(null);
  const { guard, push } = useToast();

  const load = useCallback(async () => {
    const r = await api.cas(hub).catch(() => null);
    if (r) setCas((r.CAList as Wire[]) ?? []);
  }, [hub]);
  usePoll(load, "list", [hub]);

  const upload = async (file: File) => {
    const b64 = await fileToBase64(file);
    await guard(() => api.addCa(hub, b64), "CA 证书已添加。");
    void load();
  };

  const download = (key: number) =>
    guard(async () => {
      const r = await api.getCa(hub, key);
      downloadBase64(`ca-${key}.cer`, String(r.Cert_bin ?? ""), "application/pkix-cert");
    });

  return (
    <>
      <SectionTitle
        count={cas?.length}
        actions={
          <label className="btn btn--sm">
            <IconPlus size={14} /> 添加 CA
            <input type="file" accept=".cer,.crt,.pem,.der" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          </label>
        }
      >
        受信 CA 证书
      </SectionTitle>
      {cas === null ? (
        <LoadingBlock />
      ) : cas.length === 0 ? (
        <Empty title="暂无受信 CA">
          使用已签名证书认证的用户，需要其签发 CA 在此处登记。
        </Empty>
      ) : (
        <div className="rows">
          {cas.map((c) => (
            <div key={String(c.Key_u32)} className="row">
              <div className="row__main">
                <div className="row__name">
                  <IconShield size={15} />
                  <span className="truncate">{String(c.SubjectName_utf || "证书")}</span>
                </div>
                <div className="row__note">
                  签发者 {String(c.IssuerName_utf || "?")} · 过期于 {formatDate(c.Expires_dt as string)}
                </div>
              </div>
              <div className="row__side">
                <button className="btn btn--sm btn--ghost" onClick={() => void download(Number(c.Key_u32))} aria-label="下载">
                  <IconDownload size={14} />
                </button>
                <button className="btn btn--sm btn--ghost" onClick={() => setDeleting(c)} aria-label="删除">
                  <IconTrash size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {deleting && (
        <ConfirmSheet
          title="移除该 CA？"
          verb="移除"
          body={<>证书链追溯到 <b>{String(deleting.SubjectName_utf || "该 CA")}</b> 的用户将无法再通过认证。</>}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.deleteCa(hub, Number(deleting.Key_u32));
            void load();
          }}
        />
      )}
    </>
  );
}

/* ── the revocation list ──────────────────────────────────────────────────── */

function CrlSection({ hub }: { hub: string }) {
  const [crls, setCrls] = useState<Wire[] | null>(null);
  const [adding, setAdding] = useState(false);
  const { guard } = useToast();

  const load = useCallback(async () => {
    const r = await api.crls(hub).catch(() => null);
    if (r) setCrls((r.CRLList as Wire[]) ?? []);
  }, [hub]);
  usePoll(load, "list", [hub]);

  return (
    <>
      <SectionTitle
        count={crls?.length}
        actions={
          <button className="btn btn--sm" onClick={() => setAdding(true)}>
            <IconPlus size={14} /> 吊销证书
          </button>
        }
      >
        已吊销证书
      </SectionTitle>
      {crls === null ? (
        <LoadingBlock />
      ) : crls.length === 0 ? (
        <Empty title="暂无吊销">
          吊销条目可拒绝某一张证书 — 按通用名（CN）、序列号或摘要匹配 — 即使其 CA 仍受信任。
          笔记本丢失时的一键开关。
        </Empty>
      ) : (
        <div className="rows">
          {crls.map((c) => (
            <div key={String(c.Key_u32)} className="row">
              <div className="row__main">
                <div className="row__name mono truncate">{String(c.CrlInfo_utf || `条目 ${c.Key_u32}`)}</div>
              </div>
              <div className="row__side">
                <button
                  className="btn btn--sm btn--ghost"
                  onClick={() => void guard(async () => {
                    await api.deleteCrl(hub, Number(c.Key_u32));
                    await load();
                  }, "吊销条目已移除。")}
                  aria-label="删除"
                >
                  <IconTrash size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {adding && (
        <CrlSheet
          onClose={() => setAdding(false)}
          onSave={async (body) => {
            await api.addCrl(hub, body);
            setAdding(false);
            void load();
          }}
        />
      )}
    </>
  );
}

function CrlSheet({ onClose, onSave }: { onClose: () => void; onSave: (b: Wire) => Promise<void> }) {
  const [cn, setCn] = useState("");
  const [serial, setSerial] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: Wire = {};
      if (cn.trim()) body.CommonName_utf = cn.trim();
      if (serial.trim()) body.Serial_bin = hexToBase64(serial);
      await onSave(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="吊销证书"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn--danger" onClick={save} disabled={busy || (!cn.trim() && !serial.trim())}>
            {busy && <span className="spin" />} 吊销
          </button>
        </>
      }
    >
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <div className="lede" style={{ marginBottom: "var(--s3)" }}>
        匹配你所填的<b>每一个</b>字段的证书都会被拒绝。通常只填一个精确字段 —
        序列号 — 就足够了。
      </div>
      <Field label="通用名（CN）">
        <input className="input mono" value={cn} onChange={(e) => setCn(e.target.value)} spellCheck={false} />
      </Field>
      <Field label="序列号" hint="十六进制，带不带冒号均可。">
        <input className="input mono" value={serial} onChange={(e) => setSerial(e.target.value)} spellCheck={false} placeholder="0a:1b:2c…" />
      </Field>
    </Sheet>
  );
}

function hexToBase64(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const bytes = clean.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? [];
  return btoa(String.fromCharCode(...bytes));
}

/* ── RADIUS ───────────────────────────────────────────────────────────────── */

function RadiusSection({ hub }: { hub: string }) {
  const [config, setConfig] = useState<Wire | null>(null);
  const [secret, setSecret] = useState("");
  const [dirty, setDirty] = useState(false);
  const { guard } = useToast();

  const load = useCallback(async () => {
    const r = await api.radius(hub).catch(() => null);
    if (r) setConfig((c) => (dirty ? c : r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub, dirty]);
  usePoll(load, 3600_000, [hub]);

  if (!config) return null;
  const set = (k: string, v: unknown) => {
    setConfig((c) => ({ ...(c ?? {}), [k]: v }));
    setDirty(true);
  };

  const save = () =>
    guard(async () => {
      const body: Wire = {
        RadiusServerName_str: config.RadiusServerName_str ?? "",
        RadiusPort_u32: Number(config.RadiusPort_u32) || 1812,
        RadiusRetryInterval_u32: Number(config.RadiusRetryInterval_u32) || 500,
      };
      if (secret) body.RadiusSecret_str = secret;
      await api.setRadius(hub, body);
      setDirty(false);
      setSecret("");
    }, "RADIUS 设置已保存。");

  return (
    <>
      <SectionTitle>RADIUS 认证</SectionTitle>
      <div className="card" style={{ padding: "var(--s4)", maxWidth: 640 }}>
        <div className="lede" style={{ marginBottom: "var(--s3)" }}>
          设为 RADIUS 认证的用户将由此服务器验证。主机名留空即为关闭。
        </div>
        <div className="row2">
          <Field label="服务器">
            <input className="input mono" value={String(config.RadiusServerName_str ?? "")} onChange={(e) => set("RadiusServerName_str", e.target.value)} spellCheck={false} placeholder="radius.example.net" />
          </Field>
          <Field label="端口">
            <input className="input mono" type="number" min={1} max={65535} value={Number(config.RadiusPort_u32) || 1812} onChange={(e) => set("RadiusPort_u32", Number(e.target.value))} />
          </Field>
        </div>
        <div className="row2">
          <Field label="共享密钥" hint="仅在你输入新密钥时才会发送。">
            <input className="input" type="password" value={secret} onChange={(e) => { setSecret(e.target.value); setDirty(true); }} autoComplete="off" />
          </Field>
          <Field label="重试间隔（毫秒）">
            <input className="input mono" type="number" min={100} value={Number(config.RadiusRetryInterval_u32) || 500} onChange={(e) => set("RadiusRetryInterval_u32", Number(e.target.value))} />
          </Field>
        </div>
        {dirty && (
          <button className="btn btn--primary" onClick={() => void save()}>
            保存 RADIUS 设置
          </button>
        )}
      </div>
    </>
  );
}
