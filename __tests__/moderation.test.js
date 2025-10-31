jest.mock(require('path').resolve(__dirname, '..', 'database'), () => {
  const query = jest.fn().mockResolvedValue([[]]);
  const pool = { query };
  return {
    getPool: jest.fn(() => pool),
    testConnection: jest.fn(),
    __pool: pool
  };
});

jest.mock('../moderation/handlers/orgLinks', () => ({
  handleMessageCreate: jest.fn().mockResolvedValue(undefined),
  loadOrgForumCache: jest.fn().mockResolvedValue(undefined)
}));

const path = require('path');
const { ApplicationCommandType, ApplicationCommandOptionType, MessageFlags, PermissionFlagsBits, Events } = require('discord.js');

const database = require(path.resolve(__dirname, '..', 'database'));
const moderation = require('../moderation');
const autoBanTrap = require('../moderation/autoBanTrap');
const actionHandlers = require('../moderation/handlers/actions');
const orgLinkHandler = require('../moderation/handlers/orgLinks');

const flushPromises = () => new Promise(resolve => setImmediate(resolve));

beforeEach(() => {
  moderation.__testables.resetInitialization();
});

const {
  ACTIONS,
  PARDON_COMMAND_NAME,
  PARDON_COMMAND_DESCRIPTION,
  roleCache,
  addRoleToCache,
  removeRoleFromCache,
  memberHasRole,
  hasActionPermission,
  hasHistoryPermission,
  filterEntriesForModerators,
  buildHistoryLines,
  buildHistoryContent,
  fetchHistoryRows,
  parseReferenceInput,
  handleActionRequest,
  handleModCommand,
  handleInteraction,
  handleHistoryContext,
  handlePardonCommand,
  handleModal,
  resolveTimeoutChoice,
  fetchReferenceMessage,
  handleTrapConfigCommand,
  handleAutoBanRoleUpdate,
  fetchTrapRoleId,
  isTrapRoleNewlyAssigned,
  buildSyntheticTrapInteraction
} = moderation.__testables;

const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
beforeAll(() => {
  console.error = jest.fn();
  console.warn = jest.fn();
});

afterAll(() => {
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
});

describe('memberHasRole', () => {
  test('returns false when member missing', () => {
    expect(memberHasRole(null, 'role')).toBe(false);
    expect(memberHasRole({ roles: null }, 'role')).toBe(false);
  });

  test('uses cache.has when available', () => {
    const member = {
      roles: {
        cache: {
          has: jest.fn(value => value === 'role-has')
        }
      }
    };

    expect(memberHasRole(member, 'role-has')).toBe(true);
    expect(member.roles.cache.has).toHaveBeenCalledWith('role-has');
  });

  test('uses cache.some when available', () => {
    const member = {
      roles: {
        cache: {
          some: jest.fn(fn => fn({ id: 'role-some' }))
        }
      }
    };

    expect(memberHasRole(member, 'role-some')).toBe(true);
    expect(member.roles.cache.some).toHaveBeenCalled();
  });

  test('supports array caches', () => {
    const member = {
      roles: { cache: [{ id: 'role-array' }] }
    };

    expect(memberHasRole(member, 'role-array')).toBe(true);
  });

  test('returns false when role not present', () => {
    const member = {
      roles: { cache: [{ id: 'role-a' }] }
    };

    expect(memberHasRole(member, 'role-b')).toBe(false);
  });

  test('returns false for unsupported cache shape', () => {
    const member = {
      roles: { cache: { entries: [] } }
    };

    expect(memberHasRole(member, 'role-any')).toBe(false);
  });
});

describe('moderation command definitions', () => {
  test('exposes commands for moderators', () => {
    const defs = moderation.getSlashCommandDefinitions();
    expect(defs.guild).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: ACTIONS.warn.label, type: 2 }),
      expect.objectContaining({ name: ACTIONS.kick.label, type: 2 }),
      expect.objectContaining({ name: ACTIONS.ban.label, type: 2 }),
      expect.objectContaining({ name: ACTIONS.timeout.label, type: 2 }),
      expect.objectContaining({ name: PARDON_COMMAND_NAME }),
      expect.objectContaining({ name: 'View Moderation History', type: 2 })
    ]));

    const slash = defs.guild.find(def => def.name === 'mod');
    expect(slash).toBeDefined();
    expect(slash.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'roles' }),
      expect.objectContaining({ name: 'auto-ban' })
    ]));

    const warnDef = defs.guild.find(def => def.name === ACTIONS.warn.label);
    expect(warnDef.default_member_permissions).toBeUndefined();

    const kickDef = defs.guild.find(def => def.name === ACTIONS.kick.label);
    expect(kickDef.default_member_permissions).toBeUndefined();

    const banDef = defs.guild.find(def => def.name === ACTIONS.ban.label);
    expect(banDef.default_member_permissions).toBeUndefined();

    const pardonDef = defs.guild.find(def => def.name === PARDON_COMMAND_NAME);
    expect(pardonDef).toBeDefined();
    expect(pardonDef.description).toBe(PARDON_COMMAND_DESCRIPTION);
    expect(pardonDef.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'user', type: ApplicationCommandOptionType.User })
    ]));

    const historyDef = defs.guild.find(def => def.name === 'View Moderation History');
    expect(historyDef.default_member_permissions).toBeUndefined();
  });
});

describe('hasHistoryPermission', () => {
  beforeEach(() => {
    roleCache.clear();
  });

  test('allows administrators by default', () => {
    const member = {
      permissions: { has: perm => perm === PermissionFlagsBits.Administrator }
    };
    expect(hasHistoryPermission('guild-admin', member)).toBe(true);
  });

  test('falls back to action permissions when roles configured', () => {
    addRoleToCache('guild-history', 'warn', 'role-mod');
    const member = {
      roles: { cache: { has: roleId => roleId === 'role-mod' } },
      permissions: { has: () => false }
    };
    expect(hasHistoryPermission('guild-history', member)).toBe(true);
  });

  test('denies users without permissions or roles', () => {
    const member = {
      permissions: { has: () => false }
    };
    expect(hasHistoryPermission('guild-none', member)).toBe(false);
  });

  test('denies access when member context is missing', () => {
    expect(hasHistoryPermission('guild-missing', null)).toBe(false);
  });
});

describe('filterEntriesForModerators', () => {
  test('returns empty array for invalid inputs', () => {
    expect(filterEntriesForModerators(null)).toEqual([]);
    expect(filterEntriesForModerators([])).toEqual([]);
  });

  test('returns non-pardon entries when no pardon recorded', () => {
    const entries = [
      { action: 'warn', created_at: new Date('2024-01-05') },
      { action: 'kick', created_at: new Date('2024-01-03') }
    ];

    const filtered = filterEntriesForModerators(entries);
    expect(filtered).toHaveLength(2);
    expect(filtered.every(entry => entry.action !== 'pardon')).toBe(true);
  });

  test('removes entries before the latest pardon and the pardon itself', () => {
    const entries = [
      { action: 'warn', created_at: new Date('2024-02-01') },
      { action: 'pardon', created_at: new Date('2024-01-15') },
      { action: 'kick', created_at: new Date('2024-01-10') },
      { action: 'ban', created_at: new Date('2023-12-30') }
    ];

    const filtered = filterEntriesForModerators(entries);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].action).toBe('warn');
  });

  test('ignores invalid pardon timestamps gracefully', () => {
    const entries = [
      { action: 'warn', created_at: new Date('2024-02-01') },
      { action: 'pardon', created_at: null },
      { action: 'ban', created_at: new Date('2024-01-10') }
    ];

    const filtered = filterEntriesForModerators(entries);
    expect(filtered).toHaveLength(2);
    expect(filtered.map(entry => entry.action)).toEqual(['warn', 'ban']);
  });
});

describe('buildHistoryLines', () => {
  test('formats entries and references within limits', () => {
    const { lines, truncated } = buildHistoryLines([{
      action: 'warn',
      reason: 'Spammed links in general chat',
      executor_tag: 'Mod#1000',
      reference_message_url: 'https://discord.com/channels/1/2/3',
      created_at: new Date(Date.UTC(2024, 0, 1, 12, 0, 0))
    }]);

    expect(truncated).toBe(false);
    expect(lines[0]).toContain('WARN');
    expect(lines[0]).toContain('Ref: https://discord.com/channels/1/2/3');
    expect(lines[0]).toContain('Mod#1000');
  });

  test('stops adding lines when message would exceed limits', () => {
    const entries = [];
    for (let i = 0; i < 200; i++) {
      entries.push({
        action: 'warn',
        reason: 'x'.repeat(200),
        executor_tag: `Mod#${i}`,
        created_at: new Date(Date.UTC(2024, 0, 1, 0, 0, i))
      });
    }

    const { lines, truncated } = buildHistoryLines(entries);
    expect(lines.length).toBeGreaterThan(0);
    expect(truncated).toBe(true);
  });

  test('handles missing reason and timestamp', () => {
    const { lines, truncated } = buildHistoryLines([{
      action: 'kick',
      reason: '   ',
      executor_id: 'mod-123',
      created_at: null
    }]);

    expect(truncated).toBe(false);
    expect(lines[0]).toContain('No reason provided.');
    expect(lines[0]).toContain('Unknown time');
    expect(lines[0]).toContain('mod-123');
  });
});

