jest.mock('../polls/store', () => ({
  fetchPollWithOptions: jest.fn(),
  recordSingleVote: jest.fn(),
  toggleMultiVote: jest.fn(),
  getUserVotes: jest.fn(),
  markPollClosed: jest.fn()
}));

jest.mock('../polls/render', () => ({
  buildPollEmbed: jest.fn().mockReturnValue({}),
  buildPollComponents: jest.fn().mockReturnValue([])
}));

const { handleVote } = require('../polls/handlers/vote');
const store = require('../polls/store');

function buildInteraction({ customId = 'polls:vote:1:101', isMulti = false } = {}) {
  const editMock = jest.fn().mockResolvedValue(undefined);
  const message = { edit: editMock };
  const channel = {
    isTextBased: () => true,
    messages: { fetch: jest.fn().mockResolvedValue(message) }
  };

  return {
    customId,
    user: { id: 'user-1' },
    member: { id: 'user-1' },
    client: { channels: { fetch: jest.fn().mockResolvedValue(channel) } },
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    pollIsMulti: isMulti
  };
}

describe('poll vote handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('reports option numbers for single-choice polls', async () => {
    const interaction = buildInteraction();
    store.fetchPollWithOptions
      .mockResolvedValueOnce({
        poll: { id: 1, is_multi: false, expires_at: new Date(Date.now() + 3600_000), message_id: 'msg', channel_id: 'chan' },
        options: [{ id: 101, position: 2, label: 'Blue' }]
      })
      .mockResolvedValueOnce({
        poll: { id: 1, is_multi: false, expires_at: new Date(Date.now() + 3600_000), message_id: 'msg', channel_id: 'chan' },
        options: [{ id: 101, position: 2, label: 'Blue' }]
      });
    store.getUserVotes.mockResolvedValue([2]);

    await handleVote(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('option 2')
    }));
  });

  test('reports option numbers for multi-choice polls', async () => {
    const interaction = buildInteraction({ isMulti: true });
    store.fetchPollWithOptions
      .mockResolvedValueOnce({
        poll: { id: 5, is_multi: true, expires_at: new Date(Date.now() + 3600_000), message_id: 'msg', channel_id: 'chan' },
        options: [{ id: 101, position: 2, label: 'Blue' }]
      })
      .mockResolvedValueOnce({
        poll: { id: 5, is_multi: true, expires_at: new Date(Date.now() + 3600_000), message_id: 'msg', channel_id: 'chan' },
        options: [{ id: 101, position: 2, label: 'Blue' }]
      });
    store.toggleMultiVote.mockResolvedValue('added');
    store.getUserVotes.mockResolvedValue([2]);

    await handleVote(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('option 2')
    }));
  });
});
