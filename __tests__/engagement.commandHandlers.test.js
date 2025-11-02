jest.mock('../engagement/utils', () => ({
  upsertLevelDefinition: jest.fn(),
  removeLevelDefinition: jest.fn(),
  listLevelDefinitions: jest.fn()
}));

const utils = require('../engagement/utils');
const {
  handleLevelSetCommand,
  handleLevelRemoveCommand,
  handleLevelListCommand
} = require('../engagement/handlers/commandHandlers');

function buildInteraction({ guildId = 'guild-1', integers = {}, string = null } = {}) {
  return {
    guildId,
    options: {
      getInteger: jest.fn(name => integers[name]),
      getString: jest.fn(() => string)
    },
    reply: jest.fn()
  };
}

describe('engagement command handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('handleLevelSetCommand saves definition and replies with confirmation', async () => {
    utils.upsertLevelDefinition.mockResolvedValue([]);
    const interaction = buildInteraction({
      integers: { level: 3, points: 750 },
      string: 'Ace Pilot'
    });

    await handleLevelSetCommand(interaction);

    expect(utils.upsertLevelDefinition).toHaveBeenCalledWith('guild-1', {
      levelRank: 3,
      levelName: 'Ace Pilot',
      pointsRequired: 750
    });
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Level **3**'),
      ephemeral: true
    }));
  });

  test('handleLevelSetCommand reports duplicate threshold errors', async () => {
    utils.upsertLevelDefinition.mockRejectedValue({ code: 'ER_DUP_ENTRY' });
    const interaction = buildInteraction({
      integers: { level: 2, points: 400 },
      string: 'Veteran'
    });

    await handleLevelSetCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('point value'),
      ephemeral: true
    }));
  });

  test('handleLevelRemoveCommand acknowledges missing level', async () => {
    utils.removeLevelDefinition.mockResolvedValue(false);
    const interaction = buildInteraction({ integers: { level: 5 } });

    await handleLevelRemoveCommand(interaction);

    expect(utils.removeLevelDefinition).toHaveBeenCalledWith('guild-1', 5);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('not currently defined'),
      ephemeral: true
    }));
  });

  test('handleLevelListCommand lists definitions', async () => {
    utils.listLevelDefinitions.mockResolvedValue([
      { levelRank: 1, levelName: 'Recruit', pointsRequired: 5 },
      { levelRank: 2, levelName: 'Pilot', pointsRequired: 20 }
    ]);
    const interaction = buildInteraction();

    await handleLevelListCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Recruit'),
      ephemeral: true
    });
  });
});
