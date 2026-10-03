import { parseCsv } from './csv.ts';

/**
 * Reading a Meta Ads Manager export into the boosted reels.
 *
 * Kept free of database imports so the arithmetic can be tested directly,
 * because two things in these exports are easy to get wrong and impossible to
 * notice afterwards.
 *
 * **Reach does not add up.** An export broken down by day gives one row per ad
 * per day, and reach is deduplicated people - the same person seeing a reel on
 * Tuesday and Wednesday is one reach, not two. Summing the days inflates it,
 * sometimes by a lot, and the resulting cost-per-reach reads better than it
 * was. So a day-by-day export does not fill reach at all, and says why.
 * Impressions and spend are per-event and do add up.
 *
 * **Results are only sometimes profile visits.** The Results column counts
 * whatever the campaign optimised for, named in Result indicator. For these it
 * is `profile_visit_view`, so it is profile visits; for another objective it
 * would be link clicks or messages, and filing those as profile visits would
 * be a figure nobody could later tell was wrong. It is read only when the
 * indicator says so.
 */

export type AdTotals = {
  adName: string;
  /** Days with a row, whether or not anything happened on them. */
  days: number;
  firstDay: string | null;
  lastDay: string | null;
  /**
   * First and last day money actually went out, which is not the same as the
   * export window: this file covers 3 Sep to 2 Oct and only spent on the last
   * two days of it. The window is whatever was picked in Ads Manager; these
   * two are the boost.
   */
  firstActiveDay: string | null;
  lastActiveDay: string | null;
  /** Null when the export carries no spend column at all. */
  spend: number | null;
  spendCurrency: string;
  /** Null when the export carries no impressions column at all. */
  impressions: number | null;
  /** Null when the export is per-day, because reach cannot be summed. */
  reach: number | null;
  /** Null unless Result indicator says these results are profile visits. */
  profileVisits: number | null;
  /** Null when the export carries no link clicks column at all. */
  linkClicks: number | null;
};

export type AdsExport = {
  ads: AdTotals[];
  /** Said on screen, not swallowed: each one is a number deliberately not set. */
  notes: string[];
};

