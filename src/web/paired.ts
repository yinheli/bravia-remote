/**
 * Paired badge state (pure).
 *
 * Two writers publish the header badge: the poll's `/api/pair` result and the
 * pairing dialog's confirmed transitions. A poll result describes the TV when
 * its tick began, so a dialog write during that tick makes the result stale.
 * Each dialog write bumps `generation`; a poll result is applied only when its
 * tick started at the current generation.
 */

export type PairedBadge = {
  readonly paired: boolean;
  readonly generation: number;
};

export const initialPairedBadge = (paired: boolean): PairedBadge => ({ paired, generation: 0 });

/** Confirmed dialog state: it outranks any poll request already in flight. */
export const confirmPaired = (badge: PairedBadge, paired: boolean): PairedBadge =>
  paired === badge.paired ? badge : { paired, generation: badge.generation + 1 };

/** Apply a poll result only when no dialog write happened since the tick began. */
export const applyPollPaired = (badge: PairedBadge, paired: boolean, tickGeneration: number): PairedBadge =>
  tickGeneration === badge.generation && paired !== badge.paired ? { ...badge, paired } : badge;
