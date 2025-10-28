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
const stateStore = require('../spectrum/watcher/stateStore');

describe('spectrum state store', () => {
  beforeEach(() => {
    database.__pool.query.mockReset();
    stateStore.stateCache.clear();
  });

  test('ensureStateSchema runs schema migrations', async () => {
    database.__pool.query.mockResolvedValue([[]]);

    await stateStore.ensureStateSchema(database.__pool);

    expect(database.__pool.query).toHaveBeenCalledTimes(2);
    expect(database.__pool.query.mock.calls[0][0]).toContain('CREATE TABLE');
  });

  test('loadState hydrates cache with numeric thread ids', async () => {
    database.__pool.query.mockResolvedValueOnce([[{ guild_id: '1', last_thread_id: '123' }]]);

    await stateStore.loadState(database.__pool);

    expect(stateStore.stateCache.get('1')).toEqual({ raw: '123', numeric: 123n });
  });

  test('getLastSeenThread reads from cache and falls back to database', async () => {
    stateStore.stateCache.set('guild', { raw: '500', numeric: 500n });
    await expect(stateStore.getLastSeenThread('guild')).resolves.toEqual({ raw: '500', numeric: 500n });

    stateStore.stateCache.clear();
    database.__pool.query.mockResolvedValueOnce([[{ last_thread_id: '250' }]]);
    await expect(stateStore.getLastSeenThread('guild')).resolves.toEqual({ raw: '250', numeric: 250n });
  });

  test('setLastSeenThread upserts database and updates cache', async () => {
    database.__pool.query.mockResolvedValue([[]]);

    const result = await stateStore.setLastSeenThread('guild', '600');

    expect(result).toEqual({ raw: '600', numeric: 600n });
    expect(database.__pool.query).toHaveBeenCalled();
    expect(stateStore.stateCache.get('guild')).toEqual({ raw: '600', numeric: 600n });
  });
});
