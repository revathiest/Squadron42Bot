const { listExpiredOpenPolls, fetchPollWithOptions, markPollClosed } = require('./store');
const { buildPollEmbed, buildPollComponents } = require('./render');

const CHECK_INTERVAL_MS = 60_000;
let intervalHandle = null;

async function closePollMessage(client, pollId) {
  const data = await fetchPollWithOptions(pollId);
  if (!data) {
    return;
  }

  const { poll, options } = data;
  if (!poll.message_id) {
    return;
  }

  const channel = await client.channels.fetch(poll.channel_id).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return;
  }

  const message = await channel.messages.fetch(poll.message_id).catch(() => null);
  if (!message) {
    return;
  }

  const embed = buildPollEmbed({ poll, options });
  const rows = buildPollComponents({ poll, options, disabled: true, includeCloseButton: false });
  await message.edit({ embeds: [embed], components: rows }).catch(() => {});
}

async function processExpiredPolls(client) {
  const now = new Date();
  const ids = await listExpiredOpenPolls(now);
  if (!ids.length) {
    return;
  }

  for (const pollId of ids) {
    await markPollClosed(pollId, { reason: 'expired', closedAt: now });
    await closePollMessage(client, pollId);
  }
}

function startScheduler(client) {
  if (intervalHandle) {
    return;
  }
  intervalHandle = setInterval(() => {
    processExpiredPolls(client).catch(err => {
      console.error('[polls] Failed to process expired polls:', err);
    });
  }, CHECK_INTERVAL_MS);
}

function stopScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = {
  startScheduler,
  stopScheduler,
  processExpiredPolls,
  closePollMessage
};
