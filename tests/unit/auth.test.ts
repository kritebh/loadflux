import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";
import {
  hashPassword,
  verifyPassword,
  createToken,
  verifyToken,
  setupInitialAuth,
  trySetupInitialUser,
  resetAuthModuleForTests,
} from "../../src/auth/auth.js";
import { SQLiteAdapter } from "../../src/db/sqlite.js";
import { tmpDbPath, cleanupSqliteDb } from "../helpers/db.js";

describe("auth", () => {
  let db: SQLiteAdapter;
  let dbPath: string;

  beforeEach(async () => {
    resetAuthModuleForTests();
    dbPath = tmpDbPath();
    db = new SQLiteAdapter(dbPath);
    await db.connect();
  });

  afterEach(async () => {
    await db.close();
    cleanupSqliteDb(dbPath);
  });

  describe("password hashing", () => {
    it("hashes and verifies password", async () => {
      const hash = await hashPassword("secret");
      expect(hash).not.toBe("secret");
      expect(await verifyPassword("secret", hash)).toBe(true);
      expect(await verifyPassword("wrong", hash)).toBe(false);
    });
  });

  describe("tokens", () => {
    it("creates and verifies a valid token", async () => {
      const token = await createToken("admin", db);
      expect(token).toContain(".");
      const result = await verifyToken(token, db);
      expect(result).not.toBeNull();
      expect(result!.username).toBe("admin");
    });

    it("rejects invalid token", async () => {
      const result = await verifyToken("invalid.token", db);
      expect(result).toBeNull();
    });

    it("rejects tampered token", async () => {
      const token = await createToken("admin", db);
      const tampered = token.slice(0, -1) + "X";
      const result = await verifyToken(tampered, db);
      expect(result).toBeNull();
    });

    it("rejects malformed token without dot", async () => {
      const result = await verifyToken("nodot", db);
      expect(result).toBeNull();
    });

    it("reuses cached auth_epoch across verify calls", async () => {
      await setupInitialAuth(db, "admin", "pass");
      const token = await createToken("admin", db);

      let epochReads = 0;
      const origGetSetting = db.getSetting.bind(db);
      db.getSetting = async (key: string) => {
        if (key === "auth_epoch") epochReads++;
        return origGetSetting(key);
      };

      expect(await verifyToken(token, db)).not.toBeNull();
      expect(await verifyToken(token, db)).not.toBeNull();
      expect(epochReads).toBe(0);
    });

    it("invalidates token after password change", async () => {
      await setupInitialAuth(db, "admin", "first");
      const token = await createToken("admin", db);
      expect(await verifyToken(token, db)).not.toBeNull();

      await setupInitialAuth(db, "admin", "second");
      expect(await verifyToken(token, db)).toBeNull();

      const newToken = await createToken("admin", db);
      expect(await verifyToken(newToken, db)).not.toBeNull();
    });

    it("rejects expired token", async () => {
      await setupInitialAuth(db, "admin", "pass");
      await createToken("admin", db);
      const secret = await db.getSetting("hmac_secret");
      const authEpoch = await db.getSetting("auth_epoch");
      const payload = {
        username: "admin",
        iat: Date.now() - 86400000,
        exp: Date.now() - 1000,
        authEpoch: parseInt(authEpoch ?? "0", 10),
      };
      const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const sig = createHmac("sha256", secret!)
        .update(data)
        .digest("base64url");
      const expiredToken = `${data}.${sig}`;
      expect(await verifyToken(expiredToken, db)).toBeNull();
    });
  });

  describe("trySetupInitialUser", () => {
    it("creates first user and bumps auth epoch", async () => {
      const result = await trySetupInitialUser(db, "admin", "password");
      expect(result).toBe("created");
      const user = await db.getUser("admin");
      expect(user).not.toBeNull();
      const epoch = await db.getSetting("auth_epoch");
      expect(parseInt(epoch ?? "0", 10)).toBeGreaterThan(0);
    });

    it("returns already_configured when user exists", async () => {
      await trySetupInitialUser(db, "admin", "password");
      const result = await trySetupInitialUser(db, "other", "otherpass");
      expect(result).toBe("already_configured");
    });
  });

  describe("setupInitialAuth", () => {
    it("creates user if not exists", async () => {
      await setupInitialAuth(db, "admin", "password");
      const user = await db.getUser("admin");
      expect(user).not.toBeNull();
      expect(await verifyPassword("password", user!.password_hash)).toBe(true);
    });

    it("syncs password when config changes", async () => {
      await setupInitialAuth(db, "admin", "first");
      await setupInitialAuth(db, "admin", "second");
      const user = await db.getUser("admin");
      // Password should be updated to the new config value
      expect(await verifyPassword("second", user!.password_hash)).toBe(true);
      expect(await verifyPassword("first", user!.password_hash)).toBe(false);
    });

    it("does not rehash if password unchanged", async () => {
      await setupInitialAuth(db, "admin", "same");
      const user1 = await db.getUser("admin");
      await setupInitialAuth(db, "admin", "same");
      const user2 = await db.getUser("admin");
      // Hash should remain the same (no unnecessary update)
      expect(user1!.password_hash).toBe(user2!.password_hash);
    });
  });
});
