// src/modules/mpesa/daraja.js
// Calls to Safaricom's Daraja API for one school's M-Pesa set-up.
import { open } from "../../utils/secretBox.js";

const BASE = { sandbox: "https://sandbox.safaricom.co.ke", production: "https://api.safaricom.co.ke" };
const tokens = new Map(); // configId -> { token, exp }

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Public base URL Safaricom calls back on, e.g. https://api.example.co.ke */
export function publicApiUrl() {
  const u = String(process.env.PUBLIC_API_URL || "").replace(/\/+$/, "");
  if (!/^https:\/\//.test(u)) throw httpError(400, "PUBLIC_API_URL (https) is not set on the server.");
  return u;
}

export const callbackUrls = (cfg) => {
  const base = `${publicApiUrl()}/api/public/mpesa/${cfg.callbackToken}`;
  return { confirmation: `${base}/c2b/confirmation`, validation: `${base}/c2b/validation`, stk: `${base}/stk` };
};

async function call(cfg, path, { method = "POST", body, auth } = {}) {
  const res = await fetch(`${BASE[cfg.environment] || BASE.sandbox}${path}`, {
    method,
    headers: { Authorization: auth, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw httpError(502, data?.errorMessage || data?.ResponseDescription || `M-Pesa said HTTP ${res.status}`);
  return data;
}

export async function accessToken(cfg) {
  const hit = tokens.get(cfg.id);
  if (hit && hit.exp > Date.now()) return hit.token;
  const key = open(cfg.consumerKeyEnc);
  const secret = open(cfg.consumerSecretEnc);
  if (!key || !secret) throw httpError(400, "M-Pesa consumer key and secret are not saved.");
  const basic = Buffer.from(`${key}:${secret}`).toString("base64");
  const data = await call(cfg, "/oauth/v1/generate?grant_type=client_credentials", { method: "GET", auth: `Basic ${basic}` });
  tokens.set(cfg.id, { token: data.access_token, exp: Date.now() + (Number(data.expires_in || 3599) - 60) * 1000 });
  return data.access_token;
}

/** Tells Safaricom where to send this paybill's payment notifications. */
export async function registerC2bUrls(cfg) {
  const urls = callbackUrls(cfg);
  const token = await accessToken(cfg);
  return call(cfg, "/mpesa/c2b/v2/registerurl", {
    auth: `Bearer ${token}`,
    body: { ShortCode: cfg.shortcode, ResponseType: "Completed", ConfirmationURL: urls.confirmation, ValidationURL: urls.validation },
  });
}

/** yyyyMMddHHmmss in Nairobi time, as Daraja expects. */
function timestamp(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Nairobi",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`;
}

/** Sends the "enter your M-Pesa PIN" prompt to a parent's phone. */
export async function stkPush(cfg, { phone, amount, accountReference, description }) {
  const passkey = open(cfg.passkeyEnc);
  if (!passkey) throw httpError(400, "The M-Pesa passkey (for payment prompts) is not saved.");
  const ts = timestamp();
  const token = await accessToken(cfg);
  return call(cfg, "/mpesa/stkpush/v1/processrequest", {
    auth: `Bearer ${token}`,
    body: {
      BusinessShortCode: cfg.shortcode,
      Password: Buffer.from(`${cfg.shortcode}${passkey}${ts}`).toString("base64"),
      Timestamp: ts,
      TransactionType: cfg.kind === "TILL" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phone.replace(/^\+/, ""),
      PartyB: cfg.shortcode,
      PhoneNumber: phone.replace(/^\+/, ""),
      CallBackURL: callbackUrls(cfg).stk,
      AccountReference: String(accountReference).slice(0, 12),
      TransactionDesc: String(description || "School fees").slice(0, 13),
    },
  });
}

/** "20261112083045" (Nairobi) -> Date. */
export function parseTransTime(v) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(v || ""));
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+03:00`);
}