describe('buildHistoryContent', () => {
  test('appends truncation notice for long histories', () => {
    const rows = [];
    for (let i = 0; i < 200; i++) {
      rows.push({
        action: 'warn',
        reason: 'x'.repeat(200),
        executor_tag: `Mod#${i}`,
        reference_message_url: null,
        created_at: new Date(Date.UTC(2024, 0, 1, 0, 0, i))
      });
    }

    const result = buildHistoryContent({
      targetLabel: 'User#0001',
      rows,
      isAdministrator: false
    });

    expect(result.empty).toBe(false);
    expect(result.content).toContain('Moderation history for User#0001');
    expect(result.content).toContain('Additional records were omitted for length.');
  });

  test('returns empty message when no visible entries remain', () => {
    const rows = [];
    const result = buildHistoryContent({
      targetLabel: 'User#0002',
      rows,
      isAdministrator: false
    });

    expect(result.empty).toBe(true);
    expect(result.content).toBe('No moderation history for User#0002 since their last pardon.');
  });
});

describe('handleModal', () => {
  beforeEach(() => {
    roleCache.clear();
    database.__pool.query.mockReset();
    database.__pool.query.mockResolvedValue([[]]);
  });

  test('requires reason before proceeding', async () => {
    addRoleToCache('guild-modal', 'warn', 'role-warn');
    const interaction = {
      customId: 'moderation:warn:target-1',
      guildId: 'guild-modal',
      guild: {
        id: 'guild-modal',
        members: { fetch: jest.fn().mockResolvedValue({ id: 'target-1', roles: { highest: { comparePositionTo: () => -1 } } }) }
      },
      member: {
        roles: {
          cache: { has: roleId => roleId === 'role-warn' },
          highest: { comparePositionTo: () => 1 }
        },
        permissions: { has: () => true }
      },
      user: { id: 'mod-1' },
      fields: {
        getTextInputValue: jest.fn(key => '')
      },
      reply: jest.fn().mockResolvedValue(undefined),
      client: { users: { fetch: jest.fn() } }
    };

    await handleModal(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'A reason is required for this action.'
    }));
  });

  test('logs warning and notifies moderator', async () => {
    addRoleToCache('guild-modal', 'warn', 'role-warn');
    database.__pool.query.mockRejectedValueOnce(new Error('log failed'));
    const targetUser = { id: 'target-2', tag: 'Target#0002', send: jest.fn().mockResolvedValue(undefined) };
    const targetMember = {
      id: 'target-2',
      roles: {
        cache: { has: () => false },
        highest: { comparePositionTo: () => -1 }
      },
      user: targetUser
    };

    const interaction = {
      customId: 'moderation:warn:target-2',
      guildId: 'guild-modal',
      member: {
        roles: {
          cache: { has: roleId => roleId === 'role-warn' },
          highest: { comparePositionTo: () => 1 }
        },
        permissions: { has: () => true }
      },
      guild: {
        id: 'guild-modal',
        name: 'Galactic Hub',
        members: { fetch: jest.fn().mockResolvedValue(targetMember) },
        channels: { fetch: jest.fn() }
      },
      user: { id: 'mod-2', tag: 'Mod#0002' },
      fields: {
        getTextInputValue: jest.fn(key => (key === 'reason' ? 'Violation of rules' : ''))
      },
      reply: jest.fn().mockResolvedValue(undefined),
      client: {
        users: { fetch: jest.fn() }
      }
    };

    await handleModal(interaction);

    expect(targetUser.send).toHaveBeenCalledWith(expect.stringContaining('WARNING'));
    const insertCall = database.__pool.query.mock.calls.find(call => call[0].includes('INSERT INTO moderation_actions'));
    expect(insertCall).toBeDefined();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Logged a warning for Target#0002.'
    }));
  });

  test('requires valid timeout duration', async () => {
    addRoleToCache('guild-timeout-invalid', 'timeout', 'role-timeout');
    const targetUser = { id: 'target-timeout', tag: 'Timeout#0001' };
    const targetMember = {
      id: 'target-timeout',
      roles: {
        cache: { has: () => false },
        highest: { comparePositionTo: () => -1 }
      },
      user: targetUser
    };

    const interaction = {
      customId: 'moderation:timeout:target-timeout',
      guildId: 'guild-timeout-invalid',
      guild: {
        id: 'guild-timeout-invalid',
        members: {
          fetch: jest.fn().mockResolvedValue(targetMember)
        },
        channels: { fetch: jest.fn() }
      },
      member: {
        roles: {
          cache: { has: roleId => roleId === 'role-timeout' },
          highest: { comparePositionTo: () => 1 }
        },
        permissions: { has: () => true }
      },
      user: { id: 'mod-timeout', tag: 'ModTimeout#1' },
      fields: {
        getTextInputValue: jest.fn(key => {
          if (key === 'reason') return 'Timeout reason';
          if (key === 'duration') return 'invalid-duration';
          return '';
        })
      },
      reply: jest.fn().mockResolvedValue(undefined),
      client: {
        users: { fetch: jest.fn().mockResolvedValue(targetUser) }
      }
    };

    await handleModal(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Select a valid timeout duration')
    }));
  });

  test('kicks member when moderator confirms', async () => {
    addRoleToCache('guild-kick', 'kick', 'role-kick');
    const targetUser = { id: 'target-kick', tag: 'Kickee#0001', send: jest.fn().mockResolvedValue(undefined) };
    const targetMember = {
      id: 'target-kick',
      kick: jest.fn().mockResolvedValue(undefined),
      roles: {
        cache: { has: () => false },
        highest: { comparePositionTo: () => -1 }
      },
      user: targetUser
    };

    const interaction = {
      customId: 'moderation:kick:target-kick',
      guildId: 'guild-kick',
      guild: {
        id: 'guild-kick',
        name: 'Hangar',
        members: {
          fetch: jest.fn().mockResolvedValue(targetMember),
          me: { permissions: { has: perm => perm === PermissionFlagsBits.KickMembers } }
        },
        channels: { fetch: jest.fn() }
      },
      member: {
        roles: {
          cache: { has: roleId => roleId === 'role-kick' },
          highest: { comparePositionTo: () => 1 }
        },
        permissions: { has: () => true }
      },
      user: { id: 'mod-kick', tag: 'Moderator#9999' },
      fields: {
        getTextInputValue: jest.fn(key => (key === 'reason' ? 'Excessive spam' : ''))
      },
      reply: jest.fn().mockResolvedValue(undefined),
      client: {
        users: { fetch: jest.fn() }
      }
    };

    await handleModal(interaction);

    expect(targetMember.kick).toHaveBeenCalledWith('Excessive spam');
    const insertCall = database.__pool.query.mock.calls.find(call => call[0].includes('INSERT INTO moderation_actions'));
    expect(insertCall).toBeDefined();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Kicked Kickee#0001.'
    }));
  });

  test('bans member when moderator confirms', async () => {
    addRoleToCache('guild-ban', 'ban', 'role-ban');
    const targetUser = { id: 'target-ban', tag: 'Banned#0001', send: jest.fn().mockResolvedValue(undefined) };
    const targetMember = {
      id: 'target-ban',
      roles: {
        cache: { has: () => false },
        highest: { comparePositionTo: () => -1 }
      },
      user: targetUser
    };

    const guildMembers = {
      fetch: jest.fn().mockResolvedValue(targetMember),
      ban: jest.fn().mockResolvedValue(undefined),
      me: { permissions: { has: perm => perm === PermissionFlagsBits.BanMembers } }
    };

    const interaction = {
      customId: 'moderation:ban:target-ban',
      guildId: 'guild-ban',
      guild: {
        id: 'guild-ban',
        name: 'Command',
        members: guildMembers,
        channels: { fetch: jest.fn() }
      },
      member: {
        roles: {
          cache: { has: roleId => roleId === 'role-ban' },
          highest: { comparePositionTo: () => 1 }
        },
        permissions: { has: () => true }
      },
      user: { id: 'mod-ban', tag: 'Moderator#0003' },
      fields: {
        getTextInputValue: jest.fn(key => (key === 'reason' ? 'Severe abuse' : ''))
      },
      reply: jest.fn().mockResolvedValue(undefined),
      client: {
        users: { fetch: jest.fn() }
      }
    };

    await handleModal(interaction);

    expect(guildMembers.ban).toHaveBeenCalledWith('target-ban', { reason: 'Severe abuse' });
    expect(database.__pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO moderation_actions'), expect.any(Array));
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Banned Banned#0001.'
    }));
  });

  test('timeouts member when moderator selects duration', async () => {
    addRoleToCache('guild-timeout', 'timeout', 'role-timeout');
    const timeoutMock = jest.fn().mockResolvedValue(undefined);
    const targetUser = { id: 'target-timeout', tag: 'Timeout#0001', send: jest.fn().mockResolvedValue(undefined) };
    const targetMember = {
      id: 'target-timeout',
      timeout: timeoutMock,
      roles: {
        cache: { has: () => false },
        highest: { comparePositionTo: () => -1 }
      },
      user: targetUser
    };

    const membersManager = {
      fetch: jest.fn().mockResolvedValue(targetMember),
      me: { permissions: { has: perm => perm === PermissionFlagsBits.ModerateMembers } }
    };

    const interaction = {
      customId: 'moderation:timeout:target-timeout',
      guildId: 'guild-timeout',
      guild: {
        id: 'guild-timeout',
        name: 'Brig',
        members: membersManager,
        channels: { fetch: jest.fn() }
      },
      member: {
        roles: {
          cache: { has: roleId => roleId === 'role-timeout' },
          highest: { comparePositionTo: () => 1 }
        },
        permissions: { has: () => true }
      },
      user: { id: 'mod-timeout', tag: 'Moderator#042' },
      fields: {
        getTextInputValue: jest.fn(key => {
          if (key === 'reason') {
            return 'Cooling off period';
          }
          if (key === 'duration') {
            return '1h';
          }
          return '';
        })
      },
      reply: jest.fn().mockResolvedValue(undefined),
      client: {
        users: { fetch: jest.fn() }
      }
    };

    await handleModal(interaction);

    expect(timeoutMock).toHaveBeenCalledWith(60 * 60 * 1000, expect.stringContaining('Timeout: 1 hour'));
    const insertCall = database.__pool.query.mock.calls.find(call => call[0].includes('INSERT INTO moderation_actions'));
    expect(insertCall).toBeDefined();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Timed out Timeout#0001 for 1 hour.'
    }));
  });

  test('rejects timeout when duration is invalid', async () => {
    addRoleToCache('guild-timeout-invalid', 'timeout', 'role-timeout');
    const timeoutMock = jest.fn().mockResolvedValue(undefined);
    const targetMember = {
      id: 'target-timeout-invalid',
      timeout: timeoutMock,
      roles: {
        cache: { has: () => false },
        highest: { comparePositionTo: () => -1 }
      },
      user: { id: 'target-timeout-invalid', tag: 'Timeout#Bad', send: jest.fn().mockResolvedValue(undefined) }
    };

    const membersManager = {
      fetch: jest.fn().mockResolvedValue(targetMember),
      me: { permissions: { has: perm => perm === PermissionFlagsBits.ModerateMembers } }
    };

    const interaction = {
      customId: 'moderation:timeout:target-timeout-invalid',
      guildId: 'guild-timeout-invalid',
      guild: {
        id: 'guild-timeout-invalid',
        name: 'Brig',
        members: membersManager,
        channels: { fetch: jest.fn() }
      },
      member: {
        roles: {
          cache: { has: roleId => roleId === 'role-timeout' },
          highest: { comparePositionTo: () => 1 }
        },
        permissions: { has: () => true }
      },
      user: { id: 'mod-timeout-invalid', tag: 'Moderator#043' },
      fields: {
        getTextInputValue: jest.fn(key => {
          if (key === 'reason') {
            return 'Invalid duration supplied';
          }
          if (key === 'duration') {
            return '9h';
          }
          return '';
        })
      },
      reply: jest.fn().mockResolvedValue(undefined),
      client: {
        users: { fetch: jest.fn() }
      }
    };

    await handleModal(interaction);

    expect(timeoutMock).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Select a valid timeout duration: 10m, 1h, 12h, 24h, 3d, 7d.'
    }));
  });

  test('rejects modal when guild context is missing', async () => {
    addRoleToCache('guild-missing', 'warn', 'role-warn');
    const interaction = {
      customId: 'moderation:warn:target-missing',
      guildId: null,
      guild: null,
      member: { roles: { cache: { has: () => true } }, permissions: { has: () => true } },
      user: { id: 'mod-missing' },
      fields: {
        getTextInputValue: jest.fn(key => (key === 'reason' ? 'Reason text' : ''))
      },
      reply: jest.fn().mockResolvedValue(undefined),
      client: { users: { fetch: jest.fn() } }
    };

    await handleModal(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'This moderation action must be used inside a guild.'
    }));
  });

  test('rejects when guild member cannot be determined', async () => {
    addRoleToCache('guild-member', 'warn', 'role-warn');
    const interaction = {
      customId: 'moderation:warn:target-member',
      guildId: 'guild-member',
      guild: {
        id: 'guild-member',
        ownerId: 'owner-other',
        members: { fetch: jest.fn().mockRejectedValue(new Error('not found')) }
      },
      member: null,
      user: { id: 'mod-member' },
      fields: {
        getTextInputValue: jest.fn(key => (key === 'reason' ? 'Reason text' : ''))
      },
      reply: jest.fn().mockResolvedValue(undefined),
      client: { users: { fetch: jest.fn() } }
    };

    await handleModal(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Could not resolve your guild membership for permission checks.'
    }));
  });

  test('rejects when moderator lacks permission', async () => {
    roleCache.clear();
    const interaction = {
      customId: 'moderation:warn:target-perm',
      guildId: 'guild-perm',
      guild: {
        id: 'guild-perm',
        ownerId: 'owner-other',
        members: { fetch: jest.fn() }
      },
      member: {
        roles: { cache: { has: () => false } },
        permissions: { has: () => false }
      },
      user: { id: 'mod-perm' },
      fields: {
        getTextInputValue: jest.fn(key => (key === 'reason' ? 'Reason text' : ''))
      },
      reply: jest.fn().mockResolvedValue(undefined),
      client: { users: { fetch: jest.fn() } }
    };

    await handleModal(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'You are not allowed to use this moderation action.'
    }));
  });

  test('rejects when target is the moderator', async () => {
    addRoleToCache('guild-self', 'warn', 'role-warn');
    const targetMember = {
      id: 'mod-self',
      roles: { highest: { comparePositionTo: () => -1 } },
      user: { id: 'mod-self', tag: 'Mod#Self', send: jest.fn().mockResolvedValue(undefined) }
    };
    const interaction = {
      customId: 'moderation:warn:mod-self',
      guildId: 'guild-self',
      guild: {
        id: 'guild-self',
        ownerId: 'owner-other',
        members: { fetch: jest.fn().mockResolvedValue(targetMember) }
      },
      member: {
        roles: { cache: { has: () => true }, highest: { comparePositionTo: () => 1 } },
        permissions: { has: () => true }
      },
      user: { id: 'mod-self' },
      fields: {
        getTextInputValue: jest.fn(key => (key === 'reason' ? 'Reason text' : ''))
      },
      reply: jest.fn().mockResolvedValue(undefined),
      client: { users: { fetch: jest.fn() } }
    };

    await handleModal(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'You cannot perform moderation actions on yourself.'
    }));
  });

  test('rejects when target is the guild owner', async () => {
    addRoleToCache('guild-owner', 'warn', 'role-warn');
    const targetMember = {
      id: 'owner-1',
      roles: { highest: { comparePositionTo: () => -1 } },
      user: { id: 'owner-1', tag: 'Owner#0001', send: jest.fn().mockResolvedValue(undefined) }
    };
    const interaction = {
      customId: 'moderation:warn:owner-1',
      guildId: 'guild-owner',
      guild: {
        id: 'guild-owner',
        ownerId: 'owner-1',
        members: { fetch: jest.fn().mockResolvedValue(targetMember) }
      },
      member: {
        roles: { cache: { has: () => true }, highest: { comparePositionTo: () => 1 } },
        permissions: { has: () => true }
      },
      user: { id: 'mod-owner' },
      fields: {
        getTextInputValue: jest.fn(key => (key === 'reason' ? 'Reason text' : ''))
      },
      reply: jest.fn().mockResolvedValue(undefined),
      client: { users: { fetch: jest.fn() } }
    };

    await handleModal(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'You cannot moderate the guild owner.'
    }));
  });

  test('rejects when role hierarchy blocks moderation', async () => {
    addRoleToCache('guild-hierarchy', 'warn', 'role-warn');
    const targetMember = {
      id: 'target-hierarchy',
      roles: {
        cache: { has: () => false },
        highest: { comparePositionTo: () => 0 }
      },
      user: { id: 'target-hierarchy', tag: 'Target#Hier', send: jest.fn().mockResolvedValue(undefined) }
    };
    const interaction = {
      customId: 'moderation:warn:target-hierarchy',
      guildId: 'guild-hierarchy',
      guild: {
        id: 'guild-hierarchy',
        members: { fetch: jest.fn().mockResolvedValue(targetMember) }
      },
      member: {
        roles: {
          cache: { has: () => true },
          highest: { comparePositionTo: () => 0 }
        },
        permissions: { has: () => true }
      },
      user: { id: 'mod-hierarchy' },
      fields: {
        getTextInputValue: jest.fn(key => (key === 'reason' ? 'Reason text' : ''))
      },
      reply: jest.fn().mockResolvedValue(undefined),
      client: { users: { fetch: jest.fn() } }
    };

    await handleModal(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'This user has a higher or equal role. Adjust role hierarchy before attempting this action.'
    }));
  });

  test('warn resolves user via fetch when member missing', async () => {
    addRoleToCache('guild-fetch', 'warn', 'role-warn');
    const targetUser = { id: 'target-fetch', tag: 'Target#Fetch', send: jest.fn().mockRejectedValue(new Error('dm block')) };
    const interaction = {
      customId: 'moderation:warn:target-fetch',
      guildId: 'guild-fetch',
      guild: {
        id: 'guild-fetch',
        name: 'Fetch Guild',
        ownerId: 'owner-other',
        members: { fetch: jest.fn().mockRejectedValue(new Error('not found')) }
      },
      member: {
        roles: { cache: { has: () => true }, highest: { comparePositionTo: () => 1 } },
        permissions: { has: () => true }
      },
      user: { id: 'mod-fetch', tag: 'Mod#Fetch' },
      fields: {
        getTextInputValue: jest.fn(key => (key === 'reason' ? 'Reason text' : ''))
      },
      reply: jest.fn().mockResolvedValue(undefined),
      client: {
        users: { fetch: jest.fn().mockResolvedValue(targetUser) }
      }
    };

    await handleModal(interaction);

    expect(targetUser.send).toHaveBeenCalled(); // rejection is swallowed
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Logged a warning for Target#Fetch.'
    }));
  });

  test('warn fails when user cannot be fetched', async () => {
    addRoleToCache('guild-miss-user', 'warn', 'role-warn');
    const interaction = {
      customId: 'moderation:warn:missing-user',
      guildId: 'guild-miss-user',
      guild: {
        id: 'guild-miss-user',
        ownerId: 'owner-other',
        members: { fetch: jest.fn().mockRejectedValue(new Error('not found')) }
      },
      member: {
        roles: { cache: { has: () => true }, highest: { comparePositionTo: () => 1 } },
        permissions: { has: () => true }
      },
      user: { id: 'mod-miss', tag: 'Mod#Missing' },
      fields: {
        getTextInputValue: jest.fn(key => (key === 'reason' ? 'Reason text' : ''))
      },
      reply: jest.fn().mockResolvedValue(undefined),
      client: {
        users: { fetch: jest.fn().mockRejectedValue(new Error('no user')) }
      }
    };

    await handleModal(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Unable to resolve that user.'
    }));
  });

  test('kick reports when bot lacks permission', async () => {
    addRoleToCache('guild-kick-perm', 'kick', 'role-kick');
    const targetMember = {
      id: 'target-kick-perm',
      roles: { cache: { has: () => false }, highest: { comparePositionTo: () => -1 } }
    };
    const interaction = {
      customId: 'moderation:kick:target-kick-perm',
      guildId: 'guild-kick-perm',
      guild: {
        id: 'guild-kick-perm',
        ownerId: 'owner-other',
        members: {
          fetch: jest.fn().mockResolvedValue(targetMember),
          me: { permissions: { has: () => false } }
        }
      },
      member: {
        roles: { cache: { has: () => true }, highest: { comparePositionTo: () => 1 } },
        permissions: { has: () => true }
      },
      user: { id: 'mod-kick-perm', tag: 'Mod#Kick' },
      fields: {
        getTextInputValue: jest.fn(key => (key === 'reason' ? 'Reason text' : ''))
      },
      reply: jest.fn().mockResolvedValue(undefined),
      client: {
        users: {
          fetch: jest.fn().mockResolvedValue({
            id: 'target-kick-perm',
            tag: 'Kickee#0001',
            send: jest.fn().mockResolvedValue(undefined)
          })
        }
      }
    };

    await handleModal(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'I do not have permission to kick members. Update my role settings first.'
    }));
  });

  test('kick reports when target no longer exists', async () => {
    addRoleToCache('guild-kick-missing', 'kick', 'role-kick');
    const interaction = {
      customId: 'moderation:kick:target-missing',
      guildId: 'guild-kick-missing',
      guild: {
        id: 'guild-kick-missing',
        ownerId: 'owner-other',
        members: {
          fetch: jest.fn().mockRejectedValue(new Error('missing')),
          me: { permissions: { has: () => true } }
        }
      },
      member: {
        roles: { cache: { has: () => true }, highest: { comparePositionTo: () => 1 } },
        permissions: { has: () => true }
      },
      user: { id: 'mod-kick-missing', tag: 'Mod#KickMissing' },
      fields: {
        getTextInputValue: jest.fn(key => (key === 'reason' ? 'Reason text' : ''))
      },
      reply: jest.fn().mockResolvedValue(undefined),
      client: { users: { fetch: jest.fn().mockResolvedValue({ id: 'target-missing', tag: 'Missing#0001', send: jest.fn().mockResolvedValue(undefined) }) } }
    };

    await handleModal(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'That user is no longer in the server.'
    }));
  });

  test('processes pardon modal for administrators', async () => {
    database.__pool.query.mockResolvedValue([[]]);
    const targetUser = {
      id: 'target-pardon-modal',
      tag: 'Pilot#7777',
      send: jest.fn().mockResolvedValue(undefined)
    };
    const timeoutMock = jest.fn().mockResolvedValue(undefined);

    const interaction = {
      customId: 'moderation:pardon:target-pardon-modal',
      guildId: 'guild-pardon-modal',
      guild: {
        id: 'guild-pardon-modal',
        members: {
          fetch: jest.fn().mockImplementation(async userId => {
            if (userId === 'admin-user') {
              return { permissions: { has: perm => perm === PermissionFlagsBits.Administrator } };
            }

            if (userId === 'target-pardon-modal') {
              return {
                id: 'target-pardon-modal',
                isCommunicationDisabled: () => true,
                timeout: timeoutMock
              };
            }

            return null;
          })
        }
      },
      member: {
        permissions: { has: perm => perm === PermissionFlagsBits.Administrator }
      },
      user: { id: 'admin-user', tag: 'Admin#1234' },
      fields: {
        getTextInputValue: jest.fn(key => (key === 'reason' ? 'Completed rehabilitation program' : ''))
      },
      client: {
        users: {
          cache: new Map(),
          fetch: jest.fn().mockResolvedValue(targetUser)
        }
      },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await handleModal(interaction);

    const insertCall = database.__pool.query.mock.calls.find(call => call[0].includes('INSERT INTO moderation_actions'));
    expect(insertCall).toBeDefined();
    expect(insertCall[1][1]).toBe('pardon');
    expect(timeoutMock).toHaveBeenCalledWith(null, 'Completed rehabilitation program');
    expect(targetUser.send).toHaveBeenCalledWith(expect.stringContaining('PARDON'));
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Pardoned')
    }));
  });

  test('ban reports when bot lacks permission', async () => {
    addRoleToCache('guild-ban-perm', 'ban', 'role-ban');
    const targetMember = {
      id: 'target-ban-perm',
      roles: { cache: { has: () => false }, highest: { comparePositionTo: () => -1 } },
      user: { id: 'target-ban-perm', tag: 'Ban#Perm', send: jest.fn().mockResolvedValue(undefined) }
    };
    const guildMembers = {
      fetch: jest.fn().mockResolvedValue(targetMember),
      ban: jest.fn(),
      me: { permissions: { has: () => false } }
    };
    const interaction = {
      customId: 'moderation:ban:target-ban-perm',
      guildId: 'guild-ban-perm',
      guild: {
        id: 'guild-ban-perm',
        members: guildMembers
      },
      member: {
        roles: { cache: { has: () => true }, highest: { comparePositionTo: () => 1 } },
        permissions: { has: () => true }
      },
      user: { id: 'mod-ban-perm', tag: 'Mod#Ban' },
      fields: {
        getTextInputValue: jest.fn(key => (key === 'reason' ? 'Reason text' : ''))
      },
      reply: jest.fn().mockResolvedValue(undefined),
      client: { users: { fetch: jest.fn() } }
    };

    await handleModal(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'I do not have permission to ban members. Update my role settings first.'
    }));
  });
});

