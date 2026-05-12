import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

const passwordIterations = 210_000;
const keyLength = 32;

/** Hashes a password using PBKDF2 so plaintext passwords never touch storage. */
export function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const hash = pbkdf2Sync(password, salt, passwordIterations, keyLength, "sha512").toString("hex");
  return { hash, salt };
}

/** Verifies a submitted password against a stored PBKDF2 hash in constant time. */
export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashPassword(password, salt).hash, "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function secretKey(): Buffer {
  const source = process.env.ROOMSCAPE_SECRET ?? "roomscape-local-development-secret-change-me";
  return pbkdf2Sync(source, "roomscape-credential-salt", 100_000, 32, "sha512");
}

/** Encrypts user-supplied OpenAI credentials before writing them to the local store. */
export function encryptSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
}

/** Decrypts stored credentials for server-side SDK calls only. */
export function decryptSecret(payload: string): string {
  const [iv, tag, encrypted] = payload.split(".");
  if (!iv || !tag || !encrypted) {
    throw new Error("Invalid encrypted secret payload.");
  }
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]).toString("utf8");
}
