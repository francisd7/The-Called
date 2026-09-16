// Airtable Clients field -> Notion database column. Left side is the Airtable
// field name (from "The Called - Client Success" > Clients), right side is the
// Notion column title. Anything on the right that doesn't exist in the Notion
// database is skipped and reported rather than erroring - that's what makes it
// safe to point this at a mock database first and the real one later.
export const DEFAULT_FIELD_MAP = {
  'Client Name': 'Name',
  Email: 'Client Email',
  CSM: 'CSM',
  'Package / Tier': 'Package',
  'Start Date': 'Start Date',
  Status: 'Status',
};

// The Airtable field this automation writes the finished Notion link back to.
// It has to exist on the Clients table - it's both the "already done" marker
// and where staff/CSMs find the dashboard.
export const DASHBOARD_URL_FIELD = 'Notion Dashboard URL';

export const NEEDS_DASHBOARD_FORMULA = `AND({Status} = 'Active', {${DASHBOARD_URL_FIELD}} = '')`;

function isEmpty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function optionNames(schema) {
  return (schema[schema.type]?.options ?? []).map((option) => option.name);
}

// Converts one Airtable value into the Notion property payload for whatever
// type that column actually is. Returns null when the value can't be
// represented, so the caller can report it instead of sending Notion
// something it will reject.
function toNotionValue(schema, value) {
  const text = String(value);

  switch (schema.type) {
    case 'title':
      return { title: [{ text: { content: text } }] };
    case 'rich_text':
      return { rich_text: [{ text: { content: text } }] };
    case 'email':
      return { email: text };
    case 'url':
      return { url: text };
    case 'phone_number':
      return { phone_number: text };
    case 'date':
      return { date: { start: text } };
    case 'number':
      return Number.isFinite(Number(value)) ? { number: Number(value) } : null;
    case 'checkbox':
      return { checkbox: Boolean(value) };
    case 'select':
      // Notion creates a missing select option on the fly, so anything goes.
      return { select: { name: text } };
    case 'status':
      // Status is the exception: its options can NOT be created through the
      // API, so an unknown value would 400 the whole page. Skip instead -
      // a dashboard with a blank Status beats no dashboard at all.
      return optionNames(schema).includes(text) ? { status: { name: text } } : null;
    case 'multi_select': {
      const values = Array.isArray(value) ? value : [text];
      return { multi_select: values.map((name) => ({ name: String(name) })) };
    }
    default:
      // people, relation, files, formula, rollup, ... - nothing sensible to
      // map an Airtable text/select value onto.
      return null;
  }
}

// Builds the `properties` payload for POST /v1/pages, driven by the Notion
// database's real schema. `skipped` is for humans: it explains every mapped
// field that didn't make it, which is the first thing you want to see when
// testing against a new database.
export function buildDashboardProperties(notionProperties, airtableFields, fieldMap = DEFAULT_FIELD_MAP) {
  const properties = {};
  const skipped = [];

  for (const [airtableField, notionColumn] of Object.entries(fieldMap)) {
    const value = airtableFields?.[airtableField];
    if (isEmpty(value)) {
      skipped.push({
        notionColumn,
        code: 'empty',
        reason: `Airtable field "${airtableField}" is empty`,
      });
      continue;
    }

    const schema = notionProperties?.[notionColumn];
    if (!schema) {
      skipped.push({
        notionColumn,
        code: 'missing-column',
        reason: 'no column with that name in the Notion database',
      });
      continue;
    }

    const notionValue = toNotionValue(schema, value);
    if (notionValue === null) {
      const detail =
        schema.type === 'status'
          ? `"${value}" is not one of its options (${optionNames(schema).join(', ') || 'none'}) and the API can't create Status options`
          : `Notion column type "${schema.type}" can't be set from an Airtable text value`;
      skipped.push({ notionColumn, code: 'unmappable', reason: detail });
      continue;
    }

    properties[notionColumn] = notionValue;
  }

  return { properties, skipped };
}

// Second pass over what Airtable already filtered, so the rules are visible
// and unit-testable rather than living only inside a formula string. A client
// with no name would create an untitled dashboard nobody can identify, and
// with no email there's nobody to invite once it exists.
export function selectClientsNeedingDashboard(records) {
  const toCreate = [];
  const skipped = [];

  for (const record of records) {
    const fields = record.fields ?? {};
    const clientName = (fields['Client Name'] ?? '').trim();
    const email = (fields.Email ?? '').trim();
    const existingUrl = (fields[DASHBOARD_URL_FIELD] ?? '').trim();

    if (existingUrl) {
      skipped.push({ clientName: clientName || record.id, reason: 'already has a dashboard' });
      continue;
    }
    if (!clientName) {
      skipped.push({ clientName: record.id, reason: 'no Client Name on the record' });
      continue;
    }
    if (!email) {
      skipped.push({ clientName, reason: 'no Email on the record' });
      continue;
    }

    toCreate.push({ recordId: record.id, clientName, email, fields });
  }

  return { toCreate, skipped };
}

// Notion has no API for inviting a guest to a page (checked against the
// official SDK - there is no permissions endpoint at all), so the last step
// stays human. This message is that handoff: it carries the link and the
// email so it's a copy-paste, not a lookup.
export function formatDashboardCreatedMessage({ clientName, email, url, skipped = [] }) {
  const lines = [
    `🗂️ **Notion dashboard created for ${clientName}**`,
    url,
    '',
    `Last step (30 seconds): open it → **Share** → invite \`${email}\` → **Can edit** → Invite.`,
  ];

  if (skipped.length > 0) {
    lines.push('', 'Columns left blank:');
    for (const item of skipped) {
      lines.push(`• ${item.notionColumn} — ${item.reason}`);
    }
  }

  return lines.join('\n');
}

export function formatDryRunSummary({ toCreate, skipped }) {
  const lines = ['🧪 Client dashboard run — DRY RUN (nothing was created)', ''];

  lines.push(`Would create (${toCreate.length}):`);
  if (toCreate.length === 0) {
    lines.push('  (none)');
  } else {
    for (const item of toCreate) {
      lines.push(`• ${item.clientName} <${item.email}>`);
    }
  }

  lines.push('', `Skipped (${skipped.length}):`);
  if (skipped.length === 0) {
    lines.push('  (none)');
  } else {
    for (const item of skipped) {
      lines.push(`• ${item.clientName} — ${item.reason}`);
    }
  }

  return lines.join('\n');
}