describe('handleInteraction', () => {
  beforeEach(() => {
    database.__pool.query.mockReset();
    database.__pool.query.mockResolvedValue([[]]);
  });

  test('routes mod slash command through handler', async () => {
    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'mod',
      options: {
        getSubcommandGroup: () => null
      },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await expect(handleInteraction(interaction)).resolves.toBe(true);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Unsupported moderation command.'
    }));
  });

  test('routes warn context command', async () => {
    addRoleToCache('guild-context-warn', 'warn', 'role-mod');
    const interaction = {
      isChatInputCommand: () => false,
      isUserContextMenuCommand: () => true,
      commandName: ACTIONS.warn.label,
      guildId: 'guild-context-warn',
      guild: {
        members: {
          fetch: jest.fn().mockResolvedValue({
            id: 'moderator',
            roles: { cache: { has: roleId => roleId === 'role-mod' }, highest: { comparePositionTo: () => 1 } },
            permissions: { has: () => true }
          })
        }
      },
      member: {
        roles: { cache: { has: roleId => roleId === 'role-mod' }, highest: { comparePositionTo: () => 1 } },
        permissions: { has: () => true }
      },
      targetUser: { id: 'target-1' },
      user: { id: 'moderator' },
      client: { user: { id: 'bot' } },
      showModal: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await expect(handleInteraction(interaction)).resolves.toBe(true);

    expect(interaction.showModal).toHaveBeenCalled();
  });

  test('routes pardon slash command', async () => {
    const interaction = {
      isChatInputCommand: () => true,
      isUserContextMenuCommand: () => false,
      commandName: PARDON_COMMAND_NAME,
      guildId: null,
      guild: null,
      options: { getUser: jest.fn() },
      user: { id: 'moderator' },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await expect(handleInteraction(interaction)).resolves.toBe(true);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'This moderation action must be used inside a guild.'
    }));
  });

  test('routes history context command', async () => {
    const interaction = {
      isChatInputCommand: () => false,
      isUserContextMenuCommand: () => true,
      commandName: 'View Moderation History',
      guildId: 'guild-history-context',
      guild: {
        members: { fetch: jest.fn().mockResolvedValue({ permissions: { has: () => false } }) }
      },
      member: {
        permissions: { has: () => false }
      },
      targetUser: { id: 'target' },
      user: { id: 'moderator' },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await expect(handleInteraction(interaction)).resolves.toBe(true);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'You are not allowed to view moderation history.'
    }));
  });
});

