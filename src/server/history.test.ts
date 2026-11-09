import { describe, expect, test } from "bun:test";
import { AppHistory } from "./history";

describe("AppHistory", () => {
  test("peekBack returns null until two distinct apps exist", () => {
    const h = new AppHistory();
    expect(h.peekBack()).toBeNull();
    h.push("a");
    expect(h.peekBack()).toBeNull();
    h.push("b");
    expect(h.peekBack()).toBe("a");
  });

  test("pushing an existing uri moves it to the newest slot", () => {
    const h = new AppHistory();
    h.push("a");
    h.push("b");
    h.push("a");
    // Newest order: a, b — going back lands on b.
    expect(h.peekBack()).toBe("b");
  });

  test("peek does not mutate; confirmBack moves the target to the newest slot", () => {
    const h = new AppHistory();
    h.push("a");
    h.push("b");
    h.push("c");
    expect(h.peekBack()).toBe("b");
    expect(h.peekBack()).toBe("b"); // still there — peek is read-only
    h.confirmBack("b");
    // b is now newest; going back lands on c.
    expect(h.peekBack()).toBe("c");
    h.confirmBack("c");
    expect(h.peekBack()).toBe("b");
  });

  test("confirmBack of an unknown uri is a no-op push", () => {
    const h = new AppHistory();
    h.push("a");
    h.push("b");
    h.confirmBack("zzz");
    expect(h.peekBack()).toBe("b");
  });

  test("history is capped at 8 entries", () => {
    const h = new AppHistory();
    for (const uri of ["1", "2", "3", "4", "5", "6", "7", "8", "9"]) h.push(uri);
    // Oldest ("1") evicted; back from 9 lands on 8.
    expect(h.peekBack()).toBe("8");
    h.confirmBack("8");
    h.push("2");
    h.push("3");
    h.push("4");
    h.push("5");
    h.push("6");
    h.push("7");
    expect(h.peekBack()).toBe("6");
  });
});
