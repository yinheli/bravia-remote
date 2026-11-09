/**
 * /api/screen tests driven by a fake `adb` shell script, covering the
 * adb-missing and too-small error paths plus the success pipeline. No real
 * adb and no real TV involved.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanupTempDirs, tempDir } from "../../test-support/temp";
import { type AppContext, createApp } from "../app";
import { parseConfig } from "../config";
import { CredentialStore } from "../credentials";
import { AppHistory } from "../history";

/** Write an executable fake `adb` whose screencap output is `stdout`, exiting with `exitCode`. */
const fakeAdb = async (stdout: string, exitCode = 0, sleep = ""): Promise<string> => {
  const dir = await tempDir("bravia-screen-");
  const adb = join(dir, "adb");
  await writeFile(
    adb,
    `#!/bin/sh\nif [ "$1" = "connect" ]; then exit 0; fi\n${sleep}printf '${stdout}'\nexit ${exitCode}\n`,
  );
  await chmod(adb, 0o755);
  return adb;
};

const dataDir = await tempDir("bravia-screen-ctx-");

const ctxWith = async (
  adbPath: string,
  screenTimeoutMs = 9000,
  tvUrl = "http://127.0.0.1:1",
): Promise<{ handle: (req: Request) => Response | Promise<Response> }> => {
  const credentials = await CredentialStore.open(join(dataDir, "auth.json"), {
    clientId: "cid",
    nickname: "host",
    psk: null,
  });
  const config = parseConfig({
    BRAVIA_TV: tvUrl,
    BRAVIA_AUTH_FILE: join(dataDir, "auth.json"),
    BRAVIA_ADB: adbPath,
    BRAVIA_SCREEN_TIMEOUT_MS: String(screenTimeoutMs),
  });
  return {
    handle: createApp(
      {
        config,
        credentials,
        tv: {} as AppContext["tv"],
        history: new AppHistory(),
      },
      { mode: "none" },
    ),
  };
};

afterAll(cleanupTempDirs);

describe("GET /api/screen", () => {
  test("missing adb binary answers the adb-missing machine code", async () => {
    const { handle } = await ctxWith("/nonexistent/adb-path/adb");
    const r = await handle(new Request("http://app.test/api/screen"));
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ ok: false, error: "adb-missing", bytes: null });
  });

  test("undersized screencap output answers too-small with the byte count", async () => {
    const { handle } = await ctxWith(await fakeAdb("tiny"));
    const r = await handle(new Request("http://app.test/api/screen"));
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ ok: false, error: "too-small", bytes: 4 });
  });

  test("valid PNG output streams with image/png and no-store", async () => {
    // 200 filler bytes is still below 1000 — emit a 1200-byte body instead.
    const { handle } = await ctxWith(await fakeAdb("x".repeat(1200)));
    const r = await handle(new Request("http://app.test/api/screen"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect((await r.arrayBuffer()).byteLength).toBe(1200);
  });

  test("non-zero screencap exit answers the screencap-failed machine code", async () => {
    const { handle } = await ctxWith(await fakeAdb("x".repeat(1200), 3));
    const r = await handle(new Request("http://app.test/api/screen"));
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ ok: false, error: "screencap-failed", bytes: null });
  });

  test("a hung adb answers timeout once the configured bound elapses", async () => {
    const { handle } = await ctxWith(await fakeAdb("x".repeat(1200), 0, "sleep 5;"), 200);
    const r = await handle(new Request("http://app.test/api/screen"));
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ ok: false, error: "timeout", bytes: null });
  }, 10000);

  test("concurrent captures coalesce into one adb run", async () => {
    const dir = await tempDir("bravia-screen-count-");
    const counter = join(dir, "count");
    const adb = join(dir, "adb");
    await writeFile(
      adb,
      `#!/bin/sh\nif [ "$1" = "connect" ]; then exit 0; fi\necho x >> "${counter}"\nprintf '${"x".repeat(1200)}'\n`,
    );
    await chmod(adb, 0o755);
    const { handle } = await ctxWith(adb);
    const [a, b] = await Promise.all([
      handle(new Request("http://app.test/api/screen")),
      handle(new Request("http://app.test/api/screen")),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect((await a.arrayBuffer()).byteLength).toBe(1200);
    expect((await b.arrayBuffer()).byteLength).toBe(1200);
    expect((await readFile(counter, "utf8")).trim().split("\n")).toHaveLength(1);
  });

  test("separate app contexts do not share an in-flight capture", async () => {
    const [first, second] = await Promise.all([
      ctxWith(await fakeAdb("A".repeat(1200))),
      ctxWith(await fakeAdb("B".repeat(1200))),
    ]);
    const [a, b] = await Promise.all([
      first.handle(new Request("http://app.test/api/screen")),
      second.handle(new Request("http://app.test/api/screen")),
    ]);
    expect(await a.text()).toBe("A".repeat(1200));
    expect(await b.text()).toBe("B".repeat(1200));
  });

  test("IPv6 TV hosts keep brackets in the adb serial", async () => {
    const dir = await tempDir("bravia-screen-ipv6-");
    const args = join(dir, "args");
    const adb = join(dir, "adb");
    await writeFile(
      adb,
      `#!/bin/sh\necho "$@" >> "${args}"\nif [ "$1" = "connect" ]; then exit 0; fi\nprintf '${"x".repeat(1200)}'\n`,
    );
    await chmod(adb, 0o755);
    const { handle } = await ctxWith(adb, 9000, "http://[::1]:1");
    expect((await handle(new Request("http://app.test/api/screen"))).status).toBe(200);
    const lines = (await readFile(args, "utf8")).trim().split("\n");
    expect(lines[0]).toBe("connect [::1]:5555");
    expect(lines[1]).toBe("-s [::1]:5555 exec-out screencap -p");
  });
});
