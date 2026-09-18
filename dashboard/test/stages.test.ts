import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { respondedFromStage } from '../src/lib/stages.ts';

test('reaching rapport or beyond means they replied', () => {
  for (const stage of ['rapport', 'business_talk', 'proposed_call', 'call_booked', 'closed']) {
    assert.equal(respondedFromStage(stage), true, `${stage} should count as a reply`);
  }
});

test('a lead put down for later replied before they went quiet', () => {
  assert.equal(respondedFromStage('follow_up_later'), true);
});

test('still sitting at outreached means no reply', () => {
  assert.equal(respondedFromStage('not_outreached'), false);
  assert.equal(respondedFromStage('outreached'), false);
  assert.equal(respondedFromStage('no_response'), false);
});

test('bad fit settles nothing either way', () => {
  // It can be set on sight or after a conversation, so whatever is already
  // recorded should stand rather than be overwritten by a guess.
  assert.equal(respondedFromStage('bad_fit'), null);
  assert.equal(respondedFromStage(null), null);
  assert.equal(respondedFromStage('something_new'), null);
});
