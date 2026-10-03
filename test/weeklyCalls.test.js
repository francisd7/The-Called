import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWeeklySchedule,
  parseLeadMinutes,
  parsePing,
  buildConfiguredCalls,
  buildAnnouncementSlots,
  findDueAnnouncements,
  formatAnnouncement,
  postDueCallAnnouncements,
} from '../src/announcements/weeklyCalls.js';

const masterclass = {
  key: 'masterclass',
  name: 'Weekly Masterclass',
  schedule: [{ weekday: 'Tue', hour: 19, minute: 0 }],
  meetLink: 'https://meet.google.com/abc-defg-hij',
};

test('parseWeeklySchedule reads 24-hour, 12-hour, and multi-entry schedules', () => {
  assert.deepEqual(parseWeeklySchedule('Tue 19:00'), [{ weekday: 'Tue', hour: 19, minute: 0 }]);
  assert.deepEqual(parseWeeklySchedule('Tuesday 7pm'), [{ weekday: 'Tue', hour: 19, minute: 0 }]);
  assert.deepEqual(parseWeeklySchedule('tues 7:30 PM, Thurs 12:00'), [
    { weekday: 'Tue', hour: 19, minute: 30 },
    { weekday: 'Thu', hour: 12, minute: 0 },
  ]);
  assert.deepEqual(parseWeeklySchedule('Mon 12am'), [{ weekday: 'Mon', hour: 0, minute: 0 }]);
  assert.deepEqual(parseWeeklySchedule('Mon 12pm'), [{ weekday: 'Mon', hour: 12, minute: 0 }]);
  assert.deepEqual(parseWeeklySchedule(''), []);
});

test('parseWeeklySchedule rejects anything ambiguous or malformed', () => {
  assert.throws(() => parseWeeklySchedule('Tue 7'), /Tue 7/); // am or pm?
  assert.throws(() => parseWeeklySchedule('Tu 19:00'));
  assert.throws(() => parseWeeklySchedule('Funday 19:00'));
  assert.throws(() => parseWeeklySchedule('Tue 25:00'));
  assert.throws(() => parseWeeklySchedule('Tue 13pm'));
  assert.throws(() => parseWeeklySchedule('Tue'));
});

test('parseLeadMinutes defaults to one hour and accepts a list', () => {
  assert.deepEqual(parseLeadMinutes(''), [60]);
  assert.deepEqual(parseLeadMinutes('60, 0'), [60, 0]);
  assert.throws(() => parseLeadMinutes('an hour'));
  assert.throws(() => parseLeadMinutes('-5'));
});

test('parsePing defaults to @everyone and supports here/none/role', () => {
  assert.equal(parsePing(undefined), '@everyone');
  assert.equal(parsePing('here'), '@here');
  assert.equal(parsePing('none'), '');
  assert.equal(parsePing('123456789012345678'), '<@&123456789012345678>');
  assert.throws(() => parsePing('the team'));
});

test('buildConfiguredCalls skips unscheduled calls and requires a Meet link for scheduled ones', () => {
  const calls = buildConfiguredCalls({
    masterclassSchedule: 'Tue 19:00',
    masterclassMeetLink: ' https://meet.google.com/abc-defg-hij ',
    salesCallSchedule: '',
    salesCallMeetLink: '',
  });
  assert.deepEqual(calls, [masterclass]);

  assert.throws(
    () => buildConfiguredCalls({ salesCallSchedule: 'Thu 12:00', salesCallMeetLink: '' }),
    /SALES_CALL_MEET_LINK is missing/
  );
});

test('an announcement goes out lead-minutes before the call, Eastern time (EDT)', () => {
  const slots = buildAnnouncementSlots([masterclass], [60]);
  // 2026-10-06 is a Tuesday; 18:00 EDT is 22:00 UTC.
  const due = findDueAnnouncements(new Date('2026-10-06T22:00:30Z'), slots);
  assert.equal(due.length, 1);
  assert.equal(due[0].occurrenceDate, '2026-10-06');
  assert.equal(due[0].startsAt.toISOString(), '2026-10-06T23:00:00.000Z');

  assert.equal(findDueAnnouncements(new Date('2026-10-06T21:59:00Z'), slots).length, 0);
  assert.equal(findDueAnnouncements(new Date('2026-10-05T22:00:00Z'), slots).length, 0); // Monday
});

