// configstatus.js
// Provides the /config-status command for a consolidated configuration overview.

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getPool } = require('./database');

const db = getPool();

async function initialize() {
  // no-op placeholder for interface parity
}

async function onReady() {
  // no startup work required today
}

function getSlashCommandDefinitions() {
  return {
    guild: [
      new SlashCommandBuilder()
        .setName('config-status')
        .setDescription('Show all active system configurations.')
        .setDMPermission(false)
        .toJSON()
    ],
    global: []
  };
}

async function handleConfigStatus(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const embed = new EmbedBuilder()
    .setTitle('Bot Configuration Overview')
    .setColor(0x00AE86)
    .setTimestamp();

  const guildId = interaction.guild.id;

  try {
    const [ticketConfig] = await db.query(
      'SELECT channel_id, archive_category_id FROM ticket_settings WHERE guild_id = ?',
      [guildId]
    );
    const [ticketRoles] = await db.query(
      'SELECT role_id FROM ticket_roles WHERE guild_id = ?',
      [guildId]
    );

    let ticketSection;
    if (!ticketConfig.length) {
      ticketSection = 'No configuration found.';
    } else {
      const config = ticketConfig[0];
      const archiveMention = config.archive_category_id ? `<#${config.archive_category_id}>` : 'Not set';
      const roleMentions = ticketRoles.length
        ? ticketRoles.map(r => `<@&${r.role_id}>`).join(', ')
        : 'No ticket roles configured.';

      ticketSection =
        `Registered Channel: <#${config.channel_id}>\n` +
        `Archive Category: ${archiveMention}\n` +
        `Authorized Roles: ${roleMentions}`;
    }

    embed.addFields({ name: 'Tickets', value: ticketSection, inline: false });

    const [modData] = await db.query(
      'SELECT role_id, action FROM moderation_roles WHERE guild_id = ?',
      [guildId]
    );

    let modSection;
    if (!modData.length) {
      modSection = 'No roles configured.';
    } else {
      const grouped = modData.reduce((acc, row) => {
        if (!acc[row.action]) {
          acc[row.action] = [];
        }
        acc[row.action].push(`<@&${row.role_id}>`);
        return acc;
      }, {});

      modSection = Object.entries(grouped)
        .map(([action, roles]) => {
          const label = action.charAt(0).toUpperCase() + action.slice(1);
          return `**${label}:** ${roles.join(', ')}`;
        })
        .join('\n');
    }

    embed.addFields({
      name: 'Moderation Roles',
      value: modSection,
      inline: false
    });

    const [storeCodes] = await db.query('SELECT COUNT(*) AS count FROM referral_codes');
    const [providedCodes] = await db.query('SELECT COUNT(*) AS count FROM provided_codes');
    const remainingCodes = Math.max((storeCodes[0]?.count || 0) - (providedCodes[0]?.count || 0), 0);

    embed.addFields({
      name: 'Referral Codes',
      value:
        `${storeCodes[0]?.count || 0} codes registered\n` +
        `${providedCodes[0]?.count || 0} codes provided\n` +
        `${remainingCodes} codes available`,
      inline: false
    });

    const [autoBanRoles] = await db.query(
      'SELECT trap_role_id FROM moderation_config WHERE guild_id = ?',
      [guildId]
    );
    const trapRoleId = autoBanRoles[0]?.trap_role_id;

    embed.addFields({
      name: 'Honey Trap',
      value: trapRoleId ? `Ban on assign: <@&${trapRoleId}>` : 'No trap role configured.',
      inline: false
    });

    const [spectrumConfig] = await db.query(
      'SELECT announce_channel_id, forum_id FROM spectrum_config WHERE guild_id = ?',
      [guildId]
    );

    let spectrumValue;
    if (!spectrumConfig.length) {
      spectrumValue = 'No Spectrum configuration found.';
    } else {
      const config = spectrumConfig[0];
      const channelMention = config.announce_channel_id ? `<#${config.announce_channel_id}>` : 'Not set';
      const forumId = config.forum_id || 'Not set';
      spectrumValue =
        `Channel: ${channelMention}\n` +
        `Forum ID: ${forumId}`;
    }

    embed.addFields({
      name: 'Spectrum Patch Bot',
      value: spectrumValue,
      inline: false
    });

    const [tempChannels] = await db.query(
      'SELECT template_channel_id FROM voice_channel_templates WHERE guild_id = ?',
      [guildId]
    );

    const tempValue = tempChannels.length
      ? tempChannels.map(ch => `• <#${ch.template_channel_id}>`).join('\n')
      : 'No temporary channel templates configured.';

    embed.addFields({
      name: 'Temp Channels',
      value: tempValue,
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

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) {
    return false;
  }

  if (interaction.commandName !== 'config-status') {
    return false;
  }

  await handleConfigStatus(interaction);
  return true;
}

module.exports = {
  initialize,
  onReady,
  getSlashCommandDefinitions,
  handleConfigStatus,
  handleInteraction
};
