const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { MessageFlags, canMemberCreatePoll, hasConfiguredPollRoles, generateSessionId, parseExpirationInput, validateExpiration, formatCountdown } = require('../utils');
const {
  createPollRecord,
  insertPollOptions,
  setPollMessageId,
  fetchPollWithOptions,
  markPollClosed
} = require('../store');
const { buildPollEmbed, buildPollComponents } = require('../render');
const { closePollMessage } = require('../scheduler');

const MAX_OPTIONS = 25;
const SESSION_TTL_MS = 15 * 60 * 1000;

const sessions = new Map(); // sessionId -> session
const sessionsByUser = new Map(); // userId -> sessionId

function pruneSessions() {
  const now = Date.now();
  for (const [sessionId, session] of sessions) {
    if (now - session.updatedAt > SESSION_TTL_MS || session.status === 'closed') {
      sessions.delete(sessionId);
      if (sessionsByUser.get(session.userId) === sessionId) {
        sessionsByUser.delete(session.userId);
      }
    }
  }
}

function createSession(interaction) {
  pruneSessions();
  const existing = sessionsByUser.get(interaction.user.id);
  if (existing) {
    const stale = sessions.get(existing);
    if (stale) {
      stale.status = 'closed';
      sessions.delete(existing);
    }
    sessionsByUser.delete(interaction.user.id);
  }

  const id = generateSessionId();
  const session = {
    id,
    userId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    question: null,
    options: [],
    isMulti: false,
    expiresAt: null,
    originInteraction: interaction,
    status: 'draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pollId: null,
    pollMessageId: null,
    messageUrl: null
  };
  sessions.set(id, session);
  sessionsByUser.set(session.userId, id);
  return session;
}

function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    return null;
  }
  session.updatedAt = Date.now();
  return session;
}

async function updateControlPanel(session) {
  if (!session.originInteraction) {
    return;
  }
  try {
    await session.originInteraction.editReply(renderControlPanel(session));
  } catch (err) {
    console.error('[polls] Failed to update control panel:', err);
  }
}

function renderControlPanel(session) {
  const embedLines = [];
  embedLines.push(`**Question:** ${session.question ? session.question : '_Not set_ (required)'}`);
  if (session.options.length) {
    const optionsPreview = session.options
      .map((opt, index) => `${index + 1}. ${opt.label}`)
      .join('\n');
    embedLines.push(`**Options (${session.options.length}/${MAX_OPTIONS}):**\n${optionsPreview}`);
  } else {
    embedLines.push('**Options:** _None yet_ (minimum 2 required)');
  }
  embedLines.push(`**Mode:** ${session.isMulti ? 'Multiple selections allowed' : 'Single selection'}`);
  if (session.expiresAt) {
    embedLines.push(`**Expires:** <t:${Math.floor(session.expiresAt.getTime() / 1000)}:f> (in ${formatCountdown(session.expiresAt)})`);
  } else {
    embedLines.push('**Expires:** _Not set_ (required)');
  }

  if (session.status === 'published') {
    embedLines.push(`\nPoll posted: ${session.messageUrl}`);
  }

  const embed = {
    title: session.status === 'published' ? 'Poll Control Panel (published)' : 'Poll Control Panel',
    description: embedLines.join('\n\n'),
    color: session.status === 'published' ? 0x22c55e : 0x2563eb,
    footer: {
      text: 'Use the buttons below to configure your poll.'
    }
  };

  const rows = [];

  const baseRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`polls:ctrl:set_question:${session.id}`)
      .setLabel(session.question ? 'Edit Question' : 'Set Question')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(session.status === 'published'),
    new ButtonBuilder()
      .setCustomId(`polls:ctrl:add_option:${session.id}`)
      .setLabel(session.options.length ? 'Add Option' : 'Add First Option')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(session.status === 'published' || session.options.length >= MAX_OPTIONS),
    new ButtonBuilder()
      .setCustomId(`polls:ctrl:set_expiration:${session.id}`)
      .setLabel(session.expiresAt ? 'Edit Expiration' : 'Set Expiration')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(session.status === 'published')
  );
  rows.push(baseRow);

  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`polls:ctrl:toggle_mode:${session.id}`)
      .setLabel(session.isMulti ? 'Switch to Single Answer' : 'Allow Multiple Answers')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(session.status === 'published'),
    new ButtonBuilder()
      .setCustomId(`polls:ctrl:publish:${session.id}`)
      .setLabel('Publish')
      .setStyle(ButtonStyle.Success)
      .setDisabled(
        session.status === 'published' ||
        !session.question ||
        session.options.length < 2 ||
        !session.expiresAt
      ),
    new ButtonBuilder()
      .setCustomId(`polls:ctrl:cancel:${session.id}`)
      .setLabel(session.status === 'published' ? 'Close Panel' : 'Cancel')
      .setStyle(ButtonStyle.Danger)
  );
  rows.push(controlRow);

  if (session.options.length && session.status !== 'published') {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`polls:select:remove:${session.id}`)
      .setPlaceholder('Remove options...')
      .setMinValues(1)
      .setMaxValues(session.options.length)
      .addOptions(
        session.options.map((opt, index) => ({
          label: opt.label.length > 90 ? opt.label.slice(0, 87) + '…' : opt.label,
          value: opt.id,
          description: `Option ${index + 1}`
        }))
      );
    rows.push(new ActionRowBuilder().addComponents(select));
  }

  if (session.status === 'published') {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`polls:ctrl:close:${session.id}`)
          .setLabel('Close Poll Now')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(session.pollClosed === true)
      )
    );
  }

  return {
    embeds: [embed],
    components: rows
  };
}

