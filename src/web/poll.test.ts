import { describe, expect, test } from "bun:test";
import type { PairStatus } from "../shared/api";
import type { CustomApp } from "../shared/apps";
import type { PowerStatus } from "./api";
import { initialPollState, type PollFetchers, runPoll, startPollLoop } from "./poll";

const app = (name: string): CustomApp => ({ name, uri: `com.${name}` });

const fetchers = (overrides: Partial<PollFetchers> = {}): PollFetchers => ({
  power: () => Promise.resolve<PowerStatus | null>("active"),
  pair: () => Promise.resolve<PairStatus | undefined>({ nickname: "tv", paired: true }),
  config: () => Promise.resolve<CustomApp[] | undefined>([]),
  codes: () => Promise.resolve<Record<string, string> | undefined>({ Up: "AAAA" }),
  ...overrides,
});

describe("runPoll", () => {
  test("latches an empty config success", async () => {
    let calls = 0;
    const fetch = fetchers({
      config: () => {
        calls += 1;
        return Promise.resolve<CustomApp[] | undefined>([]);
      },
    });
    const first = await runPoll(initialPollState, fetch);
    expect(first.snapshot.config).toEqual([]);
    expect(first.state.configLoaded).toBe(true);
    const second = await runPoll(first.state, fetch);
    expect(second.snapshot.config).toBeUndefined();
    expect(calls).toBe(1);
  });

  test("retries a failed config request", async () => {
    let calls = 0;
    const fetch = fetchers({
      config: () => {
        calls += 1;
        return Promise.resolve<CustomApp[] | undefined>(calls === 1 ? undefined : [app("netflix")]);
      },
    });
    const failed = await runPoll(initialPollState, fetch);
    expect(failed.state.configLoaded).toBe(false);
    expect(failed.snapshot.config).toBeUndefined();
    const retried = await runPoll(failed.state, fetch);
    expect(retried.state.configLoaded).toBe(true);
    expect(retried.snapshot.config).toEqual([app("netflix")]);
    expect(calls).toBe(2);
  });

  test("keeps retrying empty or failed IRCC lists", async () => {
    const results: Array<Record<string, string> | undefined> = [undefined, {}, { Up: "AAAA" }];
    const fetch = fetchers({ codes: () => Promise.resolve(results.shift()) });
    const first = await runPoll(initialPollState, fetch);
    const second = await runPoll(first.state, fetch);
    const third = await runPoll(second.state, fetch);
    expect(first.state.codesLoaded).toBe(false);
    expect(first.snapshot.codes).toBeUndefined();
    expect(second.state.codesLoaded).toBe(false);
    expect(second.snapshot.codes).toBeUndefined();
    expect(third.state.codesLoaded).toBe(true);
    expect(third.snapshot.codes).toEqual({ Up: "AAAA" });
  });

  test("stops polling pair status once the TV is paired", async () => {
    let calls = 0;
    let paired = false;
    const fetch = fetchers({
      pair: () => {
        calls += 1;
        return Promise.resolve<PairStatus | undefined>({ nickname: "tv", paired });
      },
    });
    const unpaired = await runPoll(initialPollState, fetch);
    expect(unpaired.snapshot.paired).toBe(false);
    expect(unpaired.state.pairLoaded).toBe(false);
    paired = true;
    const nowPaired = await runPoll(unpaired.state, fetch);
    expect(nowPaired.snapshot.paired).toBe(true);
    expect(nowPaired.state.pairLoaded).toBe(true);
    const again = await runPoll(nowPaired.state, fetch);
    expect(again.snapshot.paired).toBeUndefined();
    expect(calls).toBe(2);
  });

  test("starts the next phase only after the previous one settles", async () => {
    const config = Promise.withResolvers<CustomApp[] | undefined>();
    const configStarted = Promise.withResolvers<void>();
    let codesStarted = false;
    let settled = false;
    const pending = runPoll(
      initialPollState,
      fetchers({
        config: () => {
          configStarted.resolve();
          return config.promise;
        },
        codes: () => {
          codesStarted = true;
          return Promise.resolve<Record<string, string> | undefined>({ Up: "AAAA" });
        },
      }),
    ).then((result) => {
      settled = true;
      return result;
    });

    await configStarted.promise;
    expect(codesStarted).toBe(false);
    expect(settled).toBe(false);

    config.resolve([]);
    const result = await pending;
    expect(codesStarted).toBe(true);
    expect(result.state.configLoaded).toBe(true);
  });
});

describe("startPollLoop", () => {
  test("schedules the next tick only after the previous tick settles", async () => {
    const gate = Promise.withResolvers<void>();
    const tickStarted = Promise.withResolvers<void>();
    const scheduledSignal = Promise.withResolvers<void>();
    let scheduled = 0;
    const stop = startPollLoop(
      () => {
        tickStarted.resolve();
        return gate.promise;
      },
      {
        schedule: () => {
          scheduled += 1;
          scheduledSignal.resolve();
          return 1;
        },
        cancel: () => {},
      },
    );

    await tickStarted.promise;
    expect(scheduled).toBe(0);
    gate.resolve();
    await scheduledSignal.promise;
    expect(scheduled).toBe(1);
    stop();
  });

  test("stopping cancels a scheduled timer", async () => {
    const scheduledSignal = Promise.withResolvers<void>();
    const cancelled: number[] = [];
    const stop = startPollLoop(() => Promise.resolve(), {
      schedule: () => {
        scheduledSignal.resolve();
        return 42;
      },
      cancel: (id) => cancelled.push(id),
    });
    await scheduledSignal.promise;
    stop();
    expect(cancelled).toEqual([42]);
  });

  test("does not schedule again after stop while a tick is in flight", async () => {
    const gate = Promise.withResolvers<void>();
    const tickStarted = Promise.withResolvers<void>();
    let scheduled = 0;
    const stop = startPollLoop(
      () => {
        tickStarted.resolve();
        return gate.promise;
      },
      {
        schedule: () => {
          scheduled += 1;
          return 1;
        },
        cancel: () => {},
      },
    );
    await tickStarted.promise;
    stop();
    gate.resolve();
    await gate.promise;
    await Promise.resolve();
    expect(scheduled).toBe(0);
  });
});
