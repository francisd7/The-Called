import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWeeklySchedule,
  parsePing,
  buildConfiguredCalls,
  buildAnnouncementSlots,
  findDueAnnouncements,
  formatAnnouncement,
  postDueCallAnnouncements,
} from '../src/announcements/weeklyCalls.js';

const LINK = 'https://meet.google.com/aaa-bbbb-ccc';
const LEADS = { headsUpMinutes: 120, liveMinutes: 2 };

const masterclass = {
  key: 'masterclass',
  name: 'The Called Masterclass',
  schedule: [{ weekday: 'Fri', hour: 12, minute: 0 }],
  meetLink: LINK,
};

test('parseWeeklySchedule reads 24-hour, 12-hour, and multi-entry schedules', () => {
  assert.deepEqual(parseWeeklySchedule('Fri 12:00'), [{ weekday: 'Fri', hour: 12, minute: 0 }]);
  assert.deepEqual(parseWeeklySchedule('Friday 12pm'), [{ weekday: 'Fri', hour: 12, minute: 0 }]);
  assert.deepEqual(parseWeeklySchedule('tues 7:30 PM, Thurs 12:00'), [
    { weekday: 'Tue', hour: 19, minute: 30 },
    { weekday: 'Thu', hour: 12, minute: 0 },
  ]);
  assert.deepEqual(parseWeeklySchedule('Mon 12am'), [{ weekday: 'Mon', hour: 0, minute: 0 }]);
  assert.deepEqual(parseWeeklySchedule('none'), []);
  assert.deepEqual(parseWeeklySchedule(''), []);
});

test('parseWeeklySchedule rejects anything ambiguous or malformed', () => {
  assert.throws(() => parseWeeklySchedule('Fri 12'), /Fri 12/); // am or pm?
  assert.throws(() => parseWeeklySchedule('Fr 12:00'));
  assert.throws(() => parseWeeklySchedule('Funday 12:00'));
  assert.throws(() => parseWeeklySchedule('Fri 25:00'));
  assert.throws(() => parseWeeklySchedule('Fri 13pm'));
  assert.throws(() => parseWeeklySchedule('Fri'));
});

test('parsePing defaults to @everyone and supports here/none/role', () => {
  assert.equal(parsePing(undefined), '@everyone');
  assert.equal(parsePing('here'), '@here');
  assert.equal(parsePing('none'), '');
  assert.equal(parsePing('123456789012345678'), '<@&123456789012345678>');
  assert.throws(() => parsePing('the team'));
});

test('buildConfiguredCalls skips "none" calls and requires a Meet link for scheduled ones', () => {
  const calls = buildConfiguredCalls({
    masterclassSchedule: 'Fri 12:00',
    masterclassMeetLink: ` ${LINK} `,
    salesTrainingSchedule: 'none',
    salesTrainingMeetLink: '',
  });
  assert.deepEqual(calls, [masterclass]);

  assert.throws(
    () => buildConfiguredCalls({ salesTrainingSchedule: 'Sat 12:00', salesTrainingMeetLink: '' }),
    /SALES_TRAINING_MEET_LINK is missing/
  );
});

test('buildAnnouncementSlots rejects a "live" post that would come before the heads-up', () => {
  assert.throws(() => buildAnnouncementSlots([masterclass], { headsUpMinutes: 2, liveMinutes: 120 }));
  assert.throws(() => buildAnnouncementSlots([masterclass], { headsUpMinutes: 120, liveMinutes: -1 }));
});

test('heads-up goes out 2 hours before and "live" 2 minutes before, Eastern time (EDT)', () => {
  const slots = buildAnnouncementSlots([masterclass], LEADS);
  // 2026-10-09 is a Friday. 10:00 EDT = 14:00 UTC; 11:58 EDT = 15:58 UTC.
  const headsUp = findDueAnnouncements(new Date('2026-10-09T14:00:30Z'), slots);
  assert.deepEqual(headsUp.map((due) => due.slot.kind), ['headsUp']);
  assert.equal(headsUp[0].occurrenceDate, '2026-10-09');

  const live = findDueAnnouncements(new Date('2026-10-09T15:58:00Z'), slots);
  assert.deepEqual(live.map((due) => due.slot.kind), ['live']);

  assert.equal(findDueAnnouncements(new Date('2026-10-09T13:59:00Z'), slots).length, 0);
  assert.equal(findDueAnnouncements(new Date('2026-10-08T14:00:00Z'), slots).length, 0); // Thursday
});

