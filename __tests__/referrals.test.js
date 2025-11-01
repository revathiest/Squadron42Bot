const { MessageFlags } = require('discord.js');

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
const referrals = require('../referrals');
const registerHandler = require('../referrals/handlers/registerReferral');
const getHandler = require('../referrals/handlers/getReferral');

beforeEach(() => {
  database.__pool.query.mockReset();
  database.__pool.query.mockResolvedValue([[]]);
});

describe('referrals module interface', () => {
  test('initialize creates required tables', async () => {
    database.__pool.query.mockResolvedValue([[]]);

    await referrals.initialize();

    expect(database.__pool.query).toHaveBeenCalledTimes(2);
    expect(database.__pool.query.mock.calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS referral_codes');
    expect(database.__pool.query.mock.calls[1][0]).toContain('CREATE TABLE IF NOT EXISTS provided_codes');
  });

  test('getSlashCommandDefinitions exposes global commands', () => {
    const defs = referrals.getSlashCommandDefinitions();
    expect(defs.global.map(cmd => cmd.name)).toEqual([
      'register-referral-code',
      'get-referral-code'
    ]);
    expect(defs.guild).toEqual([]);
  });

  test('handleInteraction executes register command via handler', async () => {
    database.__pool.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{}]);

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'register-referral-code',
      user: { id: 'user-route' },
      options: { getString: jest.fn(() => 'STAR-HNDS-0001') },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await expect(referrals.handleInteraction(interaction)).resolves.toBe(true);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
  });

  test('handleInteraction executes get command via handler', async () => {
    database.__pool.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ code: 'STAR-HNDS-0002' }]])
      .mockResolvedValueOnce([{}]);

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'get-referral-code',
      user: { id: 'user-route' },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await expect(referrals.handleInteraction(interaction)).resolves.toBe(true);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
  });

  test('handleInteraction returns false for unrelated commands', async () => {
    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'other',
      user: { id: 'user-route' }
    };

    await expect(referrals.handleInteraction(interaction)).resolves.toBe(false);
  });
});

describe('register referral handler', () => {
  test('rejects invalid code format', async () => {
    const interaction = {
      user: { id: 'user-1' },
      options: { getString: jest.fn(() => 'invalid') },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await expect(registerHandler.handleRegisterReferral(interaction)).resolves.toBe(true);

    expect(database.__pool.query).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'That code does not match the required format (STAR-XXXX-XXXX).',
      flags: MessageFlags.Ephemeral
    });
  });

  test('rejects duplicate code for different user', async () => {
    database.__pool.query
      .mockResolvedValueOnce([[{ user_id: 'other-user' }]]);

    const interaction = {
      user: { id: 'user-2' },
      options: { getString: jest.fn(() => 'STAR-1234-5678') },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await expect(registerHandler.handleRegisterReferral(interaction)).resolves.toBe(true);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'That referral code is already registered by another user.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('stores valid referral code and responds with embed', async () => {
    database.__pool.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{}]);

    const interaction = {
      user: { id: 'user-3' },
      options: { getString: jest.fn(() => 'STAR-ABCD-EFGH') },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await expect(registerHandler.handleRegisterReferral(interaction)).resolves.toBe(true);

    expect(database.__pool.query).toHaveBeenCalledTimes(2);
    const replyPayload = interaction.reply.mock.calls[0][0];
    expect(replyPayload.flags).toBe(MessageFlags.Ephemeral);
    expect(replyPayload.embeds[0].data.title).toBe('Referral Code Registered');
    expect(replyPayload.embeds[0].data.description).toContain('STAR-ABCD-EFGH');
  });
});

describe('get referral handler', () => {
  const originalRandom = Math.random;

  afterEach(() => {
    Math.random = originalRandom;
  });

  test('prevents users with existing code from claiming new one', async () => {
    database.__pool.query.mockResolvedValueOnce([[{ code: 'STAR-AAAA-BBBB' }]]);

    const interaction = {
      user: { id: 'user-with-code' },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await expect(getHandler.handleGetReferral(interaction)).resolves.toBe(true);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'You already have a referral code registered; you cannot claim another one.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('responds when no codes are available', async () => {
    database.__pool.query
      .mockResolvedValueOnce([[]]) // existing check
      .mockResolvedValueOnce([[]]) // unclaimed codes
      .mockResolvedValueOnce([[]]) // truncate result
      .mockResolvedValueOnce([[]]); // all codes still empty

    const interaction = {
      user: { id: 'user-empty' },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await expect(getHandler.handleGetReferral(interaction)).resolves.toBe(true);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'No referral codes are available right now. Try again later.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('hands out random code and records usage', async () => {
    Math.random = jest.fn(() => 0);

    database.__pool.query
      .mockResolvedValueOnce([[]]) // existing check
      .mockResolvedValueOnce([[{ code: 'STAR-RAND-CODE' }]]) // unclaimed
      .mockResolvedValueOnce([{}]); // insert provided

    const interaction = {
      user: { id: 'user-need-code' },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await expect(getHandler.handleGetReferral(interaction)).resolves.toBe(true);

    expect(database.__pool.query).toHaveBeenCalledTimes(3);
    const insertCall = database.__pool.query.mock.calls[2];
    expect(insertCall[0]).toContain('INSERT INTO provided_codes');
    expect(insertCall[1]).toEqual(['STAR-RAND-CODE']);

    const replyPayload = interaction.reply.mock.calls[0][0];
    expect(replyPayload.embeds[0].data.title).toBe("Here's Your Referral Code");
    expect(replyPayload.embeds[0].data.description).toContain('STAR-RAND-CODE');
  });

  test('reuses pool after provided codes reset', async () => {
    Math.random = jest.fn(() => 0.5);

    database.__pool.query
      .mockResolvedValueOnce([[]]) // existing check
      .mockResolvedValueOnce([[]]) // unclaimed
      .mockResolvedValueOnce([{}]) // truncate
      .mockResolvedValueOnce([[{ code: 'STAR-RESET-1234' }]]) // all codes
      .mockResolvedValueOnce([{}]); // insert provided

    const interaction = {
      user: { id: 'user-reset' },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await expect(getHandler.handleGetReferral(interaction)).resolves.toBe(true);

    expect(database.__pool.query).toHaveBeenCalledTimes(5);
    expect(database.__pool.query.mock.calls[2][0]).toContain('TRUNCATE TABLE provided_codes');
    const replyPayload = interaction.reply.mock.calls[0][0];
    expect(replyPayload.embeds[0].data.description).toContain('STAR-RESET-1234');
  });
});
