// Pure timezone-aware scheduling helpers - no cron dependency needed for a
// single "fire once a week" job. Intl's timeZone support handles DST
// transitions correctly on its own (e.g. America/New_York flipping between
// EST/EDT), which a fixed UTC offset would get wrong for half the year.
// The business runs on Eastern time: calls, reminders and "what day is it"
// are all judged there. Anything that records a calendar DATE has to be
// formatted in this zone - a UTC date rolls over at 8pm locally, which is
// prime signup hours, and stamps the next day onto an evening customer.
// Instants (a watermark, a cutoff) stay UTC and are unaffected.
export const BUSINESS_TIMEZONE = 'America/New_York';

const formatterCache = new Map();

function getWeekdayHourMinuteFormatter(timeZone) {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function getLocalTimeParts(date, timeZone) {
  const parts = getWeekdayHourMinuteFormatter(timeZone).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    weekday: lookup.weekday, // 'Mon' .. 'Sun'
    hour: Number(lookup.hour) % 24, // some locales render midnight as "24"
    minute: Number(lookup.minute),
  };
}

export function isTargetMinute(date, { weekday, hour, minute, timeZone }) {
  const local = getLocalTimeParts(date, timeZone);
  return local.weekday === weekday && local.hour === hour && local.minute === minute;
}

// Whether a weekly job is due. "Due" means the time has PASSED today and it
// hasn't run today yet - not that this exact minute is the target one.
//
// The difference is the whole point. Matching the exact minute needs a tick to
// land inside a 60-second window, and the checker runs on setInterval(60_000),
// which never fires early and accumulates lateness: two ticks 60.1s apart at
// 11:59:59.9 and 12:01:00.0 skip the 12:00 minute completely. A container
// restart spanning that minute does the same. Either way the job silently does
// not run, and the next chance is a week later.
//
// Catching up is safe because the caller stamps `lastRunDate` with the local
// date before sending, so a late tick fires once and the rest of the day's
// ticks see the stamp and stop. The cost of catching up is that a job delayed
// by a restart goes out a few minutes late; the cost of not catching up is
// that it goes out never.
export function isWeeklyJobDue(date, { weekday, hour, minute, timeZone, lastRunDate }) {
  const local = getLocalTimeParts(date, timeZone);
  if (local.weekday !== weekday) return false;
  if (lastRunDate === getLocalDateString(date, timeZone)) return false;
  return local.hour > hour || (local.hour === hour && local.minute >= minute);
}

// YYYY-MM-DD in the given timezone - used as a dedupe key so a scheduled job
// fires at most once per calendar day even if checked every minute.
export function getLocalDateString(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
}
