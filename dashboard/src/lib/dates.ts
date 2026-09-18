export const TEAM_TZ = 'America/New_York';

/** YYYY-MM-DD for a moment, as the team's calendar sees it. */
export function teamDateString(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TEAM_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * The UTC instants bounding a team-local day. Computed from the zone's own
 * offset at that date rather than a fixed -5/-4, so the DST changeover doesn't
 * silently shift what "today" means.
 */
export function teamDayRange(dayOffset = 0): { start: Date; end: Date } {
  const now = new Date();
  const target = new Date(now.getTime() + dayOffset * 86_400_000);
  const day = teamDateString(target);

  const guess = new Date(`${day}T00:00:00Z`);
  const local = new Date(guess.toLocaleString('en-US', { timeZone: TEAM_TZ }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offsetMs = utc.getTime() - local.getTime();

  const start = new Date(guess.getTime() + offsetMs);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

export function formatCallTime(date: Date | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TEAM_TZ,
  }).format(date);
}

export function formatTimeOnly(date: Date | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TEAM_TZ,
  }).format(date);
}

export function formatDay(date: Date | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: TEAM_TZ,
  }).format(date);
}

export function relativeDays(date: Date | null | undefined): string {
  if (!date) return '';
  const days = Math.round((Date.now() - date.getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days > 0) return `${days}d ago`;
  if (days === -1) return 'tomorrow';
  return `in ${Math.abs(days)}d`;
}

/**
 * The Monday of the week a moment falls in, YYYY-MM-DD in the team's timezone.
 * Focus rows are keyed on this so last week's stays readable instead of being
 * overwritten by this week's.
 */
export function weekStart(date: Date = new Date()): string {
  const day = teamDateString(date);
  const noonUtc = new Date(`${day}T12:00:00Z`);
  // getUTCDay on a midday anchor avoids the date shifting under the offset.
  const weekday = noonUtc.getUTCDay(); // 0 = Sunday
  const backToMonday = (weekday + 6) % 7;
  noonUtc.setUTCDate(noonUtc.getUTCDate() - backToMonday);
  return noonUtc.toISOString().slice(0, 10);
}
