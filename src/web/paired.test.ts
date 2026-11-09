import { describe, expect, test } from "bun:test";
import type { PairStatus } from "../shared/api";
import type { CustomApp } from "../shared/apps";
import type { PowerStatus } from "./api";
import { applyPollPaired, confirmPaired, initialPairedBadge, type PairedBadge } from "./paired";
import { initialPollState, type PollFetchers, type PollState, runPoll } from "./poll";

const fetchers = (pair: () => Promise<PairStatus | undefined>): PollFetchers => ({
  power: () => Promise.resolve<PowerStatus | null>("active"),
  pair,
  config: () => Promise.resolve<CustomApp[] | undefined>([]),
  codes: () => Promise.resolve<Record<string, string> | undefined>({ Up: "AAAA" }),
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const status = (paired: boolean): PairStatus => ({ nickname: "tv", paired });

/** Resolve the in-flight tick and publish its pair result through the guard. */
const settleTick = async (
  tick: ReturnType<typeof runPoll>,
  badge: PairedBadge,
  tickGeneration: number,
): Promise<{ badge: PairedBadge; state: PollState }> => {
  const { state, snapshot } = await tick;
  if (snapshot.paired === undefined) throw new Error("expected a pair result");
  return { badge: applyPollPaired(badge, snapshot.paired, tickGeneration), state };
};

describe("paired badge ownership", () => {
  test("a poll result in flight when the dialog confirms pairing cannot overwrite it", async () => {
    const pair = deferred<PairStatus | undefined>();
    let badge = initialPairedBadge(false);
    const tickGeneration = badge.generation;
    const tick = runPoll(
      initialPollState,
      fetchers(() => pair.promise),
    );

    badge = confirmPaired(badge, true); // dialog success
    pair.resolve(status(false)); // response predates the pairing

    const settled = await settleTick(tick, badge, tickGeneration);
    expect(settled.badge.paired).toBe(true);
  });

  test("a poll result in flight when the dialog starts re-pairing cannot restore the badge", async () => {
    const pair = deferred<PairStatus | undefined>();
    let badge = initialPairedBadge(true);
    const tickGeneration = badge.generation;
    const tick = runPoll(
      initialPollState,
      fetchers(() => pair.promise),
    );

    badge = confirmPaired(badge, false); // re-pair clears the confirmation
    pair.resolve(status(true)); // response predates the re-pair

    const settled = await settleTick(tick, badge, tickGeneration);
    expect(settled.badge.paired).toBe(false);
  });

  test("a tick started after the dialog write is still applied", async () => {
    // Re-pair clears the badge locally; a poll that starts afterwards is newer
    // than the dialog's transition and may publish the TV's actual state.
    const badge = confirmPaired(initialPairedBadge(true), false);
    const tickGeneration = badge.generation;
    const pair = deferred<PairStatus | undefined>();
    const tick = runPoll(
      initialPollState,
      fetchers(() => pair.promise),
    );

    pair.resolve(status(true));
    const settled = await settleTick(tick, badge, tickGeneration);
    expect(settled.badge.paired).toBe(true);
    expect(settled.state.pairLoaded).toBe(true);
  });

  test("a no-op dialog write leaves in-flight poll results publishable", () => {
    const badge = initialPairedBadge(false);
    expect(confirmPaired(badge, false)).toBe(badge);
  });
});
