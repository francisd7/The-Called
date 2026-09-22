/**
 * Who the dashboard behaves as, decided with no database or cookie jar
 * attached so the rule that matters can be tested directly.
 */

export const VIEW_AS_COOKIE = 'view-as';

export type CurrentUser = {
  id: string;
  name: string;
  role: string;
  /**
   * Set only while somebody is being viewed as. Carries the real signed-in
   * person, so the banner can name them and every write can refuse.
   */
  viewingAs: { realId: string; realName: string; realRole: string } | null;
};

type Real = { id: string; name: string; role: string };
type Target = { id: string; name: string; role: string; active: boolean } | null | undefined;

/**
 * Every path that is not an active admin naming somebody else falls back to the
 * real person. The cookie is only a user id: taken at face value, anybody could
 * set it and read another person's pipeline, so the real role is re-checked on
 * every request rather than trusted from whatever set the cookie.
 */
export function resolveViewAs(
  real: Real,
  cookieValue: string | undefined,
  target: Target
): CurrentUser {
  const asSelf = { ...real, viewingAs: null };
  if (!cookieValue || cookieValue === real.id) return asSelf;
  if (real.role !== 'admin') return asSelf;
  if (!target || target.id !== cookieValue || !target.active) return asSelf;

  return {
    id: target.id,
    name: target.name,
    role: target.role,
    viewingAs: { realId: real.id, realName: real.name, realRole: real.role },
  };
}
