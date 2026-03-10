import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";
import type { DatabaseAdapter } from "../types.js";

// HMAC secret — generated once per startup, stored in DB for persistence
let hmacSecret: string | null = null;

async function getOrCreateSecret(db: DatabaseAdapter): Promise<string> {
  if (hmacSecret) return hmacSecret;

  try {
    const stored = await db.getSetting("hmac_secret");
    if (stored) {
      hmacSecret = stored;
      return hmacSecret;
    }

    hmacSecret = randomBytes(32).toString("hex");
    db.setSetting("hmac_secret", hmacSecret);
    return hmacSecret;
  } catch (err) {
    // Fallback to in-memory secret if DB fails
    if (!hmacSecret) {
      hmacSecret = randomBytes(32).toString("hex");
    }
    console.error("[LoadFlux] Failed to read/write HMAC secret from DB:", err);
    return hmacSecret;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createToken(
  username: string,
  db: DatabaseAdapter
): Promise<string> {
  const secret = await getOrCreateSecret(db);
  const payload = {
    username,
    iat: Date.now(),
    exp: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export async function verifyToken(
  token: string,
  db: DatabaseAdapter
): Promise<{ username: string } | null> {
  const secret = await getOrCreateSecret(db);
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [data, sig] = parts;
  const expectedSig = createHmac("sha256", secret)
    .update(data)
    .digest("base64url");

  const sigBuf = Buffer.from(sig, "utf-8");
  const expectedBuf = Buffer.from(expectedSig, "utf-8");
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(data, "base64url").toString("utf-8")
    );
    if (payload.exp < Date.now()) return null;
    return { username: payload.username };
  } catch {
    return null;
  }
}

export async function setupInitialAuth(
  db: DatabaseAdapter,
  username: string,
  password: string
): Promise<void> {
  try {
    const existing = await db.getUser(username);
    const hash = await hashPassword(password);

    if (!existing) {
      db.createUser(username, hash);
      return;
    }

    // If config password changed, update the stored hash
    const matches = await verifyPassword(password, existing.password_hash);
    if (!matches) {
      db.updateUserPassword(username, hash);
    }
  } catch (err) {
    console.error("[LoadFlux] Failed to setup initial auth:", err);
  }
}

