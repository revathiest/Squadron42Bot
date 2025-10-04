// voiceRooms.js
// Manages dynamic voice channels that spawn from designated templates.

const {
  ChannelType,
  Events,
  MessageFlags,
  OverwriteType,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder
} = require('discord.js');
const { getPool } = require('./database');

const templateCache = new Map(); // guildId -> Set(templateChannelId)
const tempChannelCache = new Map(); // channelId -> { guildId, ownerId, template_channel_id }
let clientRef;
let initialized = false;

/* istanbul ignore next */
async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS voice_channel_templates (
      guild_id VARCHAR(20) NOT NULL,
      template_channel_id VARCHAR(20) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, template_channel_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS temporary_voice_channels (
      channel_id VARCHAR(20) NOT NULL PRIMARY KEY,
      guild_id VARCHAR(20) NOT NULL,
      owner_id VARCHAR(20) NOT NULL,
      template_channel_id VARCHAR(20) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

function addTemplateToCache(guildId, channelId) {
  let channels = templateCache.get(guildId);
  if (!channels) {
    channels = new Set();
    templateCache.set(guildId, channels);
  }
  channels.add(channelId);
}

function removeTemplateFromCache(guildId, channelId) {
  const channels = templateCache.get(guildId);
  if (!channels) {
    return;
  }
  channels.delete(channelId);
  if (channels.size === 0) {
    templateCache.delete(guildId);
  }
}

function addTemporaryChannelToCache(info) {
  tempChannelCache.set(info.channel_id, info);
}

function removeTemporaryChannelFromCache(channelId) {
  tempChannelCache.delete(channelId);
}

function isTemplateChannel(guildId, channelId) {
  const channels = templateCache.get(guildId);
  return channels ? channels.has(channelId) : false;
}

/* istanbul ignore next */
async function loadCacheFromDatabase(pool) {
  const [templates] = await pool.query('SELECT guild_id, template_channel_id FROM voice_channel_templates');
  templateCache.clear();
  for (const row of templates) {
    addTemplateToCache(row.guild_id, row.template_channel_id);
  }

  const [temporary] = await pool.query('SELECT channel_id, guild_id, owner_id, template_channel_id FROM temporary_voice_channels');
  tempChannelCache.clear();
  for (const row of temporary) {
    addTemporaryChannelToCache(row);
  }
}

function buildCommandDefinition() {
  return new SlashCommandBuilder()
    .setName('voice-rooms')
    .setDescription('Manage dynamic voice room templates for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub
        .setName('set-template')
        .setDescription('Designate a lobby voice channel that spawns personal rooms.')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('The lobby voice channel members will join to create a room.')
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('clear-template')
        .setDescription('Remove a lobby channel from the dynamic voice room list.')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Lobby channel to remove.')
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('Show the current dynamic voice lobby channels.')
    )
    .toJSON();
}

function getSlashCommandDefinitions() {
  return {
    global: [],
    guild: [buildCommandDefinition()]
  };
}

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (interaction.commandName !== 'voice-rooms') {
    return;
  }

  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: 'Only administrators can use this command.', flags: MessageFlags.Ephemeral });
    return;
  }
  const guildId = interaction.guildId;
  const pool = getPool();

  try {
    if (subcommand === 'set-template') {
      const channel = interaction.options.getChannel('channel', true);

      if (channel.type !== ChannelType.GuildVoice) {
        await interaction.reply({ content: 'Please choose a voice channel.', flags: MessageFlags.Ephemeral });
        return;
      }

      await pool.query(
        'INSERT INTO voice_channel_templates (guild_id, template_channel_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE created_at = created_at',
        [guildId, channel.id]
      );
      addTemplateToCache(guildId, channel.id);

      await interaction.reply({
        content: `Added ${channel.toString()} as a dynamic voice lobby.`,
        flags: MessageFlags.Ephemeral
      });
    } else if (subcommand === 'clear-template') {
      const channel = interaction.options.getChannel('channel', true);

      await pool.query(
        'DELETE FROM voice_channel_templates WHERE guild_id = ? AND template_channel_id = ?',
        [guildId, channel.id]
      );
      removeTemplateFromCache(guildId, channel.id);

      await interaction.reply({
        content: `Removed ${channel.toString()} from the dynamic voice lobby list.`,
        flags: MessageFlags.Ephemeral
      });
    } else if (subcommand === 'list') {
      const templates = templateCache.get(guildId);

      if (!templates || templates.size === 0) {
        await interaction.reply({ content: 'No dynamic voice lobbies are configured yet.', flags: MessageFlags.Ephemeral });
        return;
      }

      const lines = [];
      for (const channelId of templates) {
        const channel = interaction.guild.channels.cache.get(channelId);
        lines.push(channel ? `- ${channel.toString()}` : `- Channel ID ${channelId}`);
      }

      await interaction.reply({ content: `Configured lobbies:\n${lines.join('\n')}`, flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    console.error('voiceRooms: interaction handler failed', err);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: 'Something went wrong while processing that command.', flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: 'Something went wrong while processing that command.', flags: MessageFlags.Ephemeral });
    }
  }
}

function buildOwnerPermissions() {
  return new PermissionsBitField([
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.Speak,
    PermissionFlagsBits.Stream,
    PermissionFlagsBits.UseVAD,
    PermissionFlagsBits.PrioritySpeaker,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.MoveMembers,
    PermissionFlagsBits.MuteMembers,
    PermissionFlagsBits.DeafenMembers,
    PermissionFlagsBits.CreateInstantInvite
  ]);
}

