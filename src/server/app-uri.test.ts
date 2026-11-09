import { describe, expect, test } from "bun:test";
import { isAppUri } from "../shared/apps";
import { ConfigError, parseConfig } from "./config";
import { BadRequestError } from "./http";
import { parseAppBody } from "./requests";

const TV = "http://192.0.2.10";

/** Both boundaries must agree with the shared grammar for every case. */
const URI_CASES: readonly (readonly [uri: string, valid: boolean])[] = [
  ["com.sony.dtv.com.example.app", true],
  ["com.sony.dtv.bili", true],
  ["http://example.com/app", true],
  ["com.example.app-v2", true],
  ["com.example.app:123", true],
  ["a.b/c:d-e_f", true],
  ["a", true],
  ["", false],
  ["   ", false],
  ["com.example.app?x=1", false],
  ["com.example.app#frag", false],
  ["com.example app", false],
  ["com.example.app%20", false],
  ["com/example/ünïcode", false],
];

const configFor = (uri: string): unknown => parseConfig({ BRAVIA_TV: TV, BRAVIA_APPS: `Test=${uri}` });

describe("app URI grammar", () => {
  test("isAppUri accepts and rejects the shared set", () => {
    for (const [uri, valid] of URI_CASES) expect(isAppUri(uri)).toBe(valid);
  });

  test("config and request parsing accept and reject the same URIs", () => {
    for (const [uri, valid] of URI_CASES) {
      if (valid) {
        expect(parseConfig({ BRAVIA_TV: TV, BRAVIA_APPS: `Test=${uri}` }).customApps).toEqual([{ name: "Test", uri }]);
        expect(parseAppBody({ uri })).toEqual({ back: false, uri });
      } else {
        expect(() => configFor(uri)).toThrow(ConfigError);
        expect(() => parseAppBody({ uri })).toThrow(BadRequestError);
      }
    }
  });

  test("both boundaries trim surrounding whitespace", () => {
    expect(parseConfig({ BRAVIA_TV: TV, BRAVIA_APPS: " Test = com.example.app " }).customApps).toEqual([
      { name: "Test", uri: "com.example.app" },
    ]);
    expect(parseAppBody({ uri: "  com.example.app  " })).toEqual({ back: false, uri: "com.example.app" });
  });

  test("config errors still quote the shared pattern", () => {
    expect(() => configFor("bad uri")).toThrow("where uri matches /^[\\w.:/-]+$/");
  });
});
