/**
 * HTTP layer: route table (JSON API, including per-route security policy) →
 * embedded static assets → 404. `createApp` returns a bare request handler so
 * tests can drive it directly.
 */
import { ASSETS } from "./assets";
import { type AuthConfig, isAuthorized, unauthorizedResponse } from "./auth";
import type { BraviaClient } from "./client";
import type { Config } from "./config";
import type { CredentialStore } from "./credentials";
import type { AppHistory } from "./history";
import { allowedOrigins, assertAllowedHost, assertAllowedOrigin, BadRequestError, ForbiddenError } from "./http";
import { configHandler, launchAppHandler } from "./routes/apps";
import { createAuthHandler } from "./routes/auth";
import { keyHandler } from "./routes/key";
import { pairHandler } from "./routes/pair";
import { screenHandler } from "./routes/screen";
import { codesHandler, infoHandler, statusHandler } from "./routes/status";

/** Runtime configuration safe for route handlers; secrets stay in startup code. */
export type AppConfig = Omit<Config, "token" | "basicPassword" | "psk">;

export type AppContext = {
  config: AppConfig;
  tv: BraviaClient;
  credentials: CredentialStore;
  history: AppHistory;
};

export type RouteHandler = (ctx: AppContext, req: Request, url: URL) => Response | Promise<Response>;

type Route = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  /** `public` skips the /api credential check (login/logout only). */
  auth: "required" | "public";
  /** `block` rejects browser cross-site fetches (screenshot exfiltration). */
  crossSite?: "block";
  handler: RouteHandler;
};

const buildRoutes = (auth: AuthConfig): readonly Route[] => [
  { method: "GET", path: "/api/auth", auth: "required", handler: createAuthHandler(auth) },
  { method: "POST", path: "/api/auth", auth: "public", handler: createAuthHandler(auth) },
  { method: "DELETE", path: "/api/auth", auth: "public", handler: createAuthHandler(auth) },
  { method: "GET", path: "/api/status", auth: "required", handler: statusHandler },
  { method: "GET", path: "/api/codes", auth: "required", handler: codesHandler },
  { method: "GET", path: "/api/info", auth: "required", handler: infoHandler },
  { method: "GET", path: "/api/pair", auth: "required", handler: pairHandler },
  { method: "POST", path: "/api/pair", auth: "required", handler: pairHandler },
  { method: "POST", path: "/api/key", auth: "required", handler: keyHandler },
  { method: "POST", path: "/api/app", auth: "required", handler: launchAppHandler },
  { method: "GET", path: "/api/config", auth: "required", handler: configHandler },
  { method: "GET", path: "/api/screen", auth: "required", crossSite: "block", handler: screenHandler },
];

/**
 * Route policy surface (no handlers) mirrored by the AGENTS.md HTTP API table;
 * `app.test.ts` fails when the two drift apart. Handlers close over `auth`, so
 * `none` produces a handler that the manifest discards.
 */
export const ROUTE_MANIFEST = buildRoutes({ mode: "none" }).map(({ method, path, auth, crossSite }) => ({
  method,
  path,
  auth,
  crossSite,
}));

export function createApp(ctx: AppContext, auth: AuthConfig): (req: Request) => Response | Promise<Response> {
  const origins = allowedOrigins(ctx.config.host, ctx.config.port, ctx.config.publicOrigin);
  const routes = buildRoutes(auth);
  return async (req) => {
    const url = new URL(req.url);
    const route = routes.find((r) => r.method === req.method && r.path === url.pathname);
    if (url.pathname.startsWith("/api/")) {
      try {
        assertAllowedHost(req, ctx.config.host, ctx.config.publicOrigin);
        // Unknown paths keep the auth requirement even though they 404 below.
        if (route?.auth !== "public" && !isAuthorized(req, auth)) return unauthorizedResponse(auth);
        // <img>/<iframe> GETs carry no Origin; browsers still send Sec-Fetch-Site.
        // A cross-site screenshot would let any web page display the TV's screen.
        if (route?.crossSite === "block" && req.headers.get("sec-fetch-site") === "cross-site")
          return Response.json({ ok: false, error: ["forbidden"] }, { status: 403 });
        if (req.method === "POST" || req.method === "DELETE") assertAllowedOrigin(req, origins);
      } catch (e) {
        if (e instanceof ForbiddenError) return Response.json({ ok: false, error: ["forbidden"] }, { status: 403 });
        throw e;
      }
    }
    // Basic protects the document so the browser can prompt; token mode leaves
    // the static shell public and guards /api.
    if (auth.mode === "basic" && !isAuthorized(req, auth)) return unauthorizedResponse(auth);
    try {
      if (route) return await route.handler(ctx, req, url);
    } catch (e) {
      if (e instanceof ForbiddenError) return Response.json({ ok: false, error: ["forbidden"] }, { status: 403 });
      if (e instanceof BadRequestError) return Response.json({ ok: false, error: ["bad"] }, { status: 400 });
      console.error(`bravia: unhandled error for ${req.method} ${url.pathname}:`, e);
      return Response.json({ ok: false, error: ["unknown"] }, { status: 500 });
    }
    const asset = ASSETS.get(url.pathname);
    if (asset)
      return new Response(asset.body, {
        headers: {
          "content-type": asset.type,
          "cache-control": "no-store",
          "content-security-policy": "frame-ancestors 'none'",
          "x-frame-options": "DENY",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        },
      });
    return new Response("not found", { status: 404 });
  };
}
