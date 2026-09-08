// Generic poll loop shared by every "new record -> Discord" automation.
// State tracks a per-automation watermark (the createdTime of the last record we
// notified about) so restarts/redeploys don't double-post.
export function createPoller({ airtableClient, discord, state, saveState, log = console }) {
  async function pollAutomation({ key, baseId, tableId, formatMessage, discordChannelId }) {
    const sinceIso = state[key];

    if (!sinceIso) {
      // First run ever for this automation: start the watermark at "now" so we
      // notify about new submissions going forward, not the entire table history.
      state[key] = new Date().toISOString();
      await saveState(state);
      log.info(`[${key}] no prior watermark — starting from now (${state[key]})`);
      return;
    }

    const records = await airtableClient.listRecordsCreatedAfter(baseId, tableId, sinceIso);
    if (records.length === 0) return;

    records.sort((a, b) => new Date(a.createdTime) - new Date(b.createdTime));

    for (const record of records) {
      const message = formatMessage(record);
      await discord.sendToChannel(discordChannelId, message);
      state[key] = record.createdTime;
      await saveState(state);
      log.info(`[${key}] notified for record ${record.id}`);
    }
  }

  async function pollAll(automations) {
    for (const automation of automations) {
      try {
        await pollAutomation(automation);
      } catch (err) {
        log.error(`[${automation.key}] poll failed:`, err);
      }
    }
  }

  return { pollAll, pollAutomation };
}
