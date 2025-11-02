const { ChannelType } = require('discord.js');

describe('moderation org promo commands', () => {
  let promoHandlers;
  let orgLinksMock;
  let respondEphemeralMock;

  beforeEach(() => {
    jest.resetModules();

    orgLinksMock = {
      allowOrgForumChannel: jest.fn().mockResolvedValue(true),
      disallowOrgForumChannel: jest.fn().mockResolvedValue(true)
    };

    respondEphemeralMock = jest.fn().mockResolvedValue(undefined);

    jest.doMock('../moderation/handlers/orgLinks', () => orgLinksMock);
    jest.doMock('../moderation/utils', () => ({ respondEphemeral: respondEphemeralMock }));

    promoHandlers = require('../moderation/handlers/promoChannels');
  });

  afterEach(() => {
    jest.resetModules();
  });

  const baseInteraction = (overrides = {}) => ({
    guildId: 'guild-1',
    user: { id: 'user-1' },
    options: {
      getSubcommand: jest.fn().mockReturnValue('add'),
      getChannel: jest.fn().mockReturnValue({
        id: 'forum-1',
        type: ChannelType.GuildForum,
        toString: () => '<#forum-1>'
      })
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    ...overrides
  });

  test('rejects non-forum channels on add', async () => {
    const interaction = baseInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('add'),
        getChannel: jest.fn().mockReturnValue({ id: 'text-1', type: ChannelType.GuildText })
      }
    });

    await promoHandlers.handleOrgPromoCommand(interaction);

    expect(respondEphemeralMock).toHaveBeenCalledWith(
      interaction,
      'Please choose a forum-style channel for organization promotions.'
    );
    expect(orgLinksMock.allowOrgForumChannel).not.toHaveBeenCalled();
  });

  test('adds forum channel for promotions', async () => {
    const interaction = baseInteraction();

    await promoHandlers.handleOrgPromoCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: expect.any(Number) });
    expect(orgLinksMock.allowOrgForumChannel).toHaveBeenCalledWith('guild-1', 'forum-1', 'user-1');
    expect(interaction.editReply).toHaveBeenCalledWith('Organization promotions are now allowed in <#forum-1>.');
  });

  test('removes forum channel for promotions', async () => {
    const interaction = baseInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('remove'),
        getChannel: jest.fn().mockReturnValue({
          id: 'forum-2',
          type: ChannelType.GuildForum,
          toString: () => '<#forum-2>'
        })
      }
    });

    await promoHandlers.handleOrgPromoCommand(interaction);

    expect(orgLinksMock.disallowOrgForumChannel).toHaveBeenCalledWith('guild-1', 'forum-2');
    expect(interaction.editReply).toHaveBeenCalledWith('Removed <#forum-2> from organization promotion forums.');
  });

  test('returns error for unsupported subcommand', async () => {
    const interaction = baseInteraction({
      options: {
        getSubcommand: jest.fn().mockReturnValue('unknown')
      }
    });

    await promoHandlers.handleOrgPromoCommand(interaction);

    expect(respondEphemeralMock).toHaveBeenCalledWith(interaction, 'Unsupported organization promotion command.');
  });
});
