#!/usr/bin/env bun
/**
 * Black-box smoke test for the compiled single-file binary: start it from a
 * clean temp cwd (so no `.env` leaks in) with an explicit token, a temp auth
 * file, and an unreachable TV. Then verify the public shell and the
 * authenticated API surface — the parts a `/`-only check cannot catch.
 *
 * Usage: bun scripts/smoke.ts [path-to-binary]   (default: dist/bravia-remote)
 */
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isRecord } from "../src/shared/parse";

/** Fixed test credential; must satisfy the server's 4-char/no-whitespace policy. */
const TOKEN = "smoke-token";
/** Port 9 (discard) is closed here, so every TV RPC fails at the transport layer. */
const TV_URL = "http://127.0.0.1:9";
const READY_TIMEOUT_MS = 10_000;

const binary = resolve(process.argv[2] ?? "dist/bravia-remote");

if (!existsSync(binary)) throw new Error(`smoke: binary not found at ${binary}; run "bun run build:server" first`);

/** Ask the OS for a currently free loopback port. */
const freePort = (): Promise<number> =>
  new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("smoke: could not determine a free port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });

/** Inherit PATH/HOME/etc. but drop BRAVIA_* so the host environment cannot alter the run. */
const cleanEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("BRAVIA_")) env[key] = value;
  }
  return env;
};

const dir = await mkdtemp(join(tmpdir(), "bravia-smoke-"));
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
let proc: Bun.Subprocess<"ignore", "ignore", "pipe"> | undefined;

const drainStderr = async (): Promise<string> => {
  if (!proc) return "(not started)";
  try {
    // Never wait for EOF: on a timeout the server is still alive, so the
    // stream stays open until the finally block kills it.
    const text = new Response(proc.stderr).text().catch(() => "(stderr unavailable)");
    const output = await Promise.race([text, Bun.sleep(1000).then(() => "(stderr still open)")]);
    return output.trim() || "(no stderr)";
  } catch {
    return "(stderr unavailable)";
  }
};

const waitForReady = async (): Promise<void> => {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (proc && proc.exitCode !== null) {
      throw new Error(`smoke: server exited before becoming ready (code ${proc.exitCode})\n${await drainStderr()}`);
    }
    try {
      const res = await fetch(`${base}/`, { signal: AbortSignal.timeout(500) });
      if (res.status === 200) return;
    } catch {
      // Not listening yet; retry until the deadline.
    }
    await Bun.sleep(100);
  }
  throw new Error(`smoke: server did not answer within ${READY_TIMEOUT_MS / 1000}s\n${await drainStderr()}`);
};

const get = (path: string, token?: string): Promise<Response> => {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(5000) });
};

const expectStatus = async (label: string, path: string, expected: number, token?: string): Promise<Response> => {
  const res = await get(path, token);
  if (res.status !== expected) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(`smoke: ${label}: expected HTTP ${expected}, got ${res.status}: ${body}`);
  }
  console.log(`ok ${label}`);
  return res;
};

const expectJson = async (
  label: string,
  res: Response,
  predicate: (body: unknown) => boolean,
  expected: string,
): Promise<void> => {
  const body = (await res.json()) as unknown;
  if (!predicate(body)) throw new Error(`smoke: ${label}: expected ${expected}, got ${JSON.stringify(body)}`);
  console.log(`ok ${label}`);
};

try {
  proc = Bun.spawn([binary], {
    cwd: dir,
    env: {
      ...cleanEnv(),
      BRAVIA_TV: TV_URL,
      BRAVIA_TOKEN: TOKEN,
      BRAVIA_AUTH_FILE: join(dir, "auth.json"),
      BRAVIA_TOKEN_FILE: join(dir, "token"),
      BRAVIA_TIMEOUT_MS: "1000",
      HOST: "127.0.0.1",
      PORT: String(port),
    },
    stdout: "ignore",
    stderr: "pipe",
  });

  await waitForReady();

  // Public shell (token mode leaves it reachable without a credential).
  await expectStatus("public /", "/", 200);
  await expectStatus("public /app.js", "/app.js", 200);
  await expectStatus("public /app.css", "/app.css", 200);
  await expectStatus("public /favicon.svg", "/favicon.svg", 200);

  // Auth gate: unauthenticated API is rejected, the configured token is accepted.
  await expectStatus("unauthenticated /api/auth", "/api/auth", 401);
  const authRes = await expectStatus("bearer /api/auth", "/api/auth", 200, TOKEN);
  await expectJson(
    "bearer /api/auth body",
    authRes,
    (body) => isRecord(body) && body.ok === true && body.mode === "token",
    '{ ok: true, mode: "token" }',
  );

  // Authenticated API wiring, including one route that reaches BraviaClient.
  const configRes = await expectStatus("bearer /api/config", "/api/config", 200, TOKEN);
  await expectJson(
    "bearer /api/config body",
    configRes,
    (body) => isRecord(body) && Array.isArray(body.apps) && body.apps.length === 0,
    "{ apps: [] }",
  );
  const statusRes = await expectStatus("bearer /api/status", "/api/status", 200, TOKEN);
  await expectJson(
    "bearer /api/status returns the RPC envelope",
    statusRes,
    (body) => isRecord(body) && Array.isArray(body.error) && body.ok === undefined,
    "{ error: [...] } from the unreachable TV",
  );
} finally {
  if (proc) {
    proc.kill("SIGKILL");
    await proc.exited;
  }
  await rm(dir, { recursive: true, force: true });
}

console.log(`smoke: ${binary} passed`);