test('the schedule follows Eastern wall-clock time across the EST switch', () => {
  const slots = buildAnnouncementSlots([masterclass], [60]);
  // 2026-12-08 is a Tuesday in EST (UTC-5): 18:00 ET is 23:00 UTC, not 22:00.
  assert.equal(findDueAnnouncements(new Date('2026-12-08T22:00:00Z'), slots).length, 0);
  const [due] = findDueAnnouncements(new Date('2026-12-08T23:00:00Z'), slots);
  assert.equal(due.startsAt.toISOString(), '2026-12-09T00:00:00.000Z');
});

test('a late tick still posts within the grace window, with the real start time', () => {
  const slots = buildAnnouncementSlots([masterclass], [60]);
  const [due] = findDueAnnouncements(new Date('2026-10-06T22:04:59Z'), slots);
  assert.equal(due.startsAt.toISOString(), '2026-10-06T23:00:00.000Z');
  assert.equal(findDueAnnouncements(new Date('2026-10-06T22:05:00Z'), slots).length, 0);
});

test('a lead time that crosses midnight (and the week boundary) announces the day before', () => {
  const mondayAfterMidnight = { ...masterclass, schedule: [{ weekday: 'Mon', hour: 0, minute: 30 }] };
  const slots = buildAnnouncementSlots([mondayAfterMidnight], [60]);
  // Sunday 2026-10-04 23:30 EDT = 2026-10-05 03:30 UTC.
  const [due] = findDueAnnouncements(new Date('2026-10-05T03:30:00Z'), slots);
  assert.equal(due.occurrenceDate, '2026-10-04');
  assert.equal(due.startsAt.toISOString(), '2026-10-05T04:30:00.000Z');
});

test('formatAnnouncement uses Discord timestamps, the Meet link, and the ping', () => {
  const startsAt = new Date('2026-10-06T23:00:00Z');
  const unix = startsAt.getTime() / 1000;
  assert.equal(
    formatAnnouncement({ callName: 'Weekly Masterclass', meetLink: masterclass.meetLink, startsAt, leadMinutes: 60, ping: '@everyone' }),
    `@everyone 📣 **Weekly Masterclass** starts <t:${unix}:R> — <t:${unix}:t> your time.\nJoin here: https://meet.google.com/abc-defg-hij`
  );
  assert.equal(
    formatAnnouncement({ callName: 'Weekly Masterclass', meetLink: masterclass.meetLink, startsAt, leadMinutes: 0, ping: '' }),
    '🔴 **Weekly Masterclass** is starting now!\nJoin here: https://meet.google.com/abc-defg-hij'
  );
});

function makeHarness({ failSends = 0 } = {}) {
  const posts = [];
  let failuresLeft = failSends;
  const state = {};
  return {
    posts,
    state,
    args: {
      slots: buildAnnouncementSlots([masterclass], [60, 0]),
      state,
      saveState: async () => {},
      discord: {
        sendToChannel: async (channelId, message) => {
          if (failuresLeft > 0) {
            failuresLeft -= 1;
            throw new Error('Discord is down');
          }
          posts.push({ channelId, message });
        },
      },
      channelId: 'announcements',
      ping: '@everyone',
      stateKey: 'callAnnouncementsLastPosted',
      log: { info: () => {}, error: () => {} },
    },
  };
}

test('postDueCallAnnouncements posts each slot once per week', async () => {
  const { posts, state, args } = makeHarness();

  await postDueCallAnnouncements({ ...args, now: new Date('2026-10-06T22:00:00Z') });
  await postDueCallAnnouncements({ ...args, now: new Date('2026-10-06T22:01:00Z') });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].channelId, 'announcements');
  assert.match(posts[0].message, /starts <t:/);

  await postDueCallAnnouncements({ ...args, now: new Date('2026-10-06T23:00:00Z') });
  assert.equal(posts.length, 2);
  assert.match(posts[1].message, /is starting now/);

  assert.deepEqual(state.callAnnouncementsLastPosted, {
    'masterclass:Tue 19:00:60': '2026-10-06',
    'masterclass:Tue 19:00:0': '2026-10-06',
  });

  // Next week's occurrence posts again.
  await postDueCallAnnouncements({ ...args, now: new Date('2026-10-13T22:00:00Z') });
  assert.equal(posts.length, 3);
});

test('a failed post is retried on the next tick inside the grace window', async () => {
  const { posts, args } = makeHarness({ failSends: 1 });

  await postDueCallAnnouncements({ ...args, now: new Date('2026-10-06T22:00:00Z') });
  assert.equal(posts.length, 0);

  await postDueCallAnnouncements({ ...args, now: new Date('2026-10-06T22:01:00Z') });
  assert.equal(posts.length, 1);
});
