import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ENV } from "../_core/env";

function key() {
  if (!ENV.cookieSecret) throw new Error("Server encryption secret is unavailable");
  return createHash("sha256").update(`supported-accommodation:${ENV.cookieSecret}`).digest();
}

export function encryptSensitive(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString("base64url")).join(".");
}

export function decryptSensitive(payload: string | null | undefined) {
  if (!payload) return null;
  const [ivValue, tagValue, encryptedValue] = payload.split(".");
  if (!ivValue || !tagValue || !encryptedValue) throw new Error("Invalid encrypted payload");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}