describe('moderation initialize', () => {
  beforeEach(() => {
    database.__pool.query.mockReset();
    database.__pool.query.mockResolvedValue([[]]);
  });
  test('onReady bootstraps when not initialized', async () => {
    const client = { on: jest.fn() };

    await moderation.onReady(client);

    expect(client.on).toHaveBeenCalledWith(Events.GuildMemberUpdate, expect.any(Function));
    expect(client.on).toHaveBeenCalledWith(Events.MessageCreate, expect.any(Function));
  });


  test('initializes schema and auto-ban listener once', async () => {
    const client = { on: jest.fn() };
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const originalRegister = autoBanTrap.registerAutoBanTrap;
    const registerSpy = jest.spyOn(autoBanTrap, 'registerAutoBanTrap').mockImplementation(clientArg => originalRegister(clientArg));

    await moderation.initialize(client);

    expect(database.__pool.query.mock.calls.length).toBeGreaterThanOrEqual(4);
    const queries = database.__pool.query.mock.calls.map(call => call[0]);
    expect(queries.some(sql => typeof sql === 'string' && sql.includes('moderation_config'))).toBe(true);
    expect(registerSpy).toHaveBeenCalledWith(client);
    expect(client.on).toHaveBeenCalledWith(Events.GuildMemberUpdate, expect.any(Function));
    expect(client.on).toHaveBeenCalledWith(Events.MessageCreate, expect.any(Function));
    expect(client.on.mock.calls.some(call => call[0] === Events.InteractionCreate)).toBe(false);

    const messageHandler = client.on.mock.calls.find(call => call[0] === Events.MessageCreate)[1];
    orgLinkHandler.handleMessageCreate.mockRejectedValueOnce(new Error('boom'));
    messageHandler({});
    await flushPromises();
    expect(errorSpy).toHaveBeenCalledWith('moderation: org link moderation failed', expect.any(Error));

    await moderation.initialize(client);

    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(client.on.mock.calls.filter(call => call[0] === Events.GuildMemberUpdate)).toHaveLength(1);
    expect(client.on.mock.calls.filter(call => call[0] === Events.MessageCreate)).toHaveLength(1);

    registerSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('fetchReferenceMessage', () => {
  test('retrieves referenced message content when available', async () => {
    const message = { content: 'This is a spoiler.' };
    const channel = {
      messages: { fetch: jest.fn().mockResolvedValue(message) }
    };
    const guild = {
      id: 'guild-ref',
      channels: { fetch: jest.fn().mockResolvedValue(channel) }
    };

    const reference = {
      guildId: 'guild-ref',
      channelId: 'channel-1',
      messageId: 'message-1',
      raw: 'https://discord.com/channels/guild-ref/channel-1/message-1'
    };

    const result = await fetchReferenceMessage(null, guild, reference);
    expect(result.url).toBe('https://discord.com/channels/guild-ref/channel-1/message-1');
    expect(result.content).toBe('This is a spoiler.');
    expect(guild.channels.fetch).toHaveBeenCalledWith('channel-1');
    expect(channel.messages.fetch).toHaveBeenCalledWith('message-1');
  });

  test('returns raw reference when guild differs', async () => {
    const guild = { id: 'guild-1', channels: { fetch: jest.fn() } };
    const reference = {
      guildId: 'guild-2',
      channelId: 'chan',
      messageId: 'msg',
      raw: 'https://discord.com/channels/guild-2/chan/msg'
    };

    const result = await fetchReferenceMessage(null, guild, reference);
    expect(result.url).toBe(reference.raw);
    expect(result.content).toBeNull();
    expect(guild.channels.fetch).not.toHaveBeenCalled();
  });

  test('returns raw reference when channel lacks message fetch', async () => {
    const guild = {
      id: 'guild-3',
      channels: { fetch: jest.fn().mockResolvedValue({}) }
    };
    const reference = {
      guildId: 'guild-3',
      channelId: 'chan-missing',
      messageId: 'msg-missing',
      raw: 'https://discord.com/channels/guild-3/chan-missing/msg-missing'
    };

    const result = await fetchReferenceMessage(null, guild, reference);
    expect(result.url).toBe(reference.raw);
    expect(result.content).toBeNull();
  });

  test('returns raw reference when message cannot be fetched', async () => {
    const channel = {
      messages: { fetch: jest.fn().mockResolvedValue(null) }
    };
    const guild = {
      id: 'guild-4',
      channels: { fetch: jest.fn().mockResolvedValue(channel) }
    };
    const reference = {
      guildId: 'guild-4',
      channelId: 'chan-4',
      messageId: 'msg-4',
      raw: 'https://discord.com/channels/guild-4/chan-4/msg-4'
    };

    const result = await fetchReferenceMessage(null, guild, reference);
    expect(result.url).toBe(reference.raw);
    expect(result.content).toBeNull();
  });

  test('handles channel fetch errors gracefully', async () => {
    const guild = {
      id: 'guild-5',
      channels: { fetch: jest.fn().mockRejectedValue(new Error('no access')) }
    };
    const reference = {
      guildId: 'guild-5',
      channelId: 'chan-error',
      messageId: 'msg-error',
      raw: 'https://discord.com/channels/guild-5/chan-error/msg-error'
    };

    const result = await fetchReferenceMessage(null, guild, reference);
    expect(result.url).toBe(reference.raw);
    expect(result.content).toBeNull();
  });
});

describe('hasActionPermission', () => {
  beforeEach(() => {
    roleCache.clear();
  });

  test('grants access when member has configured role', () => {
    addRoleToCache('guild-1', 'warn', 'role-123');
    const member = {
      roles: { cache: { has: roleId => roleId === 'role-123' } },
      permissions: { has: () => false }
    };

    expect(hasActionPermission('guild-1', member, 'warn')).toBe(true);
  });

  test('denies access when no roles configured even with permission bits', () => {
    const member = {
      permissions: { has: perm => perm === PermissionFlagsBits.ModerateMembers }
    };

    expect(hasActionPermission('guild-2', member, 'warn')).toBe(false);
  });

  test('denies access when missing role and permission', () => {
    addRoleToCache('guild-3', 'kick', 'role-abc');
    const member = {
      roles: { cache: { has: () => false } },
      permissions: { has: () => false }
    };

    expect(hasActionPermission('guild-3', member, 'kick')).toBe(false);
  });

  test('supports Collection.some fallback detection', () => {
    addRoleToCache('guild-4', 'warn', 'role-some');
    const member = {
      roles: {
        cache: {
          has: undefined,
          some: fn => fn({ id: 'role-some' })
        }
      },
      permissions: { has: () => false }
    };

    expect(hasActionPermission('guild-4', member, 'warn')).toBe(true);
  });

  test('supports array style role cache', () => {
    addRoleToCache('guild-5', 'ban', 'role-array');
    const member = {
      roles: { cache: [{ id: 'role-array' }] },
      permissions: { has: () => false }
    };

    expect(hasActionPermission('guild-5', member, 'ban')).toBe(true);
  });

  test('removeRoleFromCache ignores missing action maps', () => {
    addRoleToCache('guild-6', 'warn', 'role-remove');
    removeRoleFromCache('guild-6', 'ban', 'role-x');
    expect(roleCache.get('guild-6').get('warn').has('role-remove')).toBe(true);
  });

  test('hasActionPermission returns false when member roles missing', () => {
    addRoleToCache('guild-7', 'warn', 'role-7');
    const member = {
      roles: null,
      permissions: { has: () => false }
    };

    expect(hasActionPermission('guild-7', member, 'warn')).toBe(false);
  });

  test('removeRoleFromCache tolerates missing data', () => {
    removeRoleFromCache('missing', 'warn', 'role-none');
    addRoleToCache('guild-6', 'warn', 'role-remove');
    removeRoleFromCache('guild-6', 'warn', 'role-remove');
    expect(roleCache.get('guild-6')).toBeUndefined();
  });

  test('hasActionPermission returns false when member is null', () => {
    expect(hasActionPermission('guild-null', null, 'warn')).toBe(false);
  });

  test('hasActionPermission returns false for unknown action', () => {
    const member = { permissions: { has: () => true } };
    expect(hasActionPermission('guild-unknown', member, 'unknown')).toBe(false);
  });
});

describe('parseReferenceInput', () => {
  test('parses message URLs into channel and message ids', () => {
    const parsed = parseReferenceInput('https://discord.com/channels/123/456/789');
    expect(parsed).toEqual({
      guildId: '123',
      channelId: '456',
      messageId: '789',
      raw: 'https://discord.com/channels/123/456/789'
    });
  });

  test('returns raw value when pattern not recognised', () => {
    const parsed = parseReferenceInput('some random text');
    expect(parsed).toEqual({ raw: 'some random text' });
  });

  test('handles empty or whitespace strings', () => {
    expect(parseReferenceInput('')).toBeNull();
    expect(parseReferenceInput('   ')).toBeNull();
  });

  test('parses channel and message id pairs', () => {
    const parsed = parseReferenceInput('12345:67890');
    expect(parsed).toEqual({ channelId: '12345', messageId: '67890', raw: '12345:67890' });
  });
});

describe('handleActionRequest', () => {
  beforeEach(() => {
    roleCache.clear();
  });

  test('opens modal when moderator is allowed', async () => {
    addRoleToCache('guild-mod', 'warn', 'role-mod');
    const interaction = {
      guildId: 'guild-mod',
      member: {
        roles: { cache: { has: roleId => roleId === 'role-mod' } },
        permissions: { has: () => false }
      },
      targetUser: { id: 'target-1' },
      user: { id: 'moderator-1' },
      client: { user: { id: 'bot-1' } },
      showModal: jest.fn().mockResolvedValue(undefined)
    };

    await handleActionRequest(interaction, 'warn');

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    const [modal] = interaction.showModal.mock.calls[0];
    expect(modal.data.custom_id).toBe(`moderation:warn:${interaction.targetUser.id}`);
  });

  test('rejects when moderator lacks permission', async () => {
    const interaction = {
      guildId: 'guild-deny',
      member: {
        roles: { cache: { has: () => false } },
        permissions: { has: () => false }
      },
      targetUser: { id: 'target-deny' },
      user: { id: 'moderator-deny' },
      client: { user: { id: 'bot-1' } },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await handleActionRequest(interaction, 'warn');

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'You are not allowed to use this moderation action.'
    }));
  });

  test('rejects self targeting', async () => {
    addRoleToCache('guild-self', 'warn', 'role-mod');
    const interaction = {
      guildId: 'guild-self',
      member: {
        roles: { cache: { has: roleId => roleId === 'role-mod' } },
        permissions: { has: () => false }
      },
      targetUser: { id: 'same-user' },
      user: { id: 'same-user' },
      client: { user: { id: 'bot-1' } },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await handleActionRequest(interaction, 'warn');

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'You cannot perform moderation actions on yourself.'
    }));
  });

  test('rejects when target user is missing', async () => {
    addRoleToCache('guild-no-target', 'warn', 'role-mod');
    const interaction = {
      guildId: 'guild-no-target',
      member: {
        roles: { cache: { has: () => true } },
        permissions: { has: () => true }
      },
      targetUser: null,
      user: { id: 'moderator' },
      client: { user: { id: 'bot' } },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await handleActionRequest(interaction, 'warn');

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Unable to identify the selected user.'
    }));
  });

  test('rejects when targeting the bot itself', async () => {
    addRoleToCache('guild-bot', 'warn', 'role-mod');
    const interaction = {
      guildId: 'guild-bot',
      member: {
        roles: { cache: { has: () => true } },
        permissions: { has: () => true }
      },
      targetUser: { id: 'bot-1' },
      user: { id: 'moderator-bot' },
      client: { user: { id: 'bot-1' } },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await handleActionRequest(interaction, 'warn');

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Nice try. I refuse to moderate myself.'
    }));
  });

  test('edits reply when interaction is deferred', async () => {
    const interaction = {
      guildId: '',
      member: null,
      targetUser: null,
      user: { id: 'mod' },
      client: { user: { id: 'bot' } },
      deferred: true,
      editReply: jest.fn().mockResolvedValue(undefined)
    };

    await handleActionRequest(interaction, 'warn');

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'This command can only be used inside a guild.'
    }));
  });
});

