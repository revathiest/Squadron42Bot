// configStatus.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getPool } = require('./database');
const db = getPool();

async function initialize() {
  // no setup needed right now
}

async function onReady() {
  // no special startup tasks
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
  if (!interaction.isChatInputCommand()) {
    console.log('No Interaction');
    return;
  }
  if (interaction.commandName !== 'config-status') {
    console.log('Not the config-status command');
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const embed = new EmbedBuilder()
    .setTitle('📋 Bot Configuration Overview')
    .setColor(0x00AE86)
    .setTimestamp();

  try {
    // 🎫 Tickets
    const [ticketConfig] = await db.query(
      'SELECT channel_id, archive_category_id FROM ticket_settings WHERE guild_id = ?',
      [interaction.guild.id]
    );

    const [ticketRoles] = await db.query(
      'SELECT role_id FROM ticket_roles WHERE guild_id = ?',
      [interaction.guild.id]
    );

    let ticketSection;
    if (!ticketConfig.length) {
      ticketSection = 'No configuration found.';
    } else {
      const config = ticketConfig[0];
      const roleMentions = ticketRoles.length
        ? ticketRoles.map(r => `<@&${r.role_id}>`).join(', ')
        : 'No ticket roles configured.';

      ticketSection =
        `Registered Channel: <#${config.channel_id}>\n` +
        `Archive Category: <#${config.archive_category_id}>\n` +
        `Authorized Roles: ${roleMentions}`;
    }

    embed.addFields({ name: '🎫 Tickets', value: ticketSection, inline: false });

    // 🛡️ Moderation
    const [modRoles] = await db.query(
      'SELECT role_id FROM moderation_roles WHERE guild_id = ?',
      [interaction.guild.id]
    );
    embed.addFields({
      name: '🛡️ Moderation Roles',
      value: modRoles.length
        ? modRoles.map(r => `<@&${r.role_id}>`).join(', ')
        : 'No roles configured.',
      inline: false
    });

    // 🎟️ Referrals
    const [referralCount] = await db.query(
      'SELECT COUNT(*) AS count FROM referral_codes'
    );
    embed.addFields({
      name: '🎟️ Referral Codes',
      value: `${referralCount[0].count} codes registered`,
      inline: false
    });

  } catch (err) {
    console.error('[config-status] Failed to compile configuration:', err);
    embed.addFields({
      name: '⚠️ Error',
      value: 'Failed to load one or more configurations. Check logs.',
      inline: false
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleConfigStatus(interaction) {
  if (!interaction.isChatInputCommand()) {
    console.log('No Interaction');
    return;
  }
  if (interaction.commandName !== 'config-status') {
    console.log('Not the config-status command');
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const embed = new EmbedBuilder()
    .setTitle('📋 Bot Configuration Overview')
    .setColor(0x00AE86)
    .setTimestamp();

  try {
    // 🎫 Tickets
    const [ticketConfig] = await db.query(
      'SELECT channel_id, archive_category_id FROM ticket_settings WHERE guild_id = ?',
      [interaction.guild.id]
    );
    const [ticketRoles] = await db.query(
      'SELECT role_id FROM ticket_roles WHERE guild_id = ?',
      [interaction.guild.id]
    );

    let ticketSection;
    if (!ticketConfig.length) {
      ticketSection = 'No configuration found.';
    } else {
      const config = ticketConfig[0];
      const roleMentions = ticketRoles.length
        ? ticketRoles.map(r => `<@&${r.role_id}>`).join(', ')
        : 'No ticket roles configured.';

      ticketSection =
        `Registered Channel: <#${config.channel_id}>\n` +
        `Archive Category: <#${config.archive_category_id}>\n` +
        `Authorized Roles: ${roleMentions}`;
    }

    embed.addFields({ name: '🎫 Tickets', value: ticketSection, inline: false });

    // 🛡️ Moderation Roles
    const [modData] = await db.query(
      'SELECT role_id, action FROM moderation_roles WHERE guild_id = ?',
      [interaction.guild.id]
    );

    let modSection;
    if (!modData.length) {
      modSection = 'No roles configured.';
    } else {
      // Group by action
      const grouped = modData.reduce((acc, row) => {
        if (!acc[row.action]) acc[row.action] = [];
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
      name: '🛡️ Moderation Roles',
      value: modSection,
      inline: false
    });

    // 🎟️ Referrals
    const [storeCodes] = await db.query(
      'SELECT COUNT(*) AS count FROM referral_codes'
    );
    
    const [providedCodes] = await db.query(
      'SELECT COUNT(*) AS count FROM provided_codes'
    );

    const remainingCodes = storeCodes[0].count - providedCodes[0].count;

    embed.addFields({
      name: '🎟️ Referral Codes',
      value: `${storeCodes[0].count} codes registered\n` +
      `${providedCodes[0].count} codes provided\n` +
      `${remainingCodes} codes available`,
      inline: false
    });

    //Honey Trap
      const [autoBanRoles] = await db.query(
      'SELECT role_id FROM auto_ban_roles where guild_id = ?',
      [interaction.guild.id]
    );

    embed.addFields({
        name: 'Honey Trap',
        value: `Ban on assign: ${autoBanRoles[0]}`,
        inline: false
    })

  } catch (err) {
    console.error('[config-status] Failed to compile configuration:', err);
    embed.addFields({
      name: '⚠️ Error',
      value: 'Failed to load one or more configurations. Check logs.',
      inline: false
    });

  }

  await interaction.editReply({ embeds: [embed] });
}


module.exports = {
  initialize,
  onReady,
  getSlashCommandDefinitions,
  handleConfigStatus
};
