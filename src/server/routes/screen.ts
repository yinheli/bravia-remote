/** GET /api/screen — PNG screenshot via network adb (`adb exec-out screencap`).
 *
 * Error responses are language-neutral machine codes so the web UI can
 * localize them: "timeout", "too-small" (with `bytes`), "adb-missing", or the
 * raw error text for anything unexpected.
 */
import { isRecord } from "../../shared/parse";
import type { AppContext, RouteHandler } from "../app";

/** Local failure with a machine-readable code (localized by the web UI). */
class ScreenCaptureError extends Error {
  constructor(
    readonly code: string,
    readonly bytes?: number,
  ) {
    super(code);
  }
}

const toErrorCode = (e: unknown): string => {
  if (e instanceof ScreenCaptureError) return e.code;
  if (isRecord(e) && e.code === "ENOENT") return "adb-missing";
  return String(e);
};

/** Exit code once the subprocess finishes, or null after `ms` without settling. */
const exitCodeWithin = async (proc: Bun.Subprocess<"ignore", "pipe", "ignore">, ms: number): Promise<number | null> => {
  const { promise, resolve } = Promise.withResolvers<number | null>();
  const timer = setTimeout(() => resolve(null), ms);
  void proc.exited.then((code) => {
    clearTimeout(timer);
    resolve(code);
  });
  return promise;
};

type CaptureResult = { ok: true; png: ArrayBuffer } | { ok: false; code: string; bytes?: number };

/** Each caller needs its own Response; a shared one can only be sent once. */
const toResponse = (result: CaptureResult): Response =>
  result.ok
    ? new Response(result.png, {
        headers: {
          "content-type": "image/png",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "cross-origin-resource-policy": "same-origin",
        },
      })
    : Response.json({ ok: false, error: result.code, bytes: result.bytes ?? null }, { status: 502 });

/**
 * Per-app capture slot: concurrent callers on one server share a single adb
 * run, while separate `createApp` instances never share hidden capture state.
 * Each caller still gets its own Response.
 */
const inflight = new WeakMap<AppContext, Promise<CaptureResult>>();

export const screenHandler: RouteHandler = (ctx) => {
  const current = inflight.get(ctx);
  if (current) return current.then(toResponse);
  const capture = doCapture(ctx).finally(() => {
    if (inflight.get(ctx) === capture) inflight.delete(ctx);
  });
  inflight.set(ctx, capture);
  return capture.then(toResponse);
};

const doCapture = async (ctx: AppContext): Promise<CaptureResult> => {
  const adb = ctx.config.adbPath;
  // URL.hostname keeps IPv6 brackets, which is exactly what adb's -s serial wants.
  const host = new URL(ctx.config.tvUrl).hostname;
  const screenTimeout = ctx.config.screenTimeoutMs;
  const { promise: done, resolve: ok, reject: fail } = Promise.withResolvers<ArrayBuffer>();
  // Silence the rejection while other awaits are in flight; consumed at `await done`.
  done.catch(() => {});
  const timer = setTimeout(() => fail(new ScreenCaptureError("timeout")), screenTimeout);
  let proc: Bun.Subprocess<"ignore", "pipe", "ignore"> | undefined;
  try {
    // Both adb phases are bounded so a hung adb cannot outlive the timeout.
    await Bun.spawn([adb, "connect", `${host}:5555`], { timeout: screenTimeout, killSignal: "SIGKILL" }).exited;
    const spawned = Bun.spawn([adb, "-s", `${host}:5555`, "exec-out", "screencap", "-p"], {
      stdout: "pipe",
      stderr: "ignore",
      timeout: screenTimeout,
      killSignal: "SIGKILL",
    });
    proc = spawned;
    new Response(spawned.stdout).arrayBuffer().then(ok, fail);
    const png = await done;
    // Non-zero exit is a TV/adb error; an undersized frame is a separate failure.
    const exited = await exitCodeWithin(spawned, 1000);
    if (exited !== null && exited !== 0) throw new ScreenCaptureError("screencap-failed");
    if (png.byteLength < 1000) throw new ScreenCaptureError("too-small", png.byteLength);
    return { ok: true, png };
  } catch (e) {
    proc?.kill();
    return { ok: false, code: toErrorCode(e), bytes: e instanceof ScreenCaptureError ? e.bytes : undefined };
  } finally {
    clearTimeout(timer);
  }
};
