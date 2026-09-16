import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMAIL_CONFIRMED_MESSAGE, formatWelcomeMessage } from '../src/onboarding/welcomeMessage.js';

test('includes the member mention and all three team mentions', () => {
  const message = formatWelcomeMessage({ memberMention: '<@999>', notionDashboardUrl: '' });
  assert.match(message, /^<@999> — welcome to The Called/);
  assert.match(message, /<@414934911724552202>/); // Noah
  assert.match(message, /<@491021691367981056>/); // Andrew
  assert.match(message, /<@584241323981406221>/); // Francis
});

// The email reply is what triggers dashboard delivery, so the ask says what
// they get for it rather than just "so we can link your account".
test('appends the email ask, tied to the Notion Dashboard', () => {
  const message = formatWelcomeMessage({ memberMention: '<@999>', notionDashboardUrl: '' });
  assert.match(message, /reply here with your \*\*email address\*\*/);
  assert.match(message, /send you your Notion Dashboard/);
});

test('the email confirmation says the dashboard is coming', () => {
  assert.match(EMAIL_CONFIRMED_MESSAGE, /Notion Dashboard is on its way/);
});

test('uses a "coming shortly" line when no Notion link is configured', () => {
  const message = formatWelcomeMessage({ memberMention: '<@999>', notionDashboardUrl: '' });
  assert.match(message, /You will get your Notion Dashboard shortly\./);
});

test('does not mention a walkthrough video (not made yet)', () => {
  const message = formatWelcomeMessage({ memberMention: '<@999>', notionDashboardUrl: '' });
  assert.doesNotMatch(message, /walkthrough video/i);
});

test('includes the mandatory intake form in both states', () => {
  for (const notionDashboardUrl of ['', 'https://notion.so/dashboard']) {
    const message = formatWelcomeMessage({ memberMention: '<@999>', notionDashboardUrl });
    assert.match(message, /https:\/\/tally\.so\/r\/KYEgkX/);
    assert.match(message, /before your call with Noah/);
  }
});

// Until the Notion link is configured the form is the only thing a new member
// can actually do, so it's framed as the stopgap - but "in the meantime" would
// read wrong once they have the dashboard in hand.
test('frames the intake form as the stopgap only while the Notion link is missing', () => {
  const waiting = formatWelcomeMessage({ memberMention: '<@999>', notionDashboardUrl: '' });
  assert.match(waiting, /In the meantime, here's something you can knock out right now/);

  const configured = formatWelcomeMessage({
    memberMention: '<@999>',
    notionDashboardUrl: 'https://notion.so/dashboard',
  });
  assert.doesNotMatch(configured, /In the meantime/i);
  assert.match(configured, /This intake form is part of onboarding as well/);
});

// Tasks live in Notion now (the "Follow and Track In Order" section, orange
// items) - the old two-item THE LEADER WITHIN / ONBOARDING SPRINT checklist
// was retired, so the message points at Notion instead of listing anything.
test('points at the Notion task section instead of an inline checklist', () => {
  const message = formatWelcomeMessage({ memberMention: '<@999>', notionDashboardUrl: '' });
  assert.match(message, /Knock all of those out before you hop on your 1:1 onboarding call/);
  assert.match(message, /make sure all the items in orange on the Follow and Track In Order/);
  assert.doesNotMatch(message, /THE LEADER WITHIN|ONBOARDING SPRINT/i);
  assert.doesNotMatch(message, /all three/i);
});

test('uses the real link once configured', () => {
  const message = formatWelcomeMessage({
    memberMention: '<@999>',
    notionDashboardUrl: 'https://notion.so/dashboard',
  });
  assert.match(message, /Here is your Notion Dashboard: https:\/\/notion\.so\/dashboard/);
});
