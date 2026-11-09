/**
 * AppShell poll plan (pure).
 *
 * Status is fetched on every tick. Pairing is fetched until the TV reports
 * itself paired, and config/IRCC codes are fetched until one successful
 * response latches them. Failures stay pending and retry on the next tick; an
 * empty config list is a real result, not a failure.
 */

import type { PairStatus } from "../shared/api";
import type { CustomApp } from "../shared/apps";
import type { PowerStatus } from "./api";

/** Header/status refresh cadence; the next tick starts after this settles. */
const POLL_INTERVAL_MS = 6000;

export type PollState = {
  readonly configLoaded: boolean;
  readonly codesLoaded: boolean;
  readonly pairLoaded: boolean;
};

export const initialPollState: PollState = {
  configLoaded: false,
  codesLoaded: false,
  pairLoaded: false,
};

/** Values to publish for this tick; absent fields mean "no new result". */
export type PollSnapshot = {
  readonly status: PowerStatus | null;
  readonly paired?: boolean;
  readonly config?: readonly CustomApp[];
  readonly codes?: Readonly<Record<string, string>>;
};

export type PollFetchers = {
  readonly power: () => Promise<PowerStatus | null>;
  readonly pair: () => Promise<PairStatus | undefined>;
  readonly config: () => Promise<CustomApp[] | undefined>;
  readonly codes: () => Promise<Record<string, string> | undefined>;
};

export type PollTick = { readonly state: PollState; readonly snapshot: PollSnapshot };

/** Run one sequential tick: status/pair in parallel, then config, then codes. */
export const runPoll = async (state: PollState, fetchers: PollFetchers): Promise<PollTick> => {
  let next = state;
  const [status, pair] = await Promise.all([fetchers.power(), state.pairLoaded ? undefined : fetchers.pair()]);
  let paired: boolean | undefined;
  let config: readonly CustomApp[] | undefined;
  let codes: Readonly<Record<string, string>> | undefined;
  if (pair !== undefined) {
    paired = pair.paired;
    if (pair.paired) next = { ...next, pairLoaded: true };
  }
  if (!next.configLoaded) {
    const apps = await fetchers.config();
    if (apps !== undefined) {
      config = apps;
      next = { ...next, configLoaded: true };
    }
  }
  if (!next.codesLoaded) {
    const remote = await fetchers.codes();
    // An empty list means the TV/parser gave us nothing useful; retry it.
    if (remote !== undefined && Object.keys(remote).length > 0) {
      codes = remote;
      next = { ...next, codesLoaded: true };
    }
  }
  return { state: next, snapshot: { status, paired, config, codes } };
};

export type PollScheduler = {
  readonly schedule: (tick: () => void, delayMs: number) => number;
  readonly cancel: (id: number) => void;
};

/**
 * Start the non-overlapping poll loop; returns a stop function. The next tick
 * is scheduled only after the previous one settles, so a slow request can
 * never overlap and publish stale state over a newer result.
 */
export const startPollLoop = (tick: () => Promise<void>, scheduler: PollScheduler): (() => void) => {
  let stopped = false;
  let timer: number | undefined;
  const run = async (): Promise<void> => {
    try {
      await tick();
    } catch {
      // A transient parser/network failure must not stop the poll loop.
    } finally {
      if (!stopped) timer = scheduler.schedule(() => void run(), POLL_INTERVAL_MS);
    }
  };
  void run();
  return () => {
    stopped = true;
    if (timer !== undefined) scheduler.cancel(timer);
  };
};
