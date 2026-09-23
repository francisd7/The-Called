/**
 * Deciding, without guessing, which lead a post-call report is about.
 *
 * The Airtable form asks the closer for a first name and nothing else that
 * identifies anybody - no handle, no email - which is why every report has had
 * to be pointed at a lead by hand. First names collide, so the app has never
 * tried to work it out.
 *
 * It does not have to guess to do most of them, though. A report also carries
 * the day of the call, and on a normal day the team runs a handful. When
 * exactly one booked call that day belongs to somebody of that name, there is
 * one answer, not a guess - the same rule the Airtable import already uses
 * before it adopts a lead. Anything less certain stays in the queue for a
 * person, which is where the value of this is: the queue stops being every
 * call and becomes only the ones that genuinely need a human.
 */

export type ReportFacts = {
  leadName: string;
  callDate: Date | null;
};

export type Candidate = {
  id: string;
  name: string | null;
  igHandle: string;
  igHandleKey: string | null;
  /** A report already linked to this lead, if there is one. */
  linkedReportId: string | null;
};

export type AutoMatch =
  | { leadId: string }
  | { leadId: null; why: 'no date' | 'no name' | 'nobody that day' | 'more than one' };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The name the closer typed, reduced to the first word of it. */
export function firstName(raw: string): string {
  return norm(raw).split(' ')[0] ?? '';
}

/**
 * Whether a candidate could be the person the closer named.
 *
 * Generous on the name, because a closer types "Gavin" for "Gavin Roberts" and
 * sometimes for a lead stored only as @gavin.r. Strict afterwards: this only
 * ever narrows a list that is then required to hold exactly one row.
 */
export function nameCouldMatch(candidate: Candidate, first: string): boolean {
  if (!first) return false;

  const name = norm(candidate.name ?? '');
  if (name) {
    const tokens = name.split(' ');
    if (tokens[0] === first) return true;
    // "Gav" against "Gavin", but never the other way round - a two-letter
    // report name must not sweep up every lead beginning with it.
    if (first.length >= 4 && tokens.some((t) => t.startsWith(first))) return true;
  }

  // Handles run names together, so containment is the only thing that works -
  // and it is the loosest test here, so it takes the longest name.
  if (first.length >= 4) {
    const handle = norm(candidate.igHandleKey ?? candidate.igHandle ?? '').replace(/ /g, '');
    if (handle.includes(first)) return true;
  }

  return false;
}

/**
 * `candidates` is every non-test lead whose booked call falls on the report's
 * own day. The caller does that part, because "the same day" is a question
 * about the team's timezone rather than about names.
 */
export function pickAutoMatch(report: ReportFacts, candidates: Candidate[]): AutoMatch {
  // Without a date there is nothing to narrow by, and a first name on its own
  // across the whole pipeline is exactly the guess this avoids.
  if (!report.callDate) return { leadId: null, why: 'no date' };

  const first = firstName(report.leadName);
  if (!first) return { leadId: null, why: 'no name' };

  const hits = candidates.filter(
    // A lead already carrying somebody else's report is not free to take this
    // one: two calls with one person is a case for a human.
    (c) => c.linkedReportId === null && nameCouldMatch(c, first)
  );

  if (hits.length === 0) return { leadId: null, why: 'nobody that day' };
  if (hits.length > 1) return { leadId: null, why: 'more than one' };
  return { leadId: hits[0].id };
}
