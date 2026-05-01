/**
 * AES-256-GCM encrypt/decrypt for per-brand secrets.
 *
 * Per D-008:
 *   - Key: 32 raw bytes, base64-encoded in env var MASTER_ENCRYPTION_KEY
 *   - Output format (stored in Postgres TEXT): base64( iv [12 bytes] || ciphertext || authTag [16 bytes] )
 *   - IV is fresh per encryption (crypto.randomBytes(12)). Never reuse with the same key.
 *
 * Post-MVP upgrade path: replace this module with a KMS-backed implementation
 * (encrypt/decrypt become async API calls). Public signatures kept narrow so the
 * upgrade is a swap, not a refactor.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;     // GCM standard
const TAG_LEN = 16;
const KEY_LEN = 32;    // AES-256

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.MASTER_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('MASTER_ENCRYPTION_KEY env var is not set');
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== KEY_LEN) {
    throw new Error(
      `MASTER_ENCRYPTION_KEY must be ${KEY_LEN} bytes (base64-encoded). Got ${buf.length} bytes — generate with: openssl rand -base64 32`
    );
  }
  cachedKey = buf;
  return cachedKey;
}

export function encrypt(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString('base64');
}

export function decrypt(payload: string): string {
  const key = loadKey();
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('crypto.decrypt: payload too short to be valid');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ct = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Convenience wrapper for nullable secrets — null in, null out. */
export function encryptNullable(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  return encrypt(plaintext);
}

export function decryptNullable(payload: string | null | undefined): string | null {
  if (payload === null || payload === undefined || payload === '') return null;
  return decrypt(payload);
}
