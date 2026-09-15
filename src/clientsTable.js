// The Clients table in "The Called - Client Success", and the filter for the
// clients every automation cares about.
//
// This was src/reminders/weeklyCheckinReminder.js until 2026-09-15, when the
// Friday check-in reminder was removed at the CSM's request. The message
// formatting and the send plan went with it; these two constants did not,
// because eight other things read them - tier sync, onboarding, the Saturday
// missing-check-in report, and the migration scripts. They were never really
// about reminders, so they no longer live in a file named for one.
export const CLIENTS_TABLE_ID = 'tblrIOcPpSfDQaHfj';
export const ACTIVE_CLIENTS_FORMULA = "{Status} = 'Active'";
