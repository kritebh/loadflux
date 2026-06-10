import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import http from "http";
import {
  createStaticHandler,
  tryServeAsset,
  resetDistUiDirCache,
} from "../../src/server/static.js";

function request(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  url: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = { url, method: "GET", headers: {} } as http.IncomingMessage;
    const chunks: Buffer[] = [];
    const res = {
      statusCode: 200,
      writeHead(code: number) {
        this.statusCode = code;
      },
      end(data?: string | Buffer) {
        if (data) chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
        resolve({
          status: this.statusCode,
          body: Buffer.concat(chunks).toString("utf-8"),
        });
      },
    } as http.ServerResponse & { statusCode: number };
    try {
      handler(req, res);
    } catch (err) {
      reject(err);
    }
  });
}

describe("createStaticHandler", () => {
  let tmpDir: string;
  let originalCwd: string;
  const basePath = "/loadflux";

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loadflux-static-"));
    const distUiDir = path.join(tmpDir, "dist-ui");
    fs.mkdirSync(distUiDir, { recursive: true });
    fs.mkdirSync(path.join(distUiDir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(distUiDir, "index.html"), '<html><script src="./assets/app.js"></script></html>');
    fs.writeFileSync(path.join(distUiDir, "assets", "app.js"), "console.log('ok');");
    fs.writeFileSync(path.join(tmpDir, "secret.db"), "sensitive-data");
    process.chdir(tmpDir);
    resetDistUiDirCache();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("serves SPA index for extensionless routes", async () => {
    const handler = createStaticHandler(basePath);
    const res = await request(handler, `${basePath}/dashboard`);
    expect(res.status).toBe(200);
    expect(res.body).toContain("app.js");
    expect(res.body).toContain(`${basePath}/assets/`);
  });

  it("serves valid assets under dist-ui", async () => {
    const handler = createStaticHandler(basePath);
    const res = await request(handler, `${basePath}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(res.body).toBe("console.log('ok');");
  });

  it("blocks path traversal to files outside dist-ui", async () => {
    const handler = createStaticHandler(basePath);
    const res = await request(handler, `${basePath}/../../secret.db`);
    expect(res.status).toBe(404);
    expect(res.body).not.toContain("sensitive-data");
  });

  it("blocks normalized absolute traversal", async () => {
    const handler = createStaticHandler(basePath);
    const res = await request(handler, `${basePath}/../../../secret.db`);
    expect(res.status).toBe(404);
  });
});

describe("tryServeAsset", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loadflux-asset-"));
    const distUiDir = path.join(tmpDir, "dist-ui");
    fs.mkdirSync(path.join(distUiDir, "assets"), { recursive: true });
    fs.writeFileSync(
      path.join(distUiDir, "assets", "app.js"),
      "console.log('asset');",
    );
    fs.writeFileSync(path.join(tmpDir, "secret.db"), "sensitive-data");
    process.chdir(tmpDir);
    resetDistUiDirCache();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("serves bare /assets/* paths", async () => {
    const req = { url: "/assets/app.js", method: "GET", headers: {} } as http.IncomingMessage;
    const chunks: Buffer[] = [];
    const res = {
      statusCode: 200,
      writeHead(code: number) {
        this.statusCode = code;
      },
      end(data?: string | Buffer) {
        if (data) chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
      },
    } as http.ServerResponse & { statusCode: number };

    const served = tryServeAsset(req, res);
    expect(served).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(Buffer.concat(chunks).toString("utf-8")).toBe("console.log('asset');");
  });

  it("blocks path traversal outside dist-ui", () => {
    const req = {
      url: "/assets/../../../secret.db",
      method: "GET",
      headers: {},
    } as http.IncomingMessage;
    const res = {
      statusCode: 200,
      writeHead() {},
      end() {},
    } as http.ServerResponse;

    const served = tryServeAsset(req, res);
    expect(served).toBe(false);
  });
});
