const { MessageFlags } = require('discord.js');
const { loadConfig, upsertConfig } = require('../utils');
const { roleCache } = require('../../moderation/handlers/roles');

function hasAnyModRole(guildId, member) {
  const actionMap = roleCache.get(guildId);
  if (!actionMap) return false;
  for (const roleSet of actionMap.values()) {
    for (const roleId of roleSet) {
      if (member.roles.cache.has(roleId)) return true;
    }
  }
  return false;
}

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'spam') return false;

  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand();

  if (!subcommandGroup && subcommand === 'status') {
    return handleStatus(interaction);
  }

  if (subcommandGroup === 'configure') {
    return handleConfigure(interaction, subcommand);
  }

  return false;
}

async function handleStatus(interaction) {
  const isAdmin = interaction.memberPermissions?.has('ManageGuild');
  const isMod = hasAnyModRole(interaction.guildId, interaction.member);

  if (!isAdmin && !isMod) {
    await interaction.reply({ content: 'You need a moderation role to view spam detection status.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const config = await loadConfig(interaction.guildId);

  const roleList = config.whitelistRoleIds.length
    ? config.whitelistRoleIds.map(id => `<@&${id}>`).join(', ')
    : 'None';
  const channelList = config.whitelistChannelIds.length
    ? config.whitelistChannelIds.map(id => `<#${id}>`).join(', ')
    : 'None';

  const lines = [
    `**Spam Detection**`,
    `Enabled: **${config.enabled ? 'Yes' : 'No'}**`,
    `Alert Channel: ${config.alert_channel_id ? `<#${config.alert_channel_id}>` : 'Not set'}`,
    `Rate Limit: **${config.rate_limit_count}** messages per **${config.rate_limit_window_ms / 1000}s**`,
    `Action: **${config.auto_action}**`,
    `New Account Threshold: **${config.new_account_days} days**`,
    `Whitelisted Roles: ${roleList}`,
    `Whitelisted Channels: ${channelList}`,
  ];

  await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
  return true;
}

async function handleConfigure(interaction, subcommand) {
  if (!interaction.memberPermissions?.has('ManageGuild')) {
    await interaction.reply({ content: 'Configuring spam detection requires the **Manage Server** permission.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const guildId = interaction.guildId;

  if (subcommand === 'enable') {
    await upsertConfig(guildId, { enabled: 1 });
    await interaction.reply({ content: 'Spam detection **enabled**.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (subcommand === 'disable') {
    await upsertConfig(guildId, { enabled: 0 });
    await interaction.reply({ content: 'Spam detection **disabled**.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (subcommand === 'alert-channel') {
    const channel = interaction.options.getChannel('channel');
    await upsertConfig(guildId, { alert_channel_id: channel.id });
    await interaction.reply({ content: `Alert channel set to ${channel}.`, flags: MessageFlags.Ephemeral });
    return true;
  }

  if (subcommand === 'rate-limit') {
    const count = interaction.options.getInteger('count');
    const window = interaction.options.getInteger('window');
    await upsertConfig(guildId, { rate_limit_count: count, rate_limit_window_ms: window * 1000 });
    await interaction.reply({
      content: `Rate limit set to **${count}** messages per **${window}s**.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (subcommand === 'action') {
    const type = interaction.options.getString('type');
    await upsertConfig(guildId, { auto_action: type });
    await interaction.reply({ content: `Detection action set to **${type}**.`, flags: MessageFlags.Ephemeral });
    return true;
  }

  if (subcommand === 'whitelist-role') {
    const op = interaction.options.getString('operation');
    const role = interaction.options.getRole('role');
    const config = await loadConfig(guildId);

    let ids = [...config.whitelistRoleIds];
    if (op === 'add') {
      if (!ids.includes(role.id)) ids.push(role.id);
    } else {
      ids = ids.filter(id => id !== role.id);
    }

    await upsertConfig(guildId, { whitelist_role_ids: JSON.stringify(ids) });
    await interaction.reply({
      content: `Role ${role} ${op === 'add' ? 'added to' : 'removed from'} spam bypass list.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (subcommand === 'whitelist-channel') {
    const op = interaction.options.getString('operation');
    const channel = interaction.options.getChannel('channel');
    const config = await loadConfig(guildId);

    let ids = [...config.whitelistChannelIds];
    if (op === 'add') {
      if (!ids.includes(channel.id)) ids.push(channel.id);
    } else {
      ids = ids.filter(id => id !== channel.id);
    }

    await upsertConfig(guildId, { whitelist_channel_ids: JSON.stringify(ids) });
    await interaction.reply({
      content: `Channel ${channel} ${op === 'add' ? 'added to' : 'removed from'} spam exemption list.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  return false;
}

module.exports = { handleInteraction };
