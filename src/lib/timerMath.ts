export type TimerState = "ok" | "warning" | "overdue";

export function getTimerState(
  deadline: string,
  warningAt: string,
  clientNow: number,
  serverOffsetMs: number,
): TimerState {
  const serverNow = clientNow + serverOffsetMs;
  if (Date.parse(deadline) <= serverNow) return "overdue";
  if (Date.parse(warningAt) <= serverNow) return "warning";
  return "ok";
}

export function getSecondsLeft(
  deadline: string,
  clientNow: number,
  serverOffsetMs: number,
): number {
  return Math.floor((Date.parse(deadline) - (clientNow + serverOffsetMs)) / 1000);
}
