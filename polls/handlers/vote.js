const { MessageFlags } = require('../utils');
const {
  fetchPollWithOptions,
  recordSingleVote,
  toggleMultiVote,
  getUserVotes,
  markPollClosed
} = require('../store');
const { buildPollEmbed, buildPollComponents } = require('../render');

async function updatePollMessage(client, pollData) {
  if (!pollData.poll.message_id) {
    return;
  }

  const channel = await client.channels.fetch(pollData.poll.channel_id).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return;
  }

  const message = await channel.messages.fetch(pollData.poll.message_id).catch(() => null);
  if (!message) {
    return;
  }

  const embed = buildPollEmbed({ poll: pollData.poll, options: pollData.options, now: new Date() });
  const components = buildPollComponents({
    poll: pollData.poll,
    options: pollData.options,
    disabled: Boolean(pollData.poll.closed_at)
  });
  await message.edit({ embeds: [embed], components }).catch(() => {});
}

async function handleVote(interaction) {
  const parts = interaction.customId.split(':');
  if (parts.length !== 4 || parts[0] !== 'polls' || parts[1] !== 'vote') {
    return false;
  }
  const pollId = Number(parts[2]);
  const optionId = parts[3] === 'placeholder' ? null : Number(parts[3]);
  if (!pollId || !optionId) {
    await interaction.reply({
      content: 'This poll is no longer active.',
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return true;
  }

  const pollData = await fetchPollWithOptions(pollId);
  if (!pollData) {
    await interaction.reply({
      content: 'This poll could not be found.',
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return true;
  }

  const { poll, options } = pollData;
  if (poll.closed_at) {
    await interaction.reply({
      content: 'This poll is closed.',
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return true;
  }

  const expiry = new Date(poll.expires_at);
  if (expiry.getTime() <= Date.now()) {
    await markPollClosed(poll.id, { reason: 'expired', closedAt: expiry });
    poll.closed_at = expiry;
    poll.closed_reason = 'expired';
    await interaction.reply({
      content: 'This poll has just expired.',
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    await updatePollMessage(interaction.client, { poll, options });
    return true;
  }

  await interaction.deferUpdate();

  const targetOption = options.find(opt => Number(opt.id) === optionId);
  const optionNumber = targetOption?.position ?? null;

  try {
    const targetOption = options.find(opt => Number(opt.id) === optionId);
    const optionNumber = targetOption?.position ?? optionId;

    if (poll.is_multi) {
      const state = await toggleMultiVote(poll.id, optionId, interaction.user.id);
      const updated = await fetchPollWithOptions(poll.id);
      await updatePollMessage(interaction.client, updated);

      const votes = await getUserVotes(poll.id, interaction.user.id);
      await interaction.followUp({
        content: state === 'added'
          ? `✅ Added option ${optionNumber ?? optionId} to your selections.`
          : `✅ Removed option ${optionNumber ?? optionId} from your selections.`,
        flags: MessageFlags.Ephemeral
      }).catch(() => {});

      // Provide quick summary.
      if (votes.length) {
        await interaction.followUp({
          content: `You have selected options: ${votes.join(', ')}`,
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
      }
    } else {
      await recordSingleVote(poll.id, optionId, interaction.user.id);
      const updated = await fetchPollWithOptions(poll.id);
      await updatePollMessage(interaction.client, updated);

      const votes = await getUserVotes(poll.id, interaction.user.id);
      await interaction.followUp({
        content: votes.length
          ? `✅ Registered your vote for option ${votes[0]}.`
          : '✅ Your vote has been cleared.',
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[polls] Failed to record vote:', err);
    await interaction.followUp({
      content: 'Something went wrong while recording your vote.',
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
  }

  return true;
}

module.exports = {
  handleVote
};
