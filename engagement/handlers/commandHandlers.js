const { EmbedBuilder } = require('discord.js');
const utils = require('../utils');

function formatPoints(points) {
  return new Intl.NumberFormat('en-US').format(points);
}

async function handleStatsCommand(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const guildId = interaction.guildId;

  const stats = await utils.getMemberStats(guildId, target.id);

  if (!stats) {
    await interaction.reply({
      content: target.id === interaction.user.id
        ? 'You have not generated any engagement yet.'
        : `${target.toString()} has not generated any engagement yet.`,
      ephemeral: true
    });
    return;
  }

  const levelDisplay = `${stats.levelName ?? `Level ${stats.currentLevel}`} (Lvl ${stats.currentLevel})`;
  const nextDisplay = stats.nextThreshold
    ? `${stats.nextLevelName ?? `Level ${stats.currentLevel + 1}`} • ${formatPoints(stats.nextThreshold)} pts`
    : 'Max level reached';

  const embed = new EmbedBuilder()
    .setTitle(`${target.username}'s Engagement`)
    .setThumbnail(target.displayAvatarURL({ extension: 'png', size: 128 }))
    .addFields(
      { name: 'Level', value: levelDisplay, inline: true },
      { name: 'Active Points', value: `${formatPoints(stats.activePoints)} pts`, inline: true },
      { name: 'Next Level', value: nextDisplay, inline: true }
    )
    .setColor(0x00AEFF)
    .setFooter({ text: `Updated ${stats.updatedAt.toLocaleString()}` });

  await interaction.reply({ embeds: [embed], ephemeral: false });
}

async function handleLeaderboardCommand(interaction) {
  const sizeOption = interaction.options.getInteger('size');
  const limit = Math.min(Math.max(sizeOption ?? 10, 3), 25);
  const guildId = interaction.guildId;

  const leaderboard = await utils.getLeaderboard(guildId, limit);

  if (!leaderboard.length) {
    await interaction.reply({
      content: 'No engagement data is available yet.',
      ephemeral: true
    });
    return;
  }

  const lines = leaderboard.map((entry, idx) => {
    const rank = idx + 1;
    const userMention = `<@${entry.userId}>`;
    const points = formatPoints(entry.activePoints);
    const levelTitle = `${entry.levelName ?? `Level ${entry.currentLevel}`} (Lvl ${entry.currentLevel})`;
    return `**${rank}.** ${userMention} — ${points} pts (${levelTitle})`;
  });

  await interaction.reply({
    content: lines.join('\n'),
    allowedMentions: { users: [] }
  });
}

async function handleSetPointsCommand(interaction) {
  const reactionPoints = interaction.options.getInteger('reaction');
  const replyPoints = interaction.options.getInteger('reply');

  if (reactionPoints < 0 || replyPoints < 0) {
    await interaction.reply({
      content: 'Point values must be zero or greater.',
      ephemeral: true
    });
    return;
  }

  await utils.updateGuildPoints(interaction.guildId, {
    reactionPoints,
    replyPoints
  });

  await interaction.reply({
    content: `Updated engagement points: reactions now grant **${reactionPoints}** and replies grant **${replyPoints}**.`,
    ephemeral: true
  });
}

async function handleSetCooldownCommand(interaction) {
  const cooldownSeconds = interaction.options.getInteger('seconds');

  if (cooldownSeconds < 5) {
    await interaction.reply({
      content: 'Cooldown must be at least 5 seconds.',
      ephemeral: true
    });
    return;
  }

  await utils.updateGuildCooldown(interaction.guildId, cooldownSeconds);

  await interaction.reply({
    content: `Cooldown updated: members must now wait **${cooldownSeconds}** seconds before rewarding the same poster again.`,
    ephemeral: true
  });
}

async function handleSetAnnouncementChannelCommand(interaction) {
  const channel = interaction.options.getChannel('channel');

  if (!channel || !channel.isTextBased()) {
    await interaction.reply({
      content: 'Please choose a text-capable channel.',
      ephemeral: true
    });
    return;
  }

  await utils.updateAnnouncementChannel(interaction.guildId, channel.id);

  await interaction.reply({
    content: `Level-up announcements will post in ${channel}.`,
    ephemeral: true
  });
}

async function handleToggleAnnouncementsCommand(interaction) {
  const enabled = interaction.options.getBoolean('enabled');

  await utils.updateAnnouncementToggle(interaction.guildId, enabled);

  await interaction.reply({
    content: `Level-up announcements in the configured channel are now **${enabled ? 'enabled' : 'disabled'}**.`,
    ephemeral: true
  });
}

async function handleToggleDmCommand(interaction) {
  const enabled = interaction.options.getBoolean('enabled');

  await utils.updateDmToggle(interaction.guildId, enabled);

  await interaction.reply({
    content: `Level-up direct messages are now **${enabled ? 'enabled' : 'disabled'}**.`,
    ephemeral: true
  });
}

async function handleLevelSetCommand(interaction) {
  const levelRank = interaction.options.getInteger('level');
  const pointsRequired = interaction.options.getInteger('points');
  const rawName = interaction.options.getString('name');
  const levelName = rawName?.trim();

  if (!Number.isInteger(levelRank) || levelRank < 1) {
    await interaction.reply({ content: 'Level numbers must be 1 or higher.', ephemeral: true });
    return;
  }

  if (!Number.isInteger(pointsRequired) || pointsRequired < 1) {
    await interaction.reply({ content: 'Points must be at least 1.', ephemeral: true });
    return;
  }

  if (!levelName) {
    await interaction.reply({ content: 'Please provide a level name.', ephemeral: true });
    return;
  }

  try {
    await utils.upsertLevelDefinition(interaction.guildId, {
      levelRank,
      levelName,
      pointsRequired
    });
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      await interaction.reply({
        content: 'Another level already uses that point value. Adjust the threshold and try again.',
        ephemeral: true
      });
      return;
    }
    throw err;
  }

  await interaction.reply({
    content: `Level **${levelRank}** is now **${levelName}** at ${formatPoints(pointsRequired)} points.`,
    ephemeral: true
  });
}

async function handleLevelRemoveCommand(interaction) {
  const levelRank = interaction.options.getInteger('level');

  if (!Number.isInteger(levelRank) || levelRank < 1) {
    await interaction.reply({ content: 'Level numbers must be 1 or higher.', ephemeral: true });
    return;
  }

  const removed = await utils.removeLevelDefinition(interaction.guildId, levelRank);

  if (!removed) {
    await interaction.reply({
      content: `Level **${levelRank}** is not currently defined.`,
      ephemeral: true
    });
    return;
  }

  await interaction.reply({
    content: `Removed the custom definition for level **${levelRank}**.`,
    ephemeral: true
  });
}

async function handleLevelListCommand(interaction) {
  const levels = await utils.listLevelDefinitions(interaction.guildId);

  if (!levels.length) {
    await interaction.reply({
      content: 'No custom levels are defined. The default curve will be used.',
      ephemeral: true
    });
    return;
  }

  const lines = levels.map(level => `Level **${level.levelRank}** — ${level.levelName} (${formatPoints(level.pointsRequired)} pts)`);

  await interaction.reply({
    content: lines.join('\n'),
    ephemeral: true
  });
}

module.exports = {
  handleStatsCommand,
  handleLeaderboardCommand,
  handleSetPointsCommand,
  handleSetCooldownCommand,
  handleSetAnnouncementChannelCommand,
  handleToggleAnnouncementsCommand,
  handleToggleDmCommand,
  handleLevelSetCommand,
  handleLevelRemoveCommand,
  handleLevelListCommand
};
