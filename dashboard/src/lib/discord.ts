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
 * The last line of defence for test data. Every caller is also expected to
 * check, but a forgotten guard somewhere would put a brief for a call that
 * doesn't exist in front of the closers, so the send itself refuses too.
 */
function isSendable(lead: Lead): boolean {
  if (lead.isTest) {
    console.log(`Skipping Discord post for test lead ${lead.igHandle}.`);
    return false;
  }
  return true;
}

/** Fires when Calendly tells us a call was booked. */
export async function notifyBooking(lead: Lead, offerLabel: string | null): Promise<boolean> {
  if (!isSendable(lead)) return false;

  const lines = [
    `📅 **Call booked** — ${leadLabel(lead)}`,
    offerLabel ? `**Offer:** ${offerLabel}` : null,
    `**When:** ${formatCallTime(lead.callScheduledFor)}`,
    lead.closerName ? `**Closer:** ${lead.closerName}` : null,
    lead.igHandle ? `**IG:** @${lead.igHandle}` : null,
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
  ].filter((l) => l !== null);

  return postToChannel(
    process.env.DISCORD_TRIAGE_CHANNEL_ID ?? process.env.DISCORD_SETTER_CHANNEL_ID,
    lines.join('\n')
  );
}
