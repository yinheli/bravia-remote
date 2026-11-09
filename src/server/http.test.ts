import { describe, expect, test } from "bun:test";
import { allowedOrigins, assertAllowedHost, displayHost, ForbiddenError, isWildcardHost } from "./http";

describe("listen host helpers", () => {
  test("recognizes wildcard and empty listen addresses", () => {
    for (const host of ["", "0.0.0.0", "::", "*"]) expect(isWildcardHost(host)).toBe(true);
    for (const host of ["127.0.0.1", "192.0.2.5", "::1", "[::1]", "tv.local"]) expect(isWildcardHost(host)).toBe(false);
  });

  test("renders URL-ready hosts", () => {
    for (const host of ["", "0.0.0.0", "::", "*"]) expect(displayHost(host)).toBe("localhost");
    expect(displayHost("127.0.0.1")).toBe("127.0.0.1");
    expect(displayHost("tv.local")).toBe("tv.local");
    expect(displayHost("::1")).toBe("[::1]");
    expect(displayHost("[::1]")).toBe("[::1]");
  });

  test("allowedOrigins never advertises a wildcard bind", () => {
    const loopback = ["http://localhost:8765", "http://127.0.0.1:8765", "http://[::1]:8765"];
    expect(allowedOrigins("0.0.0.0", 8765)).toEqual(loopback);
    expect(allowedOrigins("", 8765)).toEqual(loopback);
    expect(allowedOrigins("*", 8765)).toEqual(loopback);
    expect(allowedOrigins("::1", 8765)).toEqual(loopback);
    expect(allowedOrigins("192.0.2.5", 8765)).toEqual([...loopback, "http://192.0.2.5:8765"]);
  });

  test("assertAllowedHost skips wildcard binds only", () => {
    const req = new Request("http://anything.example:8765/api/status", {
      headers: { host: "anything.example:8765" },
    });
    for (const host of ["", "0.0.0.0", "::", "*"]) expect(() => assertAllowedHost(req, host)).not.toThrow();
    expect(() => assertAllowedHost(req, "192.0.2.5")).toThrow(ForbiddenError);
    expect(() => assertAllowedHost(req, "127.0.0.1")).toThrow(ForbiddenError);
  });
});
