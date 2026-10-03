import { getLocalTimeParts, getLocalDateString } from '../reminders/schedule.js';

// Weekly group-call announcements (Masterclass, Sales Call), posted to the
// announcements channel ahead of each call with its Google Meet link.
//
// The Meet link comes from an env var, not Google Calendar: a recurring
// Calendar event keeps the same Meet link for every occurrence, so there's
// nothing to look up week to week. The one exception: editing the series
// with "This and following events" (new time or recurrence) gives the new
// half of the series a new link - update the env var when that happens.

export const CALL_ANNOUNCEMENT_TIMEZONE = 'America/New_York';

// How late an announcement may still go out after its scheduled minute - covers
// a redeploy or a briefly blocked tick landing on the exact minute. Kept short
// because the dedupe state file resets on redeploy (see README).
export const CALL_ANNOUNCEMENT_GRACE_MINUTES = 5;

// Short names match what getLocalTimeParts returns.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_FULL_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

// "Tue" / "Tues" / "Tuesday" - any 3+ letter prefix of the full name.
function parseWeekday(text) {
  const lower = text.toLowerCase();
  if (lower.length < 3) return null;
  const index = WEEKDAY_FULL_NAMES.findIndex((name) => name.startsWith(lower));
  return index === -1 ? null : WEEKDAYS[index];
}

function parseTime(text) {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(text);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
  } else if (match[2] === undefined) {
    return null; // a bare "7" is ambiguous - require "7pm" or "19:00"
  }
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

// "Tue 19:00" / "Tuesday 7pm" / "Tue 7:00 PM, Thu 12:00" -> [{ weekday, hour, minute }].
// Times are Eastern (CALL_ANNOUNCEMENT_TIMEZONE). Throws on anything it can't
// read, so a typo in the env var fails loudly at startup instead of silently
// never announcing.
export function parseWeeklySchedule(text) {
  const entries = (text ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
  return entries.map((entry) => {
    const [dayText, ...timeParts] = entry.split(/\s+/);
    const weekday = parseWeekday(dayText);
    const time = parseTime(timeParts.join(' '));
    if (!weekday || !time) {
      throw new Error(`Can't read schedule entry "${entry}" - expected something like "Tue 19:00" or "Tue 7pm"`);
    }
    return { weekday, ...time };
  });
}

// "60" / "60,0" -> [60] / [60, 0]. One announcement per value, that many
// minutes before the call starts (0 = at start time).
export function parseLeadMinutes(text) {
  const values = (text ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) return [60];
  return values.map((value) => {
    const minutes = Number(value);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes >= MINUTES_PER_WEEK) {
      throw new Error(`Can't read announcement lead time "${value}" - expected whole minutes, e.g. 60`);
    }
    return minutes;
  });
}

// "everyone" (default) / "here" / "none" / a role ID -> the mention text that
// starts each announcement.
export function parsePing(value) {
  const normalized = (value ?? 'everyone').trim().toLowerCase();
  if (normalized === 'everyone' || normalized === '@everyone') return '@everyone';
  if (normalized === 'here' || normalized === '@here') return '@here';
  if (normalized === 'none' || normalized === '') return '';
  if (/^\d+$/.test(normalized)) return `<@&${normalized}>`;
  throw new Error(`Can't read announcement ping "${value}" - expected everyone, here, none, or a role ID`);
}

// The calls this hub announces. A call with no schedule set is simply not
// announced; a schedule without a Meet link throws, since an announcement
// with nothing to click is worse than none.
export function buildConfiguredCalls({
  masterclassSchedule,
  masterclassMeetLink,
  salesCallSchedule,
  salesCallMeetLink,
}) {
  const calls = [
    { key: 'masterclass', name: 'Weekly Masterclass', envPrefix: 'MASTERCLASS', scheduleText: masterclassSchedule, meetLink: masterclassMeetLink },
    { key: 'salesCall', name: 'Weekly Sales Call', envPrefix: 'SALES_CALL', scheduleText: salesCallSchedule, meetLink: salesCallMeetLink },
  ];
  return calls
    .filter((call) => (call.scheduleText ?? '').trim())
    .map((call) => {
      const meetLink = (call.meetLink ?? '').trim();
      if (!meetLink) {
        throw new Error(`${call.envPrefix}_SCHEDULE_ET is set but ${call.envPrefix}_MEET_LINK is missing`);
      }
      return { key: call.key, name: call.name, schedule: parseWeeklySchedule(call.scheduleText), meetLink };
    });
}

