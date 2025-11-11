
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

  test('skips modules whose definitions are not objects', () => {
    const modules = [
      {
        getSlashCommandDefinitions: () => null
      },
      {
        getSlashCommandDefinitions: () => ({
          global: [{ name: 'valid' }]
        })
      }
    ];

    const result = collectCommands(modules);
    expect(result.global).toHaveLength(1);
  });
});

describe('commandManager registerAllCommands', () => {
  let putMock;
  let setTokenMock;
  let originalWarn;
  let originalError;
  let originalLog;

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

    originalWarn = console.warn;
    originalError = console.error;
    originalLog = console.log;
    console.warn = jest.fn();
    console.error = jest.fn();
    console.log = jest.fn();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  afterEach(() => {
    console.warn = originalWarn;
    console.error = originalError;
    console.log = originalLog;
  });

  test('warns when APPLICATION_ID is missing', async () => {
    await registerAllCommands('token-123', []);

    expect(console.warn).toHaveBeenCalledWith('commandManager: APPLICATION_ID is not set; skipping slash command registration.');
    expect(REST).not.toHaveBeenCalled();
  });

  test('warns when token is missing', async () => {
    process.env.APPLICATION_ID = 'app-1';
    await registerAllCommands(undefined, []);

    expect(console.warn).toHaveBeenCalledWith('commandManager: Missing bot token; cannot register slash commands.');
    expect(REST).not.toHaveBeenCalled();
  });

  test('registers global and guild commands when configuration present', async () => {
    process.env.APPLICATION_ID = 'app-9';
    process.env.CLEAR_GUILD_COMMANDS = 'true';
    process.env.FORCE_REREGISTER = 'true';

    const modules = [
      {
        getSlashCommandDefinitions: () => ({
          global: [{ name: 'global-one' }],
          guild: [{ name: 'guild-one' }]
        })
      }
    ];

    await registerAllCommands('token-xyz', modules, ['guild-7']);

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

  test('logs when guild commands exist without connected guilds', async () => {
    process.env.APPLICATION_ID = 'app-1';
    process.env.CLEAR_GUILD_COMMANDS = 'true';
    process.env.FORCE_REREGISTER = 'true';

    const modules = [
      {
        getSlashCommandDefinitions: () => ({ guild: [{ name: 'guild-only' }] })
      }
    ];

    await registerAllCommands('token-abc', modules, []);

    expect(console.log).toHaveBeenCalledWith('commandManager: Guild command definitions present but no connected guilds were supplied.');
    expect(console.log).toHaveBeenCalledWith('commandManager: CLEAR_GUILD_COMMANDS requested but no connected guilds were provided; skipping guild clears.');
    expect(console.log).toHaveBeenCalledWith('commandManager: Skipping guild command registration; no connected guilds available.');
    expect(putMock).toHaveBeenCalledTimes(1);
    expect(putMock.mock.calls[0]).toEqual(['app:app-1', { body: [] }]);
  });

  test('logs when guild command set is empty', async () => {
    process.env.APPLICATION_ID = 'app-empty';
    process.env.CLEAR_GUILD_COMMANDS = 'true';
    process.env.FORCE_REREGISTER = 'true';

    const modules = [
      {
        getSlashCommandDefinitions: () => ({ global: [{ name: 'one' }] })
      }
    ];

    await registerAllCommands('token-empty', modules, ['guild-empty']);

    expect(console.log).toHaveBeenCalledWith('commandManager: No guild commands to register.');
  });

  test('skips guild registration when forced rereregister disabled', async () => {
    process.env.APPLICATION_ID = 'app-skip';
    process.env.CLEAR_GUILD_COMMANDS = 'true';
    process.env.FORCE_REREGISTER = 'false';

    const modules = [
      {
        getSlashCommandDefinitions: () => ({ guild: [{ name: 'guild-cmd' }] })
      }
    ];

    await registerAllCommands('token-skip', modules, ['guild-ab']);

    expect(console.log).toHaveBeenCalledWith('commandManager: Guild commands not registered.  Forced reregister disabled.');
  });

  test('logs errors when registering global commands fails', async () => {
    process.env.APPLICATION_ID = 'app-err';

    putMock
      .mockResolvedValueOnce(undefined) // clear global
      .mockRejectedValueOnce(new Error('registration failed'));

    const modules = [
      {
        getSlashCommandDefinitions: () => ({ global: [{ name: 'fail' }] })
      }
    ];

    await registerAllCommands('token-err', modules);

    expect(console.error).toHaveBeenCalledWith('commandManager: Failed to register global slash commands', expect.any(Error));
    expect(console.log).toHaveBeenCalledWith('commandManager: failed global commands => fail');
  });

  test('logs errors when clearing global commands fails', async () => {
    process.env.APPLICATION_ID = 'app-clear';

    putMock.mockRejectedValueOnce(new Error('clear failed'));
    await registerAllCommands('token-clear', []);

    expect(console.error).toHaveBeenCalledWith(
      'commandManager: Failed to clear global slash commands',
      expect.any(Error)
    );
  });

  test('skips guild clearing when disabled via env flag', async () => {
    process.env.APPLICATION_ID = 'app-skip';
    process.env.CLEAR_GUILD_COMMANDS = 'false';

    await registerAllCommands('token-skip', [], ['guild-skip']);

    expect(console.log).toHaveBeenCalledWith('commandManager: Guild-specific commands not deleted. Forced command clearing disabled.');
    expect(putMock).toHaveBeenCalledTimes(1); // only global clear

  });

  test('skips guild registration when FORCE_REREGISTER is false', async () => {
    process.env.APPLICATION_ID = 'app-skip-reg';
    process.env.FORCE_REREGISTER = 'false';
    process.env.CLEAR_GUILD_COMMANDS = 'true';

    const modules = [
      {
        getSlashCommandDefinitions: () => ({
          guild: [{ name: 'guild-command' }]
        })
      }
    ];

    await registerAllCommands('token-skip-reg', modules, ['guild-skip-reg']);

    expect(console.log).toHaveBeenCalledWith('commandManager: Guild commands not registered.  Forced reregister disabled.');
    const guildCalls = putMock.mock.calls.filter(call => call[0].startsWith('guild:'));
    expect(guildCalls).toHaveLength(1);
    expect(guildCalls[0][1]).toEqual({ body: [] });
  });
});




