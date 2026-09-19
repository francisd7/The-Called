import { strict as assert } from 'node:assert';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import { notifyBooking, notifyTriage, outcomeIsNews } from '../src/lib/discord.ts';

type Captured = { path: string; auth: string | undefined; body: { content?: string } };
let captured: Captured[] = [];
let respondWith = 200;
let server: Server;

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      captured.push({
        path: req.url ?? '',
        auth: req.headers.authorization,
        body: JSON.parse(raw || '{}'),
      });
      res.writeHead(respondWith, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  process.env.DISCORD_API_BASE = `http://127.0.0.1:${port}`;
  process.env.DISCORD_BOT_TOKEN = 'test-token';
  process.env.DISCORD_TRIAGE_CHANNEL_ID = 'triage-channel';
  process.env.DISCORD_SETTER_CHANNEL_ID = 'setter-channel';
});

after(() => server.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeLead(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'lead-1',
    igHandle: 'grittraining_',
    name: 'Grit Training',
    phone: '647-555-0199',
    callScheduledFor: new Date('2026-09-19T15:30:00Z'),
    closerName: 'Nigel',
    isTest: false,
    confirmed: true,
    triageNotes: 'Wants to grow his brand. Budget is tight but real.',
    ...overrides,
  };
}

test('the triage brief carries what a closer needs to open cold', async () => {
  captured = [];
  respondWith = 200;
  assert.equal(await notifyTriage(fakeLead(), 'Alexis'), true);
  assert.equal(captured.length, 1);

  const { path, auth, body } = captured[0];
  assert.equal(path, '/channels/triage-channel/messages');
  assert.equal(auth, 'Bot test-token');

  const content = body.content ?? '';
  assert.match(content, /Grit Training/);
  assert.match(content, /647-555-0199/);
  assert.match(content, /Wants to grow his brand/);
  assert.match(content, /Nigel/);
  assert.match(content, /triaged by Alexis/);
  // 15:30 UTC is 11:30 ET - a closer reading this must not have to convert.
  assert.match(content, /11:30/);
});

test('an unconfirmed call is flagged in the brief, not silently normal', async () => {
  captured = [];
  await notifyTriage(fakeLead({ confirmed: false }), 'Loui');
  assert.match(captured[0].body.content ?? '', /not yet/);
});

test('a booking notice names the offer and the time', async () => {
  captured = [];
  assert.equal(await notifyBooking(fakeLead(), 'Brotherhood Breakthrough'), true);
  assert.equal(captured[0].path, '/channels/setter-channel/messages');
  assert.match(captured[0].body.content ?? '', /Brotherhood Breakthrough/);
  assert.match(captured[0].body.content ?? '', /Call booked/);
});

test('a Discord outage is reported, never thrown', async () => {
  captured = [];
  respondWith = 500;
  // The caller saves the triage notes first and uses this to tell the setter
  // to post manually - throwing here would lose their work.
  assert.equal(await notifyTriage(fakeLead(), 'Alexis'), false);
  respondWith = 200;
});

test('a long triage note is truncated to fit Discord rather than rejected', async () => {
  captured = [];
  await notifyTriage(fakeLead({ triageNotes: 'x'.repeat(5000) }), 'Alexis');
  assert.ok((captured[0].body.content ?? '').length <= 2000);
});

test('no bot token means no send, and no crash', async () => {
  captured = [];
  const token = process.env.DISCORD_BOT_TOKEN;
  delete process.env.DISCORD_BOT_TOKEN;
  assert.equal(await notifyTriage(fakeLead(), 'Alexis'), false);
  assert.equal(captured.length, 0);
  process.env.DISCORD_BOT_TOKEN = token;
});

test('a test lead never reaches Discord, from either notifier', async () => {
  // Rehearsing the flow must not put a brief for a call that doesn't exist in
  // front of the closers. Checked here as well as at the call sites, so a
  // forgotten guard upstream still can't send.
  captured = [];
  respondWith = 200;

  assert.equal(await notifyTriage(fakeLead({ isTest: true }), 'Alexis'), false);
  assert.equal(await notifyBooking(fakeLead({ isTest: true }), 'Brotherhood'), false);
  assert.equal(captured.length, 0, 'a test lead must produce no Discord traffic at all');

  // ...and a real one still sends, so the guard isn't just blocking everything.
  assert.equal(await notifyTriage(fakeLead(), 'Alexis'), true);
  assert.equal(captured.length, 1);
});

