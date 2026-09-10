export const MAX_STATEMENT_RANGE_MS = 3 * 366 * 86_400_000;

export function assertStatementRange(startAt: number, endAt: number) {
  if (!Number.isSafeInteger(startAt) || !Number.isSafeInteger(endAt)) throw new Error("Statement dates must be valid times. Correct the dates and try again.");
  if (startAt > endAt) throw new Error("Statement start date must be on or before the end date. Correct the dates and try again.");
  if (startAt < endAt - MAX_STATEMENT_RANGE_MS) throw new Error("Statements can cover up to three years. Choose a more recent start date.");
}
