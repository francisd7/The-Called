// Discord channel names must be lowercase with hyphens, no spaces - "First
// Last" -> "first-last". Falls back to a generic name if a display name
// somehow reduces to nothing (e.g. entirely emoji/symbols).
export function slugifyChannelName(displayName) {
  const cleaned = (displayName ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '') // strip accents so "María" -> "maria"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'new-member';
}
