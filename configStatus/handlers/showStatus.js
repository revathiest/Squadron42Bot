const { EmbedBuilder, MessageFlags } = require('discord.js');
const { getPool } = require('../../database');

async function showConfigStatus(interaction) {
  const pool = getPool();
  const guildId = interaction.guild.id;

  if (!interaction.deferred && !interaction.replied) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch (err) {
      console.error('[config-status] Failed to defer interaction reply:', err);
      return false;
    }
  }

  const embed = new EmbedBuilder()
    .setTitle('Bot Configuration Overview')
    .setColor(0x00ae86)
    .setTimestamp();

  const sections = [];

  try {
    const [
      [ticketConfig],
      [ticketRoles],
      [modRows],
      [orgPromoRows],
      [storedCodes],
      [providedCodes],
      [autoBanRows],
      [spectrumRows],
      [tempChannels],
      [embedAccessRows],
      [pollRoleRows],
      [engagementConfigRows],
      [engagementLevelRows]
    ] = await Promise.all([
      pool.query(
        'SELECT channel_id, archive_category_id FROM ticket_settings WHERE guild_id = ?',
        [guildId]
      ),
      pool.query(
        'SELECT role_id FROM ticket_roles WHERE guild_id = ?',
        [guildId]
      ),
      pool.query(
        'SELECT role_id, action FROM moderation_roles WHERE guild_id = ?',
        [guildId]
      ),
      pool.query(
        'SELECT channel_id FROM moderation_org_forum_channels WHERE guild_id = ?',
        [guildId]
      ),
      pool.query('SELECT COUNT(*) AS count FROM referral_codes'),
      pool.query('SELECT COUNT(*) AS count FROM provided_codes'),
      pool.query(
        'SELECT trap_role_id FROM moderation_config WHERE guild_id = ?',
        [guildId]
      ),
      pool.query(
        'SELECT announce_channel_id, forum_id FROM spectrum_config WHERE guild_id = ?',
        [guildId]
      ),
      pool.query(
        'SELECT template_channel_id FROM voice_channel_templates WHERE guild_id = ?',
        [guildId]
      ),
      pool.query(
        'SELECT role_id FROM embed_allowed_roles WHERE guild_id = ?',
        [guildId]
      ),
      pool.query(
        'SELECT role_id FROM poll_allowed_roles WHERE guild_id = ?',
        [guildId]
      ),
      pool.query(
        `SELECT reaction_points, reply_points, cooldown_seconds, announce_channel_id, announce_enabled, dm_enabled
         FROM engagement_config
         WHERE guild_id = ?
         LIMIT 1`,
        [guildId]
      ),
      pool.query(
        `SELECT level_rank, level_name, points_required
         FROM engagement_levels
         WHERE guild_id = ?
         ORDER BY points_required ASC`,
        [guildId]
      )
    ]);

    if (ticketConfig.length) {
      const config = ticketConfig[0];
      const archiveMention = config.archive_category_id ? `<#${config.archive_category_id}>` : 'Not set';
      const roleMentions = ticketRoles.length
        ? ticketRoles.map(row => `<@&${row.role_id}>`).join(', ')
        : 'No ticket roles configured.';

      sections.push({
        name: 'Tickets',
        value: `Registered Channel: <#${config.channel_id}>\n` +
          `Archive Category: ${archiveMention}\n` +
          `Authorized Roles: ${roleMentions}`
      });
    } else {
      sections.push({
        name: 'Tickets',
        value: 'No configuration found.'
      });
    }

    const moderationValue = modRows.length
      ? Object.entries(
        modRows.reduce((acc, row) => {
          if (!acc[row.action]) {
            acc[row.action] = [];
          }
          acc[row.action].push(`<@&${row.role_id}>`);
          return acc;
        }, {})
      )
        .map(([action, roles]) => {
          const label = action.charAt(0).toUpperCase() + action.slice(1);
          return `**${label}:** ${roles.join(', ')}`;
        })
        .join('\n')
      : 'No roles configured.';

    sections.push({
      name: 'Moderation Roles',
      value: moderationValue
    });

    const orgForumValue = orgPromoRows.length
      ? orgPromoRows.map(row => `<#${row.channel_id}>`).join('\n')
      : 'No promotion forums configured. Use `/mod org-promos add` to register a forum.';

    sections.push({
      name: 'Org Promotion Forums',
      value: orgForumValue
    });

    const registered = storedCodes[0]?.count ?? 0;
    const provided = providedCodes[0]?.count ?? 0;
    const available = Math.max(registered - provided, 0);

    sections.push({
      name: 'Referral Codes',
      value: `Registered: ${registered}\nProvided: ${provided}\nAvailable: ${available}`
    });

    const trapRoleId = autoBanRows[0]?.trap_role_id;

    sections.push({
      name: 'Honey Trap',
      value: trapRoleId ? `Ban on assign: <@&${trapRoleId}>` : 'No trap role configured.'
    });

    const spectrumValue = spectrumRows.length
      ? `Channel: ${spectrumRows[0].announce_channel_id ? `<#${spectrumRows[0].announce_channel_id}>` : 'Not set'}\n` +
        `Forum ID: ${spectrumRows[0].forum_id || 'Not set'}`
      : 'No Spectrum configuration found.';

    sections.push({
      name: 'Spectrum Patch Bot',
      value: spectrumValue
    });

    sections.push({
      name: 'Temp Channels',
      value: tempChannels.length
        ? tempChannels.map(row => `- <#${row.template_channel_id}>`).join('\n')
        : 'No temporary channel templates configured.'
    });

    const embedAccessValue = embedAccessRows.length
      ? embedAccessRows.map(row => `<@&${row.role_id}>`).join('\n')
      : 'No roles allowed to upload embed templates. Use `/embed access add` to authorize one.';

    sections.push({
      name: 'Embed Template Access',
      value: embedAccessValue
    });

    const pollRolesValue = pollRoleRows.length
      ? pollRoleRows.map(row => `<@&${row.role_id}>`).join('\n')
      : 'No poll creator roles configured. Members with Manage Server may create polls.';

    sections.push({
      name: 'Poll Creator Roles',
      value: pollRolesValue
    });

    const engagementConfig = engagementConfigRows?.[0] ?? null;
    const reactionPoints = Number(engagementConfig?.reaction_points ?? 1);
    const replyPoints = Number(engagementConfig?.reply_points ?? 5);
    const cooldownSeconds = Number(engagementConfig?.cooldown_seconds ?? 60);
    const announceChannelMention = engagementConfig?.announce_channel_id ? `<#${engagementConfig.announce_channel_id}>` : 'Not set';
    const announceState = engagementConfig ? (engagementConfig.announce_enabled ? 'enabled' : 'disabled') : 'disabled (default)';
    const dmState = engagementConfig ? (engagementConfig.dm_enabled ? 'enabled' : 'disabled') : 'disabled (default)';

    const customLevels = Array.isArray(engagementLevelRows) ? engagementLevelRows : [];
    let levelSummary;
    if (customLevels.length) {
      const preview = customLevels
        .slice(0, 3)
        .map(level => `L${level.level_rank}: ${level.level_name} (${level.points_required} pts)`)
        .join('\n');
      const remainder = customLevels.length > 3
        ? `\n… plus ${customLevels.length - 3} more.`
        : '';
      levelSummary = `${preview}${remainder}`;
    } else {
      levelSummary = 'No custom levels defined.';
    }

    const engagementLines = [];
    if (!engagementConfig) {
      engagementLines.push('No custom configuration found. Defaults in use.');
    }
    engagementLines.push(`Reaction Points: **${reactionPoints}**`);
    engagementLines.push(`Reply Points: **${replyPoints}**`);
    engagementLines.push(`Cooldown: **${cooldownSeconds}s**`);
    engagementLines.push(`Announcements: ${announceChannelMention} (${announceState})`);
    engagementLines.push(`DM Notifications: ${dmState}`);
    engagementLines.push(`Custom Levels (${customLevels.length}): ${levelSummary}`);

    sections.push({
      name: 'Engagement',
      value: engagementLines.join('\n')
    });
  } catch (err) {
    console.error('[config-status] Failed to compile configuration:', err);
    sections.push({
      name: 'Error',
      value: 'Failed to load one or more configurations. Check logs.'
    });
  }

  sections.forEach((section, index) => {
    const value = index < sections.length - 1
      ? `${section.value}\n────────────────────`
      : section.value;

    embed.addFields({
      name: section.name,
      value,
      inline: false
    });
  });

  await interaction.editReply({ embeds: [embed] });
  return true;
}

module.exports = {
  showConfigStatus
};
