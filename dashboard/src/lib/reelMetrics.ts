/**
 * Everything about a boosted reel that is arithmetic or string work, with no
 * database attached, so the parts most likely to be wrong can be tested
 * directly.
 */

/**
 * Pulls the shortcode out of an Instagram link.
 *
 * Instagram serves the same post under /reel/, /reels/, /p/ and /tv/, and a
 * link copied from the app carries a tracking query string and often a
 * trailing slash. The embed only wants the code in the middle.
 *
 * Returns null rather than guessing: a link we cannot read should show as a
 * plain link, not as a preview of the wrong post.
 */
export function shortcodeFromUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Accept a bare shortcode, which is what somebody pasting from a spreadsheet
  // is most likely to have.
  if (/^[A-Za-z0-9_-]{5,}$/.test(trimmed) && !trimmed.includes('.')) return trimmed;

  const match = trimmed.match(
    /instagram\.com\/(?:[A-Za-z0-9._]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/i
  );
  return match ? match[1] : null;
}

/** The URL Instagram's own embed code points an iframe at. */
export function embedUrl(shortcode: string): string {
  return `https://www.instagram.com/reel/${encodeURIComponent(shortcode)}/embed/`;
}

/**
 * The readable end of a link, for a button that is only a couple of hundred
 * pixels wide.
 *
 * The start of a URL is the part every link shares: "https://thecalled.c"
 * tells nobody which resource they are about to send a lead, where
 * "hooks-guide" does. Falls back to the host, and then to whatever was typed
 * in - something unparseable is still better shown than blanked out.
 */
