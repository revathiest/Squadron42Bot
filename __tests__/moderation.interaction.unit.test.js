jest.mock('../moderation/handlers/roles', () => ({
  handleModCommand: jest.fn()
}));

jest.mock('../moderation/handlers/modal', () => ({
  handleActionRequest: jest.fn(),
  handlePardonCommand: jest.fn(),
  handleModal: jest.fn()
}));

jest.mock('../moderation/handlers/history', () => ({
  handleHistoryContext: jest.fn()
}));

jest.mock('../moderation/utils', () => ({
  respondEphemeral: jest.fn()
}));

const roles = require('../moderation/handlers/roles');
const modalHandlers = require('../moderation/handlers/modal');
const historyHandlers = require('../moderation/handlers/history');
const utils = require('../moderation/utils');
const { ACTIONS, PARDON_COMMAND_NAME, HISTORY_CONTEXT_LABEL } = require('../moderation/constants');
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

  test('routes /pardon slash command', async () => {
    const interaction = {
      isChatInputCommand: () => true,
      commandName: PARDON_COMMAND_NAME
    };

    modalHandlers.handlePardonCommand.mockResolvedValue(undefined);

    await expect(handleInteraction(interaction)).resolves.toBe(true);
    expect(modalHandlers.handlePardonCommand).toHaveBeenCalledWith(interaction);
  });

  test.each([
    ['warn', ACTIONS.warn.label],
    ['kick', ACTIONS.kick.label],
    ['ban', ACTIONS.ban.label],
    ['timeout', ACTIONS.timeout.label]
  ])('routes %s context command', async (actionKey, label) => {
    const interaction = {
      isChatInputCommand: () => false,
      isUserContextMenuCommand: () => true,
      commandName: label
    };

    modalHandlers.handleActionRequest.mockResolvedValue(undefined);

    await expect(handleInteraction(interaction)).resolves.toBe(true);
    expect(modalHandlers.handleActionRequest).toHaveBeenLastCalledWith(interaction, actionKey);
  });

  test('routes history context command', async () => {
    const interaction = {
      isChatInputCommand: () => false,
      isUserContextMenuCommand: () => true,
      commandName: HISTORY_CONTEXT_LABEL
    };

    historyHandlers.handleHistoryContext.mockResolvedValue(undefined);

    await expect(handleInteraction(interaction)).resolves.toBe(true);
    expect(historyHandlers.handleHistoryContext).toHaveBeenCalledWith(interaction);
  });

  test('routes moderation modal submissions', async () => {
    const interaction = {
      isChatInputCommand: () => false,
      isUserContextMenuCommand: () => false,
      isModalSubmit: () => true,
      customId: 'moderation:warn'
    };

    modalHandlers.handleModal.mockResolvedValue(undefined);

    await expect(handleInteraction(interaction)).resolves.toBe(true);
    expect(modalHandlers.handleModal).toHaveBeenCalledWith(interaction);
  });

  test('returns false when no handler matches', async () => {
    const interaction = {
      isChatInputCommand: () => false,
      isUserContextMenuCommand: () => false,
      isModalSubmit: () => false
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
