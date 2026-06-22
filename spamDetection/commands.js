const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

function getSlashCommandDefinitions() {
  const spam = new SlashCommandBuilder()
    .setName('spam')
    .setDescription('Spam bot detection settings')
    .setDefaultMemberPermissions(null)
    .addSubcommand(sub => sub
      .setName('status')
      .setDescription('Show current spam detection configuration')
    )
    .addSubcommandGroup(group => group
      .setName('configure')
      .setDescription('Configure spam detection')
      .addSubcommand(sub => sub
        .setName('enable')
        .setDescription('Enable automatic spam bot detection')
      )
      .addSubcommand(sub => sub
        .setName('disable')
        .setDescription('Disable automatic spam bot detection')
      )
      .addSubcommand(sub => sub
        .setName('alert-channel')
        .setDescription('Set the channel for spam detection alerts')
        .addChannelOption(opt => opt
          .setName('channel')
          .setDescription('Text channel to receive detection alerts')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
        )
      )
      .addSubcommand(sub => sub
        .setName('rate-limit')
        .setDescription('Set the message burst threshold that triggers detection')
        .addIntegerOption(opt => opt
          .setName('count')
          .setDescription('Max messages allowed in the window before triggering')
          .setRequired(true)
          .setMinValue(2)
          .setMaxValue(50)
        )
        .addIntegerOption(opt => opt
          .setName('window')
          .setDescription('Window size in seconds')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(60)
        )
      )
      .addSubcommand(sub => sub
        .setName('action')
        .setDescription('Set what happens when a spam bot is detected')
        .addStringOption(opt => opt
          .setName('type')
          .setDescription('Action to take')
          .setRequired(true)
          .addChoices(
            { name: 'Timeout (1 hour)', value: 'timeout' },
            { name: 'Ban', value: 'ban' }
          )
        )
      )
      .addSubcommand(sub => sub
        .setName('whitelist-role')
        .setDescription('Add or remove a role from the spam detection bypass list')
        .addStringOption(opt => opt
          .setName('operation')
          .setDescription('Add or remove')
          .setRequired(true)
          .addChoices(
            { name: 'Add', value: 'add' },
            { name: 'Remove', value: 'remove' }
          )
        )
        .addRoleOption(opt => opt
          .setName('role')
          .setDescription('Role to whitelist')
          .setRequired(true)
        )
      )
      .addSubcommand(sub => sub
        .setName('whitelist-channel')
        .setDescription('Exempt a channel from spam detection')
        .addStringOption(opt => opt
          .setName('operation')
          .setDescription('Add or remove')
          .setRequired(true)
          .addChoices(
            { name: 'Add', value: 'add' },
            { name: 'Remove', value: 'remove' }
          )
        )
        .addChannelOption(opt => opt
          .setName('channel')
          .setDescription('Channel to exempt')
          .setRequired(true)
        )
      )
    );

  return { global: [], guild: [spam] };
}

module.exports = { getSlashCommandDefinitions };
