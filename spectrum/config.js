// spectrum/config.js
// Provides slash commands and persistence helpers for configuring the Spectrum Watcher.

const {
  ChannelType,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');
const { getPool } = require('../database');

const configCache = new Map(); // guildId -> { guildId, announceChannelId, forumId, updatedBy, updatedAt }

let initialized = false;

async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS spectrum_config (
      guild_id VARCHAR(20) NOT NULL PRIMARY KEY,
      announce_channel_id VARCHAR(20) NULL,
      forum_id VARCHAR(32) NULL,
      updated_by VARCHAR(20) NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    ALTER TABLE spectrum_config
      MODIFY guild_id VARCHAR(20) NOT NULL,
      MODIFY announce_channel_id VARCHAR(20) NULL,
      MODIFY updated_by VARCHAR(20) NULL
  `).catch(() => {});
}

async function loadCache(pool) {
  const [rows] = await pool.query(`
    SELECT guild_id, announce_channel_id, forum_id, updated_by, updated_at
    FROM spectrum_config
  `);

  configCache.clear();
  for (const row of rows) {
    configCache.set(String(row.guild_id), {
      guildId: String(row.guild_id),
      announceChannelId: row.announce_channel_id ? String(row.announce_channel_id) : null,
      forumId: row.forum_id ? String(row.forum_id) : null,
      updatedBy: row.updated_by ? String(row.updated_by) : null,
      updatedAt: row.updated_at ? new Date(row.updated_at) : null
    });
  }
}

function buildCommandDefinition() {
  return new SlashCommandBuilder()
    .setName('spectrum')
    .setDescription('Configure Spectrum Watcher announcements for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub
        .setName('set-channel')
        .setDescription('Select the channel where new Spectrum threads will be announced.')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Announcement channel')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement
            )
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('set-forum')
        .setDescription('Configure which RSI Spectrum forum to watch.')
        .addStringOption(option =>
          option
            .setName('forum_id')
            .setDescription('Forum ID from Spectrum (e.g. 123456)')
            .setMinLength(1)
            .setMaxLength(32)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Show the current Spectrum Watcher configuration.')
    )
    .addSubcommand(sub =>
      sub
        .setName('clear')
        .setDescription('Remove Spectrum Watcher configuration for this server.')
    )
    .addSubcommand(sub =>
      sub
        .setName('post-latest')
        .setDescription('Immediately post the latest Spectrum thread to the configured channel.')
    )
    .toJSON();
}

function getSlashCommandDefinitions() {
  return {
    global: [],
    guild: [buildCommandDefinition()]
  };
}

function mapRowToConfig(row) {
  if (!row) {
    return null;
  }

  return {
    guildId: String(row.guild_id),
    announceChannelId: row.announce_channel_id ? String(row.announce_channel_id) : null,
    forumId: row.forum_id ? String(row.forum_id) : null,
    updatedBy: row.updated_by ? String(row.updated_by) : null,
    updatedAt: row.updated_at ? new Date(row.updated_at) : null
  };
}

async function fetchConfig(guildId) {
  const key = String(guildId);
  const cached = configCache.get(key);
  if (cached) {
    return cached;
  }

  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT guild_id, announce_channel_id, forum_id, updated_by, updated_at FROM spectrum_config WHERE guild_id = ?',
    [key]
  );

  if (!rows.length) {
    return null;
  }

  const config = mapRowToConfig(rows[0]);
  if (config) {
    configCache.set(key, config);
  }
  return config;
}

async function setConfig(guildId, channelId, forumId, updatedBy) {
  const key = String(guildId);
  const current = configCache.get(key) || null;

  const nextChannelId = channelId === undefined
    ? current?.announceChannelId ?? null
    : (channelId ? String(channelId) : null);

  const nextForumId = forumId === undefined
    ? current?.forumId ?? null
    : (forumId ? String(forumId) : null);

  const pool = getPool();
  await pool.query(
    `
      INSERT INTO spectrum_config (guild_id, announce_channel_id, forum_id, updated_by)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        announce_channel_id = VALUES(announce_channel_id),
        forum_id = VALUES(forum_id),
        updated_by = VALUES(updated_by),
        updated_at = CURRENT_TIMESTAMP
    `,
    [key, nextChannelId, nextForumId, updatedBy ? String(updatedBy) : null]
  );

  const updatedConfig = {
    guildId: key,
    announceChannelId: nextChannelId,
    forumId: nextForumId,
    updatedBy: updatedBy ? String(updatedBy) : null,
    updatedAt: new Date()
  };

  configCache.set(key, updatedConfig);
  return updatedConfig;
}

async function clearConfig(guildId) {
  const key = String(guildId);
  const pool = getPool();
  await pool.query('DELETE FROM spectrum_config WHERE guild_id = ?', [key]);
  configCache.delete(key);
}

function getConfigsSnapshot() {
  return Array.from(configCache.values()).map(config => ({ ...config }));
}

async function replyEphemeral(interaction, options) {
  const payload = typeof options === 'string' ? { content: options } : { ...options };
  payload.flags = MessageFlags.Ephemeral;

  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(payload);
  }
  return interaction.reply(payload);
}

async function handleSetChannel(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  const guildId = interaction.guildId;

  if (!guildId || !interaction.guild) {
    await replyEphemeral(interaction, 'This command can only be used inside a guild.');
    return { action: 'noop' };
  }

  if (channel.guildId !== guildId) {
    await replyEphemeral(interaction, 'Please choose a channel from this server.');
    return { action: 'noop' };
  }

  if (
    channel.type !== ChannelType.GuildText &&
    channel.type !== ChannelType.GuildAnnouncement
  ) {
    await replyEphemeral(interaction, 'Spectrum Watcher can only post to text or announcement channels.');
    return { action: 'noop' };
  }

  const config = await setConfig(guildId, channel.id, undefined, interaction.user.id);
  await replyEphemeral(interaction, `Spectrum announcements will post to ${channel} once a forum is configured.`);

  return { action: 'set-channel', config };
}

async function handleSetForum(interaction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await replyEphemeral(interaction, 'This command can only be used inside a guild.');
    return { action: 'noop' };
  }

  const forumIdRaw = interaction.options.getString('forum_id', true);
  const forumId = forumIdRaw.trim();

  if (!forumId) {
    await replyEphemeral(interaction, 'Please provide a valid forum ID.');
    return { action: 'noop' };
  }

  if (forumId.length > 32) {
    await replyEphemeral(interaction, 'Forum IDs must be 32 characters or fewer.');
    return { action: 'noop' };
  }

  const config = await setConfig(guildId, undefined, forumId, interaction.user.id);
  await replyEphemeral(interaction, `Spectrum Watcher will monitor forum **${forumId}**.`);

  return { action: 'set-forum', config };
}

async function handleStatus(interaction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await replyEphemeral(interaction, 'This command can only be used inside a guild.');
    return { action: 'noop' };
  }

  const config = await fetchConfig(guildId);
  if (!config) {
    await replyEphemeral(interaction, 'Spectrum Watcher is not configured for this server.');
    return { action: 'status', config: null };
  }

  const channelMention = config.announceChannelId ? `<#${config.announceChannelId}>` : '*not set*';
  const forumLabel = config.forumId ? `**${config.forumId}**` : '*not set*';

  await replyEphemeral(
    interaction,
    `Spectrum Watcher status:\n• Channel: ${channelMention}\n• Forum: ${forumLabel}`
  );

  return { action: 'status', config };
}

async function handleClear(interaction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await replyEphemeral(interaction, 'This command can only be used inside a guild.');
    return { action: 'noop' };
  }

  const existing = await fetchConfig(guildId);
  if (!existing) {
    await replyEphemeral(interaction, 'Spectrum Watcher is already cleared for this server.');
    return { action: 'clear', config: null };
  }

  await clearConfig(guildId);
  await replyEphemeral(interaction, 'Spectrum Watcher configuration has been cleared.');

  return { action: 'clear', config: null };
}

