const { Events } = require('discord.js');
const { registerInteractionHandlers } = require('../interactionRegistry');

describe('interactionRegistry registerInteractionHandlers', () => {
  test('registers listener and stops after handled interaction', async () => {
    const client = {
      on: jest.fn(),
      off: jest.fn()
    };

    const handlerA = jest.fn().mockResolvedValue(true);
    const handlerB = jest.fn();

    const unsubscribe = registerInteractionHandlers(client, [
      { handleInteraction: handlerA },
      { handleInteraction: handlerB }
    ]);

    expect(client.on).toHaveBeenCalledWith(Events.InteractionCreate, expect.any(Function));
    const listener = client.on.mock.calls[0][1];

    const interaction = { replied: false, deferred: false };
    await listener(interaction);

    expect(handlerA).toHaveBeenCalledWith(interaction);
    expect(handlerB).not.toHaveBeenCalled();

    unsubscribe();
    expect(client.off).toHaveBeenCalledWith(Events.InteractionCreate, listener);
  });

  test('continues when handler returns false and logs failures', async () => {
    const client = { on: jest.fn() };
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const handlerA = jest.fn().mockResolvedValue(false);
    const handlerB = jest.fn().mockImplementation(() => {
      throw new Error('boom');
    });
    const handlerC = jest.fn().mockResolvedValue(false);

    registerInteractionHandlers(client, [
      { name: 'alpha', handleInteraction: handlerA },
      { name: 'beta', handleInteraction: handlerB },
      { name: 'gamma', handleInteraction: handlerC }
    ]);

    const listener = client.on.mock.calls[0][1];
    await listener({ replied: false, deferred: false });

    expect(handlerA).toHaveBeenCalled();
    expect(handlerB).toHaveBeenCalled();
    expect(handlerC).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
