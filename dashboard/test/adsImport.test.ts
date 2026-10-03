import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  parseAdsExport,
  planAdsImport,
  tidyAdName,
  type ReelForMatch,
} from '../src/lib/adsImport.ts';

/** A Meta export with only the columns that matter here, day by day. */
function perDay(rows: Array<[string, string, string, string, string, string]>) {
  return [
    'Reporting starts,Reporting ends,Ad name,Results,Result indicator,Reach,Amount spent (CAD),Impressions',
    ...rows.map(([day, name, results, indicator, reach, spend]) =>
      [day, day, name, results, indicator, reach, spend, '1000'].join(',')
    ),
  ].join('\n');
}

const reel = (over: Partial<ReelForMatch> = {}): ReelForMatch => ({
  id: 'r1',
  title: 'A reel',
  adName: null,
  spend: null,
  spendCurrency: 'CAD',
  impressions: null,
  reach: null,
  profileVisits: null,
  boostStartedOn: null,
  ...over,
});

test('the days of one ad add up into one row', () => {
  const { ads } = parseAdsExport(
    perDay([
      ['2026-10-01', 'Ad A', '10', 'profile_visit_view', '400', '5.50'],
      ['2026-10-02', 'Ad A', '7', 'profile_visit_view', '500', '4.50'],
    ])
  );
  assert.equal(ads.length, 1);
  assert.equal(ads[0].spend, 10);
  assert.equal(ads[0].impressions, 2000);
  assert.equal(ads[0].profileVisits, 17);
  assert.equal(ads[0].days, 2);
});

test('reach is not summed across days, because it counts people', () => {
  const { ads, notes } = parseAdsExport(
    perDay([
      ['2026-10-01', 'Ad A', '0', '', '400', '1.00'],
      ['2026-10-02', 'Ad A', '0', '', '500', '1.00'],
    ])
  );
  assert.equal(ads[0].reach, null);
  assert.ok(notes.some((n) => n.startsWith('Reach was left alone')));
});

test('an export without the daily breakdown does carry reach', () => {
  const { ads, notes } = parseAdsExport(
    perDay([['2026-09-03', 'Ad A', '0', '', '900', '10.00']])
  );
  assert.equal(ads[0].reach, 900);
  assert.ok(!notes.some((n) => n.startsWith('Reach was left alone')));
});

test('results only become profile visits when the indicator says they are', () => {
  const visits = parseAdsExport(
    perDay([['2026-10-01', 'Ad A', '12', 'profile_visit_view', '400', '1.00']])
  );
  assert.equal(visits.ads[0].profileVisits, 12);

  const clicks = parseAdsExport(
    perDay([['2026-10-01', 'Ad A', '12', 'link_click', '400', '1.00']])
  );
  assert.equal(clicks.ads[0].profileVisits, null);
  assert.ok(clicks.notes.some((n) => n.startsWith('Results were left alone')));
});

test('an ad whose days mix indicators is not filed under either', () => {
  const { ads } = parseAdsExport(
    perDay([
      ['2026-10-01', 'Ad A', '5', 'profile_visit_view', '400', '1.00'],
      ['2026-10-02', 'Ad A', '5', 'link_click', '400', '1.00'],
    ])
  );
  assert.equal(ads[0].profileVisits, null);
});

test('the currency comes from the spend header rather than an assumption', () => {
  const { ads } = parseAdsExport(
    'Reporting starts,Ad name,Amount spent (USD),Impressions\n2026-10-01,Ad A,3.00,10'
  );
  assert.equal(ads[0].spendCurrency, 'USD');
});

test('the boost window is the days money went out, not the export window', () => {
  const { ads } = parseAdsExport(
    perDay([
      ['2026-09-03', 'Ad A', '0', '', '0', '0.00'],
      ['2026-10-01', 'Ad A', '0', '', '400', '5.00'],
      ['2026-10-02', 'Ad A', '0', '', '400', '5.00'],
    ])
  );
  assert.equal(ads[0].firstDay, '2026-09-03');
  assert.equal(ads[0].firstActiveDay, '2026-10-01');
  assert.equal(ads[0].lastActiveDay, '2026-10-02');
});

test('a file that is not an Ads Manager export says so instead of importing nothing', () => {
  const { ads, notes } = parseAdsExport('name,email\nSam,sam@example.com');
  assert.equal(ads.length, 0);
  assert.ok(notes[0].includes('Ad name'));
});

test('a missing column leaves its number alone rather than writing a zero', () => {
  const { ads } = parseAdsExport('Reporting starts,Ad name,Reach\n2026-10-01,Ad A,500');
  assert.equal(ads[0].spend, null);
  assert.equal(ads[0].impressions, null);

  const plan = planAdsImport([reel({ title: 'Ad A', impressions: 40 })], { ads, notes: [] });
  assert.equal(plan.ads[0].patch.impressions, undefined);
  assert.equal(plan.ads[0].patch.spend, undefined);
});

/* ----------------------------- the plan ----------------------------- */

