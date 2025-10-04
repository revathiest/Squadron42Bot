const mockPut = jest.fn().mockResolvedValue(undefined);
const mockApplicationCommands = jest.fn(id => `application/${id}`);
const mockApplicationGuildCommands = jest.fn((appId, guildId) => `guild/${appId}/${guildId}`);

jest.mock('discord.js', () => ({
  REST: class {
    constructor() {
      this.put = mockPut;
    }
    setToken() {
      return this;
    }
  },
  Routes: {
    applicationCommands: mockApplicationCommands,
    applicationGuildCommands: mockApplicationGuildCommands
  }
}));

const { collectCommands, registerAllCommands } = require('../commandManager');

describe('commandManager', () => {
  beforeEach(() => {
    mockPut.mockClear();
    mockApplicationCommands.mockClear();
    mockApplicationGuildCommands.mockClear();
    delete process.env.APPLICATION_ID;
    delete process.env.GUILD_ID;
  });

  afterAll(() => {
    delete process.env.APPLICATION_ID;
    delete process.env.GUILD_ID;
  });

  test('collectCommands merges global and guild arrays', () => {
    const modules = [
      { getSlashCommandDefinitions: () => ({ global: [1], guild: [2] }) },
      { getSlashCommandDefinitions: () => ({ global: [3], guild: [] }) },
      { getSlashCommandDefinitions: () => null },
      {}
    ];

    const result = collectCommands(modules);
    expect(result.global).toEqual([1, 3]);
    expect(result.guild).toEqual([2]);
  });

  test('registerAllCommands warns when APPLICATION_ID is missing', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await registerAllCommands('token', []);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('APPLICATION_ID'));
    expect(mockPut).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  test('registerAllCommands warns when token missing', async () => {
    process.env.APPLICATION_ID = 'app';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await registerAllCommands('', []);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Missing bot token'));
    expect(mockPut).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  test('registerAllCommands clears and registers commands for both scopes', async () => {
    process.env.APPLICATION_ID = 'app';
    process.env.GUILD_ID = 'guild';
    const modules = [
      { getSlashCommandDefinitions: () => ({ global: [{ name: 'g' }], guild: [{ name: 'l' }] }) }
    ];

    const infoSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await registerAllCommands('token', modules);

    expect(mockApplicationCommands).toHaveBeenCalledWith('app');
    expect(mockApplicationGuildCommands).toHaveBeenCalledWith('app', 'guild');
    expect(mockPut).toHaveBeenCalledTimes(4);
    expect(mockPut).toHaveBeenNthCalledWith(1, 'application/app', { body: [] });
    expect(mockPut).toHaveBeenNthCalledWith(2, 'guild/app/guild', { body: [] });
    expect(mockPut).toHaveBeenNthCalledWith(3, 'application/app', { body: [{ name: 'g' }] });
    expect(mockPut).toHaveBeenNthCalledWith(4, 'guild/app/guild', { body: [{ name: 'l' }] });

    infoSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test('guild commands trigger warning when guild id missing', async () => {
    process.env.APPLICATION_ID = 'app';
    const modules = [
      { getSlashCommandDefinitions: () => ({ global: [], guild: [{ name: 'onlyGuild' }] }) }
    ];

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await registerAllCommands('token', modules);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('GUILD_ID is missing'));
    warnSpy.mockRestore();
  });
});
