const { Events } = require('discord.js');

describe('tickets index wrappers', () => {
  let core;
  let commands;
  let interactionHandler;
  let messageHandler;
  let tickets;

  beforeEach(() => {
    jest.resetModules();

    jest.doMock('../tickets/core', () => ({
      initialize: jest.fn().mockResolvedValue(undefined),
      onReady: jest.fn().mockResolvedValue(undefined),
      __testables: {}
    }));

    jest.doMock('../tickets/commands', () => ({
      getSlashCommandDefinitions: jest.fn(() => ({ guild: ['guild-command'], global: [] }))
    }));

    jest.doMock('../tickets/handlers/interaction', () => ({
      handleInteraction: jest.fn().mockResolvedValue('handled')
    }));

    jest.doMock('../tickets/handlers/message', () => ({
      handleMessageCreate: jest.fn().mockResolvedValue(undefined)
    }));

    core = require('../tickets/core');
    commands = require('../tickets/commands');
    interactionHandler = require('../tickets/handlers/interaction');
    messageHandler = require('../tickets/handlers/message');
    tickets = require('../tickets');
  });

  afterEach(() => {
    jest.resetModules();
  });

  test('initialize forwards to core and binds message listener once', async () => {
    const listeners = new Map();
    const client = {
      on: jest.fn((event, listener) => {
        listeners.set(event, listener);
      })
    };

    await tickets.initialize(client);
    expect(core.initialize).toHaveBeenCalledWith(client);
    expect(client.on).toHaveBeenCalledWith(Events.MessageCreate, expect.any(Function));

    const messageListener = listeners.get(Events.MessageCreate);
    expect(typeof messageListener).toBe('function');

    await messageListener({ id: '123' });
    expect(messageHandler.handleMessageCreate).toHaveBeenCalledWith({ id: '123' });

    const error = new Error('boom');
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    messageHandler.handleMessageCreate.mockRejectedValueOnce(error);
    await messageListener({ id: '456' });
    expect(consoleSpy).toHaveBeenCalledWith('tickets: lobby message handler failed', error);
    consoleSpy.mockRestore();

    await tickets.initialize(client);
    expect(client.on).toHaveBeenCalledTimes(1);
  });

  test('onReady proxies to core', async () => {
    const client = {};
    await tickets.onReady(client);
    expect(core.onReady).toHaveBeenCalledWith(client);
  });

  test('getSlashCommandDefinitions delegates to commands module', () => {
    expect(tickets.getSlashCommandDefinitions()).toEqual({ guild: ['guild-command'], global: [] });
    expect(commands.getSlashCommandDefinitions).toHaveBeenCalled();
  });

  test('handleInteraction delegates to registered handler', async () => {
    const interaction = { id: 'interact' };
    await expect(tickets.handleInteraction(interaction)).resolves.toBe('handled');
    expect(interactionHandler.handleInteraction).toHaveBeenCalledWith(interaction);
  });
});
