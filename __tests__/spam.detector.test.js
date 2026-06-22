const detector = require('../spamDetection/detector');

// Reset per-user state before each test
beforeEach(() => {
  detector.clearUserState('g1', 'u1');
  detector.clearUserState('g1', 'u2');
  detector.clearUserState('g1', 'u99');
});

// ---------------------------------------------------------------------------
// checkRateLimit
// ---------------------------------------------------------------------------

describe('checkRateLimit', () => {
  test('returns false when under limit', () => {
    expect(detector.checkRateLimit('g1', 'u1', 5, 5000)).toBe(false);
    expect(detector.checkRateLimit('g1', 'u1', 5, 5000)).toBe(false);
    expect(detector.checkRateLimit('g1', 'u1', 5, 5000)).toBe(false);
    expect(detector.checkRateLimit('g1', 'u1', 5, 5000)).toBe(false);
  });

  test('returns true when limit is reached on the Nth message', () => {
    for (let i = 0; i < 4; i++) detector.checkRateLimit('g1', 'u1', 5, 5000);
    expect(detector.checkRateLimit('g1', 'u1', 5, 5000)).toBe(true);
  });

  test('returns true on every message past the limit', () => {
    for (let i = 0; i < 5; i++) detector.checkRateLimit('g1', 'u1', 5, 5000);
    expect(detector.checkRateLimit('g1', 'u1', 5, 5000)).toBe(true);
    expect(detector.checkRateLimit('g1', 'u1', 5, 5000)).toBe(true);
  });

  test('different users are tracked independently', () => {
    for (let i = 0; i < 5; i++) detector.checkRateLimit('g1', 'u1', 5, 5000);
    expect(detector.checkRateLimit('g1', 'u2', 5, 5000)).toBe(false);
  });

  test('expired timestamps are pruned so a fresh burst resets the counter', () => {
    jest.useFakeTimers();
    try {
      for (let i = 0; i < 5; i++) detector.checkRateLimit('g1', 'u1', 5, 1000);
      jest.advanceTimersByTime(2000); // advance past the 1 s window
      expect(detector.checkRateLimit('g1', 'u1', 5, 1000)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test('limit of 2 triggers on the second message', () => {
    expect(detector.checkRateLimit('g1', 'u1', 2, 5000)).toBe(false);
    expect(detector.checkRateLimit('g1', 'u1', 2, 5000)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkDuplicates
// ---------------------------------------------------------------------------

describe('checkDuplicates', () => {
  test('returns false for content shorter than 10 characters', () => {
    expect(detector.checkDuplicates('g1', 'u1', 'hi')).toBe(false);
    expect(detector.checkDuplicates('g1', 'u1', 'hi')).toBe(false);
    expect(detector.checkDuplicates('g1', 'u1', 'hi')).toBe(false);
  });

  test('returns false when below the default threshold of 3', () => {
    expect(detector.checkDuplicates('g1', 'u1', 'some longer message text')).toBe(false);
    expect(detector.checkDuplicates('g1', 'u1', 'some longer message text')).toBe(false);
  });

  test('returns true on the third identical message', () => {
    detector.checkDuplicates('g1', 'u1', 'some longer message text');
    detector.checkDuplicates('g1', 'u1', 'some longer message text');
    expect(detector.checkDuplicates('g1', 'u1', 'some longer message text')).toBe(true);
  });

  test('is case-insensitive and whitespace-normalised', () => {
    detector.checkDuplicates('g1', 'u1', 'Hello   World  Test');
    detector.checkDuplicates('g1', 'u1', 'HELLO WORLD TEST');
    expect(detector.checkDuplicates('g1', 'u1', 'hello world test')).toBe(true);
  });

  test('different content does not accumulate toward the duplicate threshold', () => {
    detector.checkDuplicates('g1', 'u1', 'message alpha beta gamma');
    detector.checkDuplicates('g1', 'u1', 'message alpha beta gamma');
    expect(detector.checkDuplicates('g1', 'u1', 'completely different text here')).toBe(false);
  });

  test('respects a custom threshold', () => {
    detector.checkDuplicates('g1', 'u1', 'same content repeated now', 5);
    detector.checkDuplicates('g1', 'u1', 'same content repeated now', 5);
    detector.checkDuplicates('g1', 'u1', 'same content repeated now', 5);
    detector.checkDuplicates('g1', 'u1', 'same content repeated now', 5);
    expect(detector.checkDuplicates('g1', 'u1', 'same content repeated now', 5)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkMentionSpam
// ---------------------------------------------------------------------------

describe('checkMentionSpam', () => {
  function makeMessage(users, roles) {
    return { mentions: { users: { size: users }, roles: { size: roles } } };
  }

  test('returns false when total mentions are below threshold', () => {
    expect(detector.checkMentionSpam(makeMessage(2, 2))).toBe(false);
  });

  test('returns true at the default threshold of 5', () => {
    expect(detector.checkMentionSpam(makeMessage(3, 2))).toBe(true);
    expect(detector.checkMentionSpam(makeMessage(0, 5))).toBe(true);
    expect(detector.checkMentionSpam(makeMessage(5, 0))).toBe(true);
  });

  test('respects a custom threshold', () => {
    expect(detector.checkMentionSpam(makeMessage(2, 0), 3)).toBe(false);
    expect(detector.checkMentionSpam(makeMessage(3, 0), 3)).toBe(true);
  });

  test('sums user and role mentions', () => {
    expect(detector.checkMentionSpam(makeMessage(4, 4), 8)).toBe(true);
    expect(detector.checkMentionSpam(makeMessage(3, 4), 8)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkInviteLink
// ---------------------------------------------------------------------------

describe('checkInviteLink', () => {
  test('detects discord.gg short links', () => {
    expect(detector.checkInviteLink('join us at discord.gg/abc123')).toBe(true);
  });

  test('detects discordapp.com/invite links', () => {
    expect(detector.checkInviteLink('https://discordapp.com/invite/xyzxyz')).toBe(true);
  });

  test('detects discord.com/invite links', () => {
    expect(detector.checkInviteLink('https://discord.com/invite/ABCDEF')).toBe(true);
  });

  test('returns false for normal URLs', () => {
    expect(detector.checkInviteLink('https://example.com/page')).toBe(false);
  });

  test('returns false for empty content', () => {
    expect(detector.checkInviteLink('')).toBe(false);
  });

  test('returns false for discord URLs that are not invites', () => {
    expect(detector.checkInviteLink('https://discord.com/channels/123/456')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkNewAccount
// ---------------------------------------------------------------------------

describe('checkNewAccount', () => {
  function memberWithAge(daysAgo) {
    return { user: { createdTimestamp: Date.now() - daysAgo * 86_400_000 } };
  }

  test('returns true for a brand-new account', () => {
    expect(detector.checkNewAccount({ user: { createdTimestamp: Date.now() - 60_000 } }, 3)).toBe(true);
  });

  test('returns true for an account created 2 days ago when threshold is 3', () => {
    expect(detector.checkNewAccount(memberWithAge(2), 3)).toBe(true);
  });

  test('returns false for an account older than the threshold', () => {
    expect(detector.checkNewAccount(memberWithAge(10), 3)).toBe(false);
  });

  test('returns false for account age exactly at the threshold (not strictly less)', () => {
    expect(detector.checkNewAccount(memberWithAge(3), 3)).toBe(false);
  });

  test('respects a custom threshold', () => {
    expect(detector.checkNewAccount(memberWithAge(6), 7)).toBe(true);
    expect(detector.checkNewAccount(memberWithAge(8), 7)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// clearUserState
// ---------------------------------------------------------------------------

describe('clearUserState', () => {
  test('resets rate limit tracking so the user starts fresh', () => {
    for (let i = 0; i < 5; i++) detector.checkRateLimit('g1', 'u99', 5, 5000);
    detector.clearUserState('g1', 'u99');
    expect(detector.checkRateLimit('g1', 'u99', 5, 5000)).toBe(false);
  });

  test('resets duplicate tracking so the user starts fresh', () => {
    detector.checkDuplicates('g1', 'u99', 'identical message content here');
    detector.checkDuplicates('g1', 'u99', 'identical message content here');
    detector.clearUserState('g1', 'u99');
    // Two calls post-clear should not trigger (would need one more)
    expect(detector.checkDuplicates('g1', 'u99', 'identical message content here')).toBe(false);
    expect(detector.checkDuplicates('g1', 'u99', 'identical message content here')).toBe(false);
  });

  test('does not throw when called for a user with no tracked state', () => {
    expect(() => detector.clearUserState('g1', 'unknown-user')).not.toThrow();
  });
});
