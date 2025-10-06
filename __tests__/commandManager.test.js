
jest.mock('discord.js', () => {
  const actual = jest.requireActual('discord.js');
  return {
    ...actual,
    REST: jest.fn(),
    Routes: {
      applicationCommands: jest.fn(),
      applicationGuildCommands: jest.fn()
    }
  };
});

const { REST, Routes } = require('discord.js');
const { collectCommands, registerAllCommands } = require('../commandManager');

const originalEnv = { ...process.env };

describe('commandManager collectCommands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('aggregates global and guild definitions', () => {
    const modules = [
      {
        getSlashCommandDefinitions: () => ({
          global: [{ name: 'alpha' }],
          guild: [{ name: 'beta' }]
        })
      },
      {
        getSlashCommandDefinitions: () => ({
          global: [{ name: 'gamma' }]
        })
      },
      null
    ];

    const result = collectCommands(modules);
    expect(result.global).toHaveLength(2);
    expect(result.guild).toHaveLength(1);
    expect(result.global.map(cmd => cmd.name)).toEqual(['alpha', 'gamma']);
    expect(result.guild[0].name).toBe('beta');
  });

  test('skips modules whose definitions throw', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const modules = [
      {
        getSlashCommandDefinitions: () => {
          throw new Error('boom');
        }
      },
      {
        getSlashCommandDefinitions: () => ({ guild: [{ name: 'ok' }] })
      }
    ];

    const result = collectCommands(modules);
    expect(result.guild).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('commandManager registerAllCommands', () => {
  let putMock;
  let setTokenMock;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.APPLICATION_ID;
    delete process.env.GUILD_ID;

    putMock = jest.fn().mockResolvedValue(undefined);
    setTokenMock = jest.fn().mockReturnValue({ put: putMock });
    REST.mockReturnValue({ setToken: setTokenMock });
    Routes.applicationCommands.mockImplementation(appId => `app:${appId}`);
    Routes.applicationGuildCommands.mockImplementation((appId, guildId) => `guild:${appId}:${guildId}`);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('warns when APPLICATION_ID is missing', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await registerAllCommands('token-123', []);

    expect(warnSpy).toHaveBeenCalledWith('commandManager: APPLICATION_ID is not set; skipping slash command registration.');
    expect(REST).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  test('warns when token is missing', async () => {
    process.env.APPLICATION_ID = 'app-1';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await registerAllCommands(undefined, []);

    expect(warnSpy).toHaveBeenCalledWith('commandManager: Missing bot token; cannot register slash commands.');
    expect(REST).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  test('registers global and guild commands when configuration present', async () => {
    process.env.APPLICATION_ID = 'app-9';
    process.env.GUILD_ID = 'guild-7';

    const modules = [
      {
        getSlashCommandDefinitions: () => ({
          global: [{ name: 'global-one' }],
          guild: [{ name: 'guild-one' }]
        })
      }
    ];

    await registerAllCommands('token-xyz', modules);

    expect(REST).toHaveBeenCalledWith({ version: '10' });
    expect(setTokenMock).toHaveBeenCalledWith('token-xyz');

    expect(Routes.applicationCommands).toHaveBeenCalledWith('app-9');
    expect(Routes.applicationGuildCommands).toHaveBeenCalledWith('app-9', 'guild-7');

    expect(putMock).toHaveBeenCalledTimes(4);
    expect(putMock.mock.calls[0]).toEqual(['app:app-9', { body: [] }]);
    expect(putMock.mock.calls[1]).toEqual(['guild:app-9:guild-7', { body: [] }]);
    expect(putMock.mock.calls[2]).toEqual(['app:app-9', { body: [{ name: 'global-one' }] }]);
    expect(putMock.mock.calls[3]).toEqual(['guild:app-9:guild-7', { body: [{ name: 'guild-one' }] }]);
  });

  test('warns when guild commands exist without GUILD_ID', async () => {
    process.env.APPLICATION_ID = 'app-1';

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const modules = [
      {
        getSlashCommandDefinitions: () => ({ guild: [{ name: 'guild-only' }] })
      }
    ];

    await registerAllCommands('token-abc', modules);

    expect(warnSpy).toHaveBeenCalledWith('commandManager: Guild-specific commands defined but GUILD_ID is missing; they will not be registered.');
    expect(putMock).toHaveBeenCalledTimes(1);
    expect(putMock.mock.calls[0]).toEqual(['app:app-1', { body: [] }]);

    warnSpy.mockRestore();
  });

  test('logs errors when registering global commands fails', async () => {
    process.env.APPLICATION_ID = 'app-err';

    putMock
      .mockResolvedValueOnce(undefined) // clear global
      .mockRejectedValueOnce(new Error('registration failed'));

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const modules = [
      {
        getSlashCommandDefinitions: () => ({ global: [{ name: 'fail' }] })
      }
    ];

    await registerAllCommands('token-err', modules);

    expect(errorSpy).toHaveBeenCalledWith('commandManager: Failed to register global slash commands', expect.any(Error));
    expect(logSpy).toHaveBeenCalledWith('commandManager: failed global commands => fail');

    errorSpy.mockRestore();
    logSpy.mockRestore();
  });
});




