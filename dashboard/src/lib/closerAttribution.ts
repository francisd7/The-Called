/**
 * Who is down as taking a call, when a booking arrives from Calendly.
 *
 * The team books through a single Calendly account, so the host on every
 * booking is that account's owner regardless of which closer the call is
 * actually for. Calendly cannot tell them apart, and never will while they
 * share an account - so the host is a starting point for a call nobody has
 * said anything about yet, and nothing more.
 *
 * Once somebody has said who is taking it, that stands. A reschedule fires
 * invitee.created a second time and re-running the backfill replays the whole
 * history, and both used to write the host back over a correction made in
 * triage - sending the pre-call brief to the wrong closer, days after
 * somebody had already fixed it.
 *
 * Kept free of database imports so the webhook and the backfill apply exactly
 * the same rule, and so the rule itself can be tested.
 */

export type CloserPatch = {
  closerId: string | null;
  closerName: string | null;
};

/**
 * What to write about the closer, which is nothing at all when the lead
 * already has one.
 */
export function closerPatch(
  existingCloserId: string | null | undefined,
  fromCalendly: { id: string; name: string } | null,
  hostName: string | null,
): CloserPatch | Record<string, never> {
  if (existingCloserId) return {};
  return {
    closerId: fromCalendly?.id ?? null,
    closerName: fromCalendly?.name ?? hostName,
  };
}