const num = (v: string | undefined): number => {
  if (!v) return 0;
  // Ads Manager writes "-" for a metric that does not apply to the row.
  const n = Number(v.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** "Amount spent (CAD)" -> CAD. The account's currency, not an assumption. */
function currencyFrom(header: string): string | null {
  const m = header.match(/\(([A-Z]{3})\)\s*$/);
  return m ? m[1] : null;
}

export function parseAdsExport(csvText: string): AdsExport {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return { ads: [], notes: ['That file has no rows in it.'] };

  const header = rows[0].map((h) => h.trim());
  const at = (name: string) => header.findIndex((h) => h === name);
  const startsWith = (prefix: string) => header.findIndex((h) => h.startsWith(prefix));

  const iName = at('Ad name');
  const iStart = at('Reporting starts');
  const iEnd = at('Reporting ends');
  const iSpend = startsWith('Amount spent');
  const iReach = at('Reach');
  const iImpr = at('Impressions');
  const iResults = at('Results');
  const iIndicator = at('Result indicator');
  const iClicks = at('Link clicks');

  const notes: string[] = [];
  if (iName === -1) {
    return { ads: [], notes: ['No "Ad name" column — is this an Ads Manager export?'] };
  }

  const currency = iSpend === -1 ? null : currencyFrom(header[iSpend]);
  if (iSpend === -1) notes.push('No spend column, so spend was not filled.');

  const byAd = new Map<string, { rows: string[][]; days: Set<string>; ends: Set<string> }>();
  for (const row of rows.slice(1)) {
    const name = (row[iName] ?? '').trim();
    if (!name) continue;
    const entry = byAd.get(name) ?? { rows: [], days: new Set<string>(), ends: new Set<string>() };
    entry.rows.push(row);
    if (iStart !== -1 && row[iStart]) entry.days.add(row[iStart]);
    if (iEnd !== -1 && row[iEnd]) entry.ends.add(row[iEnd]);
    byAd.set(name, entry);
  }

  // One row per ad per day is the default export; one row per ad is what you
  // get without the breakdown, and only that one carries a real reach.
  const perDay = [...byAd.values()].some((e) => e.days.size > 1);
  if (perDay) {
    notes.push(
      'Reach was left alone: this export is broken down by day, and reach counts people rather than views — adding the days up would count anyone who saw it twice. Re-export without the daily breakdown if you want reach.'
    );
  }

  const ads: AdTotals[] = [];
  for (const [adName, entry] of byAd) {
    const days = [...entry.days].sort();
    const indicators = new Set(
      entry.rows.map((r) => (iIndicator === -1 ? '' : (r[iIndicator] ?? '').trim())).filter(Boolean)
    );
    const resultsAreVisits = indicators.size === 1 && indicators.has('profile_visit_view');

    const spentDays =
      iSpend === -1 || iStart === -1
        ? []
        : [
            ...new Set(
              entry.rows.filter((r) => num(r[iSpend]) > 0).map((r) => r[iStart] ?? '')
            ),
          ]
            .filter(Boolean)
            .sort();

    // Without the daily breakdown there is one row per ad, and its Reporting
    // starts is the window's start - the end lives in Reporting ends, not in
    // another row. Reading only the starts made a month-long export report
    // itself as covering a single day.
    const ends = [...entry.ends].sort();

    ads.push({
      adName,
      days: entry.days.size,
      firstDay: days[0] ?? null,
      lastDay: ends[ends.length - 1] ?? days[days.length - 1] ?? null,
      // Only a day-by-day export knows which days money went out on. Without
      // the breakdown the only date available is the window that was picked,
      // and a window of "Maximum" starts at the account's first ever day -
      // filing that as the boost start would be a date nobody could later
      // tell was wrong.
      firstActiveDay: perDay ? (spentDays[0] ?? null) : null,
      lastActiveDay: perDay ? (spentDays[spentDays.length - 1] ?? null) : null,
      spend: iSpend === -1 ? null : entry.rows.reduce((a, r) => a + num(r[iSpend]), 0),
      spendCurrency: currency ?? 'USD',
      impressions: iImpr === -1 ? null : entry.rows.reduce((a, r) => a + num(r[iImpr]), 0),
      reach:
        perDay || iReach === -1
          ? null
          : entry.rows.reduce((a, r) => a + num(r[iReach]), 0),
      profileVisits:
        resultsAreVisits && iResults !== -1
          ? entry.rows.reduce((a, r) => a + num(r[iResults]), 0)
          : null,
      linkClicks: iClicks === -1 ? null : entry.rows.reduce((a, r) => a + num(r[iClicks]), 0),
    });
  }

  if (iResults !== -1 && ads.length > 0 && ads.every((a) => a.profileVisits === null)) {
    notes.push(
      'Results were left alone: they count whatever each campaign optimised for, and these are not profile visits.'
    );
  }

  // Rounded here rather than at the database, so what the dry run shows and
  // what gets written are the same number.
  for (const ad of ads) {
    if (ad.spend !== null) ad.spend = Math.round(ad.spend * 100) / 100;
  }

  ads.sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0) || a.adName.localeCompare(b.adName));
  return { ads, notes };
}

/* ------------------------------------------------------------------------- *
 * Turning an export into changes
 * ------------------------------------------------------------------------- */

/**
 * Who owns which number.
 *
 * The usual rule here is that an import fills gaps and never overwrites, but
 * that rule is really about ownership, and ad spend is owned by Ads Manager
 * the way bookings are owned by Calendly. A boost that ran another week has a
 * bigger spend than the one typed in last Tuesday, and refusing to update it
 * would make the import pointless.
 *
 * So the export may raise what it owns - spend, impressions, reach, profile
 * visits - and may not lower it. A lower figure almost always means a shorter
 * export window, not a smaller boost, and silently cutting a month's spend
 * down to two days of it is the one mistake nobody would catch. Those are
 * listed on screen instead, with a tick for when the old number really was
 * wrong.
 *
 * Everything the dashboard measures itself - conversations, calls, closes,
 * cash - the export knows nothing about and never touches.
 */

