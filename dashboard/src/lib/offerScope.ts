/**
 * Which Calendly bookings are sales calls.
 *
 * A Calendly webhook is registered against the whole organization, and the
 * scheduled-events API returns the whole organization too. Neither can be
 * narrowed to particular links, so something has to decide.
 *
 * That decision is a list an admin keeps, not a rule derived from the three
 * current offers. Most of the booking history sits on links that have since
 * been retired, and at least one live link is Nigel's coaching calls with
 * existing clients - real calls, but not leads.
 *
 * Kept free of database imports so the webhook and the backfill apply exactly
 * the same rule, and so the rule itself can be tested.
 */

export type CountableLink = { uri: string; counted: boolean };

/** The event types whose bookings are sales calls. */
export function countedEventTypes(links: CountableLink[]): Set<string> {
  return new Set(links.filter((l) => l.counted).map((l) => l.uri));
}

/**
 * Whether a booking is one of ours.
 *
 * An empty set means nothing has been ticked yet, which is a setup problem
 * rather than a licence to accept everything. Saying no is the safe answer:
 * the delivery is still recorded and can be replayed once the list is set.
 */
export function isCountedEventType(
  eventTypeUri: string | null | undefined,
  counted: Set<string>
): boolean {
  if (!eventTypeUri) return false;
  return counted.has(eventTypeUri);
}
