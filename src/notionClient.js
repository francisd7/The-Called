const NOTION_API_BASE = 'https://api.notion.com/v1';

// Pinned on purpose. 2025-09-03 is the version that introduced data sources
// (a Notion database now *contains* one or more data sources, and pages are
// created against a data source rather than the database itself) and the
// `template` parameter this automation is built on. Notion keeps old versions
// working indefinitely, so this only moves when someone deliberately tests a
// newer one.
const NOTION_VERSION = '2025-09-03';

// Same shape as airtableClient.js: a factory that closes over the token and
// returns plain async functions, each throwing with the status + response body
// so a misconfigured database/property shows up in the logs as the exact thing
// Notion objected to.
export function createNotionClient(integrationToken) {
  if (!integrationToken) {
    throw new Error('Notion integration token is required');
  }

  async function request(method, path, body) {
    const response = await fetch(`${NOTION_API_BASE}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${integrationToken}`,
        'Notion-Version': NOTION_VERSION,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Notion ${method} /${path} failed (${response.status}): ${text}`);
    }

    return response.json();
  }

  // The database ID is the one a human can actually get (it's in the database
  // URL). Everything else in this file needs the *data source* ID, which is
  // not visible anywhere in the Notion UI - so resolve it here instead of
  // making someone hunt for it. A database made the normal way has exactly
  // one data source; if it somehow has more, first one wins and we say so.
  async function getDataSourceId(databaseId) {
    const database = await request('get', `databases/${databaseId}`);
    const dataSources = database.data_sources ?? [];
    if (dataSources.length === 0) {
      throw new Error(
        `Notion database ${databaseId} has no data sources - is that ID actually a database (not a page)?`
      );
    }
    return { id: dataSources[0].id, count: dataSources.length };
  }

  // Returns Notion's property schema: { "Client Email": { type: "email", ... } }.
  // Used to build the create-page payload against whatever columns actually
  // exist, so swapping a mock database for the real one can't 400 on a column
  // that got renamed - it just skips it and reports what it skipped.
  async function getDataSourceProperties(dataSourceId) {
    const dataSource = await request('get', `data_sources/${dataSourceId}`);
    return dataSource.properties ?? {};
  }

  async function listTemplates(dataSourceId) {
    const data = await request('get', `data_sources/${dataSourceId}/templates`);
    return data.templates ?? [];
  }

  async function findTemplateByName(dataSourceId, name) {
    const templates = await listTemplates(dataSourceId);
    const wanted = name.trim().toLowerCase();
    return templates.find((template) => template.name.trim().toLowerCase() === wanted) ?? null;
  }

  // Dedupe guard. If a dashboard already exists for this email, we link that
  // one back to Airtable instead of creating a second copy - which is what
  // makes the poll cycle safe to re-run after an Airtable write fails midway.
  async function findPageByEmail(dataSourceId, emailPropertyName, email) {
    const data = await request('post', `data_sources/${dataSourceId}/query`, {
      filter: { property: emailPropertyName, email: { equals: email } },
      page_size: 1,
    });
    return data.results?.[0] ?? null;
  }

  // templateId null means "use whichever template is set as default on the
  // database" - which is the state you're left in after clicking "Set as
  // default" in the Notion UI.
  async function createPageFromTemplate({ dataSourceId, templateId, properties }) {
    return request('post', 'pages', {
      parent: { type: 'data_source_id', data_source_id: dataSourceId },
      template: templateId ? { type: 'template_id', template_id: templateId } : { type: 'default' },
      properties,
    });
  }

  return {
    getDataSourceId,
    getDataSourceProperties,
    listTemplates,
    findTemplateByName,
    findPageByEmail,
    createPageFromTemplate,
  };
}
