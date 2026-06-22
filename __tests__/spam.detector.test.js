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
// checkCrossChannelDuplicate
// ---------------------------------------------------------------------------

describe('checkCrossChannelDuplicate', () => {
  beforeEach(() => {
    detector.clearUserState('g1', 'u1');
  });

  test('returns false for short content', () => {
    expect(detector.checkCrossChannelDuplicate('g1', 'u1', 'ch1', 'hi')).toBe(false);
    expect(detector.checkCrossChannelDuplicate('g1', 'u1', 'ch2', 'hi')).toBe(false);
  });

  test('returns false when same content is only in one channel', () => {
    expect(detector.checkCrossChannelDuplicate('g1', 'u1', 'ch1', 'check out this great deal')).toBe(false);
    expect(detector.checkCrossChannelDuplicate('g1', 'u1', 'ch1', 'check out this great deal')).toBe(false);
  });

  test('returns true when same content appears in a second channel', () => {
    detector.checkCrossChannelDuplicate('g1', 'u1', 'ch1', 'check out this great deal');
    expect(detector.checkCrossChannelDuplicate('g1', 'u1', 'ch2', 'check out this great deal')).toBe(true);
  });

  test('is case-insensitive and whitespace-normalised', () => {
    detector.checkCrossChannelDuplicate('g1', 'u1', 'ch1', 'CLICK HERE NOW');
    expect(detector.checkCrossChannelDuplicate('g1', 'u1', 'ch2', 'click here now')).toBe(true);
  });

  test('different content in multiple channels does not trigger', () => {
    detector.checkCrossChannelDuplicate('g1', 'u1', 'ch1', 'message about topic alpha');
    expect(detector.checkCrossChannelDuplicate('g1', 'u1', 'ch2', 'message about topic beta')).toBe(false);
  });

  test('same channel repeated does not trigger', () => {
    detector.checkCrossChannelDuplicate('g1', 'u1', 'ch1', 'same message in one channel');
    expect(detector.checkCrossChannelDuplicate('g1', 'u1', 'ch1', 'same message in one channel')).toBe(false);
  });

  test('respects a custom channel threshold', () => {
    detector.checkCrossChannelDuplicate('g1', 'u1', 'ch1', 'testing custom threshold here');
    detector.checkCrossChannelDuplicate('g1', 'u1', 'ch2', 'testing custom threshold here');
    expect(detector.checkCrossChannelDuplicate('g1', 'u1', 'ch3', 'testing custom threshold here', 3)).toBe(true);
  });

  test('different users are tracked independently', () => {
    detector.clearUserState('g1', 'u2');
    detector.checkCrossChannelDuplicate('g1', 'u1', 'ch1', 'shared message content here');
    expect(detector.checkCrossChannelDuplicate('g1', 'u2', 'ch2', 'shared message content here')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkSpamPatterns
// ---------------------------------------------------------------------------

describe('checkSpamPatterns', () => {
  test('returns empty array for clean content', () => {
    expect(detector.checkSpamPatterns('Hey everyone, great session tonight!')).toEqual([]);
  });

  test('returns empty array for empty/null content', () => {
    expect(detector.checkSpamPatterns('')).toEqual([]);
    expect(detector.checkSpamPatterns(null)).toEqual([]);
  });

  describe('crypto/NFT scam', () => {
    test('detects "free NFT"', () => {
      expect(detector.checkSpamPatterns('Get your free NFT now!')).toContain('crypto/NFT scam');
    });

    test('detects "free crypto"', () => {
      expect(detector.checkSpamPatterns('Sending free crypto to the first 100 people')).toContain('crypto/NFT scam');
    });

    test('detects "claim your free tokens"', () => {
      expect(detector.checkSpamPatterns('Click here to claim your free tokens today')).toContain('crypto/NFT scam');
    });

    test('detects airdrop with wallet/claim context', () => {
      expect(detector.checkSpamPatterns('Big airdrop happening now, connect your wallet to claim')).toContain('crypto/NFT scam');
    });

    test('detects Ethereum wallet address', () => {
      expect(detector.checkSpamPatterns('Send ETH to 0xAbCdEf1234567890AbCdEf1234567890AbCdEf12')).toContain('crypto/NFT scam');
    });

    test('does not flag legitimate airdrop usage without crypto context', () => {
      expect(detector.checkSpamPatterns('Enemy troops are doing an airdrop near the LZ')).not.toContain('crypto/NFT scam');
    });
  });

  describe('URL shortener', () => {
    test('detects bit.ly links', () => {
      expect(detector.checkSpamPatterns('Check this out: https://bit.ly/abc123')).toContain('URL shortener');
    });

    test('detects tinyurl links', () => {
      expect(detector.checkSpamPatterns('Visit https://tinyurl.com/xyz789 for details')).toContain('URL shortener');
    });

    test('detects other shorteners', () => {
      expect(detector.checkSpamPatterns('https://is.gd/abcdef')).toContain('URL shortener');
      expect(detector.checkSpamPatterns('https://cutt.ly/abcdef')).toContain('URL shortener');
    });

    test('does not flag full URLs', () => {
      expect(detector.checkSpamPatterns('Check out https://robertsspaceindustries.com')).not.toContain('URL shortener');
    });
  });

  describe('server promotion', () => {
    test('detects "join my server"', () => {
      expect(detector.checkSpamPatterns('Come join my server, we have great events')).toContain('server promotion');
    });

    test('detects "join our discord"', () => {
      expect(detector.checkSpamPatterns('Everyone join our Discord today!')).toContain('server promotion');
    });

    test('detects invite link sharing phrase', () => {
      expect(detector.checkSpamPatterns('Here is the invite link for our community')).toContain('server promotion');
    });

    test('does not flag joining conversation', () => {
      expect(detector.checkSpamPatterns('I just joined the event yesterday')).not.toContain('server promotion');
    });
  });

  describe('Nitro/gift card scam', () => {
    test('detects "free nitro"', () => {
      expect(detector.checkSpamPatterns('Get free nitro by clicking here')).toContain('Nitro/gift card scam');
    });

    test('detects "nitro giveaway"', () => {
      expect(detector.checkSpamPatterns('Huge nitro giveaway happening now!')).toContain('Nitro/gift card scam');
    });

    test('detects "free gift card"', () => {
      expect(detector.checkSpamPatterns('Win a free gift card just for signing up')).toContain('Nitro/gift card scam');
    });

    test('detects "free robux"', () => {
      expect(detector.checkSpamPatterns('Get free robux at this site')).toContain('Nitro/gift card scam');
    });

    test('detects steam gift card', () => {
      expect(detector.checkSpamPatterns('Claim your steam gift card reward today')).toContain('Nitro/gift card scam');
    });
  });

  describe('get-rich-quick', () => {
    test('detects "earn $500/day"', () => {
      expect(detector.checkSpamPatterns('Earn $500/day working from home')).toContain('get-rich-quick');
    });

    test('detects "earn per week"', () => {
      expect(detector.checkSpamPatterns('You can earn $2000 per week with this method')).toContain('get-rich-quick');
    });

    test('detects "make $300 per hour"', () => {
      expect(detector.checkSpamPatterns('Make $300 per hour doing simple tasks')).toContain('get-rich-quick');
    });

    test('does not flag small earnings', () => {
      // "make $50 per day" is below the 3-digit threshold for "make"
      expect(detector.checkSpamPatterns('I make $50 per day from this hobby')).not.toContain('get-rich-quick');
    });
  });

  test('can match multiple categories in one message', () => {
    const matches = detector.checkSpamPatterns('Free nitro! Earn $500/day! https://bit.ly/scam');
    expect(matches).toContain('Nitro/gift card scam');
    expect(matches).toContain('get-rich-quick');
    expect(matches).toContain('URL shortener');
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
// getTrustTier / getRequiredSignals
// ---------------------------------------------------------------------------

describe('getTrustTier', () => {
  const config = { new_account_days: 3, established_member_days: 30 };

  function member({ accountDaysAgo, joinedDaysAgo }) {
    return {
      user: { createdTimestamp: Date.now() - accountDaysAgo * 86_400_000 },
      joinedTimestamp: joinedDaysAgo != null ? Date.now() - joinedDaysAgo * 86_400_000 : null,
    };
  }

  test('suspicious when account is newer than threshold', () => {
    expect(detector.getTrustTier(member({ accountDaysAgo: 1, joinedDaysAgo: 5 }), config)).toBe('suspicious');
  });

  test('suspicious when joined server less than 1 day ago', () => {
    expect(detector.getTrustTier(member({ accountDaysAgo: 365, joinedDaysAgo: 0.5 }), config)).toBe('suspicious');
  });

  test('suspicious when both account and server join are new', () => {
    expect(detector.getTrustTier(member({ accountDaysAgo: 1, joinedDaysAgo: 0.5 }), config)).toBe('suspicious');
  });

  test('established when server tenure meets the threshold', () => {
    expect(detector.getTrustTier(member({ accountDaysAgo: 365, joinedDaysAgo: 30 }), config)).toBe('established');
  });

  test('established when server tenure exceeds the threshold', () => {
    expect(detector.getTrustTier(member({ accountDaysAgo: 365, joinedDaysAgo: 90 }), config)).toBe('established');
  });

  test('standard for a member with old account and moderate server tenure', () => {
    expect(detector.getTrustTier(member({ accountDaysAgo: 30, joinedDaysAgo: 10 }), config)).toBe('standard');
  });

  test('suspicious takes priority even with long server tenure when account is new', () => {
    expect(detector.getTrustTier(member({ accountDaysAgo: 1, joinedDaysAgo: 60 }), config)).toBe('suspicious');
  });

  test('suspicious when joinedTimestamp is null (unknown join date)', () => {
    expect(detector.getTrustTier(member({ accountDaysAgo: 365, joinedDaysAgo: null }), config)).toBe('suspicious');
  });
});

describe('getRequiredSignals', () => {
  test('suspicious tier always requires 1 signal regardless of threshold', () => {
    expect(detector.getRequiredSignals('suspicious', 1)).toBe(1);
    expect(detector.getRequiredSignals('suspicious', 5)).toBe(1);
  });

  test('standard tier uses the configured threshold', () => {
    expect(detector.getRequiredSignals('standard', 2)).toBe(2);
    expect(detector.getRequiredSignals('standard', 4)).toBe(4);
  });

  test('established tier requires one more than the threshold', () => {
    expect(detector.getRequiredSignals('established', 2)).toBe(3);
    expect(detector.getRequiredSignals('established', 4)).toBe(5);
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
