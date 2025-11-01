const { MessageFlags } = require('discord.js');

jest.mock('../embeds/utils', () => ({
  buildEmbedsFromText: jest.fn(),
  downloadAttachmentText: jest.fn(),
  isTemplateAttachment: jest.fn(),
  isLikelyTemplate: jest.fn(),
  canMemberUseTemplates: jest.fn(),
  allowRoleForGuild: jest.fn(),
  removeRoleForGuild: jest.fn(),
  listAllowedRoles: jest.fn(),
  ensureSchema: jest.fn(),
  loadRoleCache: jest.fn(),
  clearRoleCache: jest.fn()
}));

const {
  allowRoleForGuild,
  removeRoleForGuild,
  listAllowedRoles
} = require('../embeds/utils');
const { handleAccessCommand } = require('../embeds/handlers/access');

describe('embed access slash command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listAllowedRoles.mockReturnValue([]);
    allowRoleForGuild.mockResolvedValue(true);
    removeRoleForGuild.mockResolvedValue(true);
  });

  const baseInteraction = (overrides = {}) => ({
    guildId: 'guild-1',
    user: { id: 'user-1' },
    memberPermissions: { has: jest.fn().mockReturnValue(true) },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    options: {
      getSubcommand: jest.fn(),
      getRole: jest.fn()
    },
    ...overrides
  });

  test('rejects users without manage server permission', async () => {
    const interaction = baseInteraction({
      memberPermissions: { has: jest.fn().mockReturnValue(false) }
    });

    await handleAccessCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Administrator'),
      flags: MessageFlags.Ephemeral
    });
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  test('adds role to allow list', async () => {
    const role = { id: 'role-123', toString: () => '<@&role-123>' };
    const interaction = baseInteraction();
    interaction.options.getSubcommand.mockReturnValue('add');
    interaction.options.getRole.mockReturnValue(role);

    await handleAccessCommand(interaction);

    expect(allowRoleForGuild).toHaveBeenCalledWith('guild-1', 'role-123', 'user-1');
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('now upload')
    });
  });

  test('add command reports existing role', async () => {
    allowRoleForGuild.mockResolvedValue(false);
    const role = { id: 'role-123', toString: () => '<@&role-123>' };
    const interaction = baseInteraction();
    interaction.options.getSubcommand.mockReturnValue('add');
    interaction.options.getRole.mockReturnValue(role);

    await handleAccessCommand(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('already allowed')
    });
  });

  test('removes role from allow list', async () => {
    const role = { id: 'role-123', toString: () => '<@&role-123>' };
    const interaction = baseInteraction();
    interaction.options.getSubcommand.mockReturnValue('remove');
    interaction.options.getRole.mockReturnValue(role);

    await handleAccessCommand(interaction);

    expect(removeRoleForGuild).toHaveBeenCalledWith('guild-1', 'role-123');
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('no longer upload')
    });
  });

  test('remove command reports missing role', async () => {
    removeRoleForGuild.mockResolvedValue(false);
    const interaction = baseInteraction();
    const role = { id: 'role-123', toString: () => '<@&role-123>' };
    interaction.options.getSubcommand.mockReturnValue('remove');
    interaction.options.getRole.mockReturnValue(role);

    await handleAccessCommand(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('was not on')
    });
  });

  test('lists allowed roles', async () => {
    listAllowedRoles.mockReturnValue(['role-1', 'role-2']);
    const interaction = baseInteraction();
    interaction.options.getSubcommand.mockReturnValue('list');

    await handleAccessCommand(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('<@&role-1>')
    });
  });

  test('list reports empty state', async () => {
    listAllowedRoles.mockReturnValue([]);
    const interaction = baseInteraction();
    interaction.options.getSubcommand.mockReturnValue('list');

    await handleAccessCommand(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('No roles are currently')
    });
  });
});
