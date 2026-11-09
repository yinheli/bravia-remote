/**
 * MRU history of apps launched through this service (newest last), powering
 * the "previous app" fallback button.
 */
const MAX_HISTORY = 8;

export class AppHistory {
  readonly #items: string[] = [];

  /** Record a launch: move `uri` to the newest slot, capped at MAX_HISTORY. */
  push(uri: string): void {
    const i = this.#items.indexOf(uri);
    if (i >= 0) this.#items.splice(i, 1);
    this.#items.push(uri);
    if (this.#items.length > MAX_HISTORY) this.#items.shift();
  }

  /**
   * The app to return to (the one launched just before the current one).
   * Does not mutate state; call `confirmBack` after the TV accepted the switch.
   * Null when there is nothing to fall back to.
   */
  peekBack(): string | null {
    return this.#items.at(-2) ?? null;
  }

  /** Move `uri` to the newest slot after a successful back-navigation. */
  confirmBack(uri: string): void {
    const i = this.#items.indexOf(uri);
    if (i >= 0) this.#items.splice(i, 1);
    this.#items.push(uri);
  }
}