function buildQuestionModal(sessionId) {
  const modal = new ModalBuilder()
    .setCustomId(`polls:modal:question:${sessionId}`)
    .setTitle('Set Poll Question');

  const input = new TextInputBuilder()
    .setCustomId('question')
    .setLabel('What question are you asking?')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(512)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function buildOptionModal(sessionId) {
  const modal = new ModalBuilder()
    .setCustomId(`polls:modal:option:${sessionId}`)
    .setTitle('Add Poll Option');

  const input = new TextInputBuilder()
    .setCustomId('option')
    .setLabel('Option text')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(256)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function buildExpirationModal(sessionId) {
  const modal = new ModalBuilder()
    .setCustomId(`polls:modal:expire:${sessionId}`)
    .setTitle('Set Poll Expiration');

  const input = new TextInputBuilder()
    .setCustomId('expires')
    .setLabel('Expiration (2h 30m or 2025-01-30 18:00)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(64)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

async function handleCreateCommand(interaction) {
  if (!canMemberCreatePoll(interaction.member)) {
    const message = hasConfiguredPollRoles(interaction.guildId)
      ? 'You do not have permission to create polls. Ask a server admin for access.'
      : 'Poll creator roles have not been configured yet. Ask an admin to run `/poll access add` first.';
    await interaction.reply({
      content: message,
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const session = createSession(interaction);
  await interaction.reply({
    ...renderControlPanel(session),
    flags: MessageFlags.Ephemeral
  });
  return true;
}

function ensureSessionOwner(session, interaction) {
  if (!session || session.userId !== interaction.user.id) {
    return false;
  }
  return true;
}

async function handleControlButton(interaction) {
  const parts = interaction.customId.split(':');
  if (parts.length < 4 || parts[0] !== 'polls' || parts[1] !== 'ctrl') {
    return false;
  }
  const action = parts[2];
  const sessionId = parts[3];
  const session = getSession(sessionId);
  if (!ensureSessionOwner(session, interaction)) {
    await interaction.reply({
      content: 'This control panel is no longer active.',
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return true;
  }

  if (action === 'set_question') {
    await interaction.showModal(buildQuestionModal(sessionId));
    return true;
  }

  if (action === 'add_option') {
    await interaction.showModal(buildOptionModal(sessionId));
    return true;
  }

  if (action === 'set_expiration') {
    await interaction.showModal(buildExpirationModal(sessionId));
    return true;
  }

  if (action === 'toggle_mode') {
    session.isMulti = !session.isMulti;
    session.updatedAt = Date.now();
    await interaction.deferUpdate();
    await updateControlPanel(session);
    return true;
  }

  if (action === 'publish') {
    await interaction.deferUpdate();
    await publishPoll(session, interaction);
    return true;
  }

  if (action === 'cancel') {
    sessions.delete(session.id);
    sessionsByUser.delete(session.userId);
    session.status = 'closed';
    await interaction.deferUpdate();
    try {
      await session.originInteraction.editReply({
        content: 'Poll creation cancelled.',
        components: [],
        embeds: []
      });
    } catch (err) {
      console.error('[polls] Failed to close control panel:', err);
    }
    return true;
  }

  if (action === 'close' && session.status === 'published' && session.pollId) {
    await interaction.deferUpdate();
    await closePollEarly(session, interaction.user.id, interaction.client);
    return true;
  }

  return false;
}

async function handleSelectMenu(interaction) {
  const parts = interaction.customId.split(':');
  if (parts.length < 4 || parts[0] !== 'polls' || parts[1] !== 'select') {
    return false;
  }
  const action = parts[2];
  const sessionId = parts[3];
  const session = getSession(sessionId);
  if (!ensureSessionOwner(session, interaction)) {
    await interaction.reply({
      content: 'This control panel is no longer active.',
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return true;
  }

  if (action === 'remove' && session.status !== 'published') {
    const toRemove = new Set(interaction.values);
    session.options = session.options.filter(opt => !toRemove.has(opt.id));
    session.updatedAt = Date.now();
    await interaction.deferUpdate();
    await updateControlPanel(session);
    return true;
  }

  return false;
}

async function handleModalSubmission(interaction) {
  const parts = interaction.customId.split(':');
  if (parts.length < 4 || parts[0] !== 'polls' || parts[1] !== 'modal') {
    return false;
  }
  const type = parts[2];
  const sessionId = parts[3];
  const session = getSession(sessionId);
  if (!ensureSessionOwner(session, interaction)) {
    await interaction.reply({
      content: 'This poll builder is no longer active.',
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return true;
  }

  if (session.status === 'published' && type !== 'expire') {
    await interaction.reply({
      content: 'This poll has already been published.',
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return true;
  }

  if (type === 'question') {
    const input = interaction.fields.getTextInputValue('question').trim();
    if (!input) {
      await interaction.reply({
        content: 'The question cannot be empty.',
        flags: MessageFlags.Ephemeral
      });
      return true;
    }
    session.question = input.slice(0, 512);
    session.updatedAt = Date.now();
    await interaction.deferUpdate();
    await updateControlPanel(session);
    return true;
  }

  if (type === 'option') {
    const input = interaction.fields.getTextInputValue('option').trim();
    if (!input) {
      await interaction.reply({
        content: 'Option text cannot be empty.',
        flags: MessageFlags.Ephemeral
      });
      return true;
    }
    if (session.options.length >= MAX_OPTIONS) {
      await interaction.reply({
        content: `You already have the maximum of ${MAX_OPTIONS} options.`,
        flags: MessageFlags.Ephemeral
      });
      return true;
    }
    session.options.push({
      id: generateSessionId(),
      label: input.slice(0, 256)
    });
    session.updatedAt = Date.now();
    await interaction.deferUpdate();
    await updateControlPanel(session);
    return true;
  }

  if (type === 'expire') {
    const raw = interaction.fields.getTextInputValue('expires').trim();
    const parsed = parseExpirationInput(raw);
    const validation = validateExpiration(parsed, new Date());
    if (!validation.ok) {
      await interaction.reply({
        content: validation.error,
        flags: MessageFlags.Ephemeral
      });
      return true;
    }
    session.expiresAt = validation.value;
    session.updatedAt = Date.now();
    await interaction.deferUpdate();
    await updateControlPanel(session);
    return true;
  }

  return false;
}

async function publishPoll(session, interaction) {
  if (!session.question || session.options.length < 2 || !session.expiresAt) {
    await session.originInteraction.followUp({
      content: 'Please set a question, at least two options, and an expiration before publishing.',
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return;
  }

  try {
    const pollId = await createPollRecord({
      guildId: session.guildId,
      channelId: session.channelId,
      ownerId: session.userId,
      question: session.question,
      isMulti: session.isMulti,
      expiresAt: session.expiresAt
    });

    const storedOptions = await insertPollOptions(
      pollId,
      session.options.map(opt => ({ label: opt.label }))
    );

    const pollData = await fetchPollWithOptions(pollId);
    const embed = buildPollEmbed({
      poll: pollData.poll,
      options: pollData.options,
      now: new Date()
    });
    const components = buildPollComponents({
      poll: pollData.poll,
      options: pollData.options,
      disabled: false
    });

    const channel = await interaction.client.channels.fetch(session.channelId);
    const message = await channel.send({ embeds: [embed], components });
    await setPollMessageId(pollId, message.id);

    session.status = 'published';
    session.pollId = pollId;
    session.pollMessageId = message.id;
    session.messageUrl = message.url;
    session.updatedAt = Date.now();

    await updateControlPanel(session);
  } catch (err) {
    console.error('[polls] Failed to publish poll:', err);
    await session.originInteraction.followUp({
      content: 'Something went wrong while publishing the poll. Please try again.',
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
  }
}

async function closePollEarly(session, userId, client) {
  if (!session.pollId) {
    return;
  }
  await markPollClosed(session.pollId, { reason: 'manual', closedBy: userId, closedAt: new Date() });
  await closePollMessage(client, session.pollId);
  session.pollClosed = true;
  session.status = 'closed';
  sessions.delete(session.id);
  sessionsByUser.delete(session.userId);
  if (session.originInteraction) {
    try {
      await session.originInteraction.editReply({
        content: 'Poll closed.',
        embeds: [],
        components: []
      });
    } catch (err) {
      console.error('[polls] Failed to update control panel after closing poll:', err);
    }
  }
}

module.exports = {
  handleCreateCommand,
  handleControlButton,
  handleModalSubmission,
  handleSelectMenu,
  __testables: {
    createSession,
    getSession,
    renderControlPanel,
    MAX_OPTIONS
  }
};
