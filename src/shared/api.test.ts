import { describe, expect, test } from "bun:test";
import {
  parseAuthResult,
  parseCodeInfos,
  parseCustomApps,
  parseOkResult,
  parsePairActionResult,
  parsePairStatus,
  parseScreenError,
} from "./api";

describe("HTTP response parsers", () => {
  test("pair status and action fields are validated", () => {
    expect(parsePairStatus({ nickname: "living-room", paired: true })).toEqual({
      nickname: "living-room",
      paired: true,
    });
    expect(parsePairStatus("not an object")).toBeUndefined();
    expect(parsePairActionResult({ needKey: true, code: 40003 })).toEqual({
      paired: undefined,
      needKey: true,
      code: 40003,
      error: undefined,
    });
    expect(parsePairActionResult({ error: ["auth", "bad key"] }).error).toEqual(["auth", "bad key"]);
  });

  test("ok and error responses distinguish string and protocol errors", () => {
    expect(parseOkResult({ ok: true })).toEqual({ ok: true, error: undefined });
    expect(parseOkResult({ ok: false, error: "unsupported" })).toEqual({
      ok: false,
      error: "unsupported",
    });
    expect(parseOkResult({ ok: false, error: [403, "auth"] }).error).toEqual([403, "auth"]);
    expect(parseOkResult(null)).toEqual({ ok: false });
  });

  test("custom app and code lists drop malformed entries", () => {
    expect(
      parseCustomApps({
        apps: [{ name: "A", uri: "com.a" }, { name: 1, uri: "com.b" }, { name: "C" }, null],
      }),
    ).toEqual([{ name: "A", uri: "com.a" }]);
    expect(parseCustomApps({ apps: [] })).toEqual([]);
    expect(parseCustomApps({ ok: false, error: "unknown" })).toBeUndefined();
    expect(parseCustomApps(null)).toBeUndefined();
    expect(parseCodeInfos([{ name: "Up", code: "AAAA" }, { name: "", code: "x" }, { code: "y" }])).toEqual([
      { name: "Up", code: "AAAA" },
    ]);
  });

  test("screen errors and auth modes are typed", () => {
    expect(parseScreenError({ error: "too-small", bytes: 12 })).toEqual({ code: "too-small", bytes: 12 });
    expect(parseScreenError({ ok: false, error: ["forbidden"] })).toEqual({ code: "forbidden", bytes: undefined });
    expect(parseScreenError({ error: [401, "auth"] })).toEqual({ code: "401", bytes: undefined });
    expect(parseScreenError({ bytes: null })).toEqual({ code: undefined, bytes: undefined });
    expect(parseAuthResult({ ok: true, mode: "token" })).toEqual({ ok: true, mode: "token" });
    expect(parseAuthResult({ ok: true, mode: "other" })).toBeUndefined();
  });
});
