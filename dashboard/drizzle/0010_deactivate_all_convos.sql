-- Migration 0007 seeded "active conversation" from the Airtable stage so the
-- board wasn't empty on day one. In practice that marked 442 conversations
-- active, most of them long dead - the stage on an imported row says where a
-- thread stopped, not that it's still going.
--
-- Clear the slate instead: the setters mark their own live threads. A short
-- honest list is worth more than a long inherited one, and the daily "Sent"
-- button only means something if the list reflects reality.
UPDATE leads SET is_active_convo = FALSE WHERE is_test = FALSE;