describe('handleAutoBanRoleUpdate', () => {
  let guild;
  let botMember;
  let targetUser;

  beforeEach(() => {
    database.__pool.query.mockReset();
    database.__pool.query.mockResolvedValue([[]]);

    targetUser = {
      id: 'user-1',
      tag: 'user-1#0001',
      send: jest.fn().mockResolvedValue(undefined)
    };

    botMember = {
      permissions: { has: jest.fn().mockReturnValue(true) },
      roles: {
        highest: {
          comparePositionTo: jest.fn().mockReturnValue(1)
        }
      }
    };

    guild = {
      id: 'guild-trap',
      name: 'Trap Guild',
      members: {
        me: botMember,
        ban: jest.fn().mockResolvedValue(undefined)
      }
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createMember(roleIds = [], overrides = {}) {
    const cache = new Map(roleIds.map(roleId => [roleId, { id: roleId }]));
    return {
      id: overrides.id ?? targetUser.id,
      guild,
      user: overrides.user ?? targetUser,
      roles: {
        cache,
        highest: overrides.highest ?? {
          id: 'role-top',
          comparePositionTo: jest.fn().mockReturnValue(-1)
        }
      },
      ...overrides
    };
  }

  test('returns when guild context missing', async () => {
    await handleAutoBanRoleUpdate({}, { guild: null });
    expect(guild.members.ban).not.toHaveBeenCalled();
  });

  test('ignores bot members', async () => {
    const newMember = createMember(['role-trap'], { user: { ...targetUser, bot: true } });
    await handleAutoBanRoleUpdate(null, newMember);
    expect(guild.members.ban).not.toHaveBeenCalled();
  });

  test('skips when trap role not configured', async () => {
    database.__pool.query.mockResolvedValueOnce([[]]);

    const oldMember = createMember([]);
    const newMember = createMember(['role-trap']);

    await handleAutoBanRoleUpdate(oldMember, newMember);

    expect(guild.members.ban).not.toHaveBeenCalled();
  });

  test('skips when trap role not newly assigned', async () => {
    database.__pool.query.mockResolvedValueOnce([[{ trap_role_id: 'role-trap' }]]);

    const oldMember = createMember(['role-trap']);
    const newMember = createMember(['role-trap']);

    await handleAutoBanRoleUpdate(oldMember, newMember);

    expect(guild.members.ban).not.toHaveBeenCalled();
  });

  test('skips when bot lacks ban permission', async () => {
    database.__pool.query.mockResolvedValueOnce([[{ trap_role_id: 'role-trap' }]]);
    botMember.permissions.has.mockReturnValue(false);

    const oldMember = createMember([]);
    const newMember = createMember(['role-trap']);

    await handleAutoBanRoleUpdate(oldMember, newMember);

    expect(guild.members.ban).not.toHaveBeenCalled();
  });

  test('bans when trap role assigned and swallows DM failure', async () => {
    database.__pool.query
      .mockResolvedValueOnce([[{ trap_role_id: 'role-trap' }]])
      .mockResolvedValue([[]]);

    const oldMember = createMember([]);
    const newMember = createMember(['role-trap']);
    targetUser.send.mockRejectedValueOnce(new Error('dm failed'));

    await handleAutoBanRoleUpdate(oldMember, newMember);

    expect(guild.members.ban).toHaveBeenCalledWith('user-1', { reason: 'Assigned the configured moderation trap role.' });
    expect(targetUser.send).toHaveBeenCalledWith(expect.stringContaining('BAN'));
  });

  test('logs when ban request fails', async () => {
    database.__pool.query.mockResolvedValueOnce([[{ trap_role_id: 'role-trap' }]]);
    guild.members.ban.mockRejectedValueOnce(new Error('ban failed'));

    const oldMember = createMember([]);
    const newMember = createMember(['role-trap']);

    await handleAutoBanRoleUpdate(oldMember, newMember);

    expect(guild.members.ban).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      'moderation: Failed to ban user',
      expect.objectContaining({ guildId: guild.id, targetId: targetUser.id }),
      expect.any(Error)
    );
  });

  test('skips when bot hierarchy is lower than target', async () => {
    database.__pool.query.mockResolvedValueOnce([[{ trap_role_id: 'role-trap' }]]);
    botMember.roles.highest.comparePositionTo.mockReturnValue(0);

    const oldMember = createMember([]);
    const newMember = createMember(['role-trap']);

    await handleAutoBanRoleUpdate(oldMember, newMember);

    expect(guild.members.ban).not.toHaveBeenCalled();
  });
});

describe('fetchTrapRoleId', () => {
  test('returns null when guild id missing', async () => {
    expect(await fetchTrapRoleId(null)).toBeNull();
  });

  test('returns null when query fails', async () => {
    database.__pool.query.mockRejectedValueOnce(new Error('load failed'));
    const result = await fetchTrapRoleId('guild-trap');
    expect(result).toBeNull();
    expect(database.__pool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT trap_role_id'),
      ['guild-trap']
    );
  });
});


describe('buildSyntheticInteraction helper', () => {
  test('creates resolved interaction shell', async () => {
    const guild = { id: 'guild-synth', members: { me: { id: 'bot-1', user: { tag: 'Bot#0001' } } } };
    const botUser = { id: 'bot-1', tag: 'Bot#0001' };
    const interaction = buildSyntheticTrapInteraction(guild, botUser);
    expect(interaction.guild).toBe(guild);
    expect(interaction.user).toEqual(botUser);
    expect(interaction.deferred).toBe(true);
    expect(interaction.replied).toBe(true);
    await expect(interaction.editReply()).resolves.toBeUndefined();
    await expect(interaction.reply()).resolves.toBeUndefined();
    await expect(interaction.followUp()).resolves.toBeUndefined();
  });
});


describe('resolveTimeoutChoice', () => {
  test('matches duration values case-insensitively', () => {
    const option = resolveTimeoutChoice('10M');
    expect(option).toEqual(ACTIONS.timeout.durationChoices.find(choice => choice.value === '10m'));
  });

  test('returns null when duration cannot be resolved', () => {
    expect(resolveTimeoutChoice('not-a-duration')).toBeNull();
  });
});
describe('trap role helpers', () => {
  test('setTrapRoleId persists configuration', async () => {
    database.__pool.query.mockReset();
    database.__pool.query.mockResolvedValue([[]]);
    await autoBanTrap.setTrapRoleId('guild-helper', 'role-helper', 'admin-1');
    expect(database.__pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO moderation_config'),
      ['guild-helper', 'role-helper', 'admin-1']
    );
  });

  test('clearTrapRoleId nulls configuration', async () => {
    database.__pool.query.mockReset();
    database.__pool.query.mockResolvedValue([[]]);
    await autoBanTrap.clearTrapRoleId('guild-helper', 'admin-1');
    expect(database.__pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO moderation_config'),
      ['guild-helper', 'admin-1']
    );
  });
});

describe('isTrapRoleNewlyAssigned', () => {
  test('returns false when trap role missing', () => {
    expect(isTrapRoleNewlyAssigned(null, null, null)).toBe(false);
  });

  test('returns false when role not present on new member', () => {
    const newMember = { roles: { cache: new Map() } };
    expect(isTrapRoleNewlyAssigned(null, newMember, 'role-trap')).toBe(false);
  });

  test('returns true when role added', () => {
    const oldMember = { roles: { cache: new Map() } };
    const newMember = { roles: { cache: new Map([['role-trap', { id: 'role-trap' }]]) } };
    expect(isTrapRoleNewlyAssigned(oldMember, newMember, 'role-trap')).toBe(true);
  });
});

describe('registerAutoBanTrap', () => {
  test('registers guild member update listener', () => {
    const client = { on: jest.fn() };

    autoBanTrap.registerAutoBanTrap(client);

    expect(client.on).toHaveBeenCalledWith(Events.GuildMemberUpdate, expect.any(Function));
  });

  test('registered listener processes trap assignment', async () => {
    const client = { on: jest.fn() };
    autoBanTrap.registerAutoBanTrap(client);

    const handler = client.on.mock.calls.find(call => call[0] === Events.GuildMemberUpdate)[1];

    const guild = {
      id: 'guild-listener',
      members: {
        me: {
          permissions: { has: () => true },
          roles: { highest: { comparePositionTo: () => 1 } }
        }
      }
    };

    const oldMember = {
      guild,
      user: { id: 'user-listener', tag: 'User#0001' },
      roles: { cache: new Map() }
    };

    const newMember = {
      guild,
      user: { id: 'user-listener', tag: 'User#0001' },
      roles: {
        cache: new Map([['trap-role', { id: 'trap-role' }]]),
        highest: { comparePositionTo: () => -1 }
      }
    };

    database.__pool.query.mockResolvedValueOnce([[{ trap_role_id: 'trap-role' }]]);
    const banSpy = jest.spyOn(actionHandlers, 'handleBan').mockResolvedValue(undefined);

    await handler(oldMember, newMember);
    await flushPromises();

    banSpy.mockRestore();
  });
});

describe('handleModCommand', () => {
  beforeEach(() => {
    roleCache.clear();
    database.__pool.query.mockReset();
    database.__pool.query.mockResolvedValue([[]]);
  });

  test('adds a moderation role and updates cache', async () => {
    const role = { id: 'role-add', toString: () => '@Moderators' };
    const interaction = {
      guildId: 'guild-add',
      options: {
        getSubcommandGroup: () => 'roles',
        getSubcommand: () => 'add',
        getString: () => 'warn',
        getRole: () => role
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined)
    };

    await handleModCommand(interaction);

    expect(database.__pool.query).toHaveBeenCalledWith(
      'INSERT IGNORE INTO moderation_roles (guild_id, action, role_id) VALUES (?, ?, ?)',
      ['guild-add', 'warn', 'role-add']
    );
    const roles = roleCache.get('guild-add').get('warn');
    expect(roles.has('role-add')).toBe(true);
    expect(interaction.editReply).toHaveBeenCalledWith('Added @Moderators to the **1. Warn User** role list.');
  });

  test('adds timeout moderation role without enum failures', async () => {
    const role = { id: 'role-timeout', toString: () => '@TimeoutMods' };
    const interaction = {
      guildId: 'guild-timeout',
      options: {
        getSubcommandGroup: () => 'roles',
        getSubcommand: () => 'add',
        getString: () => 'timeout',
        getRole: () => role
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined)
    };

    await handleModCommand(interaction);

    expect(database.__pool.query).toHaveBeenCalledWith(
      'INSERT IGNORE INTO moderation_roles (guild_id, action, role_id) VALUES (?, ?, ?)',
      ['guild-timeout', 'timeout', 'role-timeout']
    );

    const actionMap = roleCache.get('guild-timeout');
    expect(actionMap).toBeDefined();
    expect(actionMap.get('timeout')?.has('role-timeout')).toBe(true);
    expect(interaction.editReply).toHaveBeenCalledWith('Added @TimeoutMods to the **2. Timeout User** role list.');
  });

  test('removes moderation role when present', async () => {
    addRoleToCache('guild-remove', 'kick', 'role-remove');
    const role = { id: 'role-remove', toString: () => '@TempMods' };
    database.__pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const interaction = {
      guildId: 'guild-remove',
      options: {
        getSubcommandGroup: () => 'roles',
        getSubcommand: () => 'remove',
        getString: () => 'kick',
        getRole: () => role
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined)
    };

    await handleModCommand(interaction);

    expect(database.__pool.query).toHaveBeenCalledWith(
      'DELETE FROM moderation_roles WHERE guild_id = ? AND action = ? AND role_id = ?',
      ['guild-remove', 'kick', 'role-remove']
    );
    const roles = roleCache.get('guild-remove')?.get('kick') || new Set();
    expect(roles.has('role-remove')).toBe(false);
    expect(roleCache.has('guild-remove')).toBe(false);
    expect(interaction.editReply).toHaveBeenCalledWith('Removed @TempMods from the **3. Kick User** role list.');
  });

  test('lists configured roles', async () => {
    addRoleToCache('guild-list', 'warn', 'role-a');
    addRoleToCache('guild-list', 'ban', 'role-b');
    const interaction = {
      guildId: 'guild-list',
      options: {
        getSubcommandGroup: () => 'roles',
        getSubcommand: () => 'list'
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined)
    };

    await handleModCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalled();
    const [message] = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1];
    expect(message).toContain('<@&role-a>');
    expect(message).toContain('<@&role-b>');
  });

  test('returns when deferReply fails during add', async () => {
    const role = { id: 'role-fail', toString: () => '@FailRole' };
    const interaction = {
      guildId: 'guild-fail',
      options: {
        getSubcommandGroup: () => 'roles',
        getSubcommand: () => 'add',
        getString: () => 'warn',
        getRole: () => role
      },
      deferReply: jest.fn().mockRejectedValue(new Error('discord down')),
      editReply: jest.fn()
    };

    await handleModCommand(interaction);

    expect(database.__pool.query).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  test('surfaces database errors during add', async () => {
    const role = { id: 'role-db', toString: () => '@DbRole' };
    database.__pool.query.mockRejectedValueOnce(new Error('db fail'));
    const interaction = {
      guildId: 'guild-db',
      options: {
        getSubcommandGroup: () => 'roles',
        getSubcommand: () => 'add',
        getString: () => 'warn',
        getRole: () => role
      },
      deferReply: jest.fn().mockImplementation(function () {
        interaction.deferred = true;
        return Promise.resolve();
      }),
      editReply: jest.fn().mockResolvedValue(undefined)
    };

    await handleModCommand(interaction);

    expect(interaction.editReply).toHaveBeenLastCalledWith('Failed to add the moderation role. Please try again later.');
  });

  test('surfaces database errors during remove', async () => {
    const role = { id: 'role-db-remove', toString: () => '@DbRemove' };
    database.__pool.query.mockRejectedValueOnce(new Error('db fail'));
    const interaction = {
      guildId: 'guild-db-remove',
      options: {
        getSubcommandGroup: () => 'roles',
        getSubcommand: () => 'remove',
        getString: () => 'warn',
        getRole: () => role
      },
      deferReply: jest.fn().mockImplementation(function () {
        interaction.deferred = true;
        return Promise.resolve();
      }),
      editReply: jest.fn().mockResolvedValue(undefined)
    };

    await handleModCommand(interaction);

    expect(interaction.editReply).toHaveBeenLastCalledWith('Failed to remove the moderation role. Please try again later.');
  });

  test('returns error for unsupported group', async () => {
    const interaction = {
      options: {
        getSubcommandGroup: () => null
      },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await handleModCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Unsupported moderation command.'
    }));
  });

  test('delegates auto-ban configuration', async () => {
    const trapSpy = jest.spyOn(autoBanTrap, 'handleTrapConfigCommand').mockResolvedValue(undefined);
    const interaction = {
      options: {
        getSubcommandGroup: () => 'auto-ban',
        getSubcommand: () => 'status'
      }
    };

    await handleModCommand(interaction);

    expect(trapSpy).toHaveBeenCalledWith(interaction);
    trapSpy.mockRestore();
  });
});

describe('handlePardonCommand', () => {
  test('requires guild context', async () => {
    const interaction = {
      guildId: null,
      guild: null,
      options: { getUser: jest.fn() },
      user: { id: 'moderator' },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await handlePardonCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'This moderation action must be used inside a guild.'
    }));
  });

  test('rejects when executor lacks administrator permission', async () => {
    const target = { id: 'target-user' };
    const interaction = {
      guildId: 'guild-no-admin',
      guild: {
        members: { fetch: jest.fn().mockResolvedValue({ permissions: { has: () => false } }) }
      },
      member: {
        permissions: { has: () => false }
      },
      options: {
        getUser: jest.fn().mockReturnValue(target)
      },
      user: { id: 'moderator' },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await handlePardonCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'You must be an administrator to pardon users.'
    }));
  });

  test('requires a target user', async () => {
    const interaction = {
      guildId: 'guild-no-target',
      guild: {},
      options: {
        getUser: jest.fn(() => {
          throw new Error('no option');
        })
      },
      user: { id: 'moderator' },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await handlePardonCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'You must choose a user to pardon.'
    }));
  });

  test('prevents self pardons', async () => {
    const target = { id: 'moderator' };
    const interaction = {
      guildId: 'guild-self',
      guild: {},
      options: {
        getUser: jest.fn().mockReturnValue(target)
      },
      user: { id: 'moderator' },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await handlePardonCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'You cannot issue a pardon to yourself.'
    }));
  });

  test('opens modal when executor is administrator', async () => {
    const target = { id: 'target-admin', tag: 'Pilot#1234' };
    const interaction = {
      guildId: 'guild-admin',
      guild: {
        members: { fetch: jest.fn() }
      },
      member: {
        permissions: { has: perm => perm === PermissionFlagsBits.Administrator }
      },
      options: {
        getUser: jest.fn().mockReturnValue(target)
      },
      user: { id: 'admin-user' },
      showModal: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await handlePardonCommand(interaction);

    expect(interaction.showModal).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ custom_id: 'moderation:pardon:target-admin' })
    }));
  });

  test('handles modal presentation failures gracefully', async () => {
    const target = { id: 'target-fail', tag: 'Pilot#9999' };
    const interaction = {
      guildId: 'guild-admin-fail',
      guild: {
        members: { fetch: jest.fn() }
      },
      member: {
        permissions: { has: perm => perm === PermissionFlagsBits.Administrator }
      },
      options: {
        getUser: jest.fn().mockReturnValue(target)
      },
      user: { id: 'admin-fail' },
      showModal: jest.fn().mockRejectedValue(new Error('modal failed')),
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await handlePardonCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Unable to open the pardon dialog. Please try again later.'
    }));
  });
});


