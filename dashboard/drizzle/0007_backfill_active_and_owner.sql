-- One-time data fixes for leads that were imported before these rules existed.
-- Migrations run exactly once, so none of this can re-apply later and undo a
-- decision somebody has since made by hand.

-- 1. is_active_convo was added after the import, so every imported lead has it
--    false and the active-conversations board reads zero. Seed it from the
--    stage: a live stage means a live conversation. From here it is only ever
--    changed by a person.
UPDATE leads
SET is_active_convo = TRUE
WHERE is_active_convo = FALSE
  AND is_test = FALSE
  AND conversation_stage IS NOT NULL
  AND conversation_stage NOT IN (
    'dq', 'bad_fit', 'no_response', 'no_money', 'closed',
    'declined_call', 'lost_ghosted', 'nurture', 'ltfu', 'not_outreached'
  );

-- 2. Most of the imported tracker has no setter on it, which leaves hundreds of
--    leads owned by nobody. Hand them to the admin so they have an owner and
--    can be reassigned from there.
UPDATE leads
SET setter_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1)
WHERE setter_id IS NULL
  AND is_test = FALSE
  AND EXISTS (SELECT 1 FROM users WHERE role = 'admin');

-- 3. The Airtable "Responded?" checkbox was not maintained: rows that plainly
--    replied - they booked a call, showed up, or closed - still had it unticked,
--    which made the funnel show more bookings than replies.
UPDATE leads
SET responded = TRUE
WHERE responded = FALSE
  AND (call_booked = TRUE OR showed = TRUE OR closed = TRUE);
