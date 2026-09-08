// The Called - Client Success base -> Weekly Check-ins table.
export const key = 'weeklyCheckin';
export const tableId = 'tblj04VfjlFxoXzL6';

export function formatMessage(record) {
  const fields = record.fields ?? {};
  // "Client (Name)" is a formula field that resolves the linked Client record
  // to plain text, since the "Client" field itself is a link, not text.
  const clientName = fields['Client (Name)'] ?? 'A client';
  const momentum = fields['Momentum Rating (1-10)'];
  const momentumText = typeof momentum === 'number' ? `${momentum}/10` : 'not rated';
  return `✅ **${clientName}** submitted their Weekly Check-in — Momentum: ${momentumText}`;
}
