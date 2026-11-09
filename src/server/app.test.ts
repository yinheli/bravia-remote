import { describe, expect, test } from "bun:test";
import { ROUTE_MANIFEST } from "./app";

/** `| route | method | ... |` rows of the AGENTS.md HTTP API table. */
const documentedRoutes = (doc: string): string[] => {
  const routes: string[] = [];
  for (const line of doc.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    const path = cells[1]?.replaceAll("`", "");
    const method = cells[2];
    if (path?.startsWith("/api/") && method) routes.push(`${method} ${path}`);
  }
  return routes.sort();
};

describe("AGENTS.md HTTP API table", () => {
  test("mirrors the server route manifest", async () => {
    const doc = await Bun.file(new URL("../../AGENTS.md", import.meta.url)).text();
    const manifest = ROUTE_MANIFEST.map(({ method, path }) => `${method} ${path}`).sort();
    expect(documentedRoutes(doc)).toEqual(manifest);
  });
});
