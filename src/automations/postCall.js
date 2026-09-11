// EOD Reports base -> Post Call table.
//
// Fires when a closer logs the outcome of a sales call. Unlike the EOD
// reports, which are a daily summary, this is the event itself - so the post
// carries the whole thing rather than announcing that a form was filled in.
// A closed call is the single most interesting message this bot sends.
export const key = 'postCall';
export const tableId = 'tblbMVKMdrdgy9RZq';

// Read at a glance. Scrolling a channel of these, the icon should tell you
// how the day went before you read a word.
const OUTCOME_ICONS = {
  Closed: '🎉',
  'No Show': '👻',
  'No Close': '❌',
  Rescheduled: '📅',
  'Follow Up Scheduled': '🔁',
};

// Both Payment Method and Tier carry "No Close" as a choice - an outcome
// wearing another field's clothes. "via No Close" and "Closed · No Close"
// are each nonsense, and the outcome line already says it.
const NOT_SOLD = 'No Close';

const MAX_NOTE = 400;

function selectName(value) {
  return typeof value === 'object' && value !== null ? value.name : value;
}

function truncate(text, limit = MAX_NOTE) {
  const clean = String(text ?? '').trim();
  if (!clean) return '';
  return clean.length > limit ? `${clean.slice(0, limit - 1).trimEnd()}…` : clean;
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  const [year, month, day] = String(dateStr).split('-').map(Number);
  if (!year || !month || !day) return null;
  // Date-only field, so it is parsed and rendered in UTC on purpose - going
  // through a local timezone would shift it a day.
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function money(value) {
  return typeof value === 'number' && value > 0 ? `$${value.toLocaleString('en-US')}` : null;
}

export function formatMessage(record) {
  const fields = record.fields ?? {};
  const outcome = selectName(fields['Call Outcome']) ?? 'Logged';
  const icon = OUTCOME_ICONS[outcome] ?? '📞';
  const leadName = String(fields['Lead Name'] ?? '').trim() || 'Unnamed lead';

  // Tier sits in the headline rather than down with the money: "what did we
  // just sell" is the second thing you want after "did it close", and on a
  // call that didn't close it still says what they were pitched.
  const tier = selectName(fields.Tier);
  const headline = [`${icon} **${outcome}** — ${leadName}`];
  if (tier && tier !== NOT_SOLD) headline.push(`**${tier}**`);
  const lines = [headline.join(' · ')];

  // Who ran it and who fed it. Attribution is half the reason this gets
  // posted: the setter finds out their booking closed without asking.
  const closer = selectName(fields.Closer);
  const setter = selectName(fields['Setter Booked']);
  const date = formatDate(fields['Date']);
  const attribution = [
    closer ? `${closer} closing` : null,
    setter ? `booked by ${setter}` : null,
    date,
  ].filter(Boolean);
  if (attribution.length > 0) lines.push(attribution.join(' · '));

  // Only on a call that produced money. A No Show has none, and a row of
  // "$0 collected" teaches people to skip the line that matters.
  const cash = money(fields['Cash Collected']);
  const revenue = money(fields.Revenue);
  if (cash || revenue) {
    const payment = selectName(fields['Payment Method']);
    const parts = [
      cash ? `${cash} collected` : null,
      revenue ? `${revenue} revenue` : null,
      payment && payment !== NOT_SOLD ? `via ${payment}` : null,
    ].filter(Boolean);
    lines.push(`💰 ${parts.join(' · ')}`);
  }

  const notes = truncate(fields.Notes);
  if (notes) lines.push('', `**Notes** — ${notes}`);

  // Left whole rather than truncated: it is a link, and half a URL is worse
  // than none.
  const recording = String(fields['Fathom Recording'] ?? '').trim();
  if (recording) lines.push('', `🎥 ${recording}`);

  return lines.join('\n');
}