async function handlePostLatest(interaction) {
  const guildId = interaction.guildId;
  const client = interaction.client;

  if (!guildId || !client) {
    await replyEphemeral(interaction, 'This command can only be used inside a guild.');
    return { action: 'noop' };
  }

  const config = await fetchConfig(guildId);
  if (!config) {
    await replyEphemeral(interaction, 'Spectrum Watcher is not configured for this server.');
    return { action: 'post-latest', ok: false };
  }

  if (!config.forumId) {
    await replyEphemeral(interaction, 'Set a forum ID before posting the latest thread.');
    return { action: 'post-latest', ok: false, config };
  }

  if (!config.announceChannelId) {
    await replyEphemeral(interaction, 'Set an announcement channel before posting the latest thread.');
    return { action: 'post-latest', ok: false, config };
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Lazy-load to avoid cyclic dependency issues.
    // eslint-disable-next-line global-require
    const watcher = require('../spectrumWatcher');
    const result = await watcher.postLatestThreadForGuild(client, guildId);

    if (!result?.ok) {
      await interaction.editReply(result?.message || 'Unable to post the latest Spectrum thread right now.');
      return { action: 'post-latest', ok: false, config, result };
    }

    const threadTitle = result.thread?.subject || result.thread?.title || 'Latest thread';
    const threadUrl = result.threadUrl || 'https://robertsspaceindustries.com/spectrum';
    const channelMention = `<#${config.announceChannelId}>`;
    await interaction.editReply(`Posted **${threadTitle}** to ${channelMention}.\n${threadUrl}`);
    return { action: 'post-latest', ok: true, config, result };
  } catch (err) {
    console.error('spectrumConfig: failed to post latest thread', err);
    await interaction.editReply('Something went wrong while trying to post the latest thread.');
    return { action: 'post-latest', ok: false, error: err };
  }
}

async function handleSpectrumCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  switch (subcommand) {
    case 'set-channel':
      return handleSetChannel(interaction);
    case 'set-forum':
      return handleSetForum(interaction);
    case 'status':
      return handleStatus(interaction);
    case 'clear':
      return handleClear(interaction);
    case 'post-latest':
      return handlePostLatest(interaction);
    default:
      await replyEphemeral(interaction, 'Unsupported subcommand.');
      return { action: 'noop' };
  }
}

async function onInteraction(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'spectrum') {
    return;
  }

  try {
    await handleSpectrumCommand(interaction);
  } catch (err) {
    console.error('spectrumConfig: failed to handle /spectrum command', err);
    await replyEphemeral(interaction, 'Something went wrong while handling this command. Please try again later.');
  }
}

async function initialize(client) {
  if (initialized) {
    return;
  }

  const pool = getPool();
  await ensureSchema(pool);
  await loadCache(pool);

  client.on(Events.InteractionCreate, onInteraction);
  initialized = true;
}

async function onReady(client) {
  if (!initialized) {
    await initialize(client);
  }
}

module.exports = {
  getSlashCommandDefinitions,
  initialize,
  onReady,
  fetchConfig,
  setConfig,
  clearConfig,
  getConfigsSnapshot,
  handleSpectrumCommand,
  __testables: {
    ensureSchema,
    loadCache,
    configCache
  }
};
