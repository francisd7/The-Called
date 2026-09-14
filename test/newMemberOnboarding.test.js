import { test } from 'node:test';
import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import { ChannelType } from 'discord.js';
import {
  FALLBACK_STAFF_ROLE_NAMES,
  findClientByEmail,
  buildNewClientFields,
  buildJoinPlan,
  detectTierMismatch,
  registerNewMemberOnboarding,
} from '../src/onboarding/newMemberOnboarding.js';
import { parseInviteRoleMap } from '../src/discord/inviteRoles.js';
import { getTierByKey, TIERS } from '../src/discord/tiers.js';
import { RESOLVED, NO_CHANGE, AMBIGUOUS } from '../src/discord/inviteTracker.js';

test('findClientByEmail normalizes and queries by a case/whitespace-insensitive formula', async () => {
  let capturedFormula;
  const airtableClient = {
    listRecords: async (baseId, tableId, { filterByFormula }) => {
      capturedFormula = filterByFormula;
      return [{ id: 'recABC' }];
    },
  };

  const result = await findClientByEmail(airtableClient, 'appXXX', '  Jane@Example.COM  ');

  assert.equal(result.id, 'recABC');
  assert.equal(capturedFormula, "LOWER(TRIM({Email})) = 'jane@example.com'");
});

test('findClientByEmail returns null when nothing matches', async () => {
  const airtableClient = { listRecords: async () => [] };
  const result = await findClientByEmail(airtableClient, 'appXXX', 'nobody@example.com');
  assert.equal(result, null);
});

test('buildNewClientFields builds a starter record with Status Active', () => {
  assert.deepEqual(
    buildNewClientFields({
      displayName: 'Jack Garcia',
      email: 'jack@example.com',
      discordUserId: 'member1',
      joinDate: '2026-09-09',
    }),
    {
      'Client Name': 'Jack Garcia',
      Email: 'jack@example.com',
      'Discord ID': 'member1',
      'Start Date': '2026-09-09',
      Status: 'Active',
    }
  );
});

function makeDiscordStub() {
  const client = new EventEmitter();
  client.user = { id: 'bot1' };
  const sentChannelMessages = [];
  return {
    client,
    createPrivateChannel: async () => {
      throw new Error('not used in these tests');
    },
    sendToChannel: async (channelId, message) => sentChannelMessages.push({ channelId, message }),
    sendDM: async () => {
      throw new Error('not used in these tests');
    },
    _sentChannelMessages: sentChannelMessages,
  };
}

function makeChannelStub(id) {
  const sent = [];
  return { id, send: async (message) => sent.push(message), _sent: sent };
}

const GUILD_ROLES = ['CSM', 'COO', 'CMO', 'Nigel', 'Coach', 'Tier: Foundations'];

function makeGuildStub({ categories = [] } = {}) {
  const roles = GUILD_ROLES.map((name) => ({ id: `role-${name}`, name }));
  const channels = categories.map((name) => ({
    id: `cat-${name}`,
    name,
    type: ChannelType.GuildCategory,
  }));
  return {
    id: 'guild1',
    roles: { cache: { find: (fn) => roles.find(fn) } },
    channels: { cache: { values: () => channels } },
  };
}

function makeMemberStub(guild) {
  return {
    id: 'member1',
    guild,
    displayName: 'Jack Garcia',
    user: { username: 'jack' },
    roles: { add: async () => {} },
  };
}

// Runs a join end to end and hands back the overwrites the private channel
// was actually created with.
async function joinAndCaptureOverwrites({ guild, inviteTracker = null, inviteRoleMap }) {
  const discord = makeDiscordStub();
  let created = null;
  discord.createPrivateChannel = async (guildId, options) => {
    created = options;
    return makeChannelStub('chanNew');
  };

  registerNewMemberOnboarding({
    discord,
    airtableClient: { listRecords: async () => [] },
    clientGuildId: 'guild1',
    clientSuccessBaseId: 'appXXX',
    flagChannelId: 'flagChan',
    notionDashboardUrl: '',
    state: {},
    saveState: async () => {},
    inviteTracker,
    inviteRoleMap,
    log: { info: () => {}, error: () => {} },
  });

  discord.client.emit('guildMemberAdd', makeMemberStub(guild));
  await new Promise((resolve) => setImmediate(resolve));
  return created;
}

