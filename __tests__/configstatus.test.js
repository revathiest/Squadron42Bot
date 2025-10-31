jest.mock('../database', () => {
  const pool = {
    query: jest.fn()
  };
  return {
    getPool: () => pool,
    __pool: pool
  };
});

const database = require('../database');
const configStatus = require('../configStatus');

describe('configstatus getSlashCommandDefinitions', () => {
  test('exposes guild scoped command', () => {
    const defs = configStatus.getSlashCommandDefinitions();
    expect(Array.isArray(defs.guild)).toBe(true);
    expect(defs.guild[0].name).toBe('config-status');
    expect(defs.global).toEqual([]);
  });
});

test('configStatus getModuleName returns identifier', () => {
  expect(configStatus.getModuleName()).toBe('configStatus');
});

describe('configstatus lifecycle wrappers', () => {
  test('initialize resolves even when no work is required', async () => {
    await expect(configStatus.initialize()).resolves.toBeUndefined();
  });

  test('onReady resolves without errors', async () => {
    await expect(configStatus.onReady()).resolves.toBeUndefined();
  });
});

describe('configstatus handleInteraction', () => {
  beforeEach(() => {
    database.__pool.query.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  test('returns false for non chat input interactions', async () => {
    const interaction = {
      isChatInputCommand: () => false
    };

    await expect(configStatus.handleInteraction(interaction)).resolves.toBe(false);
    expect(database.__pool.query).not.toHaveBeenCalled();
  });

  test('returns false for non-config command', async () => {
    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'other'
    };

    await expect(configStatus.handleInteraction(interaction)).resolves.toBe(false);
    expect(database.__pool.query).not.toHaveBeenCalled();
  });

  test('uses default copy when no configuration exists', async () => {
    database.__pool.query.mockResolvedValue([[]]);

    const interaction = {
      guild: { id: 'guild-none' },
      guildId: 'guild-none',
      isChatInputCommand: () => true,
      commandName: 'config-status',
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined)
    };

    await expect(configStatus.handleInteraction(interaction)).resolves.toBe(true);

    const [{ embeds }] = interaction.editReply.mock.calls[0];
    const ticketField = embeds[0].data.fields.find(field => field.name === 'Tickets');
    expect(ticketField?.value).toBe('No configuration found.');
    const spectrumField = embeds[0].data.fields.find(field => field.name === 'Spectrum Patch Bot');
    expect(spectrumField?.value).toBe('No Spectrum configuration found.');
    const tempField = embeds[0].data.fields.find(field => field.name === 'Temp Channels');
    expect(tempField?.value).toBe('No temporary channel templates configured.');
    const promoField = embeds[0].data.fields.find(field => field.name === 'Org Promotion Forums');
    expect(promoField?.value).toBe('No promotion forums configured. Use `/mod org-promos add` to register a forum.');
  });

  test('builds configuration summary embed', async () => {
    database.__pool.query
      .mockResolvedValueOnce([[{ channel_id: 'ticket-chan', archive_category_id: 'archive-cat' }]])
      .mockResolvedValueOnce([[{ role_id: 'role-a' }, { role_id: 'role-b' }]])
      .mockResolvedValueOnce([[{ role_id: 'role-mod-1', action: 'warn' }, { role_id: 'role-mod-2', action: 'ban' }]])
      .mockResolvedValueOnce([[{ channel_id: 'forum-123' }, { channel_id: 'forum-456' }]])
      .mockResolvedValueOnce([[{ count: 4 }]])
      .mockResolvedValueOnce([[{ count: 1 }]])
      .mockResolvedValueOnce([[{ trap_role_id: 'trap-role' }]])
      .mockResolvedValueOnce([[{ announce_channel_id: 'announce-chan', forum_id: 'forum-42' }]])
      .mockResolvedValueOnce([[{ template_channel_id: 'template-1' }, { template_channel_id: 'template-2' }]]);

    const interaction = {
      guild: { id: 'guild-1' },
      guildId: 'guild-1',
      isChatInputCommand: () => true,
      commandName: 'config-status',
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined)
    };

    await expect(configStatus.handleInteraction(interaction)).resolves.toBe(true);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    const [{ embeds }] = interaction.editReply.mock.calls[0];
    expect(embeds[0].data.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Tickets' }),
        expect.objectContaining({ name: 'Moderation Roles' }),
        expect.objectContaining({ name: 'Org Promotion Forums' }),
        expect.objectContaining({ name: 'Referral Codes' }),
        expect.objectContaining({ name: 'Honey Trap' }),
        expect.objectContaining({ name: 'Spectrum Patch Bot' }),
        expect.objectContaining({ name: 'Temp Channels' })
      ])
    );
  });

  test('adds error field when queries fail', async () => {
    database.__pool.query.mockRejectedValue(new Error('db down'));

    const interaction = {
      guild: { id: 'guild-err' },
      guildId: 'guild-err',
      isChatInputCommand: () => true,
      commandName: 'config-status',
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined)
    };

    await expect(configStatus.handleInteraction(interaction)).resolves.toBe(true);

    const [{ embeds }] = interaction.editReply.mock.calls[0];
    const errorField = embeds[0].data.fields.find(field => field.name === 'Error');
    expect(errorField).toBeDefined();
    expect(console.error).toHaveBeenCalled();
  });
});
