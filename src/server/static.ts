import type { IncomingMessage, ServerResponse } from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Resolve dist-ui directory. Works in both CJS and ESM, bundled or unbundled.
function findDistUiDir(): string {
  const candidates: string[] = [];

  try {
    if (import.meta?.url) {
      const thisDir = path.dirname(fileURLToPath(import.meta.url));
      candidates.push(path.resolve(thisDir, "..", "dist-ui"));
    }
  } catch {}

  candidates.push(path.resolve(process.cwd(), "dist-ui"));
  candidates.push(
    path.resolve(process.cwd(), "node_modules", "loadflux", "dist-ui")
  );

  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }

  return candidates[0];
}

let _distUiDir: string | null = null;
function getDistUiDir(): string {
  if (!_distUiDir) _distUiDir = findDistUiDir();
  return _distUiDir;
}

/** @internal Resets cached dist-ui path (for unit tests). */
export function resetDistUiDirCache(): void {
  _distUiDir = null;
  // A different dist-ui location invalidates any buffers cached under the old one.
  resetAssetCache();
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// dist-ui assets are content-hashed by Vite and served `immutable`, so their
// bytes never change for a given path. Cache the buffer on first read to keep
// blocking disk I/O off the request hot path (many tabs / cold browser caches
// otherwise re-hit the disk synchronously every request).
interface CachedAsset {
  content: Buffer;
  mimeType: string;
}
const assetCache = new Map<string, CachedAsset>();

/** @internal Clears the served-asset buffer cache (for unit tests). */
export function resetAssetCache(): void {
  assetCache.clear();
}

/**
 * Reads an asset from disk once and caches its buffer. Returns null if the file
 * does not exist. A single `readFileSync` in a try/catch replaces the previous
 * `existsSync` + `readFileSync` pair (one syscall instead of two on a miss).
 */
function readAssetCached(filePath: string, ext: string): CachedAsset | null {
  const cached = assetCache.get(filePath);
  if (cached) return cached;
  let content: Buffer;
  try {
    content = fs.readFileSync(filePath);
  } catch {
    return null;
  }
  const entry: CachedAsset = {
    content,
    mimeType: MIME_TYPES[ext] || "application/octet-stream",
  };
  assetCache.set(filePath, entry);
  return entry;
}

export function createStaticHandler(basePath: string) {
  // Read and patch index.html once: rewrite relative asset paths to absolute
  // so they always resolve to {basePath}/assets/... regardless of the URL.
  let indexHtml: Buffer | null = null;

  function getIndexHtml(): Buffer | null {
    if (indexHtml) return indexHtml;
    const distUiDir = getDistUiDir();
    const indexPath = path.join(distUiDir, "index.html");
    if (!fs.existsSync(indexPath)) return null;
    const raw = fs.readFileSync(indexPath, "utf-8");
    // Replace relative ./assets/ with absolute /basePath/assets/
    const patched = raw.replace(/(['"])\.\//g, `$1${basePath}/`);
    indexHtml = Buffer.from(patched, "utf-8");
    return indexHtml;
  }

  return function handleStatic(
    req: IncomingMessage,
    res: ServerResponse
  ): void {
    const distUiDir = getDistUiDir();
    const urlPath = (req.url || "/").split("?")[0];
    let relativePath = urlPath.substring(basePath.length) || "/";
    if (relativePath.startsWith("/")) {
      relativePath = relativePath.slice(1);
    }

    // Prevent directory traversal
    relativePath = path.normalize(relativePath).replace(
      /^(\.\.(\/|\\|$))+/,
      ""
    );

    const filePath = path.resolve(distUiDir, relativePath || ".");

    // Prevent directory traversal (mirror tryServeAsset guard)
    if (!filePath.startsWith(distUiDir + path.sep) && filePath !== distUiDir) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);

    if (ext) {
      // Has a file extension — serve the actual file or 404
      const asset = readAssetCached(filePath, ext);
      if (!asset) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }

      res.writeHead(200, {
        "Content-Type": asset.mimeType,
        "Cache-Control": "public, max-age=31536000, immutable",
      });
      res.end(asset.content);
      return;
    }

    // No extension = SPA route — serve patched index.html
    const html = getIndexHtml();
    if (!html) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end(
        "LoadFlux: Dashboard not built yet. Run 'npm run build:ui'."
      );
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/html",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    });
    res.end(html);
  };
}

/**
 * Tries to serve a dist-ui asset for bare /assets/* requests.
 * This handles the case where the browser cached old HTML with relative paths
 * that resolve to /assets/... instead of /basePath/assets/...
 * Returns true if the file was served.
 */
export function tryServeAsset(
  req: IncomingMessage,
  res: ServerResponse
): boolean {
  const urlPath = (req.url || "/").split("?")[0];
  if (!urlPath.startsWith("/assets/")) return false;

  const distUiDir = getDistUiDir();
  const filePath = path.resolve(distUiDir, urlPath.slice(1)); // remove leading /

  // Prevent directory traversal
  if (!filePath.startsWith(distUiDir + path.sep) && filePath !== distUiDir) return false;

  const ext = path.extname(filePath);
  const asset = readAssetCached(filePath, ext);
  if (!asset) return false;

  res.writeHead(200, {
    "Content-Type": asset.mimeType,
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  res.end(asset.content);
  return true;
}
