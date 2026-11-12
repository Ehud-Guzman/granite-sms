// src/utils/secretBox.js
// Encrypts secrets kept in the database (school M-Pesa credentials) with
// AES-256-GCM. The key is MPESA_ENC_KEY: 32 random bytes, base64
// (`openssl rand -base64 32`). Without it, secrets can't be saved or read.
import crypto from "crypto";

function key() {
  const raw = process.env.MPESA_ENC_KEY || "";
  const buf = Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : null;
}

export const secretBoxReady = () => !!key();

/** "v1:<iv>:<tag>:<ciphertext>" (base64 parts). */
export function seal(plain) {
  const k = key();
  if (!k) throw Object.assign(new Error("MPESA_ENC_KEY is not set on the server."), { status: 400 });
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", k, iv);
  const enc = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function open(sealed) {
  if (!sealed) return null;
  const k = key();
  if (!k) throw Object.assign(new Error("MPESA_ENC_KEY is not set on the server."), { status: 500 });
  const [v, iv, tag, data] = String(sealed).split(":");
  if (v !== "v1") throw new Error("Unknown secret format");
  const d = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}
