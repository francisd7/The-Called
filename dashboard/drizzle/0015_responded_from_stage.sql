-- "Responded?" was never maintained: 79 of 541 leads are ticked against 68
-- booked calls, an 86% reply-to-booking rate that cannot be real. The
-- conversation stage is the field setters actually keep up, and it answers the
-- same question. See src/lib/stages.ts for how each stage is read.
--
-- A booking always counts as a reply whatever the stage says, and a lead with a
-- recorded reply time keeps its tick. 'bad_fit' and 'dq' are left alone: either
-- can be set from a profile alone, so the stage settles nothing.

UPDATE leads
SET responded = TRUE
WHERE conversation_stage IN (
  'rapport',
  'mid_rapport',
  'mid_rapport_seen',
  'business_talk',
  'business_talk_seen',
  'proposed_call',
  'close_to_booking',
  'declined_call',
  'booked',
  'call_booked',
  'closed',
  'follow_up_later',
  'short_term_fu',
  'ltfu',
  'nurture',
  'no_money'
);

UPDATE leads
SET responded = TRUE
WHERE call_booked = TRUE;

UPDATE leads
SET responded = FALSE
WHERE conversation_stage IN (
  'not_outreached',
  'outreached',
  'outreached_seen',
  'no_response'
)
  AND call_booked = FALSE
  AND responded_at IS NULL;
