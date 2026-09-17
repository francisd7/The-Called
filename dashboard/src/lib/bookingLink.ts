/**
 * Stamps a lead's id onto a Calendly scheduling URL so the invitee.created
 * webhook can match the booking back to that exact lead row. Calendly echoes
 * utm_* values back in the payload's `tracking` object untouched.
 *
 * Name/email matching is not an option here: the lead list is keyed on IG
 * handle and mostly has neither.
 */
export function buildTrackedBookingUrl(schedulingUrl: string, leadId: string, setterName?: string) {
  const url = new URL(schedulingUrl);
  url.searchParams.set('utm_source', 'setter-dashboard');
  url.searchParams.set('utm_medium', 'ig-dm');
  url.searchParams.set('utm_content', leadId);
  if (setterName) url.searchParams.set('utm_campaign', setterName);
  return url.toString();
}
