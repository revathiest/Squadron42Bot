jest.mock('../polls/utils', () => ({
  MessageFlags: { Ephemeral: 64 },
  canMemberClosePoll: jest.fn()
}));

jest.mock('../polls/store', () => ({
  fetchPollWithOptions: jest.fn(),
  markPollClosed: jest.fn()
}));

jest.mock('../polls/scheduler', () => ({
  closePollMessage: jest.fn()
}));

const { handleCloseButton } = require('../polls/handlers/manage');
const utils = require('../polls/utils');
const store = require('../polls/store');
const scheduler = require('../polls/scheduler');

describe('polls manage handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns message when poll id is invalid', async () => {
    const interaction = {
      customId: 'polls:close:not-a-number',
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await handleCloseButton(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'This poll is no longer available.',
      flags: utils.MessageFlags.Ephemeral
    });
  });

  test('replies when poll cannot be found', async () => {
    store.fetchPollWithOptions.mockResolvedValue(null);
    const interaction = {
      customId: 'polls:close:42',
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await handleCloseButton(interaction);

    expect(store.fetchPollWithOptions).toHaveBeenCalledWith(42);
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'This poll could not be found.',
      flags: utils.MessageFlags.Ephemeral
    });
  });

  test('blocks unauthorised members', async () => {
    store.fetchPollWithOptions.mockResolvedValue({ poll: { id: 7, closed_at: null, owner_id: 'owner' } });
    utils.canMemberClosePoll.mockReturnValue(false);

    const interaction = {
      customId: 'polls:close:7',
      member: { id: 'not-owner' },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await handleCloseButton(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'You are not allowed to close this poll.',
      flags: utils.MessageFlags.Ephemeral
    });
    expect(store.markPollClosed).not.toHaveBeenCalled();
  });

  test('closes poll when member is authorised', async () => {
    const poll = { id: 9, closed_at: null, owner_id: 'owner-9' };
    store.fetchPollWithOptions.mockResolvedValue({ poll });
    utils.canMemberClosePoll.mockReturnValue(true);

    const interaction = {
      customId: 'polls:close:9',
      member: { id: 'owner-9' },
      user: { id: 'owner-9' },
      client: {},
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn()
    };

    await handleCloseButton(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: utils.MessageFlags.Ephemeral });
    expect(store.markPollClosed).toHaveBeenCalled();
    expect(scheduler.closePollMessage).toHaveBeenCalledWith(interaction.client, 9);
    expect(interaction.editReply).toHaveBeenCalledWith({ content: 'Poll closed.' });
  });
});