export type ReelForMatch = {
  id: string;
  title: string;
  adName: string | null;
  spend: string | number | null;
  spendCurrency: string;
  impressions: number | null;
  reach: number | null;
  profileVisits: number | null;
  linkClicks: number | null;
  boostStartedOn: string | null;
};

/** What would be written to one reel. Keyed to the column names. */
export type ReelPatch = {
  adName?: string;
  spend?: string;
  spendCurrency?: string;
  impressions?: number;
  reach?: number;
  profileVisits?: number;
  linkClicks?: number;
  boostStartedOn?: string;
};

export type FieldChange = { label: string; from: string | null; to: string };

export type AdPlan = {
  ad: AdTotals;
  /** The reel this lands on; null when a new one would be created for it. */
  reelId: string | null;
  /** What the reel is, or would be, called. */
  reelTitle: string;
  matchedBy: 'adName' | 'title' | 'new' | 'ambiguous' | 'quiet';
  patch: ReelPatch;
  changes: FieldChange[];
  /** Numbers the export carried that were deliberately not written. */
  kept: string[];
};

export type AdsPlan = { ads: AdPlan[]; notes: string[] };

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * "Instagram post: 📲Comment "HOOKS" and i'll shoot..." is what Ads Manager
 * calls an ad made by boosting a post - the caption with a prefix on it. The
 * prefix is noise in a list of reels; the rest is the only hint of which reel
 * it is, so it is kept as typed.
 */
export function tidyAdName(adName: string): string {
  return adName.replace(/^(?:Instagram|Facebook) post:\s*/i, '').trim() || adName.trim();
}

const n0 = (n: number) => n.toLocaleString('en-US');
const money = (n: number) => n.toFixed(2);

