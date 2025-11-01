const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { formatCountdown } = require('./utils');

function buildPollEmbed({ poll, options, now = new Date() }) {
  const totalVotes = options.reduce((sum, opt) => sum + Number(opt.votes ?? 0), 0);
  const embed = new EmbedBuilder()
    .setTitle(poll.question)
    .setColor(poll.closed_at ? 0x6b7280 : 0x2563eb)
    .setFooter({
      text: poll.closed_at
        ? (poll.closed_reason === 'manual' ? 'Poll closed early' : 'Poll closed (expired)')
        : `Closes in ${formatCountdown(new Date(poll.expires_at), now)}`
    })
    .setTimestamp(poll.closed_at ? new Date(poll.closed_at) : new Date(poll.expires_at));

  const descriptionLines = options.map(opt => {
    const votes = Number(opt.votes ?? 0);
    const percentage = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
    const barUnits = Math.min(10, Math.round((percentage / 100) * 10));
    const bar = '█'.repeat(barUnits) + '░'.repeat(10 - barUnits);
    return `**${opt.position}. ${opt.label}**\n${bar} — ${votes} vote${votes === 1 ? '' : 's'} (${percentage}%)`;
  });

  if (poll.is_multi) {
    descriptionLines.push('\nMembers may choose **multiple** options.');
  }

  embed.setDescription(descriptionLines.join('\n\n'));
  return embed;
}

function buildPollComponents({ poll, options, disabled = false, includeCloseButton = true }) {
  const rows = [];
  let currentRow = new ActionRowBuilder();

  options.forEach(opt => {
    if (currentRow.components.length === 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`polls:vote:${poll.id}:${opt.id}`)
        .setStyle(ButtonStyle.Primary)
        .setLabel(`${opt.position}`)
        .setDisabled(disabled)
    );
  });

  if (currentRow.components.length > 0) {
    rows.push(currentRow);
  }

  if (!rows.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`polls:vote:${poll.id}:placeholder`)
          .setLabel('No options configured')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      )
    );
  }

  if (!poll.closed_at && includeCloseButton) {
    const closeButton = new ButtonBuilder()
      .setCustomId(`polls:close:${poll.id}`)
      .setLabel('Close Poll')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled);

    const lastRow = rows[rows.length - 1];
    if (lastRow && lastRow.components.length < 5) {
      lastRow.addComponents(closeButton);
    } else if (rows.length < 5) {
      rows.push(new ActionRowBuilder().addComponents(closeButton));
    }
    // If all rows are full and already at Discord's limit, we omit the close button.
  }

  return rows;
}

module.exports = {
  buildPollEmbed,
  buildPollComponents
};
