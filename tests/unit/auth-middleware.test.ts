import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { IncomingMessage } from "http";
import { isAuthenticated } from "../../src/auth/middleware.js";
import {
  createToken,
  setupInitialAuth,
  resetAuthModuleForTests,
} from "../../src/auth/auth.js";
import { SQLiteAdapter } from "../../src/db/sqlite.js";
import { tmpDbPath, cleanupSqliteDb } from "../helpers/db.js";

function mockReq(headers: Record<string, string> = {}): IncomingMessage {
  return { headers } as IncomingMessage;
}

describe("isAuthenticated", () => {
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

  it("returns false when no users are configured", async () => {
    const result = await isAuthenticated(mockReq(), db);
    expect(result).toBe(false);
  });

  it("accepts valid Bearer token", async () => {
    await setupInitialAuth(db, "admin", "secret");
    const token = await createToken("admin", db);
    const result = await isAuthenticated(
      mockReq({ authorization: `Bearer ${token}` }),
      db,
    );
    expect(result).toBe(true);
  });

  it("accepts valid session cookie", async () => {
    await setupInitialAuth(db, "admin", "secret");
    const token = await createToken("admin", db);
    const result = await isAuthenticated(
      mockReq({ cookie: `__loadflux_token=${token}` }),
      db,
    );
    expect(result).toBe(true);
  });

  it("rejects invalid Bearer token", async () => {
    await setupInitialAuth(db, "admin", "secret");
    const result = await isAuthenticated(
      mockReq({ authorization: "Bearer invalid.token" }),
      db,
    );
    expect(result).toBe(false);
  });

  it("rejects tampered cookie token", async () => {
    await setupInitialAuth(db, "admin", "secret");
    const token = await createToken("admin", db);
    const tampered = token.slice(0, -1) + "X";
    const result = await isAuthenticated(
      mockReq({ cookie: `__loadflux_token=${tampered}` }),
      db,
    );
    expect(result).toBe(false);
  });
});
