const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

// Airtable Automations has no "call an external URL" / Discord action, so instead
// of relying on Airtable-side webhooks this hub polls the REST API on an interval
// and asks it for records matching a filter formula.
export function createAirtableClient(personalAccessToken) {
  if (!personalAccessToken) {
    throw new Error('Airtable personal access token is required');
  }

  async function listRecords(baseId, tableId, { filterByFormula } = {}) {
    const records = [];
    let offset;

    do {
      const url = new URL(`${AIRTABLE_API_BASE}/${baseId}/${tableId}`);
      if (filterByFormula) url.searchParams.set('filterByFormula', filterByFormula);
      url.searchParams.set('pageSize', '50');
      if (offset) url.searchParams.set('offset', offset);

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${personalAccessToken}` },
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Airtable list records failed (${response.status}): ${body}`);
      }

      const data = await response.json();
      records.push(...data.records);
      offset = data.offset;
    } while (offset);

    return records;
  }

  async function listRecordsCreatedAfter(baseId, tableId, sinceIso) {
    return listRecords(baseId, tableId, {
      filterByFormula: `IS_AFTER(CREATED_TIME(), '${sinceIso}')`,
    });
  }

  // First write path this hub has needed - #1/#2/#3 only ever read. The
  // AIRTABLE_PAT must include the data.records:write scope for this to work.
  async function updateRecord(baseId, tableId, recordId, fields) {
    const url = `${AIRTABLE_API_BASE}/${baseId}/${tableId}/${recordId}`;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${personalAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Airtable update record failed (${response.status}): ${body}`);
    }

    return response.json();
  }

  return { listRecords, listRecordsCreatedAfter, updateRecord };
}
