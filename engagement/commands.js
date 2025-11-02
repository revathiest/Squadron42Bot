const { SlashCommandBuilder } = require('discord.js');

function getSlashCommandDefinitions() {
  const builder = new SlashCommandBuilder()
    .setName('engagement')
    .setDescription('View and configure engagement XP.')
    .addSubcommand(sub =>
      sub
        .setName('stats')
        .setDescription('Show engagement stats for yourself or another member.')
        .addUserOption(opt =>
          opt
            .setName('user')
            .setDescription('Member to inspect (defaults to yourself).')
            .setRequired(false)))
    .addSubcommand(sub =>
      sub
        .setName('leaderboard')
        .setDescription('Show the top members by engagement points.')
        .addIntegerOption(opt =>
          opt
            .setName('size')
            .setDescription('How many entries to show (default 10, max 25).')
            .setRequired(false)))
    .addSubcommandGroup(group =>
      group
        .setName('configure')
        .setDescription('Admin tools for engagement scoring.')
        .addSubcommand(sub =>
          sub
            .setName('set-points')
            .setDescription('Configure how many points reactions and replies award.')
            .addIntegerOption(opt =>
              opt
                .setName('reaction')
                .setDescription('Points granted for a distinct reaction.')
                .setRequired(true))
            .addIntegerOption(opt =>
              opt
                .setName('reply')
                .setDescription('Points granted per reply.')
                .setRequired(true)))
        .addSubcommand(sub =>
          sub
            .setName('set-cooldown')
            .setDescription('Set the cooldown before a user can reward the same poster again.')
            .addIntegerOption(opt =>
              opt
                .setName('seconds')
                .setDescription('Cooldown in seconds (minimum 5).')
                .setRequired(true)))
        .addSubcommand(sub =>
          sub
            .setName('set-announcement-channel')
            .setDescription('Choose where level-up announcements should be posted.')
            .addChannelOption(opt =>
              opt
                .setName('channel')
                .setDescription('Channel for level-up announcements.')
                .setRequired(true)))
        .addSubcommand(sub =>
          sub
            .setName('toggle-announcements')
            .setDescription('Enable or disable level-up announcements in the configured channel.')
            .addBooleanOption(opt =>
              opt
                .setName('enabled')
                .setDescription('Whether channel announcements are enabled.')
                .setRequired(true)))
        .addSubcommand(sub =>
          sub
            .setName('toggle-dm')
            .setDescription('Enable or disable DM notifications for level-ups.')
            .addBooleanOption(opt =>
              opt
                .setName('enabled')
                .setDescription('Whether direct messages are sent on level-up.')
                .setRequired(true)))
        .addSubcommand(sub =>
          sub
            .setName('level-set')
            .setDescription('Define or update a custom level threshold.')
            .addIntegerOption(opt =>
              opt
                .setName('level')
                .setDescription('Level number to define (minimum 1).')
                .setRequired(true))
            .addIntegerOption(opt =>
              opt
                .setName('points')
                .setDescription('Points required to reach this level.')
                .setRequired(true))
            .addStringOption(opt =>
              opt
                .setName('name')
                .setDescription('Display name for this level.')
                .setRequired(true)))
        .addSubcommand(sub =>
          sub
            .setName('level-remove')
            .setDescription('Remove a custom level definition.')
            .addIntegerOption(opt =>
              opt
                .setName('level')
                .setDescription('Level number to remove.')
                .setRequired(true)))
        .addSubcommand(sub =>
          sub
            .setName('level-list')
            .setDescription('Show configured levels and thresholds.')));

  return {
    global: [],
    guild: [builder]
  };
}

module.exports = {
  getSlashCommandDefinitions
};
