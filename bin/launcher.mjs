/**
 * Launcher shared by the npm entry point. Kept dependency-free and plain
 * JavaScript so Node can run it without a build step. Bun runs the packaged
 * server bundle directly; Node downloads the matching release binary once.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { homedir, constants as osConstants } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

export const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

export const RELEASE_BASE = `https://github.com/yinheli/bravia-remote/releases/download/v${VERSION}`;

/** Map a Node platform/arch pair to a release target, or null when unsupported. */
export function resolveTarget(platform, arch, libc = "glibc") {
  if (platform === "linux") {
    if (arch === "x64") return libc === "musl" ? "linux-x64-musl" : "linux-x64";
    if (arch === "arm64") return libc === "musl" ? null : "linux-arm64";
    return null;
  }
  if (platform === "darwin") return arch === "x64" || arch === "arm64" ? `darwin-${arch}` : null;
  if (platform === "win32") return arch === "x64" ? "windows-x64" : null;
  return null;
}

/** Release artifacts use the target suffix and `.exe` on Windows. */
export function assetName(target) {
  return `bravia-remote-${target}${target.startsWith("windows-") ? ".exe" : ""}`;
}

/**
 * Detect glibc vs musl. `process.report` is authoritative when available;
 * `/etc/alpine-release` is a fallback for runtimes that do not implement it.
 */
export function detectLibc(report, alpine = existsSync("/etc/alpine-release")) {
  const header = report?.header;
  if (header) return header.glibcVersionRuntime ? "glibc" : "musl";
  return alpine ? "musl" : "glibc";
}

/** Platform-appropriate cache root; BRAVIA_REMOTE_CACHE overrides it. */
export function cacheRoot(env = process.env, platform = process.platform, home = homedir()) {
  if (env.BRAVIA_REMOTE_CACHE) return resolve(env.BRAVIA_REMOTE_CACHE);
  if (platform === "win32") return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "bravia-remote");
  if (platform === "darwin") return join(home, "Library", "Caches", "bravia-remote");
  return join(env.XDG_CACHE_HOME || join(home, ".cache"), "bravia-remote");
}

/** Parse `sha256sum` output (`<hex>  <name>` or `<hex> *<name>`). */
export function parseChecksums(text) {
  const sums = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (match) sums.set(basename(match[2]), match[1].toLowerCase());
  }
  return sums;
}

/** Download base for the current package version; overridable for mirrors. */
export function releaseBase(env = process.env) {
  return (env.BRAVIA_REMOTE_DOWNLOAD_BASE || RELEASE_BASE).replace(/\/+$/, "");
}

/** The packaged server bundle, falling back to TS source in a repo checkout. */
export function serverEntry() {
  const bundled = fileURLToPath(new URL("../dist/server.js", import.meta.url));
  if (existsSync(bundled)) return bundled;
  const source = fileURLToPath(new URL("../src/server/main.ts", import.meta.url));
  if (existsSync(source)) return source;
  throw new Error("packaged server bundle missing; run `bun run build:npm`");
}

/**
 * When `bunx` runs this Node launcher, the user agent still identifies bunx.
 * Prefer the Bun that invoked us over downloading the standalone binary.
 */
export function bunForBunx(env = process.env, platform = process.platform, exists = existsSync) {
  if (!env.npm_config_user_agent?.startsWith("bun/")) return null;
  if (env.BUN_INSTALL) {
    const candidate = join(env.BUN_INSTALL, "bin", platform === "win32" ? "bun.exe" : "bun");
    if (exists(candidate)) return candidate;
  }
  return "bun";
}

const processReport = () => {
  try {
    return process.report?.getReport?.();
  } catch {
    return undefined;
  }
};

const discard = (path) => {
  try {
    unlinkSync(path);
  } catch {
    // Best-effort cleanup; the destination is only used after a successful rename.
  }
};

/** Stream a response to a temp file and hash it without buffering the binary. */
async function download(response, destination) {
  if (!response.body) throw new Error("download returned an empty body");
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  const hash = createHash("sha256");
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      new Transform({
        transform(chunk, _encoding, callback) {
          hash.update(chunk);
          callback(null, chunk);
        },
      }),
      createWriteStream(temporary, { mode: 0o755 }),
    );
  } catch (error) {
    discard(temporary);
    throw error;
  }
  return { temporary, sha256: hash.digest("hex") };
}

/**
 * Resolve an executable: BRAVIA_REMOTE_BINARY wins, then the cached release
 * binary for this platform (downloaded and checksum-verified on first use).
 */
export async function ensureBinary(env = process.env) {
  if (env.BRAVIA_REMOTE_BINARY) {
    const binary = resolve(env.BRAVIA_REMOTE_BINARY);
    if (!existsSync(binary)) throw new Error(`BRAVIA_REMOTE_BINARY does not exist: ${binary}`);
    return binary;
  }

  const target = resolveTarget(process.platform, process.arch, detectLibc(processReport()));
  if (!target) {
    throw new Error(
      `no prebuilt binary for ${process.platform}-${process.arch}; install Bun and run with \`bunx\`, or set BRAVIA_REMOTE_BINARY`,
    );
  }

  const asset = assetName(target);
  const destination = join(cacheRoot(env), `v${VERSION}`, asset);
  if (existsSync(destination)) return destination;

  const base = releaseBase(env);
  const sumsResponse = await fetch(`${base}/SHA256SUMS`);
  if (!sumsResponse.ok) {
    throw new Error(
      `cannot fetch ${base}/SHA256SUMS (${sumsResponse.status}); set BRAVIA_REMOTE_BINARY to use a local binary`,
    );
  }
  const expected = parseChecksums(await sumsResponse.text()).get(asset);
  if (!expected) throw new Error(`SHA256SUMS at ${base} has no entry for ${asset}`);

  const binaryResponse = await fetch(`${base}/${asset}`);
  if (!binaryResponse.ok) {
    throw new Error(`cannot download ${asset} (${binaryResponse.status} ${binaryResponse.statusText})`);
  }
  const size = Number(binaryResponse.headers.get("content-length") ?? 0);
  console.error(
    `bravia: downloading ${asset}${size > 0 ? ` (${Math.round(size / 1048576)} MB)` : ""} — one-time setup`,
  );
  const { temporary, sha256 } = await download(binaryResponse, destination);
  if (sha256 !== expected) {
    discard(temporary);
    throw new Error(`checksum mismatch for ${asset}; expected ${expected}, got ${sha256}`);
  }
  try {
    chmodSync(temporary, 0o755);
    renameSync(temporary, destination);
  } catch (error) {
    discard(temporary);
    if (!existsSync(destination)) throw error;
  }
  return destination;
}

/** Spawn a child with inherited stdio and mirror its exit status. */
export function run(command, args, env = process.env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        const number = osConstants.signals[signal];
        process.exitCode = number ? 128 + number : 1;
      } else {
        process.exitCode = code ?? 1;
      }
      resolvePromise();
    });
  });
}

/** Entry point used by `bin/bravia-remote.mjs`. */
export async function main(argv = process.argv.slice(2), env = process.env) {
  if (process.versions.bun) {
    await run(process.execPath, [serverEntry(), ...argv], env);
    return;
  }

  const bun = bunForBunx(env);
  if (bun) {
    try {
      await run(bun, [serverEntry(), ...argv], env);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      console.error("bravia: Bun was not found; falling back to the release binary");
    }
  }

  await run(await ensureBinary(env), argv, env);
}
