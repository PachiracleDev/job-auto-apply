import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const raw = process.env["SESSION_ENCRYPTION_KEY"]?.trim();
  if (!raw) {
    throw new Error("SESSION_ENCRYPTION_KEY no está definida (base64 de 32 bytes).");
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(
      "SESSION_ENCRYPTION_KEY debe decodificar a exactamente 32 bytes (AES-256).",
    );
  }
  return buf;
}

export function encryptSessionBytes(plain: Buffer): Buffer {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

export function decryptSessionBytes(blob: Buffer): Buffer {
  const key = getKey();
  if (blob.length < IV_LEN + TAG_LEN) {
    throw new Error("Blob cifrado demasiado corto.");
  }
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}
