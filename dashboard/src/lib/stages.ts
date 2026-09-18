/**
 * What a conversation stage implies about whether the lead ever replied.
 *
 * The tracker's own "Responded?" checkbox can't be trusted - 79 of 541 leads
 * are ticked against 68 booked calls, which would be an 86% reply-to-booking
 * rate. The stage is the field setters actually maintain, and it answers the
 * same question more reliably: nobody reaches rapport without the lead saying
 * something back.
 *
 * The vocabulary is the team's own, carried over from Airtable, which is why
 * there are near-duplicates (rapport and mid_rapport, booked and call_booked).
 * Both spellings are listed rather than tidied away, because both are in use on
 * real rows.
 *
 * A "seen" stage means the last message was read without a reply - but only
 * says so about that message. Reaching mid_rapport_seen still means they
 * replied earlier, so it counts; outreached_seen means they never did.
 */

/** Reaching any of these means they replied at some point. */
export const RESPONDED_STAGES = [
  'rapport',
  'mid_rapport',
  'mid_rapport_seen',
  'business_talk',
  'business_talk_seen',
  'proposed_call',
  'close_to_booking',
  // You can only decline a call you were offered in a conversation.
  'declined_call',
  'booked',
  'call_booked',
  'closed',
  // Replied, then parked for later. Still a reply.
  'follow_up_later',
  'short_term_fu',
  'ltfu',
  'nurture',
  // You find out somebody has no money by talking to them.
  'no_money',
] as const;

/** Reaching any of these means they didn't. */
export const SILENT_STAGES = [
  'not_outreached',
  'outreached',
  'outreached_seen',
  'no_response',
] as const;

/**
 * Whether a stage settles the question.
 *
 * 'bad_fit' and 'dq' deliberately settle nothing: a lead can be written off
 * from their profile alone or after a long conversation, so whatever is already
 * recorded stands rather than being overwritten by a guess.
 */
export function respondedFromStage(stage: string | null | undefined): boolean | null {
  if (!stage) return null;
  if ((RESPONDED_STAGES as readonly string[]).includes(stage)) return true;
  if ((SILENT_STAGES as readonly string[]).includes(stage)) return false;
  return null;
}
