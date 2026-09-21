/**
 * What merging one lead into another would change, worked out without touching
 * the database.
 *
 * Kept pure and separate from the merge itself so the screen can show somebody
 * exactly what they are about to lose before they press anything, and so the
 * rules can be tested without a booking, a close and two Airtable rows set up
 * first.
 *
 * The shape of the rules: the lead you keep wins every disagreement. The other
 * one only fills in what the keeper hasn't got. The exceptions are the handful
 * of fields where "no" and "don't know" are the same value, and a merge that
 * honoured them would throw away a real answer - a call that was booked, a deal
 * that closed, a conversation somebody marked live.
 */
import type { leads } from '../db/schema.ts';

export type LeadRow = typeof leads.$inferSelect;

/**
 * Both rows say something, so the keeper's answer stands - except where its
 * answer is `false`, which on these columns means nobody ever said otherwise.
 */
const OR_TRUE = [
  'outboundDm',
  'responded',
  'callBooked',
  'callCancelled',
  'confirmed',
  'triaged',
  'isActiveConvo',
  // Nullable, and a null is genuinely "not answered yet" - but a false here
  // came from an Airtable checkbox nobody ticked, which is the same thing.
  'showed',
  'qualified',
  'closed',
] as const satisfies readonly (keyof LeadRow)[];

/** The conversation began when the earlier of the two began. */
const EARLIEST = ['leadCreatedAt'] as const satisfies readonly (keyof LeadRow)[];

/** Activity: the later of the two is the true last time anything happened. */
const LATEST = ['lastContactAt', 'lastOutreachAt'] as const satisfies readonly (keyof LeadRow)[];

/** Counts of work done, which the two rows split between them. */
const MAX = ['followUps'] as const satisfies readonly (keyof LeadRow)[];

/**
 * Never merged: identity, and the bookkeeping that belongs to the row itself.
 * airtableRecordId and postCallRecordId are unique columns - the keeper takes
 * one only if it hasn't got one, and the loser's is remembered in lead_merges
 * rather than carried, so a re-import follows it here instead of rebuilding the
 * row it came from.
 */
const NEVER = new Set<keyof LeadRow>(['id', 'createdAt', 'updatedAt', 'isTest', 'igHandleKey']);

/** Columns the keeper takes only when it has nothing of its own. */
const FILL_IF_EMPTY: readonly (keyof LeadRow)[] = [
  'name',
  'email',
  'phone',
  'igHandle',
  'setterId',
  'leadSource',
  'opener',
  'conversationStage',
  'leadQuality',
  'icp',
  'respondedAt',
  'nextFollowUpAt',
  'offerId',
  'callBookedAt',
  'callScheduledFor',
  'closerId',
  'closerName',
  'calendlyEventUri',
  'calendlyInviteeUri',
  'calendlyAnswers',
  'calendlyCancelUrl',
  'calendlyRescheduleUrl',
  'callCancelledAt',
  'cancelReason',
  'confirmedAt',
  'confirmedById',
  'confirmationMethod',
  'triagedAt',
  'triagedById',
  'triageNotes',
  'sourceContent',
  'callOutcome',
  'tier',
  'paymentMethod',
  'fathomUrl',
  'outcomeLoggedAt',
  'outcomeLoggedById',
  'closedDate',
  'cashCollected',
  'contractValue',
  'lostReason',
  'postCallNotes',
  'airtableRecordId',
  'postCallRecordId',
];

