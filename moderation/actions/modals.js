const {
  ActionRowBuilder,
  GuildMember,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits
} = require('discord.js');
const { ACTIONS, TIMEOUT_DURATIONS } = require('../constants');
const { parseReferenceInput, fetchReferenceMessage, respondEphemeral } = require('../utils');
const { hasActionPermission } = require('../roleCache');
const {
  handleWarn,
  handleKick,
  handleBan,
  handleTimeout,
  executePardon
} = require('./handlers');

function buildReasonModal({ action, targetUser }) {
  const modal = new ModalBuilder()
    .setCustomId(`moderation:${action}:${targetUser.id}`)
    .setTitle(`${ACTIONS[action].label}`);

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason')
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(6)
    .setMaxLength(1024)
    .setRequired(true)
    .setPlaceholder('Describe why this action is being taken.');

  const referenceInput = new TextInputBuilder()
    .setCustomId('reference')
    .setLabel('Message link (optional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder('Paste the message URL or channelId:messageId');

  const components = [
    new ActionRowBuilder().addComponents(reasonInput)
  ];

  if (ACTIONS[action]?.durationChoices?.length) {
    const options = ACTIONS[action].durationChoices
      .map(choice => choice.value)
      .join(', ');

    const durationInput = new TextInputBuilder()
      .setCustomId('duration')
      .setLabel('Timeout duration')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder(`Choose from: ${options}`);

    components.push(new ActionRowBuilder().addComponents(durationInput));
  }

  components.push(new ActionRowBuilder().addComponents(referenceInput));

  for (const row of components) {
    modal.addComponents(row);
  }

  return modal;
}

function buildPardonModal(targetUser) {
  const modal = new ModalBuilder()
    .setCustomId(`moderation:pardon:${targetUser.id}`)
    .setTitle('Pardon User');

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason for pardon')
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(6)
    .setMaxLength(512)
    .setRequired(true)
    .setPlaceholder('Explain why this user is being pardoned.');

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
  return modal;
}

async function validateContext(interaction, action, targetId) {
  const guild = interaction.guild;
  const guildId = interaction.guildId;

  if (!guild || !guildId) {
    await respondEphemeral(interaction, 'This moderation action must be used inside a guild.');
    return null;
  }

  const member = interaction.member || (await guild.members.fetch(interaction.user.id).catch(() => null));
  if (!member) {
    await respondEphemeral(interaction, 'Could not resolve your guild membership for permission checks.');
    return null;
  }

  if (!hasActionPermission(guildId, member, action)) {
    await respondEphemeral(interaction, 'You are not allowed to use this moderation action.');
    return null;
  }

  let targetMember = null;
  try {
    targetMember = await guild.members.fetch(targetId);
  } catch {
    targetMember = null;
  }

  if (targetMember?.id === interaction.user.id) {
    await respondEphemeral(interaction, 'You cannot perform moderation actions on yourself.');
    return null;
  }

  if (targetMember?.id === guild.ownerId) {
    await respondEphemeral(interaction, 'You cannot moderate the guild owner.');
    return null;
  }

  if (targetMember && !canModerateMember(member, targetMember)) {
    await respondEphemeral(interaction, 'This user has a higher or equal role. Adjust role hierarchy before attempting this action.');
    return null;
  }

  return { guild, member, targetMember };
}

function canModerateMember(invoker, targetMember) {
  if (!targetMember || !invoker) {
    return true;
  }

  if (!(invoker instanceof GuildMember) || !(targetMember instanceof GuildMember)) {
    if (!targetMember.roles?.highest || !invoker.roles?.highest) {
      return true;
    }
  }

  const invokerHighest = invoker.roles?.highest;
  const targetHighest = targetMember.roles?.highest;

  if (!invokerHighest || !targetHighest) {
    return true;
  }

  return invokerHighest.comparePositionTo(targetHighest) > 0;
}

async function handleModal(interaction) {
  const [prefix, action, targetId] = interaction.customId.split(':');
  if (prefix !== 'moderation' || (!ACTIONS[action] && action !== 'pardon') || !targetId) {
    return;
  }

  const reason = interaction.fields.getTextInputValue('reason')?.trim();
  const durationInput = action === 'timeout'
    ? interaction.fields.getTextInputValue('duration')?.trim()
    : null;

  if (!reason) {
    await respondEphemeral(interaction, 'A reason is required for this action.');
    return;
  }

  if (action === 'pardon') {
    const guild = interaction.guild;
    if (!guild) {
      await respondEphemeral(interaction, 'This moderation action must be used inside a guild.');
      return;
    }

    const member = interaction.member || (await guild.members.fetch(interaction.user.id).catch(() => null));
    if (!member?.permissions?.has?.(PermissionFlagsBits.Administrator)) {
      await respondEphemeral(interaction, 'You must be an administrator to pardon users.');
      return;
    }

    const targetUser =
      interaction.client.users.cache?.get(targetId) ||
      (await interaction.client.users.fetch(targetId).catch(() => null));

    if (!targetUser) {
      await respondEphemeral(interaction, 'Unable to resolve that user.');
      return;
    }

    await executePardon({
      interaction,
      targetUser,
      moderator: interaction.user,
      reason
    });

    await respondEphemeral(interaction, `Pardoned ${targetUser.tag ?? targetUser.id}. Prior moderation actions are now hidden from moderators.`);
    return;
  }

  const referenceInput = interaction.fields.getTextInputValue('reference');

  const context = await validateContext(interaction, action, targetId);
  if (!context) {
    return;
  }

  const reference = await fetchReferenceMessage(
    interaction.client,
    context.guild,
    parseReferenceInput(referenceInput)
  );

  const timeoutChoice = action === 'timeout' ? resolveTimeoutChoice(durationInput) : null;
  if (action === 'timeout' && !timeoutChoice) {
    const allowed = TIMEOUT_DURATIONS.map(choice => choice.value).join(', ');
    await respondEphemeral(interaction, `Select a valid timeout duration: ${allowed}.`);
    return;
  }

  const targetUser =
    context.targetMember?.user ||
    (await interaction.client.users.fetch(targetId).catch(() => null));

  if (!targetUser) {
    await respondEphemeral(interaction, 'Unable to resolve that user.');
    return;
  }

  const handlerMap = {
    warn: handleWarn,
    kick: handleKick,
    ban: handleBan,
    timeout: handleTimeout
  };

  await handlerMap[action]({
    interaction,
    context,
    reason,
    reference,
    targetUser,
    duration: timeoutChoice
  });
}

function resolveTimeoutChoice(input) {
  if (!input) {
    return null;
  }

  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return TIMEOUT_DURATIONS.find(choice => {
    const value = choice.value.toLowerCase();
    const label = choice.label.toLowerCase();
    const compactLabel = label.replace(/\s+/g, '');
    return normalized === value || normalized === label || normalized === compactLabel;
  }) || null;
}

module.exports = {
  buildReasonModal,
  buildPardonModal,
  handleModal,
  validateContext,
  canModerateMember
};
