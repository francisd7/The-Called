import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { reelMetrics, shortcodeFromUrl } from '../src/lib/reelMetrics.ts';

const blank = {
  spend: null, views: null, impressions: null, reach: null, profileVisits: null,
  linkClicks: null, likes: null, comments: null, shares: null, saves: null,
  leadsGenerated: null, callsBooked: null, closes: null, cashCollected: null,
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

// --- totals ---
import { summariseReels } from '../src/lib/reelMetrics.ts';

const reel = (over: Record<string, unknown> = {}) => ({ ...blank, spendCurrency: 'USD', ...over });

test('totals add the reels up and work the rates off the sums', () => {
  const [t] = summariseReels([
    reel({ spend: '400', cashCollected: '8000', leadsGenerated: 40, callsBooked: 8, closes: 2 }),
    reel({ spend: '100', cashCollected: '2000', leadsGenerated: 10, callsBooked: 2, closes: 1 }),
  ]);
  assert.equal(t.reels, 2);
  assert.equal(t.spend, 500);
  assert.equal(t.cash, 10000);
  assert.equal(t.net, 9500);
  assert.equal(t.costPerLead, 10);
  assert.equal(t.costPerCall, 50);
  assert.equal(t.roas, 20);
});

test('two currencies never blend into one meaningless figure', () => {
  // A cost per lead mixing CAD spend with USD spend is not a number in either
  // currency, and it is exactly the number a boosting decision gets made on.
  const rows = summariseReels([
    reel({ spend: '400', leadsGenerated: 40 }),
    reel({ spendCurrency: 'CAD', spend: '200', leadsGenerated: 10 }),
  ]);
  assert.equal(rows.length, 2);
  const usd = rows.find((r) => r.currency === 'USD')!;
  const cad = rows.find((r) => r.currency === 'CAD')!;
  assert.equal(usd.costPerLead, 10);
  assert.equal(cad.costPerLead, 20);
});

test('the bigger spend is listed first', () => {
  const rows = summariseReels([
    reel({ spendCurrency: 'CAD', spend: '50' }),
    reel({ spend: '900' }),
  ]);
  assert.equal(rows[0].currency, 'USD');
});

test('a reel with nothing filled in drags no total down', () => {
  const [t] = summariseReels([reel({ spend: '300', leadsGenerated: 30 }), reel()]);
  assert.equal(t.reels, 2);
  assert.equal(t.spend, 300);
  assert.equal(t.costPerLead, 10);
});

test('no reels, no rows', () => {
  assert.deepEqual(summariseReels([]), []);
});

test('a currency nobody set falls back to USD rather than its own row', () => {
  const rows = summariseReels([reel({ spend: '100' }), reel({ spendCurrency: '', spend: '50' })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].spend, 150);
});

test('what a profile visit cost is spend over visits', () => {
  const m = reelMetrics({ ...blank, spend: '57.70', profileVisits: 3108 });
  assert.ok(m.costPerProfileVisit !== null);
  assert.equal(m.costPerProfileVisit!.toFixed(4), '0.0186');
});

test('CPM is quoted per thousand impressions, the way the platforms do', () => {
  const m = reelMetrics({ ...blank, spend: '57.70', impressions: 126860 });
  assert.ok(m.cpm !== null);
  assert.equal(m.cpm!.toFixed(4), '0.4548');
});

test('click-through is clicks over impressions', () => {
  const m = reelMetrics({ ...blank, impressions: 1000, linkClicks: 26 });
  assert.equal(m.ctr, 0.026);
});

test('frequency is how many times the average person saw it', () => {
  const m = reelMetrics({ ...blank, impressions: 1200, reach: 1000 });
  assert.equal(m.frequency, 1.2);
});

test('a half nobody imported leaves the rate unknown rather than zero', () => {
  const m = reelMetrics({ ...blank, spend: '57.70' });
  assert.equal(m.costPerProfileVisit, null);
  assert.equal(m.cpm, null);
  assert.equal(m.ctr, null);
  assert.equal(m.frequency, null);
});

test('the totals add up what adds up and leave reach out of it', () => {
  const [t] = summariseReels([
    { ...blank, spendCurrency: 'CAD', spend: '57.70', impressions: 126860, reach: 108895, profileVisits: 3108 },
    { ...blank, spendCurrency: 'CAD', spend: '56.87', impressions: 148274, reach: 112745, profileVisits: 1691 },
  ]);
  assert.equal(t.impressions, 275134);
  assert.equal(t.profileVisits, 4799);
  assert.equal(t.spend, 114.57);
  assert.ok(!('reach' in t));
  assert.ok(t.costPerProfileVisit !== null);
  assert.equal(t.costPerProfileVisit!.toFixed(4), '0.0239');
});

test('a total nobody has entered is unknown rather than zero', () => {
  // The import fills spend and leaves cash to be entered by hand. Summing the
  // blanks to zero turned that into "net -115, 0.0x return" - a loss nobody
  // made, on a page that had only just been imported into.
  const [t] = summariseReels([
    { ...blank, spendCurrency: 'CAD', spend: '57.70', impressions: 126860 },
    { ...blank, spendCurrency: 'CAD', spend: '56.87', impressions: 148274 },
  ]);
  assert.equal(t.spend, 114.57);
  assert.equal(t.cash, null);
  assert.equal(t.net, null);
  assert.equal(t.roas, null);
  assert.equal(t.calls, null);
  assert.equal(t.costPerCall, null);
});

test('one reel with the number is enough for a total; the blanks add nothing', () => {
  const [t] = summariseReels([
    { ...blank, spendCurrency: 'CAD', spend: '100.00', cashCollected: '400.00' },
    { ...blank, spendCurrency: 'CAD', spend: '100.00' },
  ]);
  assert.equal(t.cash, 400);
  assert.equal(t.net, 200);
  assert.equal(t.roas, 2);
});
