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

/** How far the team's clock sits from UTC at a given moment, in ms. */
function teamOffsetMs(at: Date): number {
  const local = new Date(at.toLocaleString('en-US', { timeZone: TEAM_TZ }));
  const utc = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' }));
  return utc.getTime() - local.getTime();
}

/**
 * A moment as `YYYY-MM-DDTHH:mm` on the team's clock, which is what a
 * datetime-local input wants. Everything else on the page is shown in the
 * team's timezone, so a form that quietly used UTC would be reading four or
 * five hours off from the time printed next to it.
 */
export function teamDateTimeInputValue(date: Date | null | undefined): string {
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TEAM_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  // Some runtimes render midnight as hour 24 rather than 00.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

/**
 * The reverse: a team-local `YYYY-MM-DDTHH:mm` back to the instant it names.
 * The offset is resolved twice, so a time just either side of a daylight-saving
 * change lands on the offset actually in force rather than the one before it.
 */
export function parseTeamDateTime(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const naiveUtc = new Date(`${value.slice(0, 16)}:00Z`);
  if (Number.isNaN(naiveUtc.getTime())) return null;
  const firstPass = new Date(naiveUtc.getTime() + teamOffsetMs(naiveUtc));
  return new Date(naiveUtc.getTime() + teamOffsetMs(firstPass));
}
