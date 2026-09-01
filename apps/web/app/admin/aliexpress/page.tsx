"use client";

import { useState } from "react";

/**
 * One-time AliExpress OAuth setup, proxied through the dropship-engine
 * (see /dropship-engine's README). The engine stores the access/refresh
 * tokens itself — nothing here ever displays them, unlike the old
 * in-repo-engine version of this page.
 */
export default function AliExpressAuthPage() {
  const [appKey, setAppKey] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [code, setCode] = useState("");
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"connect" | "url" | "exchange" | "webhook" | null>(null);

  async function registerWebhook() {
    setError(null);
    setWebhookUrl(null);
    setBusy("webhook");
    try {
      const res = await fetch("/api/admin/aliexpress/webhook", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not register webhook");
      setWebhookUrl(data.webhookUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not register webhook");
    } finally {
      setBusy(null);
    }
  }

  async function saveAppCredentials() {
    setError(null);
    if (!appKey || !appSecret) {
      setError("Enter both the app key and app secret first.");
      return;
    }
    setBusy("connect");
    try {
      const res = await fetch("/api/admin/aliexpress/auth", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appKey, appSecret }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save app credentials");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save app credentials");
    } finally {
      setBusy(null);
    }
  }

  async function getAuthorizeUrl() {
    setError(null);
    setAuthorizeUrl(null);
    if (!redirectUri) {
      setError("Enter the redirect/callback URI first.");
      return;
    }
    setBusy("url");
    try {
      const res = await fetch(`/api/admin/aliexpress/auth?redirectUri=${encodeURIComponent(redirectUri)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not build authorize URL");
      setAuthorizeUrl(data.authorizeUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build authorize URL");
    } finally {
      setBusy(null);
    }
  }

  async function exchangeCode() {
    setError(null);
    setConnected(false);
    if (!redirectUri || !code) {
      setError("Enter both the redirect/callback URI and the code from the redirect.");
      return;
    }
    setBusy("exchange");
    try {
      const res = await fetch("/api/admin/aliexpress/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, redirectUri }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Token exchange failed");
      setConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Token exchange failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-2xl">
      <p className="eyebrow mb-2">AliExpress</p>
      <h1 className="font-serif text-3xl mb-2">Connect AliExpress account</h1>
      <p className="text-sm text-stone-600 mb-8">
        One-time OAuth setup, run through the dropship-engine — it stores and refreshes the tokens itself, so nothing
        secret ever lands in this browser or this app&rsquo;s own env vars.
      </p>

      <div className="card p-6 mb-6">
        <div className="mb-2 text-sm font-medium">Step 1 — register your AliExpress Open Platform app</div>
        <p className="text-xs text-stone-500 mb-3">From your app at open.aliexpress.com.</p>
        <input
          type="text"
          value={appKey}
          onChange={(e) => setAppKey(e.target.value)}
          placeholder="App key"
          className="w-full border border-stone-300 px-3 py-2 text-sm mb-2"
        />
        <input
          type="password"
          value={appSecret}
          onChange={(e) => setAppSecret(e.target.value)}
          placeholder="App secret"
          className="w-full border border-stone-300 px-3 py-2 text-sm mb-4"
        />
        <button className="btn-secondary" onClick={saveAppCredentials} disabled={busy !== null}>
          {busy === "connect" ? "Saving…" : "Save app credentials"}
        </button>
      </div>

      <div className="card p-6 mb-6">
        <label className="block text-sm mb-2" htmlFor="redirectUri">
          Redirect / callback URI
        </label>
        <input
          id="redirectUri"
          type="text"
          value={redirectUri}
          onChange={(e) => setRedirectUri(e.target.value)}
          placeholder="https://www.webese.ai/api/callback"
          className="w-full border border-stone-300 px-3 py-2 text-sm mb-4"
        />

        <div className="mb-2 text-sm font-medium">Step 2 — get the authorize link</div>
        <button className="btn-secondary mb-4" onClick={getAuthorizeUrl} disabled={busy !== null}>
          {busy === "url" ? "Loading…" : "Get authorize link"}
        </button>
        {authorizeUrl && (
          <p className="text-sm mb-4">
            Visit this link, log into the AliExpress account being connected, and approve access. You&rsquo;ll be
            redirected back to your callback URI with a <code>?code=...</code> in the address bar — copy that code
            below.
            <br />
            <a href={authorizeUrl} target="_blank" rel="noreferrer" className="underline break-all">
              {authorizeUrl}
            </a>
          </p>
        )}

        <div className="mb-2 mt-6 text-sm font-medium">Step 3 — exchange the code</div>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Code from the redirect URL"
          className="w-full border border-stone-300 px-3 py-2 text-sm mb-4"
        />
        <button className="btn-primary" onClick={exchangeCode} disabled={busy !== null}>
          {busy === "exchange" ? "Exchanging…" : "Exchange code"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-6">{error}</p>}

      {connected && (
        <div className="card p-6 mb-6">
          <p className="text-sm font-medium">
            Connected — the dropship-engine now holds this account&rsquo;s access/refresh tokens and will keep them
            renewed automatically. Nothing further needed here.
          </p>
        </div>
      )}

      <div className="card p-6">
        <div className="mb-2 text-sm font-medium">Webhook — receive price/stock/tracking updates</div>
        <p className="text-xs text-stone-500 mb-3">
          Requires <code>DROPSHIP_ENGINE_WEBHOOK_SECRET</code> already set as an env var on this deployment (it has to
          match what <code>/api/webhooks/dropship-engine</code> verifies signatures with).
        </p>
        <button className="btn-secondary" onClick={registerWebhook} disabled={busy !== null}>
          {busy === "webhook" ? "Registering…" : "Register webhook with the engine"}
        </button>
        {webhookUrl && <p className="text-sm mt-3">Registered: {webhookUrl}</p>}
      </div>
    </div>
  );
}
