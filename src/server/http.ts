/** Malformed request (bad JSON body or wrong content type) → machine code 400. */
export class BadRequestError extends Error {}

/** Cross-origin browser write rejected → machine code 403. */
export class ForbiddenError extends Error {}

/** Hard cap so a reachable client cannot make the server buffer an arbitrary body. */
const MAX_JSON_BODY_BYTES = 64 * 1024;

/** Byte-capped body read, independent of Content-Length. */
const readBodyText = async (req: Request): Promise<string> => {
  const declared = req.headers.get("content-length");
  if (declared && Number(declared) > MAX_JSON_BODY_BYTES) throw new BadRequestError("request body too large");
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw new BadRequestError("request body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
};

/**
 * Require `application/json` (blocks the simplified-content-type CSRF path) and
 * return `BadRequestError` for malformed or oversized bodies.
 */
export const readJsonBody = async (req: Request): Promise<unknown> => {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json"))
    throw new BadRequestError(`content-type must be application/json, got "${contentType}"`);
  try {
    return JSON.parse(await readBodyText(req));
  } catch (e) {
    if (e instanceof BadRequestError) throw e;
    throw new BadRequestError("malformed JSON body");
  }
};

/**
 * Listen addresses that mean "every interface": Bun's default bind is
 * `0.0.0.0`, and an empty hostname falls back to it.
 */
export const isWildcardHost = (host: string): boolean =>
  host === "" || host === "0.0.0.0" || host === "::" || host === "*";

/** URL-ready host for logs and origin lists: wildcards show as localhost, IPv6 literals get brackets. */
export const displayHost = (host: string): string => {
  if (isWildcardHost(host)) return "localhost";
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
};

/**
 * Server-known origins (from configuration, NOT from the request): the hosts a
 * real browser reaches us on. Comparing against config-derived values is what
 * defeats DNS rebinding — under rebinding the attacker also controls the Host
 * header, so a request-derived comparison would approve its own origin.
 */
export const allowedOrigins = (host: string, port: number, publicOrigin?: string | null): string[] => {
  const names = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!isWildcardHost(host)) names.add(host);
  const origins = [...names].map((n) => `http://${displayHost(n)}:${port}`);
  if (publicOrigin) origins.push(publicOrigin);
  return origins;
};

/**
 * Reject browser cross-origin writes (CSRF / DNS rebinding). Browsers attach
 * an Origin header to cross-origin POSTs; it must match either a
 * config-derived origin or the request's own (already Host-allowlisted)
 * origin — the latter keeps same-origin access working on LAN deployments
 * where the browser addresses the server by its LAN IP.
 * Non-browser clients (curl, scripts) send no Origin and are governed by the
 * listen address instead.
 */
export const assertAllowedOrigin = (req: Request, allowed: readonly string[]): void => {
  const origin = req.headers.get("origin");
  if (!origin) return;
  if (allowed.includes(origin)) return;
  if (origin === new URL(req.url).origin) return;
  throw new ForbiddenError(origin);
};

/** WHATWG URL keeps IPv6 brackets in hostname; allowlists store bare literals. */
const bareHostname = (bracketed: string): string => bracketed.replace(/^\[(.+)\]$/, "$1");

/**
 * DNS-rebinding guard for reads and writes alike: the Host header must name a
 * host this server is actually reached on. Skipped when listening on a
 * wildcard address (LAN access by design means arbitrary hostnames).
 */
export const assertAllowedHost = (req: Request, host: string, publicOrigin?: string | null): void => {
  if (isWildcardHost(host)) return;
  const header = req.headers.get("host");
  if (!header) return;
  let hostname: string;
  try {
    hostname = new URL(`http://${header}`).hostname;
  } catch {
    throw new ForbiddenError(header);
  }
  const names = new Set(["localhost", "127.0.0.1", "::1", host]);
  if (publicOrigin) names.add(bareHostname(new URL(publicOrigin).hostname));
  if (!names.has(bareHostname(hostname))) throw new ForbiddenError(header);
};
