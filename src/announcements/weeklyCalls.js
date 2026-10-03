import { getLocalTimeParts, getLocalDateString } from '../reminders/schedule.js';

// Weekly group-call announcements (Masterclass, Sales Training), posted to the
// announcements channel twice per call: a heads-up a couple of hours before,
// then a "we're live" right before it starts, each with its Google Meet link.
//
// The Meet link comes from an env var, not Google Calendar: a recurring
// Calendar event keeps the same Meet link for every occurrence, so there's
// nothing to look up week to week. The one exception: editing the series
// with "This and following events" (new time or recurrence) gives the new
// half of the series a new link - update the env var when that happens. It's
// an env var rather than a code default because this repo is public.

export const CALL_ANNOUNCEMENT_TIMEZONE = 'America/New_York';

// Shown as-is year-round (even during daylight time, technically EDT) - one
// fixed label is less confusing for clients than per-viewer local times.
export const CALL_ANNOUNCEMENT_TIMEZONE_LABEL = 'EST';

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

// "Fri 12:00" / "Friday 12pm" / "Tue 7pm, Thu 7pm" -> [{ weekday, hour, minute }].
// Times are Eastern. "none" (or blank) -> no announcements for that call.
// Throws on anything it can't read, so a typo fails the deploy loudly instead
// of silently never announcing.
export function parseWeeklySchedule(text) {
  if ((text ?? '').trim().toLowerCase() === 'none') return [];
  const entries = (text ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
  return entries.map((entry) => {
    const [dayText, ...timeParts] = entry.split(/\s+/);
    const weekday = parseWeekday(dayText);
    const time = parseTime(timeParts.join(' '));
    if (!weekday || !time) {
      throw new Error(`Can't read schedule entry "${entry}" - expected something like "Fri 12:00" or "Fri 12pm"`);
    }
    return { weekday, ...time };
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

// The calls this hub announces. A scheduled call with no Meet link throws,
// since an announcement with nothing to click is worse than none.
export function buildConfiguredCalls({
  masterclassSchedule,
  masterclassMeetLink,
  salesTrainingSchedule,
  salesTrainingMeetLink,
}) {
  const calls = [
    { key: 'masterclass', name: 'The Called Masterclass', envPrefix: 'MASTERCLASS', scheduleText: masterclassSchedule, meetLink: masterclassMeetLink },
    { key: 'salesTraining', name: 'The Called Sales Training', envPrefix: 'SALES_TRAINING', scheduleText: salesTrainingSchedule, meetLink: salesTrainingMeetLink },
  ];
  return calls
    .map((call) => ({ ...call, schedule: parseWeeklySchedule(call.scheduleText) }))
    .filter((call) => call.schedule.length > 0)
    .map((call) => {
      const meetLink = (call.meetLink ?? '').trim();
      if (!meetLink) {
        throw new Error(`${call.envPrefix}_MEET_LINK is missing (set ${call.envPrefix}_SCHEDULE_ET=none to skip this call)`);
      }
      return { key: call.key, name: call.name, schedule: call.schedule, meetLink };
    });
}

// Everything announcements need, validated. Throws with a message naming the
// Railway variable to fix.
export function buildCallAnnouncementSetup(config) {
  if (!config.announcementsChannelId) {
    throw new Error('DISCORD_ANNOUNCEMENTS_CHANNEL_ID is missing');
  }
  const slots = buildAnnouncementSlots(buildConfiguredCalls(config), {
    headsUpMinutes: config.callAnnouncementHeadsUpMinutes,
    liveMinutes: config.callAnnouncementLiveMinutes,
  });
  if (slots.length === 0) {
    throw new Error('MASTERCLASS_SCHEDULE_ET and SALES_TRAINING_SCHEDULE_ET are both "none"');
  }
  return { slots, ping: parsePing(config.callAnnouncementPing) };
}

const PERMISSION_LABELS = {
  ViewChannel: 'View Channel',
  SendMessages: 'Send Messages',
  MentionEveryone: 'Mention @everyone, @here, and All Roles',
};

// Checked once at startup, so a permissions gap in the announcements channel
// shows up on deploy instead of at the first scheduled post. Returns a
// staff-facing description of the problem, or null if the bot can post.
export async function findAnnouncementChannelProblem({ discord, channelId, ping }) {
  const needed = ['ViewChannel', 'SendMessages', ...(ping ? ['MentionEveryone'] : [])];
  try {
    const missing = await discord.getMissingChannelPermissions(channelId, needed);
    if (missing.length === 0) return null;
    return `the bot is missing ${missing.map((name) => `**${PERMISSION_LABELS[name]}**`).join(', ')} in <#${channelId}>`;
  } catch (err) {
    return `the bot can't open the announcements channel (${channelId}): ${err.message}`;
  }
}

function minuteOfWeek({ weekday, hour, minute }) {
  return WEEKDAYS.indexOf(weekday) * MINUTES_PER_DAY + hour * 60 + minute;
}

function formatClock24(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// Two slots per scheduled call time - a heads-up and a "we're live" - each
// announced at most once per week.
export function buildAnnouncementSlots(calls, { headsUpMinutes, liveMinutes }) {
  for (const [name, value] of [['heads-up', headsUpMinutes], ['live', liveMinutes]]) {
    if (!Number.isInteger(value) || value < 0 || value >= MINUTES_PER_WEEK) {
      throw new Error(`Can't use ${value} as the ${name} announcement lead time - expected whole minutes, e.g. 120`);
    }
  }
  if (liveMinutes >= headsUpMinutes) {
    throw new Error('The "live" announcement must go out closer to the call than the heads-up');
  }

  const slots = [];
  for (const call of calls) {
    for (const time of call.schedule) {
      for (const [kind, leadMinutes] of [['headsUp', headsUpMinutes], ['live', liveMinutes]]) {
        slots.push({
          key: `${call.key}:${time.weekday} ${formatClock24(time.hour, time.minute)}:${kind}`,
          kind,
          callName: call.name,
          meetLink: call.meetLink,
          leadMinutes,
          startHour: time.hour,
          startMinute: time.minute,
          announceMinuteOfWeek:
            (minuteOfWeek(time) - leadMinutes + MINUTES_PER_WEEK) % MINUTES_PER_WEEK,
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
    due.push({ slot, occurrenceDate: getLocalDateString(announceAt, timeZone) });
  }
  return due;
}

function formatClock12(hour, minute) {
  const hour12 = ((hour + 11) % 12) + 1;
  return `${hour12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

// 120 -> "2 hours", 90 -> "1 hour 30 minutes", 45 -> "45 minutes"
function formatDuration(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (minutes > 0 || hours === 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  return parts.join(' ');
}

export function formatAnnouncement({ kind, callName, meetLink, leadMinutes, startHour, startMinute, ping }) {
  const prefix = ping ? `${ping} ` : '';
  const headline =
    kind === 'live'
      ? `🔴 **${callName}** is live!`
      : `📣 **${callName}** starts in ${formatDuration(leadMinutes)} — ${formatClock12(startHour, startMinute)} ${CALL_ANNOUNCEMENT_TIMEZONE_LABEL}.`;
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

  for (const { slot, occurrenceDate } of findDueAnnouncements(now, slots)) {
    if (sentLog[slot.key] === occurrenceDate) continue;

    // Mark before sending, same as the weekly reminder, so a send that runs
    // past the next tick can't double-post.
    const previous = sentLog[slot.key];
    sentLog[slot.key] = occurrenceDate;
    await saveState(state);

    try {
      await discord.sendToChannel(channelId, formatAnnouncement({ ...slot, ping }));
      log.info(`[callAnnouncements] posted ${slot.key} for ${occurrenceDate}`);
    } catch (err) {
      log.error(`[callAnnouncements] failed to post ${slot.key}:`, err);
      if (previous === undefined) delete sentLog[slot.key];
      else sentLog[slot.key] = previous;
      await saveState(state);
    }
  }
}