function minuteOfWeek({ weekday, hour, minute }) {
  return WEEKDAYS.indexOf(weekday) * MINUTES_PER_DAY + hour * 60 + minute;
}

function formatClock(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// One slot per (call, scheduled time, lead time) - each is announced at most
// once per week. calls: [{ key, name, schedule: [{ weekday, hour, minute }], meetLink }]
export function buildAnnouncementSlots(calls, leadMinutesList) {
  const slots = [];
  for (const call of calls) {
    for (const time of call.schedule) {
      for (const leadMinutes of leadMinutesList) {
        const startMinuteOfWeek = minuteOfWeek(time);
        slots.push({
          key: `${call.key}:${time.weekday} ${formatClock(time.hour, time.minute)}:${leadMinutes}`,
          callName: call.name,
          meetLink: call.meetLink,
          leadMinutes,
          announceMinuteOfWeek:
            (startMinuteOfWeek - leadMinutes + MINUTES_PER_WEEK) % MINUTES_PER_WEEK,
        });
      }
    }
  }
  return slots;
}

// Slots whose announce minute (Eastern wall-clock) was within the last
// graceMinutes. occurrenceDate is the Eastern date of that announce minute -
// the per-week dedupe key.
export function findDueAnnouncements(
  now,
  slots,
  { timeZone = CALL_ANNOUNCEMENT_TIMEZONE, graceMinutes = CALL_ANNOUNCEMENT_GRACE_MINUTES } = {}
) {
  const nowMinute = Math.floor(now.getTime() / 60_000) * 60_000;
  const nowMinuteOfWeek = minuteOfWeek(getLocalTimeParts(new Date(nowMinute), timeZone));

  const due = [];
  for (const slot of slots) {
    const minutesLate =
      (nowMinuteOfWeek - slot.announceMinuteOfWeek + MINUTES_PER_WEEK) % MINUTES_PER_WEEK;
    if (minutesLate >= graceMinutes) continue;
    const announceAt = new Date(nowMinute - minutesLate * 60_000);
    due.push({
      slot,
      occurrenceDate: getLocalDateString(announceAt, timeZone),
      startsAt: new Date(announceAt.getTime() + slot.leadMinutes * 60_000),
    });
  }
  return due;
}

// Discord renders <t:...> timestamps in each viewer's own timezone, so clients
// outside Eastern see their local start time without any conversion here.
export function formatAnnouncement({ callName, meetLink, startsAt, leadMinutes, ping }) {
  const unix = Math.floor(startsAt.getTime() / 1000);
  const prefix = ping ? `${ping} ` : '';
  const headline =
    leadMinutes === 0
      ? `🔴 **${callName}** is starting now!`
      : `📣 **${callName}** starts <t:${unix}:R> — <t:${unix}:t> your time.`;
  return `${prefix}${headline}\nJoin here: ${meetLink}`;
}

// Posts every due, not-yet-sent announcement. A failed post is un-marked so
// the next tick retries it while it's still inside the grace window.
export async function postDueCallAnnouncements({
  now = new Date(),
  slots,
  state,
  saveState,
  discord,
  channelId,
  ping,
  stateKey,
  log = console,
}) {
  const sentLog = state[stateKey] ?? {};
  state[stateKey] = sentLog;

  for (const { slot, occurrenceDate, startsAt } of findDueAnnouncements(now, slots)) {
    if (sentLog[slot.key] === occurrenceDate) continue;

    // Mark before sending, same as the weekly reminder, so a send that runs
    // past the next tick can't double-post.
    const previous = sentLog[slot.key];
    sentLog[slot.key] = occurrenceDate;
    await saveState(state);

    try {
      await discord.sendToChannel(channelId, formatAnnouncement({ ...slot, startsAt, ping }));
      log.info(`[callAnnouncements] posted ${slot.key} for ${occurrenceDate}`);
    } catch (err) {
      log.error(`[callAnnouncements] failed to post ${slot.key}:`, err);
      if (previous === undefined) delete sentLog[slot.key];
      else sentLog[slot.key] = previous;
      await saveState(state);
    }
  }
}
