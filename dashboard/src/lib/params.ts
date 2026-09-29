/**
 * Guards for values that arrive off a URL and end up in a query.
 *
 * Filters are carried in the query string so a view can be linked and
 * bookmarked, which means anything at all can reach the query builder. A date
 * that will not parse or an id that is not a uuid gets as far as the Postgres
 * cast and throws from inside the driver, and the page 500s - a crash screen
 * over a typo in an address bar.
 *
 * Dropping what cannot be right, rather than passing it on, widens the view
 * instead of breaking it: an unreadable filter shows everything, which is
 * visibly wrong and recoverable, where a stack trace is neither.
 *
 * Kept free of database imports so the edges can be tested directly.
 */

const SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A real calendar day as YYYY-MM-DD, or the fallback.
 *
 * The shape alone is not enough: "2026-13-99" and "2026-02-31" both match it
 * and both make Postgres throw, so the value is parsed as well. Date's ISO
 * form rejects an impossible day rather than rolling it over into March.
 */
export function validDay<T extends string | undefined>(
  value: string | null | undefined,
  fallback: T,
): string | T {
  if (!value || !SHAPE.test(value)) return fallback;
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return fallback;
  // Feb 31 parses in some engines by rolling forward; compare it back.
  return parsed.toISOString().slice(0, 10) === value ? value : fallback;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id that can be compared against a uuid column, or undefined. */
export function validUuid(
  value: string | null | undefined,
): string | undefined {
  return value && UUID.test(value) ? value : undefined;
}

/**
 * A setter filter: a real id, or the literal "none" for the unassigned pile.
 *
 * "none" is a sentinel the lead queries understand (`isNull(setterId)`), and
 * it is what the Unassigned option in the filter dropdown sends. Guarding
 * those params with validUuid alone silently dropped it, so picking Unassigned
 * quietly showed everybody's leads instead - a filter that looks applied and
 * is not is worse than one that errors.
 */
export function validSetterFilter(
  value: string | null | undefined,
): string | undefined {
  if (value === "none") return "none";
  return validUuid(value);
}