describe('handleHistoryContext', () => {
  beforeEach(() => {
    roleCache.clear();
    database.__pool.query.mockReset();
  });

  test('blocks members without permissions', async () => {
    const interaction = {
      guildId: 'guild-context-deny',
      guild: {
        members: { fetch: jest.fn().mockResolvedValue({ permissions: { has: () => false } }) }
      },
      member: {
        permissions: { has: () => false }
      },
      targetUser: { id: 'target-context', tag: 'Target#0001' },
      user: { id: 'requester' },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await handleHistoryContext(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'You are not allowed to view moderation history.'
    }));
  });

  test('requires guild context for history view', async () => {
    const interaction = {
      guildId: null,
      guild: null,
      targetUser: { id: 'target' },
      user: { id: 'requester' },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await handleHistoryContext(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'This command can only be used inside a guild.'
    }));
  });

  test('requires a target user for history view', async () => {
    const interaction = {
      guildId: 'guild-no-target',
      guild: {},
      targetUser: null,
      user: { id: 'requester' },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await handleHistoryContext(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Unable to identify the selected user.'
    }));
  });

  test('displays history for moderators with role access', async () => {
    addRoleToCache('guild-context-allow', 'warn', 'role-mod');
    const rows = [
      { action: 'warn', reason: 'Recent issue', executor_tag: 'Mod#1', created_at: new Date('2024-04-01T12:00:00Z') }
    ];
    database.__pool.query.mockResolvedValue([rows]);

    const interaction = {
      guildId: 'guild-context-allow',
      guild: {
        members: { fetch: jest.fn().mockResolvedValue({
          roles: { cache: { has: roleId => roleId === 'role-mod' } },
          permissions: { has: () => false }
        }) }
      },
      member: null,
      targetUser: { id: 'target-context', tag: 'Target#0002' },
      user: { id: 'mod-user' },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined)
    };

    await handleHistoryContext(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Moderation history for Target#0002'));
  });

  test('reports database errors when fetching history', async () => {
    addRoleToCache('guild-context-error', 'warn', 'role-mod');
    database.__pool.query.mockRejectedValueOnce(new Error('db fail'));

    const interaction = {
      guildId: 'guild-context-error',
      guild: {
        members: { fetch: jest.fn().mockResolvedValue({
          roles: { cache: { has: roleId => roleId === 'role-mod' } },
          permissions: { has: () => false }
        }) }
      },
      member: null,
      targetUser: { id: 'target-context', tag: 'Target#0003' },
      user: { id: 'mod-error' },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined)
    };

    await handleHistoryContext(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith('Failed to fetch moderation history. Please try again later.');
  });

  test('silently exits when defer reply fails', async () => {
    addRoleToCache('guild-context-defer', 'warn', 'role-mod');
    const interaction = {
      guildId: 'guild-context-defer',
      guild: {
        members: { fetch: jest.fn().mockResolvedValue({
          roles: { cache: { has: roleId => roleId === 'role-mod' } },
          permissions: { has: () => false }
        }) }
      },
      member: null,
      targetUser: { id: 'target-defer', tag: 'Target#0004' },
      user: { id: 'mod-defer' },
      deferReply: jest.fn().mockRejectedValue(new Error('cannot defer')),
      editReply: jest.fn()
    };

    await handleHistoryContext(interaction);

    expect(interaction.deferReply).toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  test('handles member fetch failures gracefully', async () => {
    addRoleToCache('guild-context-fetch-fail', 'warn', 'role-mod');
    const interaction = {
      guildId: 'guild-context-fetch-fail',
      guild: {
        members: { fetch: jest.fn().mockRejectedValue(new Error('no member')) }
      },
      member: null,
      targetUser: { id: 'target-fetch-fail' },
      user: { id: 'mod-fetch-fail' },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await handleHistoryContext(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'You are not allowed to view moderation history.'
    }));
  });
});
describe('handleTrapConfigCommand', () => {
  beforeEach(() => {
    database.__pool.query.mockReset();
    database.__pool.query.mockResolvedValue([[]]);
  });

  test('sets the trap role', async () => {
    const role = { id: 'role-trap', toString: () => '<@&role-trap>' };
    const interaction = {
      guildId: 'guild-trap',
      options: {
        getSubcommand: () => 'set',
        getRole: () => role
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      user: { id: 'admin-1' }
    };

    await handleTrapConfigCommand(interaction);

    expect(database.__pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO moderation_config'),
      ['guild-trap', 'role-trap', 'admin-1']
    );
    expect(interaction.editReply).toHaveBeenCalledWith('Marked <@&role-trap> as the trap role.');
  });

  test('clears the trap role', async () => {
    const interaction = {
      guildId: 'guild-trap',
      options: {
        getSubcommand: () => 'clear'
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      user: { id: 'admin-1' }
    };

    await handleTrapConfigCommand(interaction);

    expect(database.__pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO moderation_config'),
      ['guild-trap', 'admin-1']
    );
    expect(interaction.editReply).toHaveBeenCalledWith('Cleared the configured trap role.');
  });

  test('reports status for configured role', async () => {
    database.__pool.query.mockResolvedValueOnce([[{ trap_role_id: 'role-trap' }]]);

    const interaction = {
      guildId: 'guild-trap',
      options: {
        getSubcommand: () => 'status'
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined)
    };

    await handleTrapConfigCommand(interaction);

    expect(database.__pool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT trap_role_id'),
      ['guild-trap']
    );
    expect(interaction.editReply).toHaveBeenCalledWith('Current trap role: <@&role-trap>');
  });

  test('status indicates when no role configured', async () => {
    database.__pool.query.mockResolvedValueOnce([[]]);

    const interaction = {
      guildId: 'guild-none',
      options: {
        getSubcommand: () => 'status'
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined)
    };

    await handleTrapConfigCommand(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith('No trap role configured yet.');
  });

  test('handles query failures gracefully', async () => {
    const error = new Error('db down');
    database.__pool.query.mockRejectedValueOnce(error);

    const interaction = {
      guildId: 'guild-trap',
      options: {
        getSubcommand: () => 'set',
        getRole: () => ({ id: 'role-trap', toString: () => '<@&role-trap>' })
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      user: { id: 'admin-1' }
    };

    await handleTrapConfigCommand(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith('Failed to update the trap role. Please try again later.');
  });

  test('handles clear failures gracefully', async () => {
    database.__pool.query.mockRejectedValueOnce(new Error('clear failed'));

    const interaction = {
      guildId: 'guild-trap',
      options: {
        getSubcommand: () => 'clear'
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      user: { id: 'admin-1' }
    };

    await handleTrapConfigCommand(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith('Failed to clear the trap role. Please try again later.');
  });

  test('handles status failures gracefully', async () => {
    database.__pool.query.mockRejectedValueOnce(new Error('status failed'));

    const interaction = {
      guildId: 'guild-trap',
      options: {
        getSubcommand: () => 'status'
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined)
    };

    await handleTrapConfigCommand(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith('No trap role configured yet.');
  });

  test('handles unsupported subcommand', async () => {
    const interaction = {
      guildId: 'guild-trap',
      options: {
        getSubcommand: () => 'unknown'
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined)
    };

    await handleTrapConfigCommand(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith('Unsupported trap role command.');
  });
});











