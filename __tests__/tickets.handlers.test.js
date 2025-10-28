describe('tickets handlers', () => {
  let core;
  let handlers;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../tickets/core', () => ({
      handleInteraction: jest.fn().mockResolvedValue('handled'),
      handleMessageCreate: jest.fn().mockResolvedValue('message-handled')
    }));

    handlers = {
      interaction: require('../tickets/handlers/interaction'),
      message: require('../tickets/handlers/message')
    };
    core = require('../tickets/core');
  });

  afterEach(() => {
    jest.resetModules();
  });

  test('handler delegates to core', async () => {
    const interaction = {};
    await expect(handlers.interaction.handleInteraction(interaction)).resolves.toBe('handled');
    expect(core.handleInteraction).toHaveBeenCalledWith(interaction);
  });

  test('message handler delegates to core', async () => {
    const message = {};
    await handlers.message.handleMessageCreate(message);
    expect(core.handleMessageCreate).toHaveBeenCalledWith(message);
  });
});
