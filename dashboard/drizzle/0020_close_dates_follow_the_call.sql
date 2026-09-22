-- Closes logged in the dashboard were stamped with the moment somebody pressed
-- the button, so a batch of backfilled results all landed on one afternoon and
-- the dashboard read $41,320 collected "today" for money that came in over
-- weeks.
--
-- Move them onto the day the call happened. Deliberately narrow:
--   * only closes recorded here (outcome_logged_at set) - the Airtable import
--     carried real close dates and those stay untouched
--   * only where the stamp matches the day it was logged, which is the
--     signature of now() rather than a date somebody meant
--   * only where the call was on a different day, so nothing is rewritten to
--     the value it already holds
UPDATE leads
SET closed_date = call_scheduled_for
WHERE closed IS TRUE
  AND outcome_logged_at IS NOT NULL
  AND call_scheduled_for IS NOT NULL
  AND closed_date::date = outcome_logged_at::date
  AND closed_date::date <> call_scheduled_for::date;

-- Same story for a cancellation recorded here.
UPDATE leads
SET call_cancelled_at = call_scheduled_for
WHERE call_cancelled IS TRUE
  AND outcome_logged_at IS NOT NULL
  AND call_scheduled_for IS NOT NULL
  AND call_cancelled_at::date = outcome_logged_at::date
  AND call_cancelled_at::date <> call_scheduled_for::date;
