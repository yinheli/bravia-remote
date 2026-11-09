/**
 * Pairing credentials (Normal-mode Basic auth + cookie, or PSK), kept in
 * memory and persisted as JSON so restarts stay paired.
 */

import { randomUUID } from "node:crypto";
import { chmod, mkdir, open as openFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { isRecord } from "../shared/parse";

export type Credentials = {
  clientId: string;
  nickname: string;
  /** Authorization header value issued by the TV during Normal-mode pairing */
  credential: string;
  cookie: string;
  psk: string | null;
};

type Persisted = {
  clientid?: string;
  credential?: string;
  cookie?: string;
  psk?: string;
  nickname?: string;
};

const str = (o: Record<string, unknown>, key: string): string | undefined => {
  const value = o[key];
  return typeof value === "string" ? value : undefined;
};

const parsePersisted = (v: unknown): Persisted => {
  if (!isRecord(v)) return {};
  return {
    clientid: str(v, "clientid"),
    credential: str(v, "credential"),
    cookie: str(v, "cookie"),
    psk: str(v, "psk"),
    nickname: str(v, "nickname"),
  };
};

const toPersisted = (c: Credentials): Persisted => ({
  clientid: c.clientId,
  credential: c.credential || undefined,
  cookie: c.cookie || undefined,
  psk: c.psk ?? undefined,
  nickname: c.nickname,
});

export class CredentialStore {
  readonly #file: string;
  #state: Credentials;

  private constructor(file: string, state: Credentials) {
    this.#file = file;
    this.#state = state;
  }

  /**
   * Load persisted credentials, falling back to the provided defaults.
   * A missing file means "never paired"; a corrupt file throws (fail loudly
   * on broken state rather than silently starting over).
   *
   * `clientId` is only a fallback: the id persisted at pairing is reused unless
   * `clientIdFromEnv` marks the configured value as an explicit override, so
   * stored registration credentials keep their original identity.
   */
  static async open(
    file: string,
    defaults: {
      clientId: string;
      /** True when `clientId` comes from explicit configuration (BRAVIA_CLIENT_ID). */
      clientIdFromEnv?: boolean;
      nickname: string;
      psk?: string | null;
    },
  ): Promise<CredentialStore> {
    let saved: Persisted = {};
    if (await Bun.file(file).exists()) {
      // Best-effort repair for an existing file with loose permissions.
      await chmod(file, 0o600).catch((e) => {
        console.error("bravia: failed to restrict auth file permissions:", e);
      });
      saved = parsePersisted(JSON.parse(await Bun.file(file).text()) as unknown);
    }
    const state: Credentials = {
      // Explicit configuration wins; otherwise keep the id the TV paired with.
      clientId: defaults.clientIdFromEnv ? defaults.clientId : saved.clientid || defaults.clientId,
      nickname: saved.nickname || defaults.nickname,
      credential: saved.credential ?? "",
      cookie: saved.cookie ?? "",
      // An explicitly provided (env) PSK wins over the persisted one.
      psk: defaults.psk ?? (saved.psk ? saved.psk : null),
    };
    return new CredentialStore(file, state);
  }

  get snapshot(): Readonly<Credentials> {
    return { ...this.#state };
  }

  get nickname(): string {
    return this.#state.nickname;
  }

  get psk(): string | null {
    return this.#state.psk;
  }

  /** True when any usable auth method is available. */
  get paired(): boolean {
    const s = this.#state;
    return Boolean(s.credential || s.cookie || s.psk);
  }

  async setNickname(nickname: string): Promise<void> {
    this.#state.nickname = nickname;
    await this.#persist();
  }

  async setPsk(psk: string): Promise<void> {
    this.#state.psk = psk;
    await this.#persist();
  }

  async setRegistration(credential: string, cookie: string): Promise<void> {
    this.#state.credential = credential;
    this.#state.cookie = cookie;
    await this.#persist();
  }

  /** Serialized so concurrent mutations never race on the tmp file. */
  #persistChain: Promise<void> = Promise.resolve();

  async #persist(): Promise<void> {
    const run = this.#persistChain.then(() => this.#writeOnce());
    this.#persistChain = run.catch(() => {});
    await run;
  }

  /** Persist atomically (unique temp + rename) so a crash never leaves a
   * torn auth.json behind, with owner-only permissions from creation on. */
  async #writeOnce(): Promise<void> {
    await mkdir(dirname(this.#file), { recursive: true, mode: 0o700 }).catch(() => {});
    const tmp = `${this.#file}.${randomUUID()}.tmp`;
    // `wx` + mode 0600 means the secret is never briefly world-readable.
    try {
      const handle = await openFile(tmp, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(toPersisted(this.#state)));
      } finally {
        await handle.close();
      }
    } catch (e) {
      await rm(tmp, { force: true }).catch(() => {});
      throw e;
    }
    await chmod(tmp, 0o600).catch((e) => {
      console.error("bravia: failed to restrict auth file permissions:", e);
    });
    await rename(tmp, this.#file);
    await rm(tmp, { force: true }).catch(() => {});
  }
}
