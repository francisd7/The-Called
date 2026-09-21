/**
 * Which Calendly bookings belong to this business.
 *
 * A Calendly webhook is registered against the whole organization, and the
 * scheduled-events API returns the whole organization too. Neither can be
 * narrowed to particular links. So the three offers are the filter: a booking
 * on any other event type - an internal sync, a personal appointment, someone
 * else's link on the same account - is not a sales call and has no business in
 * the lead tracker.
 *
 * Kept free of database imports so both the webhook and the backfill can apply
 * exactly the same rule, and so the rule itself can be tested.
 */

export type OfferLike = { eventTypeUri: string | null; active?: boolean };

/** The event types the three offer links point at. */
export function linkedEventTypes(offers: OfferLike[]): Set<string> {
  return new Set(
    offers.filter((o) => o.active !== false && o.eventTypeUri).map((o) => o.eventTypeUri as string)
  );
}

/**
 * Whether a booking is on one of our links.
 *
 * An empty set means no offer has been linked to its Calendly event type yet,
 * which is a setup problem rather than a licence to accept everything. Saying
 * no is the safe answer: the delivery is still recorded and can be replayed
 * once the offers are connected.
 */
export function isOurEventType(
  eventTypeUri: string | null | undefined,
  linked: Set<string>
): boolean {
  if (!eventTypeUri) return false;
  return linked.has(eventTypeUri);
}