export function planAdsImport(
  reels: ReelForMatch[],
  parsed: AdsExport,
  { replace = false }: { replace?: boolean } = {}
): AdsPlan {
  const notes = [...parsed.notes];
  const byAdName = new Map<string, ReelForMatch[]>();
  const byTitle = new Map<string, ReelForMatch[]>();
  for (const r of reels) {
    if (r.adName) {
      const k = key(r.adName);
      byAdName.set(k, [...(byAdName.get(k) ?? []), r]);
    }
    const t = key(r.title);
    byTitle.set(t, [...(byTitle.get(t) ?? []), r]);
  }

  const ads: AdPlan[] = [];
  let quiet = 0;
  for (const ad of parsed.ads) {
    const tidy = tidyAdName(ad.adName);

    // An ad that spent nothing and was seen by nobody over the dates picked is
    // an ad that was not running then. Writing zeroes over a reel's numbers,
    // or creating a reel for it, would both be wrong. Only the numbers the
    // export actually carried count towards that: a column the file does not
    // have says nothing about the ad either way.
    const measured = [ad.spend, ad.impressions, ad.reach, ad.profileVisits, ad.linkClicks].filter(
      (n): n is number => n !== null
    );
    if (measured.length > 0 && measured.every((n) => n === 0)) {
      quiet += 1;
      continue;
    }
    const candidates =
      byAdName.get(key(ad.adName)) ??
      byTitle.get(key(ad.adName)) ??
      byTitle.get(key(tidy)) ??
      [];

    // Two reels answering to the same name is not something to pick between:
    // whichever one got the spend, the other would be wrong.
    if (candidates.length > 1) {
      ads.push({
        ad,
        reelId: null,
        reelTitle: tidy,
        matchedBy: 'ambiguous',
        patch: {},
        changes: [],
        kept: [
          `${candidates.length} reels are called this, so nothing was written. ` +
            'Set the Ads Manager name on the right one.',
        ],
      });
      continue;
    }

    const reel = candidates[0] ?? null;
    const matchedBy: AdPlan['matchedBy'] = !reel
      ? 'new'
      : reel.adName && key(reel.adName) === key(ad.adName)
        ? 'adName'
        : 'title';

    const patch: ReelPatch = {};
    const changes: FieldChange[] = [];
    const kept: string[] = [];

    // Written on the first match so every later import is a name match rather
    // than a title match - renaming a reel must not break the link.
    if (reel && key(reel.adName ?? '') !== key(ad.adName)) patch.adName = ad.adName;

    const raise = (
      label: string,
      existing: number | null,
      incoming: number | null,
      write: (v: number) => void,
      fmt: (v: number) => string
    ) => {
      if (incoming === null) return;
      if (existing !== null && incoming <= existing) {
        if (incoming < existing) {
          if (replace) {
            write(incoming);
            changes.push({ label, from: fmt(existing), to: fmt(incoming) });
          } else {
            kept.push(`${label} stayed at ${fmt(existing)} — the export says ${fmt(incoming)}`);
          }
        }
        return;
      }
      write(incoming);
      changes.push({ label, from: existing === null ? null : fmt(existing), to: fmt(incoming) });
    };

    const existingSpend =
      reel === null || reel.spend === null || reel.spend === ''
        ? null
        : Number(reel.spend);

    // Spend already here in another currency cannot be compared with this one,
    // and converting it would invent a rate. Said out loud instead.
    const currencyClash =
      reel !== null &&
      existingSpend !== null &&
      reel.spendCurrency !== ad.spendCurrency;

    const writeSpend = (v: number) => {
      patch.spend = money(v);
      patch.spendCurrency = ad.spendCurrency;
    };

    if (ad.spend === null) {
      // No spend column in the file at all; nothing to say about spend.
    } else if (currencyClash && !replace) {
      kept.push(
        `spend stayed at ${reel!.spendCurrency} ${money(existingSpend!)} — this export is in ` +
          `${ad.spendCurrency}, and the two cannot be added up`
      );
    } else if (currencyClash) {
      writeSpend(ad.spend);
      changes.push({
        label: 'spend',
        from: `${reel!.spendCurrency} ${money(existingSpend!)}`,
        to: `${ad.spendCurrency} ${money(ad.spend)}`,
      });
    } else {
      raise('spend', existingSpend, ad.spend, writeSpend, (v) => `${ad.spendCurrency} ${money(v)}`);
    }

    raise('impressions', reel?.impressions ?? null, ad.impressions, (v) => (patch.impressions = v), n0);
    raise('accounts reached', reel?.reach ?? null, ad.reach, (v) => (patch.reach = v), n0);
    raise(
      'profile visits',
      reel?.profileVisits ?? null,
      ad.profileVisits,
      (v) => (patch.profileVisits = v),
      n0
    );
    raise('link clicks', reel?.linkClicks ?? null, ad.linkClicks, (v) => (patch.linkClicks = v), n0);

    // A date somebody typed is a fact about the boost; this is a guess from
    // which day money first went out, so it only ever fills a blank.
    if (ad.firstActiveDay && !reel?.boostStartedOn) {
      patch.boostStartedOn = ad.firstActiveDay;
      changes.push({ label: 'boost started', from: null, to: ad.firstActiveDay });
    }

    ads.push({ ad, reelId: reel?.id ?? null, reelTitle: reel?.title ?? tidy, matchedBy, patch, changes, kept });
  }

  if (quiet > 0) {
    notes.push(
      `${quiet} ${quiet === 1 ? 'ad' : 'ads'} in the file spent nothing over these dates, so ` +
        `${quiet === 1 ? 'it was' : 'they were'} left out.`
    );
  }

  // Nothing is said here about the ads that matched nothing: whether that
  // reads as "would be added" or "was added" depends on which button was
  // pressed, which is the caller's business rather than the arithmetic's.
  return { ads, notes };
}
