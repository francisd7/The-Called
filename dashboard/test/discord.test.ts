import { strict as assert } from 'node:assert';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import { notifyBooking, notifyTriage } from '../src/lib/discord.ts';

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
