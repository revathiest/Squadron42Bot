const { ChannelType } = require('discord.js');

jest.mock('../database', () => {
  const pool = { query: jest.fn().mockResolvedValue([]) };
  return {
    getPool: jest.fn(() => pool),
    __pool: pool
  };
});

const database = require('../database');
const voiceRooms = require('../voiceRooms');
const { __testables } = voiceRooms;
const {
  addTemplateToCache,
  addTemporaryChannelToCache,
  tempChannelCache,
  onVoiceStateUpdate
} = __testables;

function createTemplateChannel() {
  const overwrites = [{
    id: 'role-1',
    allow: { bitfield: 0n },
    deny: { bitfield: 0n },
    type: 'role'
  }];

  return {
    id: 'template-1',
    parentId: 'category-1',
    bitrate: 64000,
    userLimit: 4,
    rtcRegion: 'auto',
    videoQualityMode: 1,
    permissionOverwrites: {
      cache: {
        map: fn => overwrites.map(fn)
      }
    }
  };
}

function createGuild(createResult) {
  return {
    id: 'guild-1',
    channels: {
      create: jest.fn().mockResolvedValue(createResult),
      fetch: jest.fn()
    }
  };
}

beforeEach(() => {
  tempChannelCache.clear();
  database.__pool.query.mockReset();
  database.__pool.query.mockResolvedValue([]);
});

describe('voiceRooms voice-state integration', () => {
  test('spawns a personal room when member joins lobby', async () => {
    addTemplateToCache('guild-1', 'template-1');

    const createdChannel = {
      id: 'temp-room-1',
      members: { size: 1 },
      delete: jest.fn()
    };

    const guild = createGuild(createdChannel);
    const newState = {
      channelId: 'template-1',
      guild,
      channel: createTemplateChannel(),
      member: {
        id: 'user-1',
        displayName: 'Test Pilot',
        user: { username: 'Pilot', bot: false }
      },
      setChannel: jest.fn(),
      user: { bot: false }
    };

    const oldState = { channelId: null, guild };

    await onVoiceStateUpdate(oldState, newState);

    expect(guild.channels.create).toHaveBeenCalledTimes(1);
    const payload = guild.channels.create.mock.calls[0][0];
    expect(payload.type).toBe(ChannelType.GuildVoice);
    expect(payload.name).toContain('Test Pilot');
    expect(Array.isArray(payload.permissionOverwrites)).toBe(true);

    expect(database.__pool.query).toHaveBeenCalledWith(
      'INSERT INTO temporary_voice_channels (channel_id, guild_id, owner_id, template_channel_id) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE owner_id = VALUES(owner_id), template_channel_id = VALUES(template_channel_id)',
      ['temp-room-1', 'guild-1', 'user-1', 'template-1']
    );

    expect(newState.setChannel).toHaveBeenCalledWith(createdChannel);
    expect(tempChannelCache.has('temp-room-1')).toBe(true);
  });

  test('cleans up empty personal room', async () => {
    addTemporaryChannelToCache({
      channel_id: 'temp-room-1',
      guild_id: 'guild-1',
      owner_id: 'user-1',
      template_channel_id: 'template-1'
    });

    const channel = {
      id: 'temp-room-1',
      members: { size: 0 },
      delete: jest.fn().mockResolvedValue(undefined)
    };

    const guild = {
      id: 'guild-1',
      channels: {
        create: jest.fn(),
        fetch: jest.fn().mockResolvedValue(channel)
      }
    };

    const oldState = {
      channelId: 'temp-room-1',
      guild,
      channel
    };

    const newState = {
      channelId: null,
      guild,
      channel: null,
      member: null
    };

    await onVoiceStateUpdate(oldState, newState);

    expect(database.__pool.query).toHaveBeenCalledWith(
      'DELETE FROM temporary_voice_channels WHERE channel_id = ?',
      ['temp-room-1']
    );

    expect(channel.delete).toHaveBeenCalled();
    expect(tempChannelCache.has('temp-room-1')).toBe(false);
  });
});