// Coach reaches every category so Eddie can run the weekly call and see each
// tier's announcements and chat. It must never reach a client's private
// channel. Every path builds that channel from tiers.js staffRoleNames, which
// omits Coach - this pins the one path that has no tier to read it from.
test('an unresolved invite grants CSM only — never Coach', async () => {
  const overwrites = await joinAndCaptureOverwrites({
    guild: makeGuildStub(),
    inviteRoleMap: new Map(),
  });

  const granted = overwrites.overwrites.filter((o) => o.allow).map((o) => o.id);
  assert.ok(granted.includes('role-CSM'), 'the CSM can see a new client channel');
  assert.ok(!granted.includes('role-Coach'), 'Coach must not be on a private client channel');
  assert.deepEqual(FALLBACK_STAFF_ROLE_NAMES, ['CSM']);
});

test('a resolved tier grants exactly that tier\'s staff — never Coach', async () => {
  const overwrites = await joinAndCaptureOverwrites({
    guild: makeGuildStub({ categories: ['FOUNDATIONS'] }),
    inviteTracker: { resolveForJoin: async () => ({ code: 'low', reason: RESOLVED }) },
    inviteRoleMap: parseInviteRoleMap('low=foundations').map,
  });

  const granted = overwrites.overwrites.filter((o) => o.allow).map((o) => o.id);
  assert.deepEqual(granted, ['member1', 'bot1', 'role-CSM', 'role-COO']);
  assert.ok(!granted.includes('role-Coach'));
});

// Belt and braces: the rule is a property of the data, so assert it there too
// rather than only through the one path a test happens to walk.
test('no tier puts Coach in its private client channels', () => {
  for (const tier of TIERS) {
    assert.ok(!tier.staffRoleNames.includes('Coach'), `${tier.name} must not grant Coach`);
  }
});

