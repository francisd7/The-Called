/**
 * Who may sign in, as a rule with no database attached.
 *
 * `active` used to carry two meanings at once: "can get in" for sign-in, and
 * "is on the team" for the pickers. Closers were marked inactive to keep them
 * out of the dashboard - they work from Discord and the post-call form - and
 * that quietly took them out of the Closer dropdown as well, which is the one
 * place their names have to appear. A call could be booked and nobody could
 * say which of them was taking it.
 *
 * So the two are separated. `active` means on the team, and whether somebody
 * can sign in is decided here, by role. A closer has a row so bookings can be
 * attributed to them; it was never an account.
 */
export type AccessRow = { email: string; active: boolean; role: string };

/** Null when they may sign in, or the reason to log when they may not. */
export function signInRefusal(
  row: AccessRow | null | undefined,
  email: string,
): string | null {
  if (!row) return `${email} is not in the users table.`;
  if (!row.active) return `${email} exists but is not active (${row.role}).`;
  // By role, not by the active flag: a closer is on the team and pickable, and
  // still has no reason to be in here.
  if (row.role === "closer") {
    return `${email} is a closer. Closers work from Discord and the post-call form, and have no dashboard sign-in.`;
  }
  return null;
}
