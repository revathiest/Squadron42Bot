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
const store = require('../polls/store');

describe('polls store getUserVotes', () => {
  beforeEach(() => {
    database.__pool.query.mockReset();
  });

  test('returns option positions instead of ids', async () => {
    database.__pool.query.mockResolvedValueOnce([
      [{ position: 2 }, { position: 4 }]
    ]);

    const results = await store.getUserVotes(10, 'user-1');

    expect(database.__pool.query).toHaveBeenCalledWith(
      expect.stringContaining('JOIN poll_options'),
      [10, 'user-1']
    );
    expect(results).toEqual([2, 4]);
  });
});
