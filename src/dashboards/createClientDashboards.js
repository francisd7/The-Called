import { CLIENTS_TABLE_ID } from '../reminders/weeklyCheckinReminder.js';
import {
  DASHBOARD_URL_FIELD,
  NEEDS_DASHBOARD_FORMULA,
  buildDashboardProperties,
  formatDashboardCreatedMessage,
  selectClientsNeedingDashboard,
} from './clientDashboard.js';

// Resolves everything Notion-side that the run depends on, in one place, so a
// misconfiguration fails here with a clear message instead of halfway through
// creating dashboards. Shared with the dry-run script - running that is how
// you confirm a new database is wired up correctly before going live.
export async function resolveNotionTarget({ notionClient, databaseId, templateName }) {
  const { id: dataSourceId, count } = await notionClient.getDataSourceId(databaseId);
  const properties = await notionClient.getDataSourceProperties(dataSourceId);
  const templates = await notionClient.listTemplates(dataSourceId);

  const wanted = templateName?.trim();
  const template = wanted
    ? templates.find((t) => t.name.trim().toLowerCase() === wanted.toLowerCase())
    : templates.find((t) => t.is_default);

  if (!template) {
    const available = templates.map((t) => t.name).join(', ') || 'none';
    throw new Error(
      wanted
        ? `No Notion template named "${wanted}" in that database. Templates found: ${available}`
        : `That Notion database has no default template set, and NOTION_DASHBOARD_TEMPLATE_NAME isn't set either — every dashboard would come out blank. Templates found: ${available}. Set one as default in Notion (⌄ next to New → ••• → Set as default), or name it in the env var.`
    );
  }

  return { dataSourceId, dataSourceCount: count, properties, templates, template };
}

// The real write path - only reachable from src/index.js when
// NOTION_DASHBOARD_ENABLED=true, and from scripts/create-one-client-dashboard.js
// for a deliberate single-client test.
//
// Ordering matters: create the Notion page, then immediately write the URL
// back to Airtable. That write is what stops the next poll cycle from picking
// the same client up again, so if it fails we stop the whole run rather than
// carry on and risk a second dashboard for someone else while the first
// client is still unmarked.
export async function createClientDashboards({
  airtableClient,
  notionClient,
  discord,
  baseId,
  databaseId,
  templateName,
  notifyChannelId,
  log = console,
}) {
  // Airtable first, on purpose. This runs on the poll interval and almost
  // every cycle has nothing to do, so there's no reason to spend three Notion
  // API calls a minute resolving a database nobody needs yet.
  const records = await airtableClient.listRecords(baseId, CLIENTS_TABLE_ID, {
    filterByFormula: NEEDS_DASHBOARD_FORMULA,
  });
  const plan = selectClientsNeedingDashboard(records);
  if (plan.toCreate.length === 0) {
    return { created: [], failures: [], skipped: plan.skipped };
  }

  const target = await resolveNotionTarget({ notionClient, databaseId, templateName });
  if (target.dataSourceCount > 1) {
    log.warn(
      `[clientDashboard] database has ${target.dataSourceCount} data sources; using the first one (${target.dataSourceId})`
    );
  }

  // Whichever column holds the client's email is what dedupe matches on.
  const emailColumn = Object.entries(target.properties).find(
    ([, schema]) => schema.type === 'email'
  )?.[0];

  const created = [];
  const failures = [];

  for (const client of plan.toCreate) {
    try {
      // If a page for this email already exists, a previous run created it and
      // then failed to write the URL back. Reuse it - never make a second one.
      const existing = emailColumn
        ? await notionClient.findPageByEmail(target.dataSourceId, emailColumn, client.email)
        : null;

      let page = existing;
      let skippedColumns = [];

      if (existing) {
        log.info(`[clientDashboard] reusing existing page for ${client.email} (${existing.id})`);
      } else {
        const built = buildDashboardProperties(target.properties, client.fields);
        skippedColumns = built.skipped.filter((item) => item.code !== 'empty');
        page = await notionClient.createPageFromTemplate({
          dataSourceId: target.dataSourceId,
          templateId: target.template.id,
          properties: built.properties,
        });
      }

      await airtableClient.updateRecord(baseId, CLIENTS_TABLE_ID, client.recordId, {
        [DASHBOARD_URL_FIELD]: page.url,
      });

      if (notifyChannelId) {
        await discord.sendToChannel(
          notifyChannelId,
          formatDashboardCreatedMessage({
            clientName: client.clientName,
            email: client.email,
            url: page.url,
            skipped: skippedColumns,
          })
        );
      }

      created.push({ clientName: client.clientName, url: page.url, reused: Boolean(existing) });
      log.info(`[clientDashboard] dashboard ready for ${client.clientName} — ${page.url}`);
    } catch (err) {
      failures.push({ clientName: client.clientName, error: err.message });
      log.error(`[clientDashboard] failed for ${client.clientName}:`, err);
      // Stop the run. Continuing past a failure risks duplicate dashboards if
      // the failure was the Airtable write rather than the Notion create.
      break;
    }
  }

  if (failures.length > 0 && notifyChannelId) {
    await discord.sendToChannel(
      notifyChannelId,
      `⚠️ Notion dashboard run stopped after an error on **${failures[0].clientName}**: ${failures[0].error}`
    );
  }

  return { created, failures, skipped: plan.skipped };
}
