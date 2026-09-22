import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { reelMetrics, shortcodeFromUrl } from '../src/lib/reelMetrics.ts';

const blank = {
  spend: null, views: null, reach: null, likes: null, comments: null,
  shares: null, saves: null, leadsGenerated: null, callsBooked: null,
  closes: null, cashCollected: null,
};

test('a reel link gives up its shortcode', () => {
  assert.equal(shortcodeFromUrl('https://www.instagram.com/reel/C8xYz-1AbCd/'), 'C8xYz-1AbCd');
});

test('the other three shapes Instagram serves the same post under all work', () => {
  assert.equal(shortcodeFromUrl('https://instagram.com/reels/AbC123/'), 'AbC123');
  assert.equal(shortcodeFromUrl('https://www.instagram.com/p/AbC123/'), 'AbC123');
  assert.equal(shortcodeFromUrl('https://www.instagram.com/tv/AbC123/'), 'AbC123');
});

test('the tracking junk the app adds when you copy a link is ignored', () => {
  assert.equal(
    shortcodeFromUrl('https://www.instagram.com/reel/C8xYz-1AbCd/?igsh=MzRlODBiNWFlZA=='),
    'C8xYz-1AbCd'
  );
});

test('a link that names the account still works', () => {
  // Copied from a profile rather than the post, which is the usual case.
  assert.equal(shortcodeFromUrl('https://www.instagram.com/thecalled/reel/AbC123/'), 'AbC123');
});

test('a bare shortcode pasted from a spreadsheet is taken as one', () => {
  assert.equal(shortcodeFromUrl('C8xYz-1AbCd'), 'C8xYz-1AbCd');
});

test('a link we cannot read gives null rather than a guess', () => {
  // Showing a preview of the wrong post is worse than showing none.
  assert.equal(shortcodeFromUrl('https://tiktok.com/@someone/video/123'), null);
  assert.equal(shortcodeFromUrl('not a url at all!'), null);
  assert.equal(shortcodeFromUrl(''), null);
  assert.equal(shortcodeFromUrl(null), null);
});

test('cost per lead is spend over leads', () => {
  const m = reelMetrics({ ...blank, spend: '100.00', leadsGenerated: 8 });
  assert.equal(m.costPerLead, 12.5);
});

test('nothing divides by zero into a fake result', () => {
  // A reel with no leads yet has no cost per lead - not an infinite one.
  const m = reelMetrics({ ...blank, spend: '100.00', leadsGenerated: 0, callsBooked: 0, closes: 0 });
  assert.equal(m.costPerLead, null);
  assert.equal(m.costPerCall, null);
  assert.equal(m.costPerClose, null);
});

test('a number nobody has entered stays unknown rather than becoming zero', () => {
  const m = reelMetrics(blank);
  assert.equal(m.costPerLead, null);
  assert.equal(m.roas, null);
  assert.equal(m.net, null);
  assert.equal(m.engagementRate, null);
});

test('return and net come off spend and cash together', () => {
  const m = reelMetrics({ ...blank, spend: '500.00', cashCollected: '2000.00' });
  assert.equal(m.roas, 4);
  assert.equal(m.net, 1500);
});

test('a reel that lost money says so rather than hiding it', () => {
  const m = reelMetrics({ ...blank, spend: '500.00', cashCollected: '100.00' });
  assert.equal(m.net, -400);
  assert.equal(m.roas, 0.2);
});

test('engagement counts every interaction against reach', () => {
  const m = reelMetrics({ ...blank, reach: 1000, likes: 50, comments: 10, shares: 15, saves: 25 });
  assert.equal(m.engagementRate, 0.1);
});

test('engagement with reach but no interactions entered is unknown, not zero', () => {
  const m = reelMetrics({ ...blank, reach: 1000 });
  assert.equal(m.engagementRate, null);
});

test('partial interaction numbers still count', () => {
  // Instagram does not always surface all four, so requiring all of them would
  // leave the rate blank on most reels.
  const m = reelMetrics({ ...blank, reach: 200, likes: 20 });
  assert.equal(m.engagementRate, 0.1);
});

test('the funnel rates read off the counts', () => {
  const m = reelMetrics({ ...blank, leadsGenerated: 20, callsBooked: 5, closes: 2 });
  assert.equal(m.leadToCall, 0.25);
  assert.equal(m.callToClose, 0.4);
});

test('spend of zero gives free leads, but no return figure', () => {
  const m = reelMetrics({ ...blank, spend: '0', cashCollected: '100', leadsGenerated: 4 });
  // Four leads for nothing really is nothing each - that is a result, not a gap.
  assert.equal(m.costPerLead, 0);
  // Return is cash over spend, and there is no multiple of zero.
  assert.equal(m.roas, null);
  assert.equal(m.net, 100);
});
