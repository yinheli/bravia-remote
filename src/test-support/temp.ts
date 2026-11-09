/**
 * Shared temp-directory lifecycle for filesystem-touching tests.
 *
 * Bun runs test files sequentially in one process, so a module-level registry
 * with an explicit per-file `afterEach`/`afterAll` cleanup hook is sufficient;
 * no import-time hook is registered (it would bind to whichever file module
 * instance loaded first).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];

/** Create a tracked temp dir; cleaned by `cleanupTempDirs`. */
export const tempDir = async (prefix = "bravia-test-"): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

/** Create a tracked temp dir and return a file path inside it. */
export const tempFile = async (prefix = "bravia-test-", name = "auth.json"): Promise<string> =>
  join(await tempDir(prefix), name);

/** Remove every tracked temp dir created since the last cleanup. */
export const cleanupTempDirs = async (): Promise<void> => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
};
