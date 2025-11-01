const { MessageFlags, canMemberClosePoll } = require('../utils');
const { fetchPollWithOptions, markPollClosed } = require('../store');
const { closePollMessage } = require('../scheduler');

async function handleCloseButton(interaction) {
  const parts = interaction.customId.split(':');
  if (parts.length !== 3 || parts[0] !== 'polls' || parts[1] !== 'close') {
    return false;
  }

  const pollId = Number(parts[2]);
  if (!pollId) {
    await interaction.reply({
      content: 'This poll is no longer available.',
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

  const { poll } = pollData;
  if (poll.closed_at) {
    await interaction.reply({
      content: 'This poll is already closed.',
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return true;
  }

  if (!canMemberClosePoll(interaction.member, poll)) {
    await interaction.reply({
      content: 'You are not allowed to close this poll.',
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return true;
  }

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    // If we cannot defer, stop early so Discord doesn't treat this as unhandled.
    return true;
  }

  try {
    await markPollClosed(poll.id, {
      reason: 'manual',
      closedBy: interaction.user.id,
      closedAt: new Date()
    });
    await closePollMessage(interaction.client, poll.id);

    await interaction.editReply({
      content: 'Poll closed.'
    }).catch(() => {});
  } catch (err) {
    console.error('[polls] Failed to close poll via message button:', err);
    await interaction.editReply({
      content: 'Unable to close the poll. Please try again.'
    }).catch(() => {});
  }

  return true;
}

module.exports = {
  handleCloseButton
};