/** How a field reads in the "also brings across" list. */
const LABELS: Partial<Record<keyof LeadRow, string>> = {
  name: 'their name',
  email: 'email address',
  phone: 'phone number',
  setterId: 'the setter it belongs to',
  leadSource: 'lead source',
  opener: 'opener',
  conversationStage: 'conversation stage',
  leadQuality: 'lead quality',
  icp: 'ICP',
  sourceContent: 'the post it came from',
  responded: 'that they replied',
  respondedAt: 'when they replied',
  followUps: 'follow-up count',
  nextFollowUpAt: 'next follow-up date',
  callBooked: 'a booked call',
  callScheduledFor: 'the call date',
  callCancelled: 'that the call was cancelled',
  cancelReason: 'why it was cancelled',
  calendlyEventUri: 'the Calendly booking',
  closerId: 'the closer',
  closerName: 'the closer',
  confirmed: 'that it was confirmed',
  triaged: 'that it was triaged',
  triageNotes: 'triage notes',
  showed: 'that they showed',
  qualified: 'that they qualified',
  closed: 'the close',
  closedDate: 'when it closed',
  cashCollected: 'cash collected',
  contractValue: 'contract value',
  lostReason: 'why it was lost',
  postCallNotes: 'post-call notes',
  callOutcome: 'the call outcome',
  fathomUrl: 'the call recording',
  airtableRecordId: 'its row in the Airtable tracker',
  postCallRecordId: 'its post-call report',
  isActiveConvo: 'that the conversation is live',
  leadCreatedAt: 'an earlier start date',
  lastContactAt: 'a later last contact',
  lastOutreachAt: 'a later last outreach',
};

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/** A number Airtable wrote as a string, or a real one, or nothing. */
function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export type MergePlan = {
  /** The columns to write onto the lead being kept. */
  changes: Partial<LeadRow>;
  /** One line each, for the screen: what keeping this row would pull across. */
  brings: string[];
};

/**
 * Note that this never returns anything that would make the keeper *worse* -
 * a field only changes when the other row has something the keeper hasn't.
 */
export function planMerge(keep: LeadRow, drop: LeadRow): MergePlan {
  const changes: Partial<LeadRow> = {};
  const brings: string[] = [];
  const say = (field: keyof LeadRow) => {
    const label = LABELS[field];
    if (label && !brings.includes(label)) brings.push(label);
  };

  for (const field of FILL_IF_EMPTY) {
    if (NEVER.has(field)) continue;
    if (isEmpty(keep[field]) && !isEmpty(drop[field])) {
      (changes as Record<string, unknown>)[field] = drop[field];
      say(field);
    }
  }

  for (const field of OR_TRUE) {
    if (drop[field] === true && keep[field] !== true) {
      (changes as Record<string, unknown>)[field] = true;
      say(field);
    }
  }

  for (const field of EARLIEST) {
    const a = keep[field] as Date | null;
    const b = drop[field] as Date | null;
    if (b && (!a || b.getTime() < a.getTime())) {
      (changes as Record<string, unknown>)[field] = b;
      say(field);
    }
  }

  for (const field of LATEST) {
    const a = keep[field] as Date | null;
    const b = drop[field] as Date | null;
    if (b && (!a || b.getTime() > a.getTime())) {
      (changes as Record<string, unknown>)[field] = b;
      say(field);
    }
  }

  for (const field of MAX) {
    const a = asNumber(keep[field]) ?? 0;
    const b = asNumber(drop[field]) ?? 0;
    if (b > a) {
      (changes as Record<string, unknown>)[field] = b;
      say(field);
    }
  }

  // Nothing in the tracker has a column of its own here, so the two blobs are
  // combined rather than one replacing the other. The keeper's keys win.
  const keepLegacy = (keep.legacy ?? null) as Record<string, unknown> | null;
  const dropLegacy = (drop.legacy ?? null) as Record<string, unknown> | null;
  if (dropLegacy && Object.keys(dropLegacy).length > 0) {
    const merged = { ...dropLegacy, ...(keepLegacy ?? {}) };
    if (JSON.stringify(merged) !== JSON.stringify(keepLegacy)) changes.legacy = merged;
  }

  // A lead that comes out of this with a call or a close says so, rather than
  // sitting on whichever stage the surviving row happened to carry. Same rule
  // the booking form uses, for the same reason: the stage drives half the
  // screens, and one that disagrees with the booking beside it is worse than
  // no stage at all.
  const closedAfter = changes.closed ?? keep.closed;
  const bookedAfter = changes.callBooked ?? keep.callBooked;
  const stageAfter = changes.conversationStage ?? keep.conversationStage;
  if (closedAfter && stageAfter !== 'closed') {
    changes.conversationStage = 'closed';
    say('conversationStage');
  } else if (bookedAfter && stageAfter !== 'closed' && stageAfter !== 'call_booked') {
    changes.conversationStage = 'call_booked';
    say('conversationStage');
  }

  // A handle only had to be made up when nobody knew it. If the other row knows
  // it, this one no longer needs flagging.
  if (keep.needsHandle && !drop.needsHandle) {
    changes.needsHandle = false;
    changes.igHandle = drop.igHandle;
    brings.push('a real Instagram handle');
  }

  return { changes, brings };
}
