describe('voiceRooms index wrappers', () => {
  let core;
  let handler;
  let voiceRooms;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../voiceRooms/core', () => ({
      initialize: jest.fn(),
      onReady: jest.fn(),
      handleInteraction: jest.fn()
    }));

    jest.doMock('../voiceRooms/handlers/interaction', () => ({
      handleInteraction: jest.fn().mockResolvedValue(true)
    }));

    core = require('../voiceRooms/core');
    handler = require('../voiceRooms/handlers/interaction');
    voiceRooms = require('../voiceRooms');
  });

  afterEach(() => {
    jest.resetModules();
  });

  test('initialize forwards to core.initialize', async () => {
    const client = {};
    await voiceRooms.initialize(client);
    expect(core.initialize).toHaveBeenCalledWith(client);
  });

  test('onReady forwards to core.onReady', async () => {
    const client = {};
    await voiceRooms.onReady(client);
    expect(core.onReady).toHaveBeenCalledWith(client);
  });

  test('handleInteraction delegates to handler implementation', async () => {
    const interaction = {};
    await expect(voiceRooms.handleInteraction(interaction)).resolves.toBe(true);
    expect(handler.handleInteraction).toHaveBeenCalledWith(interaction);
  });
});
