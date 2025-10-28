describe('spectrum index module', () => {
  let spectrum;
  let config;
  let watcher;
  let commands;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../spectrum/config', () => ({
      initialize: jest.fn(),
      onReady: jest.fn()
    }));
    jest.doMock('../spectrum/watcher/service', () => ({
      initialize: jest.fn(),
      onReady: jest.fn(),
      handleInteraction: jest.fn().mockResolvedValue(true)
    }));
    jest.doMock('../spectrum/commands', () => ({
      getSlashCommandDefinitions: jest.fn(() => ({ guild: ['cmd'], global: [] }))
    }));

    spectrum = require('../spectrum');
    config = require('../spectrum/config');
    watcher = require('../spectrum/watcher/service');
    commands = require('../spectrum/commands');
  });

  afterEach(() => {
    jest.resetModules();
  });

  test('initialize delegates to config and watcher', async () => {
    const client = {};
    await spectrum.initialize(client);
    expect(config.initialize).toHaveBeenCalledWith(client);
    expect(watcher.initialize).toHaveBeenCalledWith(client);
  });

  test('onReady delegates to config and watcher', async () => {
    const client = {};
    await spectrum.onReady(client);
    expect(config.onReady).toHaveBeenCalledWith(client);
    expect(watcher.onReady).toHaveBeenCalledWith(client);
  });

  test('getSlashCommandDefinitions pulls from commands module', () => {
    expect(spectrum.getSlashCommandDefinitions()).toEqual({ guild: ['cmd'], global: [] });
    expect(commands.getSlashCommandDefinitions).toHaveBeenCalled();
  });

  test('handleInteraction delegates to watcher', async () => {
    const interaction = {};
    await expect(spectrum.handleInteraction(interaction)).resolves.toBe(true);
    expect(watcher.handleInteraction).toHaveBeenCalledWith(interaction);
  });
});