test('the EOD post carries the numbers, not just that one was filed', async () => {
  // The Airtable version announced a submission and nothing else, so everyone
  // had to open the record to learn anything.
  captured = [];
  respondWith = 200;
  const { notifyEodSubmitted } = await import('../src/lib/discord.ts');

  assert.equal(
    await notifyEodSubmitted({
      setterName: 'Loui',
      reportDate: '2026-09-18',
      outbounds: 82,
      followUps: 31,
      replies: 14,
      callsBooked: 2,
      win: 'Booked two off the fitness angle',
      obstacle: null,
      streakDays: 5,
      isUpdate: false,
    }),
    true
  );

  const content = captured[0].body.content ?? '';
  assert.match(content, /Loui/);
  assert.match(content, /submitted their EOD/);
  assert.match(content, /Outbounds 82/);
  assert.match(content, /Booked 2/);
  assert.match(content, /5 days in a row/);
  assert.match(content, /fitness angle/);
  assert.equal(captured[0].path, '/channels/setter-channel/messages');
});

test('a zero is reported, but a blank is left out', async () => {
  // Zero outbounds is a real and meaningful number; a field nobody filled in
  // is not, and printing "Replies 0" for it would invent data.
  captured = [];
  const { notifyEodSubmitted } = await import('../src/lib/discord.ts');
  await notifyEodSubmitted({
    setterName: 'Alexis',
    reportDate: '2026-09-18',
    outbounds: 0,
    followUps: null,
    replies: null,
    callsBooked: null,
    win: null,
    obstacle: null,
    streakDays: 1,
    isUpdate: true,
  });

  const content = captured[0].body.content ?? '';
  assert.match(content, /Outbounds 0/);
  assert.doesNotMatch(content, /Follow-ups/);
  assert.doesNotMatch(content, /Replies/);
  // A one-day streak isn't a streak worth announcing.
  assert.doesNotMatch(content, /days in a row/);
  assert.match(content, /updated their EOD/);
});

test('a close is announced as a close, with the money', async () => {
  captured = [];
  respondWith = 200;
  const { notifyOutcome } = await import('../src/lib/discord.ts');

  const lead = fakeLead({
    callOutcome: 'closed',
    contractValue: '10000.00',
    cashCollected: '5000.00',
    tier: 'Momentum',
    postCallNotes: 'Split over 5 months.',
  });
  assert.equal(await notifyOutcome(lead, 'Francis'), true);

  const content = captured[0].body.content ?? '';
  assert.match(content, /Closed/);
  assert.match(content, /\$10,000/);
  assert.match(content, /\$5,000/);
  assert.match(content, /Momentum/);
  assert.match(content, /logged by Francis/);
});

test('a no-show says so instead of reporting money it does not have', async () => {
  captured = [];
  const { notifyOutcome } = await import('../src/lib/discord.ts');
  await notifyOutcome(fakeLead({ callOutcome: 'no_show', contractValue: null, cashCollected: null }), 'Loui');

  const content = captured[0].body.content ?? '';
  assert.match(content, /No show/);
  assert.doesNotMatch(content, /Contract/);
  assert.doesNotMatch(content, /Cash in/);
});

test('a test lead outcome still never reaches Discord', async () => {
  captured = [];
  const { notifyOutcome } = await import('../src/lib/discord.ts');
  assert.equal(await notifyOutcome(fakeLead({ isTest: true, callOutcome: 'closed' }), 'Francis'), false);
  assert.equal(captured.length, 0);
});

test('a result from today is news, one from last month is not', () => {
  const now = Date.parse('2026-09-19T22:00:00Z');
  const at = (iso: string) => ({ callScheduledFor: new Date(iso), postCallRecordId: null });

  assert.equal(outcomeIsNews(at('2026-09-19T18:00:00Z'), now), true, "today's call");
  assert.equal(outcomeIsNews(at('2026-09-18T18:00:00Z'), now), true, 'yesterday still counts');
  assert.equal(outcomeIsNews(at('2026-09-03T10:00:00Z'), now), false, 'a backfill from weeks ago');
  // Right on the boundary, and just past it.
  assert.equal(outcomeIsNews(at('2026-09-17T22:00:00Z'), now), true);
  assert.equal(outcomeIsNews(at('2026-09-17T21:59:00Z'), now), false);
});

test('a call Airtable already announced is never announced again', () => {
  const now = Date.parse('2026-09-19T22:00:00Z');
  assert.equal(
    outcomeIsNews(
      { callScheduledFor: new Date('2026-09-19T20:00:00Z'), postCallRecordId: 'recAbc' },
      now
    ),
    false,
    'the Post Call form already posted this one'
  );
});

test('an outcome with no call date is treated as a backfill', () => {
  // In practice a missing date means nobody recorded the call at the time,
  // which means this is being typed up long afterwards.
  assert.equal(outcomeIsNews({ callScheduledFor: null, postCallRecordId: null }), false);
});
