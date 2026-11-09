import { describe, expect, test } from "bun:test";
import { detectLang, dictionaries, type TKey, t } from "./i18n";

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "");

describe("i18n", () => {
  test("zh and en dictionaries share identical placeholder sets per key", () => {
    const zh = dictionaries.zh;
    const en = dictionaries.en;
    for (const key of Object.keys(zh) as TKey[]) {
      expect(placeholders(en[key]), key).toEqual(placeholders(zh[key]));
      expect(zh[key].length, `zh:${key}`).toBeGreaterThan(0);
      expect(en[key].length, `en:${key}`).toBeGreaterThan(0);
    }
  });
  test("detects the first supported browser language, zh otherwise", () => {
    expect(detectLang(["zh-CN", "en-US"])).toBe("zh");
    expect(detectLang(["en-US", "zh-CN"])).toBe("en");
    expect(detectLang(["fr-FR", "EN-gb"])).toBe("en");
    expect(detectLang(["fr-FR"])).toBe("zh");
    expect(detectLang([])).toBe("zh");
  });

  test("resolves the dictionary for the runtime language", () => {
    // Both languages must produce non-empty output for every key (parity
    // enforced by the type of `en: Record<keyof typeof zh, string>`).
    expect(t("title")).toBeTypeOf("string");
    expect(t("title").length).toBeGreaterThan(0);
    expect(t("pairStart")).toBeTypeOf("string");
  });

  test("fills placeholders", () => {
    const out = t("errSendCode", { code: 7, text: "nope" });
    expect(out).toContain("7");
    expect(out).toContain("nope");
    expect(out).not.toContain("{code}");
    expect(out).not.toContain("{text}");
  });

  test("keeps unknown placeholders visible instead of dropping them", () => {
    expect(t("errSendCode")).toContain("{code}");
  });

  test("every dictionary key renders text (never echoes the raw key)", () => {
    for (const key of Object.keys(dictionaries.zh) as TKey[]) {
      expect(t(key), key).not.toBe(key);
      expect(t(key).length, key).toBeGreaterThan(0);
    }
  });
});
