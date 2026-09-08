// EOD Reports base -> Setter EOD table.
export const key = 'setterEod';
export const tableId = 'tblAOPJioGyBRliH4';

function formatDate(dateStr) {
  if (!dateStr) return 'an unknown date';
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatMessage(record) {
  const fields = record.fields ?? {};
  const setterName = fields['Setter Name'] ?? 'Someone';
  const date = formatDate(fields['Date']);
  return `📋 **${setterName}** submitted their EOD report — ${date}`;
}