test('messageCreate: matches a pending member\'s email, writes Discord ID, confirms', async () => {
  const discord = makeDiscordStub();
  const state = {
    newMemberOnboardingPending: { chan1: { discordUserId: 'member1', displayName: 'Jane Doe' } },
  };
  const saved = [];
  const updates = [];
  const airtableClient = {
    listRecords: async () => [{ id: 'recABC' }],
    updateRecord: async (baseId, tableId, recordId, fields) => updates.push({ recordId, fields }),
    createRecord: async () => {
      throw new Error('should not create when a match was found');
    },
  };

  registerNewMemberOnboarding({
    discord,
    airtableClient,
    clientGuildId: 'guild1',
    clientSuccessBaseId: 'appXXX',
    flagChannelId: 'flagChan',
    notionDashboardUrl: '',
    state,
    saveState: async (s) => saved.push(JSON.parse(JSON.stringify(s))),
    log: { info: () => {}, error: () => {} },
  });

  const channel = makeChannelStub('chan1');
  discord.client.emit('messageCreate', {
    author: { id: 'member1', bot: false },
    channel,
    content: 'jane@example.com',
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], { recordId: 'recABC', fields: { 'Discord ID': 'member1' } });
  assert.equal(channel._sent.length, 1);
  assert.match(channel._sent[0], /You're all set/);
  assert.equal(state.newMemberOnboardingPending.chan1, undefined);
});

test('messageCreate: no match creates a starter Client record and flags staff to fill it in', async () => {
  const discord = makeDiscordStub();
  const state = {
    newMemberOnboardingPending: { chan1: { discordUserId: 'member1', displayName: 'Jane Doe' } },
  };
  const created = [];
  const airtableClient = {
    listRecords: async () => [],
    updateRecord: async () => {
      throw new Error('should not update when nothing matched');
    },
    createRecord: async (baseId, tableId, fields) => {
      created.push({ baseId, tableId, fields });
      return { id: 'recNEW' };
    },
  };

  registerNewMemberOnboarding({
    discord,
    airtableClient,
    clientGuildId: 'guild1',
    clientSuccessBaseId: 'appXXX',
    flagChannelId: 'flagChan',
    notionDashboardUrl: '',
    state,
    saveState: async () => {},
    log: { info: () => {}, error: () => {} },
  });

  const channel = makeChannelStub('chan1');
  discord.client.emit('messageCreate', {
    author: { id: 'member1', bot: false },
    channel,
    content: 'nobody@example.com',
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(created.length, 1);
  assert.equal(created[0].fields['Client Name'], 'Jane Doe');
  assert.equal(created[0].fields.Email, 'nobody@example.com');
  assert.equal(created[0].fields['Discord ID'], 'member1');
  assert.equal(created[0].fields.Status, 'Active');
  assert.match(created[0].fields['Start Date'], /^\d{4}-\d{2}-\d{2}$/);

  assert.equal(channel._sent.length, 1);
  assert.match(channel._sent[0], /You're all set/);

  assert.equal(discord._sentChannelMessages.length, 1);
  assert.equal(discord._sentChannelMessages[0].channelId, 'flagChan');
  assert.match(discord._sentChannelMessages[0].message, /nobody@example\.com/);
  assert.match(discord._sentChannelMessages[0].message, /starter record/);

  assert.equal(state.newMemberOnboardingPending.chan1, undefined);
});

test('messageCreate: non-email text prompts a retry without querying Airtable', async () => {
  const discord = makeDiscordStub();
  const state = {
    newMemberOnboardingPending: { chan1: { discordUserId: 'member1', displayName: 'Jane Doe' } },
  };
  const airtableClient = {
    listRecords: async () => {
      throw new Error('should not query for non-email text');
    },
  };

  registerNewMemberOnboarding({
    discord,
    airtableClient,
    clientGuildId: 'guild1',
    clientSuccessBaseId: 'appXXX',
    flagChannelId: 'flagChan',
    notionDashboardUrl: '',
    state,
    saveState: async () => {},
    log: { info: () => {}, error: () => {} },
  });

  const channel = makeChannelStub('chan1');
  discord.client.emit('messageCreate', {
    author: { id: 'member1', bot: false },
    channel,
    content: 'hey whats up',
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(channel._sent.length, 1);
  assert.match(channel._sent[0], /doesn't look like an email/);
  // still pending - not cleared
  assert.deepEqual(state.newMemberOnboardingPending.chan1, {
    discordUserId: 'member1',
    displayName: 'Jane Doe',
  });
});

test('messageCreate: ignores messages from someone other than the pending member', async () => {
  const discord = makeDiscordStub();
  const state = {
    newMemberOnboardingPending: { chan1: { discordUserId: 'member1', displayName: 'Jane Doe' } },
  };
  const airtableClient = {
    listRecords: async () => {
      throw new Error('should not be called for a different author');
    },
  };

  registerNewMemberOnboarding({
    discord,
    airtableClient,
    clientGuildId: 'guild1',
    clientSuccessBaseId: 'appXXX',
    flagChannelId: 'flagChan',
    notionDashboardUrl: '',
    state,
    saveState: async () => {},
    log: { info: () => {}, error: () => {} },
  });

  const channel = makeChannelStub('chan1');
  discord.client.emit('messageCreate', {
    author: { id: 'someone-else', bot: false },
    channel,
    content: 'jane@example.com',
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(channel._sent.length, 0);
});

const INVITE_MAP = parseInviteRoleMap(
  'mid=momentum,low=foundations,bible=the-called'
).map;

test('a resolved invite decides the tier and the roles to grant', () => {
  const plan = buildJoinPlan({
    resolution: { code: 'mid', reason: RESOLVED },
    inviteRoleMap: INVITE_MAP,
  });
  // Tier only. Brand gates nothing since the brand categories were deleted,
  // so it is assigned by hand rather than doubling the list of links the team
  // picks from - where a mis-pick could land on the wrong tier.
  assert.deepEqual(plan.roleNames, ['Tier: Momentum']);
  assert.equal(plan.tier.key, 'momentum');
  assert.equal(plan.brand, null);
  assert.equal(plan.flagReason, null);
});

// The safety property that matters most: when the bot cannot tell which link
// was used, it must grant nothing rather than guess a tier.
test('an unidentifiable invite grants no roles and says why', () => {
  const plan = buildJoinPlan({
    resolution: { code: null, reason: NO_CHANGE },
    inviteRoleMap: INVITE_MAP,
  });
  assert.deepEqual(plan.roleNames, []);
  assert.equal(plan.tier, null);
  assert.match(plan.flagReason, /Could not tell which invite link was used/);
});

test('simultaneous joins are flagged as ambiguous, not resolved to one of them', () => {
  const plan = buildJoinPlan({
    resolution: { code: null, reason: AMBIGUOUS },
    inviteRoleMap: INVITE_MAP,
  });
  assert.deepEqual(plan.roleNames, []);
  assert.match(plan.flagReason, /Two people joined at once/);
});

test('an unmapped invite code is flagged by code so it can be added to the map', () => {
  const plan = buildJoinPlan({
    resolution: { code: 'mysteryLink', reason: RESOLVED },
    inviteRoleMap: INVITE_MAP,
  });
  assert.deepEqual(plan.roleNames, []);
  assert.match(plan.flagReason, /mysteryLink/);
  assert.match(plan.flagReason, /DISCORD_INVITE_ROLE_MAP/);
});

test('no invite tracker at all still yields a safe, role-free plan', () => {
  const plan = buildJoinPlan({ resolution: null, inviteRoleMap: INVITE_MAP });
  assert.deepEqual(plan.roleNames, []);
  assert.ok(plan.flagReason);
});

test('the bible-study link grants its roles but maps to no private channel', () => {
  const plan = buildJoinPlan({
    resolution: { code: 'bible', reason: RESOLVED },
    inviteRoleMap: INVITE_MAP,
  });
  // The one link that still carries a brand: that tier has exactly one, so
  // nothing is being guessed.
  assert.deepEqual(plan.roleNames, ['The Called', 'Tier: The Called']);
  assert.equal(plan.tier.hasPrivateChannel, false);
});

// The forwarded-link backstop.
test('a joiner whose record shows a different package is flagged', () => {
  const mismatch = detectTierMismatch({
    inviteTier: getTierByKey('momentum'),
    clientRecord: { fields: { 'Package / Tier': 'Foundations' } },
  });
  assert.match(mismatch, /Momentum/);
  assert.match(mismatch, /Foundations/);
  assert.match(mismatch, /shared link/);
});

test('a matching package is not flagged', () => {
  assert.equal(
    detectTierMismatch({
      inviteTier: getTierByKey('momentum'),
      clientRecord: { fields: { 'Package / Tier': 'Momentum' } },
    }),
    null
  );
});

test('tier mismatch copes with Airtable returning a select as an object', () => {
  const mismatch = detectTierMismatch({
    inviteTier: getTierByKey('inner-circle'),
    clientRecord: { fields: { 'Package / Tier': { id: 'sel1', name: 'Foundations' } } },
  });
  assert.match(mismatch, /Foundations/);
});

test('nothing to compare against is not a mismatch', () => {
  assert.equal(detectTierMismatch({ inviteTier: null, clientRecord: { fields: {} } }), null);
  assert.equal(detectTierMismatch({ inviteTier: getTierByKey('momentum'), clientRecord: null }), null);
  assert.equal(
    detectTierMismatch({ inviteTier: getTierByKey('momentum'), clientRecord: { fields: {} } }),
    null,
    'a record with no package recorded yet is the normal new-signup case'
  );
});

test('a starter record carries the brand and tier the invite established', () => {
  assert.deepEqual(
    buildNewClientFields({
      displayName: 'Jack Garcia',
      email: 'jack@example.com',
      discordUserId: 'member1',
      joinDate: '2026-09-09',
      brandValue: 'Called Coaches',
      tierValue: 'Momentum',
    }),
    {
      'Client Name': 'Jack Garcia',
      Email: 'jack@example.com',
      'Discord ID': 'member1',
      'Start Date': '2026-09-09',
      Status: 'Active',
      Brand: 'Called Coaches',
      'Package / Tier': 'Momentum',
    }
  );
});

test('an unresolved invite leaves brand and tier off the record rather than guessing', () => {
  const fields = buildNewClientFields({
    displayName: 'Jack Garcia',
    email: 'jack@example.com',
    discordUserId: 'member1',
    joinDate: '2026-09-09',
    brandValue: null,
    tierValue: null,
  });
  assert.equal('Brand' in fields, false);
  assert.equal('Package / Tier' in fields, false);
});
