/** Map the typed /api/info payload to view models and localized errors. */
import {
  type ApiError,
  type InfoPayload,
  type InputInfo,
  parseInfoPayload,
  parseInputInfos,
  parseInterfaceInfo,
  parsePlayingContent,
  parsePowerSaving,
  parsePowerStatus,
  parseTime,
  parseVolumeInfos,
  type RpcError,
  type VolumeInfo,
} from "../shared/bravia";
import { t } from "./i18n";

export type InfoView = {
  raw: unknown;
  power?: { status: string };
  model?: string;
  product?: string;
  ifaceVer?: string;
  powerSaving?: string;
  time?: string;
  playing?: { title?: string; source?: string };
  vols: VolumeInfo[];
  inputs: InputInfo[];
  pwErr?: RpcError;
  volErr?: RpcError;
  playErr?: RpcError;
  inErr?: RpcError;
};

/** Map protocol error codes to localized user-facing text. */
export const errText = (e?: RpcError | ApiError): string =>
  !e
    ? ""
    : e[0] === 40005
      ? t("errStandby")
      : e[0] === 504
        ? t("errConnectTv")
        : e[0] === 7
          ? t("errNoContent")
          : e[0] === 403
            ? t("errPairingNeeded")
            : t("errUnavailable", { code: e[0] });

/**
 * Display name for an external input. The TV names these itself (in its own
 * language and numbering) and puts a user rename in `label`; show the TV text
 * verbatim. Machine translation is deliberately not attempted: models localize
 * and number inputs differently, and a guessed name can be worse than the
 * original.
 */
export function inputDisplayName(inp: InputInfo): string {
  const label = inp.label?.trim();
  return label || inp.title;
}

const empty = (raw: unknown): InfoView => ({ raw, vols: [], inputs: [] });

export function parseInfo(raw: unknown): InfoView {
  const info: InfoPayload | undefined = parseInfoPayload(raw);
  if (!info) return empty(raw);

  const power = parsePowerStatus(info.power.result?.[0]);
  const iface = parseInterfaceInfo(info.iface.result?.[0]);
  const playing = parsePlayingContent(info.playing.result?.[0]);
  const powerSaving = parsePowerSaving(info.powerSaving.result?.[0]);

  return {
    raw,
    power,
    pwErr: info.power.error,
    model: iface?.modelName,
    product: iface?.productName,
    ifaceVer: iface?.interfaceVersion,
    powerSaving: powerSaving?.mode,
    time: parseTime(info.time.result?.[0]),
    playing,
    playErr: info.playing.error,
    vols: parseVolumeInfos(info.volume.result?.[0]),
    volErr: info.volume.error,
    inputs: parseInputInfos(info.inputs.result?.[0]),
    inErr: info.inputs.error,
  };
}
