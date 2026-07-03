const { SlashCommandBuilder, ChannelType } = require('discord.js');

function getSlashCommandDefinitions() {
  return {
    global: [],
    guild: [
      new SlashCommandBuilder()
        .setName('sq42news')
        .setDescription('Squadron 42 news watcher settings')
        .addSubcommand(sub =>
          sub
            .setName('set-channel')
            .setDescription('Set the channel where SQ42 news posts will appear')
            .addChannelOption(opt =>
              opt
                .setName('channel')
                .setDescription('Text channel to post news to')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('status')
            .setDescription('Show current SQ42 news watcher configuration')
        )
        .addSubcommand(sub =>
          sub
            .setName('clear')
            .setDescription('Remove SQ42 news watcher configuration for this server')
        )
        .addSubcommand(sub =>
          sub
            .setName('poll-now')
            .setDescription('Immediately poll all SQ42 news sources and post anything new')
        )
        .addSubcommand(sub =>
          sub
            .setName('preview')
            .setDescription('Post one sample from each source so you can see what the embeds look like')
        )
        .toJSON()
    ]
  };
}

module.exports = { getSlashCommandDefinitions };
