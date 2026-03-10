import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  hashPassword,
  verifyPassword,
  createToken,
  verifyToken,
  setupInitialAuth,
} from "../../src/auth/auth.js";
import { SQLiteAdapter } from "../../src/db/sqlite.js";
import fs from "fs";
import path from "path";
import os from "os";

function tmpDbPath(): string {
  return path.join(os.tmpdir(), `loadflux-auth-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe("auth", () => {
  let db: SQLiteAdapter;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = tmpDbPath();
    db = new SQLiteAdapter(dbPath);
    await db.connect();
  });

  afterEach(async () => {
    await db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { fs.unlinkSync(dbPath + suffix); } catch {}
    }
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
