import { afterEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanupTempDirs, tempDir } from "../test-support/temp";
import { ConfigError } from "./config";
import { StartupError, start } from "./main";

afterEach(cleanupTempDirs);

/** Run startup to failure; the tests only exercise paths that stop before binding. */
const startupFailure = async (env: Record<string, string | undefined>): Promise<StartupError> => {
  try {
    await start(env);
  } catch (e) {
    if (e instanceof StartupError) return e;
    throw e;
  }
  throw new Error("start() unexpectedly succeeded");
};

describe("start", () => {
  test("propagates configuration errors", async () => {
    const err = await start({}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigError);
  });

  test("reports a corrupt credential file with the delete hint", async () => {
    const dir = await tempDir();
    const authFile = join(dir, "auth.json");
    await writeFile(authFile, "{not json");
    const err = await startupFailure({
      BRAVIA_TV: "http://192.0.2.10",
      BRAVIA_AUTH_FILE: authFile,
      BRAVIA_AUTH_MODE: "none",
    });
    expect(err.message.startsWith(`bravia: cannot read credential file ${authFile} (`)).toBe(true);
    expect(err.message.endsWith("); delete it to start unpaired")).toBe(true);
  });

  test("reports a token file that cannot be created", async () => {
    const dir = await tempDir();
    const blocker = join(dir, "blocker");
    await writeFile(blocker, "x");
    const tokenFile = join(blocker, "token");
    const err = await startupFailure({
      BRAVIA_TV: "http://192.0.2.10",
      BRAVIA_AUTH_FILE: join(dir, "auth.json"),
      BRAVIA_TOKEN_FILE: tokenFile,
    });
    expect(
      err.message.startsWith(`bravia: cannot initialize authentication (cannot create token file ${tokenFile}`),
    ).toBe(true);
  });
});
