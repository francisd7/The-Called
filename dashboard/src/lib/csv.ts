/**
 * CSV, written out properly.
 *
 * The fields most likely to be exported here are triage notes and post-call
 * notes - free text somebody typed into a textarea, so full of commas, quotes
 * and newlines. A naive join(',') produces a file that opens with the columns
 * shifted from the first note onward and looks fine until somebody trusts it.
 */

/** RFC 4180: quote when it could be misread, and double any quote inside. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let s: string;
  let wasText = typeof value === 'string';
  if (value instanceof Date) {
    s = value.toISOString();
  } else if (typeof value === 'object') {
    s = JSON.stringify(value);
    wasText = true;
  } else {
    s = String(value);
  }

  if (s === '') return '';
  // A leading =, +, - or @ makes Excel and Sheets treat the cell as a formula,
  // so text that starts that way is prefixed with a quote. Only text: -180 in
  // the net column is a number we want to stay a number, and a number cannot
  // carry a formula in the first place.
  if (wasText && /^[=+\-@]/.test(s)) s = `'${s}`;

  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [columns.map(cell).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => cell(row[c])).join(','));
  }
  // CRLF and a trailing newline: what Excel expects, and what stops the last
  // row being dropped by some parsers.
  return lines.join('\r\n') + '\r\n';
}
