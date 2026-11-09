import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assetName,
  bunForBunx,
  cacheRoot,
  detectLibc,
  ensureBinary,
  parseChecksums,
  RELEASE_BASE,
  releaseBase,
  resolveTarget,
  VERSION,
} from "./launcher.mjs";

const processReport = () => {
  try {
    return process.report?.getReport?.();
  } catch {
    return undefined;
  }
};

const currentTarget = () => resolveTarget(process.platform, process.arch, detectLibc(processReport()));

const withServer = async (handler, fn) => {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

describe("target selection", () => {
  test("maps supported platforms and libc variants", () => {
    expect(resolveTarget("linux", "x64", "glibc")).toBe("linux-x64");
    expect(resolveTarget("linux", "x64", "musl")).toBe("linux-x64-musl");
    expect(resolveTarget("linux", "arm64", "glibc")).toBe("linux-arm64");
    expect(resolveTarget("darwin", "x64", "glibc")).toBe("darwin-x64");
    expect(resolveTarget("darwin", "arm64", "glibc")).toBe("darwin-arm64");
    expect(resolveTarget("win32", "x64", "glibc")).toBe("windows-x64");
  });

  test("returns null for unsupported combinations", () => {
    expect(resolveTarget("linux", "arm64", "musl")).toBeNull();
    expect(resolveTarget("linux", "ia32", "glibc")).toBeNull();
    expect(resolveTarget("darwin", "ia32", "glibc")).toBeNull();
    expect(resolveTarget("win32", "arm64", "glibc")).toBeNull();
    expect(resolveTarget("freebsd", "x64", "glibc")).toBeNull();
  });

  test("names the Windows artifact with .exe", () => {
    expect(assetName("linux-x64")).toBe("bravia-remote-linux-x64");
    expect(assetName("windows-x64")).toBe("bravia-remote-windows-x64.exe");
  });

  test("detects glibc and musl from process.report or Alpine", () => {
    expect(detectLibc({ header: { glibcVersionRuntime: "2.39" } }, true)).toBe("glibc");
    expect(detectLibc({ header: {} }, false)).toBe("musl");
    expect(detectLibc(undefined, true)).toBe("musl");
    expect(detectLibc(undefined, false)).toBe("glibc");
  });
});

describe("paths and checksums", () => {
  test("parses sha256sum output and ignores malformed lines", () => {
    const sums = parseChecksums(
      `${"a".repeat(64)}  bravia-remote-linux-x64\r\n${"B".repeat(64)} *bravia-remote-windows-x64.exe\nnot a checksum\n`,
    );
    expect(sums.get("bravia-remote-linux-x64")).toBe("a".repeat(64));
    expect(sums.get("bravia-remote-windows-x64.exe")).toBe("b".repeat(64));
    expect(sums.size).toBe(2);
  });

  test("uses a platform-specific cache directory", () => {
    expect(cacheRoot({ BRAVIA_REMOTE_CACHE: "/tmp/cache" }, "linux", "/home/u")).toBe("/tmp/cache");
    expect(cacheRoot({}, "linux", "/home/u")).toBe("/home/u/.cache/bravia-remote");
    expect(cacheRoot({ XDG_CACHE_HOME: "/xdg" }, "linux", "/home/u")).toBe("/xdg/bravia-remote");
    expect(cacheRoot({}, "darwin", "/Users/u")).toBe("/Users/u/Library/Caches/bravia-remote");
    expect(cacheRoot({ LOCALAPPDATA: join("C:", "data") }, "win32", join("C:", "home"))).toBe(
      join("C:", "data", "bravia-remote"),
    );
  });

  test("builds release URLs and honors a mirror override", () => {
    expect(releaseBase({})).toBe(RELEASE_BASE);
    expect(RELEASE_BASE).toContain("github.com/yinheli/bravia-remote/releases");
    expect(releaseBase({ BRAVIA_REMOTE_DOWNLOAD_BASE: "https://mirror.test/bravia/" })).toBe(
      "https://mirror.test/bravia",
    );
  });

  test("prefers the Bun that invoked bunx", () => {
    expect(bunForBunx({ npm_config_user_agent: "npm/11 node/v22 linux x64" })).toBeNull();
    expect(
      bunForBunx({ npm_config_user_agent: "bun/1.4.4 npm/? node/v22", BUN_INSTALL: "/opt/bun" }, "linux", () => true),
    ).toBe(join("/opt/bun", "bin", "bun"));
    expect(bunForBunx({ npm_config_user_agent: "bun/1.4.4" }, "linux", () => false)).toBe("bun");
  });
});

describe("binary resolution", () => {
  test("honors BRAVIA_REMOTE_BINARY and reports missing files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bravia-launcher-"));
    try {
      const binary = join(dir, "bravia-remote");
      await writeFile(binary, "#!/bin/sh\n");
      expect(await ensureBinary({ BRAVIA_REMOTE_BINARY: binary })).toBe(binary);
      await expect(ensureBinary({ BRAVIA_REMOTE_BINARY: join(dir, "missing") })).rejects.toThrow(/does not exist/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("downloads, verifies, caches and reuses the release binary", async () => {
    const target = currentTarget();
    if (!target) return;
    const asset = assetName(target);
    const payload = "#!/bin/sh\nexit 0\n";
    const digest = createHash("sha256").update(payload).digest("hex");
    const dir = await mkdtemp(join(tmpdir(), "bravia-launcher-"));
    let requests = 0;
    try {
      const first = await withServer(
        (request, response) => {
          requests += 1;
          if (request.url === "/SHA256SUMS") return response.end(`${digest}  ${asset}\n`);
          if (request.url === `/${asset}`) return response.end(payload);
          response.statusCode = 404;
          response.end("not found");
        },
        async (base) => {
          const env = { BRAVIA_REMOTE_CACHE: dir, BRAVIA_REMOTE_DOWNLOAD_BASE: base };
          const binary = await ensureBinary(env);
          expect(await readFile(binary, "utf8")).toBe(payload);
          if (process.platform !== "win32") expect((await stat(binary)).mode & 0o111).not.toBe(0);
          expect(await ensureBinary(env)).toBe(binary);
          return binary;
        },
      );
      expect(first.startsWith(dir)).toBe(true);
      expect(requests).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects a mismatched checksum without leaving a binary behind", async () => {
    const target = currentTarget();
    if (!target) return;
    const asset = assetName(target);
    const dir = await mkdtemp(join(tmpdir(), "bravia-launcher-"));
    try {
      const rejection = withServer(
        (request, response) => {
          if (request.url === "/SHA256SUMS") return response.end(`${"0".repeat(64)}  ${asset}\n`);
          if (request.url === `/${asset}`) return response.end("#!/bin/sh\n");
          response.statusCode = 404;
          response.end("not found");
        },
        (base) => ensureBinary({ BRAVIA_REMOTE_CACHE: dir, BRAVIA_REMOTE_DOWNLOAD_BASE: base }),
      );
      await expect(rejection).rejects.toThrow(/checksum mismatch/);
      expect(existsSync(join(dir, `v${VERSION}`, asset))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
