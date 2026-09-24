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

/**
 * Reads back what toCsv wrote.
 *
 * Hand-rolled rather than pulled in, because the shape is small and fixed and
 * the failure everyone has seen - a note containing a comma shifting every
 * column after it - lives in exactly these twenty lines.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  // A file saved by a spreadsheet often carries a byte order mark, which would
  // otherwise become part of the first column's name.
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' || c === '\n') {
      // CRLF, LF and a lone CR all end a row; skip the second half of a CRLF.
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  // A file not ending in a newline still has a last row.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Undoes the quote toCsv puts in front of text a spreadsheet would run. */
export function unguard(value: string): string {
  return /^'[=+\-@]/.test(value) ? value.slice(1) : value;
}
