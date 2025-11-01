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

describe('polls store helpers', () => {
  beforeEach(() => {
    database.__pool.query.mockReset();
  });

  test('getUserVotes returns option positions', async () => {
    database.__pool.query.mockResolvedValueOnce([
      [{ position: 2 }, { position: 4 }]
    ]);

    const selections = await store.getUserVotes(15, 'user-1');

    expect(database.__pool.query).toHaveBeenCalledWith(
      expect.stringContaining('JOIN poll_options'),
      [15, 'user-1']
    );
    expect(selections).toEqual([2, 4]);
  });
});
