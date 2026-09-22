-- The dropdown briefly carried eight cancel reasons that duplicated the team's
-- own: "Cannot afford it" beside "No Money", "Stopped replying" beside
-- "Unresponsive", "To Reschedule" beside "Rescheduling". The Airtable ones are
-- the words the business actually reports on, so these step aside.
--
-- Hidden rather than deleted: a lead that recorded one in the hour they were
-- live keeps reading correctly, and the form offers back any value it does not
-- recognise instead of blanking it.
UPDATE option_sets SET active = false
WHERE kind = 'cancel_reason'
  AND value IN (
    'rescheduling',
    'could_not_make_it',
    'not_interested',
    'not_ready',
    'cant_afford',
    'went_elsewhere',
    'ghosted',
    'no_reason'
  );
