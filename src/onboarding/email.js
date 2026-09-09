const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Deliberately loose - just enough to catch "that's obviously not an email"
// (e.g. "hey what's up") before we bother querying Airtable, not full RFC
// validation.
export function looksLikeEmail(text) {
  return EMAIL_PATTERN.test((text ?? '').trim());
}

export function normalizeEmail(text) {
  return (text ?? '').trim().toLowerCase();
}
