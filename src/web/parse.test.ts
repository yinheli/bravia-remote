import { describe, expect, test } from "bun:test";
import type { InputInfo } from "../shared/bravia";
import { t } from "./i18n";
import { errText, inputDisplayName, parseInfo } from "./parse";

const infoFixture = {
  power: { result: [{ status: "standby" }] },
  iface: { result: [{ modelName: "XR-55A80K", productName: "Sony", interfaceVersion: "1.0" }] },
  inputs: { result: [[{ uri: "hdmi1", title: "PS5", connection: true }, { broken: true }]] },
  volume: { result: [[{ target: "speaker", volume: 22, mute: false }, { broken: true }]] },
  playing: { result: [{ title: "Movie", source: "hdmi:1" }] },
  time: { result: ["2026-01-01 12:00:00"] },
  powerSaving: { result: [{ mode: "off" }] },
};

describe("parseInfo", () => {
  test("maps a full payload", () => {
    const v = parseInfo(infoFixture);
    expect(v.power).toEqual({ status: "standby" });
    expect(v.model).toBe("XR-55A80K");
    expect(v.product).toBe("Sony");
    expect(v.ifaceVer).toBe("1.0");
    expect(v.powerSaving).toBe("off");
    expect(v.time).toBe("2026-01-01 12:00:00");
    expect(v.playing).toEqual({ title: "Movie", source: "hdmi:1" });
    expect(v.vols).toEqual([{ target: "speaker", volume: 22, mute: false }]);
    expect(v.inputs).toEqual([{ uri: "hdmi1", title: "PS5", connection: true }]);
    expect(v.pwErr).toBeUndefined();
    expect(v.volErr).toBeUndefined();
    expect(v.playErr).toBeUndefined();
    expect(v.inErr).toBeUndefined();
    expect(v.raw).toBe(infoFixture);
  });

  test("keeps the optional label field", () => {
    const v = parseInfo({
      inputs: {
        result: [[{ uri: "extInput:composite?port=1", title: "视频信号 1", label: "", connection: true }]],
      },
    });
    expect(v.inputs).toEqual([{ uri: "extInput:composite?port=1", title: "视频信号 1", label: "", connection: true }]);
  });

  test("attaches protocol errors", () => {
    const v = parseInfo({ power: { error: [40005, "standby"] }, volume: { error: [7, "none"] } });
    expect(v.pwErr).toEqual([40005, "standby"]);
    expect(v.volErr).toEqual([7, "none"]);
    expect(v.power).toBeUndefined();
    expect(v.vols).toEqual([]);
  });

  test("drops malformed entries instead of rendering empty rows", () => {
    const v = parseInfo({ volume: { result: [[{ target: "speaker" }, { broken: true }]] } });
    expect(v.vols).toEqual([]);
    expect(v.inputs).toEqual([]);
    expect(v.time).toBeUndefined();
  });

  test("keeps a string time value only", () => {
    expect(parseInfo({ time: { result: ["2026"] } }).time).toBe("2026");
    expect(parseInfo({ time: { result: [42] } }).time).toBeUndefined();
  });
});

describe("inputDisplayName", () => {
  const input = (over: Partial<InputInfo>): InputInfo => ({
    uri: "extInput:hdmi?port=1",
    title: "HDMI 1",
    connection: true,
    ...over,
  });

  test("prefers a user-set label over the TV default title", () => {
    const inp = input({ uri: "extInput:composite?port=1", title: "视频信号 1", label: "PS5" });
    expect(inputDisplayName(inp)).toBe("PS5");
  });

  test("shows the TV title verbatim, including its own numbering", () => {
    expect(inputDisplayName(input({ uri: "extInput:component?port=1", title: "视频信号 2/分量信号" }))).toBe(
      "视频信号 2/分量信号",
    );
    expect(inputDisplayName(input({ title: "HDMI 3/ARC" }))).toBe("HDMI 3/ARC");
    expect(inputDisplayName(input({ title: "Screen Mirroring" }))).toBe("Screen Mirroring");
  });
});

describe("errText", () => {
  test("maps each code class to its localized message", () => {
    expect(errText([40005, "x"])).toBe(t("errStandby"));
    expect(errText([7, "x"])).toBe(t("errNoContent"));
    expect(errText([403, "x"])).toBe(t("errPairingNeeded"));
    expect(errText([99, "x"])).toBe(t("errUnavailable", { code: 99 }));
    expect(errText(undefined)).toBe("");
  });
});
