// Token encryption (C-25, PRD v3 §7): AES-256-GCM with TOKEN_ENCRYPTION_KEY (32 bytes, base64).
// The IV, the authentication tag and the key version are stored with the ciphertext
// (public.channel_tokens). `aad` binds a ciphertext to its owner (brand + provider), so a row copied
// onto another connection does not decrypt.
//
// Rules: a token is never logged, returned to a browser or put in an error. Only the publisher, the
// refresh job and the disconnect code decrypt (through ./tokens.ts).
//
// Without a key: production refuses (TokenKeyError); development and tests use a key that lives only
// in this process, with a warning (tokens saved that way cannot be read after a restart).

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Bumped when the key is rotated; stored with every token. */
export const TOKEN_KEY_VERSION = 1;

export class TokenKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenKeyError";
  }
}

export interface EncryptedToken {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64
  keyVersion: number;
}

let ephemeral: Buffer | null = null;
let warned = false;

function configuredKey(): Buffer | null {
  const raw = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new TokenKeyError("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded.");
  return key;
}

/** True when tokens can be stored: a valid key is set, or this is not production (an ephemeral key is used). */
export function tokenEncryptionAvailable(): boolean {
  try {
    return configuredKey() !== null || process.env.NODE_ENV !== "production";
  } catch {
    return false;
  }
}

function key(): Buffer {
  const k = configuredKey();
  if (k) return k;
  if (process.env.NODE_ENV === "production") {
    throw new TokenKeyError("TOKEN_ENCRYPTION_KEY is required in production. Set it before connecting accounts.");
  }
  if (!ephemeral) ephemeral = randomBytes(32);
  if (!warned) {
    warned = true;
    console.warn("[connections] TOKEN_ENCRYPTION_KEY is blank; using a temporary key. Saved tokens stop working when the server restarts.");
  }
  return ephemeral;
}

/** Tests only: forget the temporary key and the warning. */
export function resetTokenKeyForTests(): void {
  ephemeral = null;
  warned = false;
}

export function encryptToken(plain: string, aad: string): EncryptedToken {
  if (typeof plain !== "string" || plain.length === 0) throw new TokenKeyError("Nothing to encrypt.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyVersion: TOKEN_KEY_VERSION,
  };
}

/** Throws TokenKeyError when the key is wrong, the data was changed, or `aad` is not the one it was sealed with. */
export function decryptToken(enc: EncryptedToken, aad: string): string {
  if (enc.keyVersion !== TOKEN_KEY_VERSION) throw new TokenKeyError("This token was sealed with another key version.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(enc.iv, "base64"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(enc.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(enc.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch (e) {
    if (e instanceof TokenKeyError) throw e;
    throw new TokenKeyError("The stored token could not be decrypted.");
  }
}

/** What a connection's token is bound to. */
export const tokenAad = (brandId: string, provider: string) => `channel-token:${brandId}:${provider}`;
