import { afterEach, describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { chmod, readFile } from "node:fs/promises";
import { cleanupTempDirs, tempDir, tempFile } from "../test-support/temp";
import { CredentialStore } from "./credentials";

afterEach(cleanupTempDirs);

describe("CredentialStore", () => {
  test("falls back to defaults when no file or explicit client id exists", async () => {
    const store = await CredentialStore.open(await tempFile(), { clientId: "cid", nickname: "host", psk: null });
    expect(store.snapshot).toEqual({ clientId: "cid", nickname: "host", credential: "", cookie: "", psk: null });
    expect(store.paired).toBe(false);
  });

  test("reuses the persisted client id when none is configured", async () => {
    const f = await tempFile();
    await Bun.write(f, JSON.stringify({ clientid: "paired-id", nickname: "n" }));
    const store = await CredentialStore.open(f, { clientId: "default-id", nickname: "fallback", psk: null });
    expect(store.snapshot.clientId).toBe("paired-id");
  });

  test("an explicitly configured client id wins over the persisted one", async () => {
    const f = await tempFile();
    await Bun.write(f, JSON.stringify({ clientid: "paired-id", nickname: "n" }));
    const store = await CredentialStore.open(f, {
      clientId: "env-id",
      clientIdFromEnv: true,
      nickname: "fallback",
      psk: null,
    });
    expect(store.snapshot.clientId).toBe("env-id");
  });

  test("throws loudly on a corrupt file instead of silently resetting", async () => {
    const f = await tempFile();
    await Bun.write(f, "{not json");
    expect(CredentialStore.open(f, { clientId: "cid", nickname: "host", psk: null })).rejects.toThrow();
  });

  test("setPsk persists and reloads", async () => {
    const f = await tempFile();
    const store = await CredentialStore.open(f, { clientId: "cid", nickname: "n", psk: null });
    await store.setPsk("psk-123");
    expect(store.paired).toBe(true);
    const reloaded = await CredentialStore.open(f, { clientId: "cid", nickname: "n", psk: null });
    expect(reloaded.psk).toBe("psk-123");
    expect(reloaded.paired).toBe(true);
  });

  test("persisted JSON has the expected shape", async () => {
    const f = await tempFile();
    const store = await CredentialStore.open(f, { clientId: "cid", nickname: "n", psk: null });
    await store.setPsk("p");
    const raw = JSON.parse(await readFile(f, "utf8")) as Record<string, unknown>;
    expect(raw).toEqual({ clientid: "cid", psk: "p", nickname: "n" });
  });

  test("an explicitly provided PSK wins over the persisted one", async () => {
    const f = await tempFile();
    const first = await CredentialStore.open(f, { clientId: "cid", nickname: "n", psk: null });
    await first.setPsk("old");
    const second = await CredentialStore.open(f, { clientId: "cid", nickname: "n", psk: "new" });
    expect(second.psk).toBe("new");
  });

  test("setRegistration persists credential and cookie", async () => {
    const f = await tempFile();
    const store = await CredentialStore.open(f, { clientId: "cid", nickname: "n", psk: null });
    await store.setRegistration("Basic abc", "auth=xyz");
    const reloaded = await CredentialStore.open(f, { clientId: "cid", nickname: "n", psk: null });
    expect(reloaded.snapshot.credential).toBe("Basic abc");
    expect(reloaded.snapshot.cookie).toBe("auth=xyz");
  });

  test("setNickname persists", async () => {
    const f = await tempFile();
    const store = await CredentialStore.open(f, { clientId: "cid", nickname: "n", psk: null });
    await store.setNickname("living-room");
    const reloaded = await CredentialStore.open(f, { clientId: "cid", nickname: "fallback", psk: null });
    expect(reloaded.nickname).toBe("living-room");
  });

  test("snapshot is a copy, not live state", async () => {
    const store = await CredentialStore.open(await tempFile(), { clientId: "cid", nickname: "n", psk: null });
    const snap = store.snapshot;
    await store.setPsk("changed");
    expect(snap.psk).toBeNull();
  });

  test("concurrent mutations both persist without tmp-file races", async () => {
    const f = await tempFile();
    const store = await CredentialStore.open(f, { clientId: "cid", nickname: "n", psk: null });
    await Promise.all([store.setNickname("concurrent"), store.setPsk("psk")]);
    const reloaded = await CredentialStore.open(f, { clientId: "cid", nickname: "n", psk: null });
    expect(reloaded.nickname).toBe("concurrent");
    expect(reloaded.psk).toBe("psk");
  });

  test("persisted auth file is owner-only (0600)", async () => {
    if (process.platform === "win32") return; // POSIX perms not applicable
    const f = await tempFile();
    const store = await CredentialStore.open(f, { clientId: "cid", nickname: "n", psk: null });
    await store.setPsk("secret");
    expect(statSync(f).mode & 0o777).toBe(0o600);
  });

  test("repairs loose permissions on an existing auth file", async () => {
    if (process.platform === "win32") return; // POSIX perms not applicable
    const f = await tempFile();
    await Bun.write(f, JSON.stringify({ clientid: "cid", nickname: "n" }));
    await chmod(f, 0o644);
    const store = await CredentialStore.open(f, { clientId: "fallback", nickname: "fallback", psk: null });
    expect(store.nickname).toBe("n");
    expect(statSync(f).mode & 0o777).toBe(0o600);
  });

  test("creates missing parent directories on first persist", async () => {
    const dir = await tempDir("bravia-nested-");
    const f = `${dir}/deep/nested/auth.json`;
    const store = await CredentialStore.open(f, { clientId: "cid", nickname: "n", psk: null });
    await store.setPsk("deep");
    expect((await readFile(f, "utf8")).includes("deep")).toBe(true);
  });
});
