import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatWelcomeMessage } from '../src/onboarding/welcomeMessage.js';

test('includes the member mention and both team mentions', () => {
  const message = formatWelcomeMessage({ memberMention: '<@999>', notionDashboardUrl: '' });
  assert.match(message, /^<@999> — welcome to The Called/);
  assert.match(message, /<@414934911724552202>/); // Noah
  assert.match(message, /<@491021691367981056>/); // Andrew
});

test('appends the email ask', () => {
  const message = formatWelcomeMessage({ memberMention: '<@999>', notionDashboardUrl: '' });
  assert.match(message, /reply here with the \*\*email address you purchased with\*\*/);
});

test('uses a placeholder when no Notion link is configured', () => {
  const message = formatWelcomeMessage({ memberMention: '<@999>', notionDashboardUrl: '' });
  assert.match(message, /Here is your Notion Dashboard: \[Insert Link\]/);
});

test('uses the real link once configured', () => {
  const message = formatWelcomeMessage({
    memberMention: '<@999>',
    notionDashboardUrl: 'https://notion.so/dashboard',
  });
  assert.match(message, /Here is your Notion Dashboard: https:\/\/notion\.so\/dashboard/);
});
