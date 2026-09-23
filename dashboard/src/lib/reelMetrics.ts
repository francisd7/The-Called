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

/** Where a click should take you - the post itself, not the embed. */
export function permalink(shortcode: string): string {
  return `https://www.instagram.com/reel/${encodeURIComponent(shortcode)}/`;
}

type Counts = {
  spend: string | number | null;
  views: number | null;
  reach: number | null;
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

  const interactions = [r.likes, r.comments, r.shares, r.saves]
    .map(num)
    .filter((n): n is number => n !== null);

  return {
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
  spend: number;
  cash: number;
  net: number;
  leads: number;
  calls: number;
  closes: number;
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

  // A sum of nothing is zero, but a sum of things nobody has filled in is not:
  // a reel with no spend entered contributes nothing rather than dragging a
  // total down to a number somebody would act on.
  const total = (rows: Summable[], pick: (r: Summable) => string | number | null) =>
    rows.reduce((acc, r) => acc + (num(pick(r)) ?? 0), 0);

  return [...byCurrency.entries()]
    .map(([currency, rows]) => {
      const spend = total(rows, (r) => r.spend);
      const cash = total(rows, (r) => r.cashCollected);
      const leads = total(rows, (r) => r.leadsGenerated);
      const calls = total(rows, (r) => r.callsBooked);
      const closes = total(rows, (r) => r.closes);

      return {
        currency,
        reels: rows.length,
        spend,
        cash,
        net: cash - spend,
        leads,
        calls,
        closes,
        costPerLead: per(spend, leads),
        costPerCall: per(spend, calls),
        costPerClose: per(spend, closes),
        roas: spend === 0 ? null : cash / spend,
      };
    })
    .sort((a, b) => b.spend - a.spend);
}
