const { EmbedBuilder } = require('discord.js');
const { getPool } = require('../../database');

async function showConfigStatus(interaction) {
  const pool = getPool();
  const guildId = interaction.guild.id;

  await interaction.deferReply({ ephemeral: true });

  const embed = new EmbedBuilder()
    .setTitle('Bot Configuration Overview')
    .setColor(0x00ae86)
    .setTimestamp();

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
      [tempChannels]
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
      )
    ]);

    if (ticketConfig.length) {
      const config = ticketConfig[0];
      const archiveMention = config.archive_category_id ? `<#${config.archive_category_id}>` : 'Not set';
      const roleMentions = ticketRoles.length
        ? ticketRoles.map(row => `<@&${row.role_id}>`).join(', ')
        : 'No ticket roles configured.';

      embed.addFields({
        name: 'Tickets',
        value: `Registered Channel: <#${config.channel_id}>\n` +
          `Archive Category: ${archiveMention}\n` +
          `Authorized Roles: ${roleMentions}`,
        inline: false
      });
    } else {
      embed.addFields({
        name: 'Tickets',
        value: 'No configuration found.',
        inline: false
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

    embed.addFields({
      name: 'Moderation Roles',
      value: moderationValue,
      inline: false
    });

    const orgForumValue = orgPromoRows.length
      ? orgPromoRows.map(row => `<#${row.channel_id}>`).join('\n')
      : 'No promotion forums configured. Use `/mod org-promos add` to register a forum.';

    embed.addFields({
      name: 'Org Promotion Forums',
      value: orgForumValue,
      inline: false
    });

    const registered = storedCodes[0]?.count ?? 0;
    const provided = providedCodes[0]?.count ?? 0;
    const available = Math.max(registered - provided, 0);

    embed.addFields({
      name: 'Referral Codes',
      value: `Registered: ${registered}\nProvided: ${provided}\nAvailable: ${available}`,
      inline: false
    });

    const trapRoleId = autoBanRows[0]?.trap_role_id;

    embed.addFields({
      name: 'Honey Trap',
      value: trapRoleId ? `Ban on assign: <@&${trapRoleId}>` : 'No trap role configured.',
      inline: false
    });

    const spectrumValue = spectrumRows.length
      ? `Channel: ${spectrumRows[0].announce_channel_id ? `<#${spectrumRows[0].announce_channel_id}>` : 'Not set'}\n` +
        `Forum ID: ${spectrumRows[0].forum_id || 'Not set'}`
      : 'No Spectrum configuration found.';

    embed.addFields({
      name: 'Spectrum Patch Bot',
      value: spectrumValue,
      inline: false
    });

    embed.addFields({
      name: 'Temp Channels',
      value: tempChannels.length
        ? tempChannels.map(row => `- <#${row.template_channel_id}>`).join('\n')
        : 'No temporary channel templates configured.',
      inline: false
    });
  } catch (err) {
    console.error('[config-status] Failed to compile configuration:', err);
    embed.addFields({
      name: 'Error',
      value: 'Failed to load one or more configurations. Check logs.',
      inline: false
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

module.exports = {
  showConfigStatus
};