/* istanbul ignore next */
async function handlePotentialSpawn(newState) {
  if (!newState.channelId || !newState.guild) {
    return;
  }

  const guildId = newState.guild.id;
  if (!isTemplateChannel(guildId, newState.channelId)) {
    return;
  }

  if (!newState.member || newState.member.user.bot) {
    return;
  }

  const templateChannel = newState.channel;
  if (!templateChannel) {
    return;
  }

  const displayName = newState.member.displayName || newState.member.user.username || 'Guest';
  const channelName = `${displayName}'s Room`.slice(0, 95);

  const ownerPermissions = buildOwnerPermissions();
  const permissionOverwrites = templateChannel.permissionOverwrites.cache.map(overwrite => ({
    id: overwrite.id,
    allow: overwrite.allow.bitfield,
    deny: overwrite.deny.bitfield,
    type: overwrite.type
  }));

  permissionOverwrites.push({
    id: newState.member.id,
    allow: ownerPermissions.bitfield,
    type: OverwriteType.Member
  });

  try {
    const newChannel = await newState.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildVoice,
      parent: templateChannel.parentId ?? undefined,
      bitrate: templateChannel.bitrate,
      userLimit: templateChannel.userLimit ?? undefined,
      rtcRegion: templateChannel.rtcRegion ?? undefined,
      videoQualityMode: templateChannel.videoQualityMode ?? undefined,
      permissionOverwrites
    });

    const pool = getPool();
    await pool.query(
      'INSERT INTO temporary_voice_channels (channel_id, guild_id, owner_id, template_channel_id) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE owner_id = VALUES(owner_id), template_channel_id = VALUES(template_channel_id)',
      [newChannel.id, guildId, newState.member.id, templateChannel.id]
    );
    addTemporaryChannelToCache({
      channel_id: newChannel.id,
      guild_id: guildId,
      owner_id: newState.member.id,
      template_channel_id: templateChannel.id
    });

    try {
      await newState.setChannel(newChannel);
    } catch (moveError) {
      console.error('voiceRooms: Failed to move member into new channel, cleaning up', moveError);
      await cleanupTemporaryChannel(newChannel, 'Failed to move member into spawned room');
    }
  } catch (err) {
    console.error('voiceRooms: Failed to create personal room', err);
  }
}

/* istanbul ignore next */
async function cleanupTemporaryChannel(channel, reason) {
  const channelId = typeof channel === 'string' ? channel : channel?.id;
  if (!channelId) {
    return;
  }

  const pool = getPool();
  removeTemporaryChannelFromCache(channelId);

  await pool.query('DELETE FROM temporary_voice_channels WHERE channel_id = ?', [channelId]);

  if (typeof channel !== 'string') {
    await channel.delete(reason).catch(err => {
      console.error('voiceRooms: Failed to delete temporary channel', err);
    });
  }
}

/* istanbul ignore next */
async function handlePotentialCleanup(oldState) {
  const channelId = oldState.channelId;
  if (!channelId) {
    return;
  }

  const record = tempChannelCache.get(channelId);
  if (!record) {
    return;
  }

  let channel = oldState.channel;
  if (!channel) {
    try {
      channel = await oldState.guild.channels.fetch(channelId);
    } catch (err) {
      channel = null;
    }
  }

  if (!channel) {
    await cleanupTemporaryChannel(channelId, 'Temporary voice room missing during cleanup');
    return;
  }

  if (channel.members.size === 0) {
    await cleanupTemporaryChannel(channel, 'Temporary voice room emptied');
  }
}

/* istanbul ignore next */
async function onVoiceStateUpdate(oldState, newState) {
  await handlePotentialSpawn(newState);
  await handlePotentialCleanup(oldState);
}

/* istanbul ignore next */
async function cleanupOrphanedChannels() {
  if (!clientRef) {
    return;
  }

  for (const [channelId, info] of tempChannelCache.entries()) {
    try {
      const guild = clientRef.guilds.cache.get(info.guild_id) || await clientRef.guilds.fetch(info.guild_id);
      const channel = await guild.channels.fetch(channelId);
      if (!channel || channel.members.size === 0) {
        await cleanupTemporaryChannel(channel || channelId, 'Startup cleanup of temporary voice room');
      }
    } catch (err) {
      console.warn(`voiceRooms: Unable to verify channel ${channelId}, removing record.`, err);
      await cleanupTemporaryChannel(channelId, 'Cleanup after missing channel');
    }
  }
}

/* istanbul ignore next */
async function initialize(client) {
  if (initialized) {
    return;
  }

  clientRef = client;
  const pool = getPool();
  await ensureSchema(pool);
  await loadCacheFromDatabase(pool);

  client.on(Events.InteractionCreate, handleInteraction);
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    onVoiceStateUpdate(oldState, newState).catch(err => {
      console.error('voiceRooms: voice state handler failed', err);
    });
  });

  initialized = true;
}

/* istanbul ignore next */
async function onReady(client) {
  if (!initialized) {
    await initialize(client);
  }

  await cleanupOrphanedChannels();
}

module.exports = {
  getSlashCommandDefinitions,
  initialize,
  onReady,
  __testables: {
    handleInteraction,
    addTemplateToCache,
    removeTemplateFromCache,
    addTemporaryChannelToCache,
    removeTemporaryChannelFromCache,
    isTemplateChannel,
    onVoiceStateUpdate,
    templateCache,
    tempChannelCache
  }
};
