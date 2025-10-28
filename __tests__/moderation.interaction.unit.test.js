jest.mock('../moderation/roleConfig', () => ({
  handleModCommand: jest.fn()
}));

jest.mock('../moderation/actions/context', () => ({
  handleActionRequest: jest.fn(),
  handlePardonCommand: jest.fn()
}));

jest.mock('../moderation/actions/modals', () => ({
  handleModal: jest.fn()
}));

jest.mock('../moderation/history/context', () => ({
  handleHistoryContext: jest.fn()
}));

jest.mock('../moderation/utils', () => ({
  respondEphemeral: jest.fn()
}));

const roleConfig = require('../moderation/roleConfig');
const actionsContext = require('../moderation/actions/context');
const modals = require('../moderation/actions/modals');
const historyContext = require('../moderation/history/context');
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

    roleConfig.handleModCommand.mockResolvedValue(undefined);

    await expect(handleInteraction(interaction)).resolves.toBe(true);
    expect(roleConfig.handleModCommand).toHaveBeenCalledWith(interaction);
  });

  test('routes /pardon slash command', async () => {
    const interaction = {
      isChatInputCommand: () => true,
      commandName: PARDON_COMMAND_NAME
    };

    actionsContext.handlePardonCommand.mockResolvedValue(undefined);

    await expect(handleInteraction(interaction)).resolves.toBe(true);
    expect(actionsContext.handlePardonCommand).toHaveBeenCalledWith(interaction);
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

    actionsContext.handleActionRequest.mockResolvedValue(undefined);

    await expect(handleInteraction(interaction)).resolves.toBe(true);
    expect(actionsContext.handleActionRequest).toHaveBeenLastCalledWith(interaction, actionKey);
  });

  test('routes history context command', async () => {
    const interaction = {
      isChatInputCommand: () => false,
      isUserContextMenuCommand: () => true,
      commandName: HISTORY_CONTEXT_LABEL
    };

    historyContext.handleHistoryContext.mockResolvedValue(undefined);

    await expect(handleInteraction(interaction)).resolves.toBe(true);
    expect(historyContext.handleHistoryContext).toHaveBeenCalledWith(interaction);
  });

  test('routes moderation modal submissions', async () => {
    const interaction = {
      isChatInputCommand: () => false,
      isUserContextMenuCommand: () => false,
      isModalSubmit: () => true,
      customId: 'moderation:warn'
    };

    modals.handleModal.mockResolvedValue(undefined);

    await expect(handleInteraction(interaction)).resolves.toBe(true);
    expect(modals.handleModal).toHaveBeenCalledWith(interaction);
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

    roleConfig.handleModCommand.mockRejectedValue(new Error('boom'));
    utils.respondEphemeral.mockResolvedValue(undefined);

    await expect(handleInteraction(interaction)).resolves.toBe(true);
    expect(utils.respondEphemeral).toHaveBeenCalledWith(
      interaction,
      'An error occurred while processing that moderation action.'
    );
  });
});
