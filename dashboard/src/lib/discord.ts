import type { InferSelectModel } from 'drizzle-orm';
import type { leads } from '@/db/schema';

type Lead = InferSelectModel<typeof leads>;

// Read per call rather than at module load: on Railway the module can be
// evaluated during the build, before the service's env vars exist.
// DISCORD_API_BASE is the seam the tests point at a local stub.
function discordApiBase() {
  return process.env.DISCORD_API_BASE ?? 'https://discord.com/api/v10';
}

/**
 * Posts via the REST API rather than a gateway connection: the dashboard is a
 * web app that may run several instances, and each one holding an open Discord
 * socket would be both wasteful and a source of duplicate sends. The automation
 * hub keeps the single real bot connection.
 */
async function postToChannel(channelId: string | undefined, content: string): Promise<boolean> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !channelId) return false;

  try {
    const res = await fetch(`${discordApiBase()}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      // 2000 is Discord's hard limit; a long triage note must be truncated
      // rather than rejected outright.
      body: JSON.stringify({ content: content.slice(0, 1990) }),
    });
    if (!res.ok) {
      console.error(`Discord post failed (${res.status}):`, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('Discord post threw:', err);
    return false;
  }
}

function formatCallTime(date: Date | null): string {
  if (!date) return 'time TBC';
  // Everyone on the team works ET, and a closer reading this on their phone
  // should not have to convert from UTC.
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
    timeZoneName: 'short',
  }).format(date);
}

function leadLabel(lead: Lead): string {
  return lead.name?.trim() || `@${lead.igHandle}`;
}

/**
 * A tap from Discord to the lead itself.
 *
 * Without it, everything these messages ask for - confirm, triage, log what
 * happened - means opening the dashboard and searching for a first name. That
 * friction is why post-call outcomes end up being typed into a separate
 * Airtable form and then linked back by hand.
 *
 * Null when AUTH_URL is unset, which is the local and test case; a message
 * with a half-built link in it would be worse than one without.
 */
function leadUrl(lead: Lead): string | null {
  const base = process.env.AUTH_URL?.replace(/\/+$/, '');
  if (!base) return null;
  return `${base}/leads/${lead.id}`;
}

/**
 * The last line of defence for test data. Every caller is also expected to
 * check, but a forgotten guard somewhere would put a brief for a call that
 * doesn't exist in front of the closers, so the send itself refuses too.
 */
/** A result stops being news two days after the call it belongs to. */
const OUTCOME_NEWS_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Whether an outcome is worth telling the team about.
 *
 * Backfilling months of results would otherwise announce every one of them as
 * if it had just happened, and a close from three weeks ago read as tonight's
 * news is worse than no message at all. Two cases stay quiet: a call that is
 * already old, and one the Airtable Post Call form has already posted about.
 */
export function outcomeIsNews(
  lead: Pick<Lead, 'callScheduledFor' | 'postCallRecordId'>,
  now: number = Date.now()
): boolean {
  // Airtable's own automation announced this one when the closer filled it in.
  if (lead.postCallRecordId) return false;
  // No date means nobody recorded when the call was, which in practice means
  // it is being entered long after the fact.
  if (!lead.callScheduledFor) return false;
  return now - lead.callScheduledFor.getTime() <= OUTCOME_NEWS_WINDOW_MS;
}

function isSendable(lead: Lead): boolean {
  if (lead.isTest) {
    console.log(`Skipping Discord post for test lead ${lead.igHandle}.`);
    return false;
  }
  return true;
}

/**
 * Fires when Calendly tells us a call was booked.
 *
 * Names come in as arguments rather than being looked up here: this module
 * has no database of its own, which is what lets the whole of it be tested
 * against a stub.
 */
export async function notifyBooking(
  lead: Lead,
  offerLabel: string | null,
  people: { setterName?: string | null; closers?: string[] } = {}
): Promise<boolean> {
  if (!isSendable(lead)) return false;

  // Calendly names a host, but in practice either closer may end up taking it,
  // so the line offers both and gets edited in Discord if it matters. The host
  // still goes first, because that is who the calendar actually has.
  const closers = (people.closers ?? []).filter(Boolean);
  const ordered = lead.closerName
    ? [lead.closerName, ...closers.filter((c) => c !== lead.closerName)]
    : closers;
  const closerLine = ordered.length > 0 ? ordered.join(' and/or ') : lead.closerName;
  const link = leadUrl(lead);

  const lines = [
    `📅 **Call booked** — ${leadLabel(lead)}`,
    offerLabel ? `**Offer:** ${offerLabel}` : null,
    `**When:** ${formatCallTime(lead.callScheduledFor)}`,
    people.setterName ? `**Setter:** ${people.setterName}` : null,
    closerLine ? `**Closer:** ${closerLine}` : null,
    lead.needsHandle ? null : lead.igHandle ? `**IG:** @${lead.igHandle}` : null,
    // Somebody booked off a link without ever being in the tracker. That is
    // the booking most likely to be walked into cold, so the ping says so
    // rather than looking like every other one.
    lead.needsHandle || !lead.setterId
      ? `⚠️ **Nobody is on this one.**${lead.email ? ` They booked as ${lead.email}.` : ''} Claim it in the dashboard and triage it before the call.`
      : null,
    link ? `<${link}>` : null,
  ].filter(Boolean);

  return postToChannel(process.env.DISCORD_SETTER_CHANNEL_ID, lines.join('\n'));
}

/**
 * The pre-call brief. This is how Nigel and Andrew get triage notes without
 * logging into the dashboard at all - Discord stays their interface, which is
 * where they already read pre-call notes today.
 */
export async function notifyTriage(lead: Lead, setterName: string): Promise<boolean> {
  if (!isSendable(lead)) return false;

  const link = leadUrl(lead);

  const lines = [
    `🧠 **Pre-call notes** — ${leadLabel(lead)}`,
    `**Call:** ${formatCallTime(lead.callScheduledFor)}${lead.closerName ? ` with ${lead.closerName}` : ''}`,
    lead.phone ? `**Phone:** ${lead.phone}` : null,
    lead.igHandle ? `**IG:** @${lead.igHandle}` : null,
    lead.confirmed ? '**Confirmed:** ✅' : '**Confirmed:** ⚠️ not yet',
    '',
    lead.triageNotes?.trim() || '_No notes written._',
    '',
    `— triaged by ${setterName}`,
    link ? `\nLog what happened here: <${link}>` : null,
  ].filter((l) => l !== null);

  return postToChannel(
    process.env.DISCORD_TRIAGE_CHANNEL_ID ?? process.env.DISCORD_SETTER_CHANNEL_ID,
    lines.join('\n')
  );
}

/**
 * Posts when a setter files their EOD, replacing the notification the
 * automation hub sends when one lands in Airtable. Without this, moving EOD
 * into the dashboard silently ends the only signal the team had that a report
 * was filed at all.
 *
 * Carries the headline numbers rather than just announcing a submission: the
 * Airtable version made everyone open the record to learn anything.
 */
export async function notifyEodSubmitted(input: {
  setterName: string;
  reportDate: string;
  outbounds: number | null;
  followUps: number | null;
  replies: number | null;
  callsBooked: number | null;
  win: string | null;
  obstacle: string | null;
  streakDays: number;
  isUpdate: boolean;
}): Promise<boolean> {
  const stat = (label: string, value: number | null) =>
    value === null ? null : `${label} ${value}`;

  const numbers = [
    stat('Outbounds', input.outbounds),
    stat('Follow-ups', input.followUps),
    stat('Replies', input.replies),
    stat('Booked', input.callsBooked),
  ].filter(Boolean);

  const lines = [
    `📋 **${input.setterName}** ${input.isUpdate ? 'updated their' : 'submitted their'} EOD — ${input.reportDate}`,
    numbers.length > 0 ? numbers.join(' · ') : null,
    // The streak is the whole point of the habit, so it travels with the post.
    input.streakDays > 1 ? `🔥 ${input.streakDays} days in a row` : null,
    input.win ? `**Win:** ${input.win}` : null,
    input.obstacle ? `**Obstacle:** ${input.obstacle}` : null,
  ].filter(Boolean);

  return postToChannel(process.env.DISCORD_SETTER_CHANNEL_ID, lines.join('\n'));
}

/**
 * Posts what happened on a call. A close is the thing the whole pipeline exists
 * to produce, so it should not be something you only find out by opening a
 * record - and a no-show is worth knowing about just as quickly.
 */
export async function notifyOutcome(lead: Lead, loggedBy: string): Promise<boolean> {
  if (!isSendable(lead)) return false;

  const money = (v: string | null) =>
    v === null ? null : Number(v).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    });

  const closed = lead.callOutcome === 'closed';
  const cancelled = lead.callOutcome === 'cancelled';
  const headline = closed
    ? `💰 **Closed** — ${leadLabel(lead)}`
    : lead.callOutcome === 'no_show'
      ? `👻 **No show** — ${leadLabel(lead)}`
      : cancelled
        ? // "Call done" about a call that never happened is worse than saying
          // nothing, and a cancellation is the one the team can still act on.
          `🚫 **Cancelled** — ${leadLabel(lead)}`
        : `📞 **Call done** — ${leadLabel(lead)}`;

  const lines = [
    headline,
    closed && lead.contractValue ? `**Contract:** ${money(lead.contractValue)}` : null,
    closed && lead.cashCollected ? `**Cash in:** ${money(lead.cashCollected)}` : null,
    closed && lead.tier ? `**Tier:** ${lead.tier}` : null,
    !closed && !cancelled && lead.callOutcome
      ? `**Outcome:** ${lead.callOutcome.replace(/_/g, ' ')}`
      : null,
    cancelled && lead.cancelReason ? `**Reason:** ${lead.cancelReason.replace(/_/g, ' ')}` : null,
    lead.closerName ? `**Closer:** ${lead.closerName}` : null,
    lead.postCallNotes?.trim() ? `\n${lead.postCallNotes.trim()}` : null,
    `\n— logged by ${loggedBy}`,
  ].filter(Boolean);

  return postToChannel(process.env.DISCORD_SETTER_CHANNEL_ID, lines.join('\n'));
}
