jest.mock('../moderation/handlers/roles', () => ({
  handleModCommand: jest.fn()
}));

jest.mock('../moderation/utils', () => ({
  respondEphemeral: jest.fn()
}));

const roles = require('../moderation/handlers/roles');
const utils = require('../moderation/utils');
const { handleInteraction } = require('../moderation/handlers/interaction');

describe('moderation interaction routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  test('routes /mod slash command', async () => {
    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'mod'
    };

    roles.handleModCommand.mockResolvedValue(undefined);

    await expect(handleInteraction(interaction)).resolves.toBe(true);
    expect(roles.handleModCommand).toHaveBeenCalledWith(interaction);
  });

  test('returns false when no handler matches', async () => {
    const interaction = {
      isChatInputCommand: () => false
    };

    await expect(handleInteraction(interaction)).resolves.toBe(false);
  });

  test('provides fallback error handling', async () => {
    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'mod',
      isRepliable: () => true
    };

    roles.handleModCommand.mockRejectedValue(new Error('boom'));
    utils.respondEphemeral.mockResolvedValue(undefined);

    await expect(handleInteraction(interaction)).resolves.toBe(true);
    expect(utils.respondEphemeral).toHaveBeenCalledWith(
      interaction,
      'An error occurred while processing that moderation action.'
    );
  });
});
