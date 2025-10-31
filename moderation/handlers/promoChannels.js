const { ChannelType, MessageFlags } = require('discord.js');
const { respondEphemeral } = require('../utils');
const {
  allowOrgForumChannel,
  disallowOrgForumChannel,
  listOrgForumChannels
} = require('./orgLinks');

async function handleOrgPromoAdd(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  if (!channel || channel.type !== ChannelType.GuildForum) {
    return respondEphemeral(interaction, 'Please choose a forum-style channel for organization promotions.');
  }

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch {
    return;
  }

  try {
    await allowOrgForumChannel(interaction.guildId, channel.id, interaction.user.id);
    await interaction.editReply(`Organization promotions are now allowed in ${channel}.`);
  } catch (err) {
    console.error('moderation: failed to add organization promotion forum', {
      guildId: interaction.guildId,
      channelId: channel.id
    }, err);
    await interaction.editReply('Failed to add that forum channel. Please try again later.');
  }
}

async function handleOrgPromoRemove(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  if (!channel || channel.type !== ChannelType.GuildForum) {
    return respondEphemeral(interaction, 'Please choose a forum-style channel to remove.');
  }

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch {
    return;
  }

  try {
    const removed = await disallowOrgForumChannel(interaction.guildId, channel.id);
    if (removed) {
      await interaction.editReply(`Removed ${channel} from organization promotion forums.`);
    } else {
      await interaction.editReply(`${channel} was not configured for organization promotions.`);
    }
  } catch (err) {
    console.error('moderation: failed to remove organization promotion forum', {
      guildId: interaction.guildId,
      channelId: channel.id
    }, err);
    await interaction.editReply('Failed to remove that forum channel. Please try again later.');
  }
}

async function handleOrgPromoList(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch {
    return;
  }

  try {
    const channels = await listOrgForumChannels(interaction.guildId);
    if (!channels.length) {
      await interaction.editReply('No forum channels have been configured for organization promotions yet.');
      return;
    }

    const mentions = channels.map(id => `<#${id}>`).join('\n');
    await interaction.editReply(`Organization promotions are allowed in:\n${mentions}`);
  } catch (err) {
    console.error('moderation: failed to list organization promotion forums', {
      guildId: interaction.guildId
    }, err);
    await interaction.editReply('Failed to list organization promotion forums. Please try again later.');
  }
}

async function handleOrgPromoCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'add') {
    return handleOrgPromoAdd(interaction);
  }

  if (subcommand === 'remove') {
    return handleOrgPromoRemove(interaction);
  }

  if (subcommand === 'list') {
    return handleOrgPromoList(interaction);
  }

  return respondEphemeral(interaction, 'Unsupported organization promotion command.');
}

module.exports = {
  handleOrgPromoCommand,
  handleOrgPromoAdd,
  handleOrgPromoRemove,
  handleOrgPromoList
};