const oneAd = (over: Partial<ReturnType<typeof parseAdsExport>['ads'][number]> = {}) => ({
  ads: [
    {
      adName: 'Instagram post: Comment HOOKS...',
      days: 2,
      firstDay: '2026-10-01',
      lastDay: '2026-10-02',
      firstActiveDay: '2026-10-01',
      lastActiveDay: '2026-10-02',
      spend: 57.7,
      spendCurrency: 'CAD',
      impressions: 126860,
      reach: null,
      profileVisits: 3108,
      ...over,
    },
  ],
  notes: [],
});

test('the Ads Manager name is what an ad is matched on', () => {
  const plan = planAdsImport(
    [reel({ title: 'Renamed since', adName: 'instagram post: comment hooks...' })],
    oneAd()
  );
  assert.equal(plan.ads[0].matchedBy, 'adName');
  assert.equal(plan.ads[0].reelId, 'r1');
});

test('a reel titled like the ad is matched and then carries the name for next time', () => {
  const plan = planAdsImport([reel({ title: 'Comment HOOKS...' })], oneAd());
  assert.equal(plan.ads[0].matchedBy, 'title');
  assert.equal(plan.ads[0].patch.adName, 'Instagram post: Comment HOOKS...');
});

test('an ad nothing answers to becomes a new reel named after it', () => {
  const plan = planAdsImport([reel({ title: 'Something else' })], oneAd());
  assert.equal(plan.ads[0].matchedBy, 'new');
  assert.equal(plan.ads[0].reelId, null);
  assert.equal(plan.ads[0].reelTitle, 'Comment HOOKS...');
  assert.equal(plan.ads[0].patch.spend, '57.70');
});

test('two reels answering to the same name are left for a person', () => {
  const plan = planAdsImport(
    [reel({ id: 'a', title: 'Comment HOOKS...' }), reel({ id: 'b', title: 'comment hooks...' })],
    oneAd()
  );
  assert.equal(plan.ads[0].matchedBy, 'ambiguous');
  assert.deepEqual(plan.ads[0].patch, {});
  assert.ok(plan.ads[0].kept[0].includes('2 reels'));
});

test('a longer boost raises the spend that is already there', () => {
  const plan = planAdsImport(
    [reel({ title: 'Comment HOOKS...', spend: '40.00', spendCurrency: 'CAD' })],
    oneAd()
  );
  assert.equal(plan.ads[0].patch.spend, '57.70');
  assert.deepEqual(
    plan.ads[0].changes.find((c) => c.label === 'spend'),
    { label: 'spend', from: 'CAD 40.00', to: 'CAD 57.70' }
  );
});

test('a shorter export window never cuts a number down, and says it did not', () => {
  const plan = planAdsImport(
    [reel({ title: 'Comment HOOKS...', spend: '400.00', impressions: 900000 })],
    oneAd()
  );
  assert.equal(plan.ads[0].patch.spend, undefined);
  assert.equal(plan.ads[0].patch.impressions, undefined);
  assert.equal(plan.ads[0].kept.length, 2);
  assert.ok(plan.ads[0].kept[0].includes('400.00'));
});

test('ticking replace lets a wrong number be corrected downwards', () => {
  const plan = planAdsImport(
    [reel({ title: 'Comment HOOKS...', spend: '400.00' })],
    oneAd(),
    { replace: true }
  );
  assert.equal(plan.ads[0].patch.spend, '57.70');
});

test('a number that has not moved is not reported as a change', () => {
  const plan = planAdsImport(
    [reel({ title: 'Comment HOOKS...', spend: '57.70', impressions: 126860, profileVisits: 3108 })],
    oneAd()
  );
  assert.deepEqual(plan.ads[0].changes, [{ label: 'boost started', from: null, to: '2026-10-01' }]);
  assert.deepEqual(plan.ads[0].kept, []);
});

test('spend in another currency is not compared or overwritten', () => {
  const plan = planAdsImport(
    [reel({ title: 'Comment HOOKS...', spend: '40.00', spendCurrency: 'USD' })],
    oneAd()
  );
  assert.equal(plan.ads[0].patch.spend, undefined);
  assert.ok(plan.ads[0].kept.some((k) => k.includes('cannot be added up')));
});

test('a boost start somebody typed is a fact and is left as typed', () => {
  const plan = planAdsImport(
    [reel({ title: 'Comment HOOKS...', boostStartedOn: '2026-09-28' })],
    oneAd()
  );
  assert.equal(plan.ads[0].patch.boostStartedOn, undefined);
});

test('an ad that did not run over these dates is left out entirely', () => {
  const plan = planAdsImport(
    [reel({ title: 'Comment HOOKS...', spend: '40.00', impressions: 5 })],
    oneAd({ spend: 0, impressions: 0, profileVisits: 0 })
  );
  assert.equal(plan.ads.length, 0);
  assert.ok(plan.notes.some((n) => n.includes('spent nothing')));
});

test('the boosted-post prefix comes off a name used as a reel title', () => {
  assert.equal(tidyAdName('Instagram post: Comment HOOKS'), 'Comment HOOKS');
  assert.equal(tidyAdName('Facebook post: Thing'), 'Thing');
  assert.equal(tidyAdName('  A plain ad name '), 'A plain ad name');
});
