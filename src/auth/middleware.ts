import type { IncomingMessage } from "http";
import type { DatabaseAdapter } from "../types.js";
import { verifyToken } from "./auth.js";

export async function isAuthenticated(
  req: IncomingMessage,
  db: DatabaseAdapter
): Promise<boolean> {
  try {
    // Check if auth is configured at all
    const hasUsers = await db.getUser("admin");
    if (!hasUsers) {
      // No auth configured — allow access (dashboard will show setup prompt)
      return true;
    }

    // Check Authorization header
    const authHeader = (req.headers["authorization"] ?? "") as string;
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const result = await verifyToken(token, db);
      if (result) return true;
    }

    // Check cookie
    const cookies = parseCookies(req.headers["cookie"] ?? "");
    const cookieToken = cookies["__loadflux_token"];
    if (cookieToken) {
      const result = await verifyToken(cookieToken, db);
      if (result) return true;
    }

    return false;
  } catch (err) {
    console.error("[LoadFlux] Auth check failed:", err);
    return false;
  }
}

function parseCookies(cookieStr: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of cookieStr.split(";")) {
    const [key, ...vals] = pair.trim().split("=");
    if (key) cookies[key.trim()] = vals.join("=").trim();
  }
  return cookies;
}
