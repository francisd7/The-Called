const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

// Airtable Automations has no "call an external URL" / Discord action, so instead
// of relying on Airtable-side webhooks this hub polls the REST API on an interval
// and asks it for records created after a watermark timestamp.
export function createAirtableClient(personalAccessToken) {
  if (!personalAccessToken) {
    throw new Error('Airtable personal access token is required');
  }

  async function listRecordsCreatedAfter(baseId, tableId, sinceIso) {
    const formula = `IS_AFTER(CREATED_TIME(), '${sinceIso}')`;
    const records = [];
    let offset;

    do {
      const url = new URL(`${AIRTABLE_API_BASE}/${baseId}/${tableId}`);
      url.searchParams.set('filterByFormula', formula);
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

  return { listRecordsCreatedAfter };
}
