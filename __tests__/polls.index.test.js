jest.mock('../polls/handlers/create', () => ({
  handleCreateCommand: jest.fn().mockResolvedValue(true),
  handleControlButton: jest.fn().mockResolvedValue(true),
  handleModalSubmission: jest.fn().mockResolvedValue(true),
  handleSelectMenu: jest.fn().mockResolvedValue(true)
}));

jest.mock('../polls/handlers/access', () => ({
  handleAccessCommand: jest.fn().mockResolvedValue(true)
}));

jest.mock('../polls/handlers/vote', () => ({
  handleVote: jest.fn().mockResolvedValue(true)
}));

jest.mock('../polls/handlers/manage', () => ({
  handleCloseButton: jest.fn().mockResolvedValue(true)
}));

jest.mock('../polls/schema', () => ({
  ensureSchema: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../polls/utils', () => {
  const actual = jest.requireActual('../polls/utils');
  return {
    ...actual,
    loadRoleCache: jest.fn().mockResolvedValue(undefined)
  };
});

jest.mock('../polls/scheduler', () => ({
  startScheduler: jest.fn(),
  processExpiredPolls: jest.fn().mockResolvedValue(undefined)
}));

const polls = require('../polls');
const commands = require('../polls/commands');
const createHandlers = require('../polls/handlers/create');
const accessHandlers = require('../polls/handlers/access');
const voteHandlers = require('../polls/handlers/vote');
const manageHandlers = require('../polls/handlers/manage');
const utils = require('../polls/utils');
const { ensureSchema } = require('../polls/schema');

describe('polls module wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('getSlashCommandDefinitions exposes guild poll command', () => {
    const defs = polls.getSlashCommandDefinitions();
    expect(Array.isArray(defs.guild)).toBe(true);
    expect(defs.guild[0].name).toBe('poll');
    expect(defs.global).toEqual([]);
  });

  test('initialize ensures schema and caches roles', async () => {
    const client = {};
    await polls.initialize(client);
    expect(ensureSchema).toHaveBeenCalled();
    expect(utils.loadRoleCache).toHaveBeenCalled();
  });

  test('handleInteraction routes to create command', async () => {
    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'poll',
      options: {
        getSubcommandGroup: () => null,
        getSubcommand: () => 'create'
      }
    };

    await polls.handleInteraction(interaction);
    expect(createHandlers.handleCreateCommand).toHaveBeenCalledWith(interaction);
  });

  test('handleInteraction routes to access commands', async () => {
    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'poll',
      options: {
        getSubcommandGroup: () => 'access',
        getSubcommand: () => 'add'
      }
    };

    await polls.handleInteraction(interaction);
    expect(accessHandlers.handleAccessCommand).toHaveBeenCalledWith(interaction);
  });

  test('handleInteraction routes button and modal interactions', async () => {
    const buttonInteraction = {
      isChatInputCommand: () => false,
      isButton: () => true,
      customId: 'polls:ctrl:set_question:123'
    };
    await polls.handleInteraction(buttonInteraction);
    expect(createHandlers.handleControlButton).toHaveBeenCalledWith(buttonInteraction);

    const voteButton = {
      isChatInputCommand: () => false,
      isButton: () => true,
      customId: 'polls:vote:1:2'
    };
    await polls.handleInteraction(voteButton);
    expect(voteHandlers.handleVote).toHaveBeenCalledWith(voteButton);

    const closeButton = {
      isChatInputCommand: () => false,
      isButton: () => true,
      customId: 'polls:close:1'
    };
    await polls.handleInteraction(closeButton);
    expect(manageHandlers.handleCloseButton).toHaveBeenCalledWith(closeButton);

    const modalInteraction = {
      isChatInputCommand: () => false,
      isButton: () => false,
      isModalSubmit: () => true,
      customId: 'polls:modal:question:abc'
    };
    await polls.handleInteraction(modalInteraction);
    expect(createHandlers.handleModalSubmission).toHaveBeenCalledWith(modalInteraction);

    const selectInteraction = {
      isChatInputCommand: () => false,
      isButton: () => false,
      isModalSubmit: () => false,
      isStringSelectMenu: () => true,
      customId: 'polls:select:remove:def'
    };
    await polls.handleInteraction(selectInteraction);
    expect(createHandlers.handleSelectMenu).toHaveBeenCalledWith(selectInteraction);
  });
});
