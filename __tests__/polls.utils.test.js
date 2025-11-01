const { Collection, PermissionFlagsBits } = require('discord.js');

jest.mock('../database', () => {
  const pool = {
    query: jest.fn()
  };
  return {
    getPool: () => pool,
    __pool: pool
  };
});

jest.mock('../polls/schema', () => ({
  ensureSchema: jest.fn().mockResolvedValue(undefined)
}));

const database = require('../database');
const utils = require('../polls/utils');

describe('polls utils role allow list', () => {
  beforeEach(() => {
    database.__pool.query.mockReset();
    utils.clearRoleCache();
  });

  test('allowRoleForGuild inserts and caches', async () => {
    database.__pool.query.mockResolvedValueOnce([[]]); // ensureSchema
    database.__pool.query.mockResolvedValueOnce([{}]); // insert

    const added = await utils.allowRoleForGuild('guild-1', 'role-1', 'user-1');
    expect(added).toBe(true);
    expect(utils.listAllowedRoles('guild-1')).toEqual(['role-1']);
  });

  test('hasConfiguredPollRoles reports allow list presence', async () => {
    expect(utils.hasConfiguredPollRoles('guild-empty')).toBe(false);
    database.__pool.query.mockResolvedValueOnce([[]]);
    database.__pool.query.mockResolvedValueOnce([{}]);
    await utils.allowRoleForGuild('guild-allow', 'role-allow', 'user');
    expect(utils.hasConfiguredPollRoles('guild-allow')).toBe(true);
  });

  test('removeRoleForGuild clears cache', async () => {
    database.__pool.query
      .mockResolvedValueOnce([{}]) // insert
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // delete

    await utils.allowRoleForGuild('guild-2', 'role-2', 'user-2');
    const removed = await utils.removeRoleForGuild('guild-2', 'role-2');
    expect(removed).toBe(true);
    expect(utils.listAllowedRoles('guild-2')).toEqual([]);
  });

  test('canMemberCreatePoll returns false when no roles configured', () => {
    const member = {
      guild: { id: 'guild-3' },
      permissions: {
        has: perm => perm === PermissionFlagsBits.ManageGuild
      }
    };
    expect(utils.canMemberCreatePoll(member)).toBe(false);
  });

  test('canMemberCreatePoll uses allow list', async () => {
    database.__pool.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{}]);
    await utils.allowRoleForGuild('guild-4', 'role-allow', 'user');

    const member = {
      guild: { id: 'guild-4' },
      roles: { cache: new Collection([['role-allow', { id: 'role-allow' }]]) }
    };
    expect(utils.canMemberCreatePoll(member)).toBe(true);
  });

  test('canMemberClosePoll allows poll owner even without permissions', () => {
    const member = {
      id: 'owner-1',
      guild: { id: 'guild-5' },
      permissions: { has: () => false }
    };
    expect(utils.canMemberClosePoll(member, { owner_id: 'owner-1' })).toBe(true);
  });

  test('canMemberClosePoll grants allow-list members access', async () => {
    database.__pool.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{}]);
    await utils.allowRoleForGuild('guild-6', 'role-close', 'admin');

    const member = {
      id: 'user-close',
      guild: { id: 'guild-6' },
      roles: { cache: new Collection([['role-close', { id: 'role-close' }]]) }
    };

    expect(utils.canMemberClosePoll(member, { owner_id: 'other-user' })).toBe(true);
  });
});

describe('polls utils expiration parsing', () => {
  test('parses duration strings', () => {
    const now = new Date('2025-01-01T00:00:00Z');
    const expiry = utils.parseExpirationInput('1h 30m', now);
    expect(expiry.getTime()).toBe(now.getTime() + (90 * 60 * 1000));
  });

  test('parses ISO timestamp', () => {
    const expiry = utils.parseExpirationInput('2025-01-01T12:00:00Z');
    expect(expiry).toBeInstanceOf(Date);
    expect(expiry.toISOString()).toBe('2025-01-01T12:00:00.000Z');
  });

  test('validateExpiration enforces limits', () => {
    const now = new Date('2025-01-01T00:00:00Z');
    const short = new Date(now.getTime() + 30 * 1000);
    const long = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

    expect(utils.validateExpiration(short, now).ok).toBe(false);
    expect(utils.validateExpiration(long, now).ok).toBe(false);

    const ok = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    expect(utils.validateExpiration(ok, now)).toEqual({ ok: true, value: ok });
  });
});
