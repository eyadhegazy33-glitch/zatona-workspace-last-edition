import { describe, expect, it } from "vitest";
import { getSecondsLeft, getTimerState } from "./timerMath";

describe("server-offset timer calculations", () => {
  const now = Date.parse("2025-01-01T12:00:00.000Z");
  const deadline = "2025-01-01T12:10:00.000Z";
  const warningAt = "2025-01-01T12:05:00.000Z";

  it("subtracts the server clock offset from time remaining", () => {
    expect(getSecondsLeft(deadline, now, 2_000)).toBe(598);
  });

  it("uses server time to determine ok, warning, and overdue states", () => {
    expect(getTimerState(deadline, warningAt, now, 0)).toBe("ok");
    expect(getTimerState(deadline, warningAt, now, 6 * 60_000)).toBe("warning");
    expect(getTimerState(deadline, warningAt, now, 10 * 60_000)).toBe("overdue");
  });
});