export function linkTail(url: string): string {
  try {
    const u = new URL(url);
    const tail = u.pathname.split('/').filter(Boolean).pop();
    return tail ? decodeURIComponent(tail) : u.host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Where a click should take you - the post itself, not the embed. */
export function permalink(shortcode: string): string {
  return `https://www.instagram.com/reel/${encodeURIComponent(shortcode)}/`;
}

type Counts = {
  spend: string | number | null;
  views: number | null;
  impressions: number | null;
  reach: number | null;
  profileVisits: number | null;
  linkClicks: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  leadsGenerated: number | null;
  callsBooked: number | null;
  closes: number | null;
  cashCollected: string | number | null;
};

const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * A rate is only meaningful when both halves are known, and dividing by zero
 * is not "infinite performance" - it is a reel nobody has entered spend for
 * yet. Every one of these returns null rather than a number that would be read
 * as a result.
 */
function per(cost: number | null, count: number | null): number | null {
  if (cost === null || count === null || count === 0) return null;
  return cost / count;
}

export type ReelMetrics = {
  /** What a profile visit cost. The number a boost lives or dies on. */
  costPerProfileVisit: number | null;
  /** Cost of a thousand impressions - what delivery is being charged at. */
  cpm: number | null;
  /** Link clicks over impressions, as a fraction. */
  ctr: number | null;
  /** Impressions over reach: how many times the average person saw it. */
  frequency: number | null;
  costPerLead: number | null;
  costPerCall: number | null;
  costPerClose: number | null;
  /** Cash back per unit spent. 2 means twice the spend came back. */
  roas: number | null;
  /** Cash minus spend. Null unless both are known. */
  net: number | null;
  /** Interactions over reach, as a fraction. */
  engagementRate: number | null;
  /** Of the conversations this reel started, how many booked. */
  leadToCall: number | null;
  /** Of the calls it produced, how many closed. */
  callToClose: number | null;
};

export function reelMetrics(r: Counts): ReelMetrics {
  const spend = num(r.spend);
  const cash = num(r.cashCollected);
  const reach = num(r.reach);
  const impressions = num(r.impressions);

  const interactions = [r.likes, r.comments, r.shares, r.saves]
    .map(num)
    .filter((n): n is number => n !== null);

  return {
    costPerProfileVisit: per(spend, num(r.profileVisits)),
    // Per thousand, which is how every ad platform quotes it.
    cpm: spend === null || impressions === null || impressions === 0
      ? null
      : (spend / impressions) * 1000,
    ctr: ratio(num(r.linkClicks), impressions),
    frequency: ratio(impressions, reach),
    costPerLead: per(spend, num(r.leadsGenerated)),
    costPerCall: per(spend, num(r.callsBooked)),
    costPerClose: per(spend, num(r.closes)),
    roas: spend !== null && spend !== 0 && cash !== null ? cash / spend : null,
    net: spend !== null && cash !== null ? cash - spend : null,
    // Only counts when at least one interaction number was entered, so a reel
    // with nothing filled in reads as unknown rather than as zero engagement.
    engagementRate:
      reach !== null && reach !== 0 && interactions.length > 0
        ? interactions.reduce((a, b) => a + b, 0) / reach
        : null,
    leadToCall: ratio(num(r.callsBooked), num(r.leadsGenerated)),
    callToClose: ratio(num(r.closes), num(r.callsBooked)),
  };
}

function ratio(top: number | null, bottom: number | null): number | null {
  if (top === null || bottom === null || bottom === 0) return null;
  return top / bottom;
}

export const REEL_STATUSES = ['running', 'paused', 'finished'] as const;
export type ReelStatus = (typeof REEL_STATUSES)[number];

type Summable = Counts & { spendCurrency: string };

export type ReelTotals = {
  currency: string;
  reels: number;
  spend: number | null;
  cash: number | null;
  net: number | null;
  impressions: number | null;
  profileVisits: number | null;
  leads: number | null;
  calls: number | null;
  closes: number | null;
  costPerProfileVisit: number | null;
  cpm: number | null;
  costPerLead: number | null;
  costPerCall: number | null;
  costPerClose: number | null;
  roas: number | null;
};

/**
 * The top line: what boosting cost and what came back.
 *
 * Grouped by currency rather than summed across it. An ad account billing CAD
 * against contracts written in USD would otherwise produce a blended cost per
 * lead that is not a number in any currency - the kind of figure a boosting
 * decision gets made on and should not be.
 *
 * Most of the time there is one currency and this is a single row.
 */
export function summariseReels(reels: Summable[]): ReelTotals[] {
  const byCurrency = new Map<string, Summable[]>();
  for (const r of reels) {
    const key = r.spendCurrency || 'USD';
    byCurrency.set(key, [...(byCurrency.get(key) ?? []), r]);
  }

  /**
   * A sum of nothing is not zero.
   *
   * A reel with no spend entered contributes nothing rather than dragging the
   * total down, but when *no* reel has the number at all the answer is that
   * nobody knows it - not that it is zero. That distinction stopped being
   * academic when the Ads Manager import started filling spend and leaving
   * cash to be entered by hand: summing nulls to zero turned a page where the
   * cash had simply not been recorded yet into one reading "net -CA$115,
   * 0.0x return on spend", which is a loss nobody made.
   */
  const total = (rows: Summable[], pick: (r: Summable) => string | number | null) => {
    const known = rows.map(pick).map(num).filter((n): n is number => n !== null);
    return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
  };

  return [...byCurrency.entries()]
    .map(([currency, rows]) => {
      const spend = total(rows, (r) => r.spend);
      const cash = total(rows, (r) => r.cashCollected);
      const impressions = total(rows, (r) => r.impressions);
      const profileVisits = total(rows, (r) => r.profileVisits);
      const leads = total(rows, (r) => r.leadsGenerated);
      const calls = total(rows, (r) => r.callsBooked);
      const closes = total(rows, (r) => r.closes);

      return {
        currency,
        reels: rows.length,
        spend,
        cash,
        // Spend is known and cash is not: that is a reel whose outcome has not
        // been recorded, and neither its net nor its return is a number yet.
        net: spend === null || cash === null ? null : cash - spend,
        impressions,
        profileVisits,
        leads,
        calls,
        closes,
        // Reach is not totalled anywhere on purpose. It counts people, and two
        // reels shown to overlapping audiences do not reach the sum of their
        // two numbers - the same mistake as adding a reel's days together.
        costPerProfileVisit: per(spend, profileVisits),
        cpm:
          spend === null || impressions === null || impressions === 0
            ? null
            : (spend / impressions) * 1000,
        costPerLead: per(spend, leads),
        costPerCall: per(spend, calls),
        costPerClose: per(spend, closes),
        roas: spend === null || spend === 0 || cash === null ? null : cash / spend,
      };
    })
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
}
