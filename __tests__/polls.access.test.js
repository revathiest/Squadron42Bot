const { MessageFlags } = require('../polls/utils');
const accessHandler = require('../polls/handlers/access');

jest.mock('../polls/utils', () => {
  const actual = jest.requireActual('../polls/utils');
  return {
    ...actual,
    allowRoleForGuild: jest.fn().mockResolvedValue(true),
    removeRoleForGuild: jest.fn().mockResolvedValue(true),
    listAllowedRoles: jest.fn().mockReturnValue(['role-1'])
  };
});

const utils = require('../polls/utils');

describe('polls access handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('requires Manage Server permission', async () => {
    const interaction = {
      memberPermissions: { has: () => false },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await accessHandler.handleAccessCommand(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
  });

  test('adds allowed role', async () => {
    const interaction = {
      memberPermissions: { has: () => true },
      guildId: 'guild-a',
      user: { id: 'user-a' },
      options: {
        getSubcommand: () => 'add',
        getRole: () => ({ id: 'role-a', toString: () => '<@&role-a>' })
      },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await accessHandler.handleAccessCommand(interaction);
    expect(utils.allowRoleForGuild).toHaveBeenCalledWith('guild-a', 'role-a', 'user-a');
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
  });

  test('lists roles when requested', async () => {
    utils.listAllowedRoles.mockReturnValue(['role-1', 'role-2']);
    const interaction = {
      memberPermissions: { has: () => true },
      guildId: 'guild-b',
      options: {
        getSubcommand: () => 'list'
      },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await accessHandler.handleAccessCommand(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
  });
});