test('the schedule follows Eastern wall-clock time across the EST switch', () => {
  const slots = buildAnnouncementSlots([masterclass], LEADS);
  // 2026-12-11 is a Friday in EST (UTC-5): 10:00 ET is 15:00 UTC, not 14:00.
  assert.equal(findDueAnnouncements(new Date('2026-12-11T14:00:00Z'), slots).length, 0);
  assert.equal(findDueAnnouncements(new Date('2026-12-11T15:00:00Z'), slots).length, 1);
});

test('a late tick still posts within the 5-minute grace window, and not after', () => {
  const slots = buildAnnouncementSlots([masterclass], LEADS);
  assert.equal(findDueAnnouncements(new Date('2026-10-09T14:04:59Z'), slots).length, 1);
  assert.equal(findDueAnnouncements(new Date('2026-10-09T14:05:00Z'), slots).length, 0);
});

test('a lead time that crosses midnight (and the week boundary) announces the day before', () => {
  const mondayAfterMidnight = { ...masterclass, schedule: [{ weekday: 'Mon', hour: 1, minute: 0 }] };
  const slots = buildAnnouncementSlots([mondayAfterMidnight], LEADS);
  // Heads-up for Mon 01:00 is Sun 23:00 EDT on 2026-10-04 = 2026-10-05 03:00 UTC.
  const [due] = findDueAnnouncements(new Date('2026-10-05T03:00:00Z'), slots);
  assert.equal(due.slot.kind, 'headsUp');
  assert.equal(due.occurrenceDate, '2026-10-04');
});

test('formatAnnouncement: heads-up shows the EST start time, live says it is live', () => {
  const [headsUp, live] = buildAnnouncementSlots([masterclass], LEADS);
  assert.equal(
    formatAnnouncement({ ...headsUp, ping: '@everyone' }),
    `@everyone 📣 **The Called Masterclass** starts in 2 hours — 12:00 PM EST.\nJoin here: ${LINK}`
  );
  assert.equal(
    formatAnnouncement({ ...live, ping: '@everyone' }),
    `@everyone 🔴 **The Called Masterclass** is live!\nJoin here: ${LINK}`
  );
  assert.equal(
    formatAnnouncement({ ...headsUp, leadMinutes: 90, startHour: 19, startMinute: 30, ping: '' }),
    `📣 **The Called Masterclass** starts in 1 hour 30 minutes — 7:30 PM EST.\nJoin here: ${LINK}`
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
      slots: buildAnnouncementSlots([masterclass], LEADS),
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

  await postDueCallAnnouncements({ ...args, now: new Date('2026-10-09T14:00:00Z') });
  await postDueCallAnnouncements({ ...args, now: new Date('2026-10-09T14:01:00Z') });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].channelId, 'announcements');
  assert.match(posts[0].message, /starts in 2 hours/);

  await postDueCallAnnouncements({ ...args, now: new Date('2026-10-09T15:58:00Z') });
  assert.equal(posts.length, 2);
  assert.match(posts[1].message, /is live!/);

  assert.deepEqual(state.callAnnouncementsLastPosted, {
    'masterclass:Fri 12:00:headsUp': '2026-10-09',
    'masterclass:Fri 12:00:live': '2026-10-09',
  });

  // Next week's occurrence posts again.
  await postDueCallAnnouncements({ ...args, now: new Date('2026-10-16T14:00:00Z') });
  assert.equal(posts.length, 3);
});

test('a failed post is retried on the next tick inside the grace window', async () => {
  const { posts, args } = makeHarness({ failSends: 1 });

  await postDueCallAnnouncements({ ...args, now: new Date('2026-10-09T14:00:00Z') });
  assert.equal(posts.length, 0);

  await postDueCallAnnouncements({ ...args, now: new Date('2026-10-09T14:01:00Z') });
  assert.equal(posts.length, 1);
});
