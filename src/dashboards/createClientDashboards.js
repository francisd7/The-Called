import { CLIENTS_TABLE_ID, firstNameOf } from '../reminders/weeklyCheckinReminder.js';
import {
  CHANNEL_ID_FIELD,
  DASHBOARD_URL_FIELD,
  NEEDS_DASHBOARD_FORMULA,
  buildDashboardProperties,
  formatClientDashboardMessage,
  formatDashboardCreatedMessage,
  selectClientsNeedingDashboard,
} from './clientDashboard.js';

// Resolves everything Notion-side that a run depends on, in one place, so a
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

function emailColumnOf(properties) {
  return Object.entries(properties).find(([, schema]) => schema.type === 'email')?.[0];
}

// The one place a dashboard actually gets made, shared by both entry points.
//
// Ordering matters: create the Notion page, then immediately write the URL back
// to Airtable. That write is what marks the client as done, so anything that
// fails after the page exists must be safe to retry - which is what the
// dedupe-by-email lookup at the top is for.
async function provisionDashboard({
  notionClient,
  airtableClient,
  target,
  emailColumn,
  client,
  baseId,
  log,
}) {
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

  return { page, skippedColumns, reused: Boolean(existing) };
}

// The instant path, and the one clients actually experience: they reply with
// their email, and their dashboard lands in the same channel seconds later.
//
// Notion has no API for granting them access, so the invite is still a human
// step - but it now happens *after* the client already has the link, which is
// why the staff ping mentions the CSM role and says so outright. The client
// message names the access gap too, rather than leaving them staring at
// Notion's request-access screen wondering if they were sent a broken link.
//
// Never throws: a Notion outage must not break the "You're all set!" reply or
// the Airtable record that the rest of onboarding depends on. A failure is
// logged and pushed to the staff channel instead, where someone can pick it up.
export async function deliverDashboardOnSignup({
  notionClient,
  airtableClient,
  discord,
  baseId,
  databaseId,
  templateName,
  record,
  clientChannelId,
  staffChannelId,
  csmRoleId,
  log = console,
}) {
  const fields = record?.fields ?? {};
  const clientName = (fields['Client Name'] ?? '').trim();
  const email = (fields.Email ?? '').trim();
  const existingUrl = (fields[DASHBOARD_URL_FIELD] ?? '').trim();

  async function postToClient(url) {
    if (!clientChannelId) return;
    await discord.sendToChannel(
      clientChannelId,
      formatClientDashboardMessage({ firstName: firstNameOf(clientName), url })
    );
  }

  try {
    // A returning client who already has a dashboard just gets the link again -
    // no Notion calls, no second page, no staff ping. They're already a guest.
    if (existingUrl) {
      await postToClient(existingUrl);
      log.info(`[clientDashboard] re-sent existing dashboard link to ${clientName}`);
      return { ok: true, url: existingUrl, reused: true };
    }

    if (!email) {
      log.warn(`[clientDashboard] no email on ${clientName || record?.id} — skipping dashboard`);
      return { ok: false, reason: 'no email on the record' };
    }

    const target = await resolveNotionTarget({ notionClient, databaseId, templateName });
    const { page, skippedColumns } = await provisionDashboard({
      notionClient,
      airtableClient,
      target,
      emailColumn: emailColumnOf(target.properties),
      client: { recordId: record.id, clientName, email, fields },
      baseId,
      log,
    });

    await postToClient(page.url);

    if (staffChannelId) {
      await discord.sendToChannel(
        staffChannelId,
        formatDashboardCreatedMessage({
          clientName,
          email,
          url: page.url,
          skipped: skippedColumns,
          csmRoleMention: csmRoleId ? `<@&${csmRoleId}>` : '',
          linkAlreadySent: Boolean(clientChannelId),
        })
      );
    }

    log.info(`[clientDashboard] delivered dashboard to ${clientName} — ${page.url}`);
    return { ok: true, url: page.url, reused: false };
  } catch (err) {
    log.error(`[clientDashboard] delivery failed for ${clientName || record?.id}:`, err);
    if (staffChannelId) {
      await discord
        .sendToChannel(
          staffChannelId,
          `⚠️ Couldn't create a Notion dashboard for **${clientName || record?.id}** (${email || 'no email'}): ${err.message}\nThey've been told one is coming, so this needs doing by hand.`
        )
        .catch(() => {});
    }
    return { ok: false, reason: err.message };
  }
}

// The safety net. Picks up any Active client who still has no dashboard -
// someone added to Airtable by hand, a client who predates this automation, or
// one whose instant send failed. Driven by the absence of a Notion Dashboard
// URL rather than a created-time watermark, so it's idempotent and re-running
// it is always safe.
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

  const emailColumn = emailColumnOf(target.properties);
  const created = [];
  const failures = [];

  for (const client of plan.toCreate) {
    try {
      const { page, skippedColumns, reused } = await provisionDashboard({
        notionClient,
        airtableClient,
        target,
        emailColumn,
        client,
        baseId,
        log,
      });

      // If onboarding captured their channel we can still reach the client
      // directly, so this path delivers the same experience as the instant one.
      const clientChannelId = (client.fields[CHANNEL_ID_FIELD] ?? '').trim();
      if (clientChannelId) {
        await discord.sendToChannel(
          clientChannelId,
          formatClientDashboardMessage({
            firstName: firstNameOf(client.clientName),
            url: page.url,
          })
        );
      }

      if (notifyChannelId) {
        await discord.sendToChannel(
          notifyChannelId,
          formatDashboardCreatedMessage({
            clientName: client.clientName,
            email: client.email,
            url: page.url,
            skipped: skippedColumns,
            linkAlreadySent: Boolean(clientChannelId),
          })
        );
      }

      created.push({ clientName: client.clientName, url: page.url, reused });
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
