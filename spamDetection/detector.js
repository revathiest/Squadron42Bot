// In-memory per-user state — single-instance bot, no cross-restart persistence needed.
const messageWindows = new Map();      // key -> timestamp[]
const recentMessages = new Map();      // key -> { content, timestamp }[]
const crossChannelMessages = new Map(); // key -> { content, channelId, timestamp }[]

const INVITE_RE = /discord(?:\.gg|app\.com\/invite|\.com\/invite)\/[a-zA-Z0-9-]+/i;
const DUPLICATE_WINDOW_MS = 60_000;

const SPAM_PATTERNS = [
  {
    label: 'crypto/NFT scam',
    patterns: [
      /\bfree\s+(nfts?|crypto|bitcoin|btc|ethereum|eth|usdt|bnb|sol|tokens?)\b/i,
      /\bclaim\s+(your\s+)?(free\s+)?(tokens?|nfts?|crypto|airdrop|reward|prize)\b/i,
      /\bairdrop\b.{0,40}(wallet|token|crypto|claim)/is,
      /\b0x[a-fA-F0-9]{40}\b/,
    ],
  },
  {
    label: 'URL shortener',
    patterns: [
      /https?:\/\/(bit\.ly|tinyurl\.com|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|short\.io|cutt\.ly|t\.co)\//i,
    ],
  },
  {
    label: 'server promotion',
    patterns: [
      /\bjoin\s+(my|our)\s+(server|discord|community)\b/i,
      /\binvite\s+(link|code)\s*(for|to)\b/i,
    ],
  },
  {
    label: 'Nitro/gift card scam',
    patterns: [
      /\bfree\s+nitro\b/i,
      /\bnitro\s+(giveaway|gift)\b/i,
      /\bfree\s+(gift\s*card|robux|v-?bucks)\b/i,
      /\bsteam\s+gift\s*card\b/i,
    ],
  },
  {
    label: 'get-rich-quick',
    patterns: [
      /\bearn\s+\$?\d+\s*(\/\s*|\s+per\s+)(day|hour|week|month)\b/i,
      /\bmake\s+\$?\d{3,}\s*(\/\s*|\s+per\s+)(day|hour|week)\b/i,
    ],
  },
];

function checkSpamPatterns(content) {
  if (!content) return [];
  const matched = [];
  for (const { label, patterns } of SPAM_PATTERNS) {
    if (patterns.some(re => re.test(content))) {
      matched.push(label);
    }
  }
  return matched;
}

function windowKey(guildId, userId) {
  return `${guildId}_${userId}`;
}

function checkRateLimit(guildId, userId, limitCount, windowMs) {
  const key = windowKey(guildId, userId);
  const now = Date.now();

  let timestamps = messageWindows.get(key) ?? [];
  timestamps = timestamps.filter(t => now - t < windowMs);
  timestamps.push(now);
  messageWindows.set(key, timestamps);

  return timestamps.length >= limitCount;
}

function checkDuplicates(guildId, userId, content, threshold = 3) {
  if (!content || content.length < 10) return false;

  const key = windowKey(guildId, userId);
  const now = Date.now();

  let msgs = recentMessages.get(key) ?? [];
  msgs = msgs.filter(m => now - m.timestamp < DUPLICATE_WINDOW_MS);

  const normalized = content.toLowerCase().replace(/\s+/g, ' ').trim();
  msgs.push({ content: normalized, timestamp: now });
  recentMessages.set(key, msgs);

  return msgs.filter(m => m.content === normalized).length >= threshold;
}

function checkCrossChannelDuplicate(guildId, userId, channelId, content, channelThreshold = 2) {
  if (!content || content.length < 10) return false;

  const key = windowKey(guildId, userId);
  const now = Date.now();

  let entries = crossChannelMessages.get(key) ?? [];
  entries = entries.filter(e => now - e.timestamp < DUPLICATE_WINDOW_MS);

  const normalized = content.toLowerCase().replace(/\s+/g, ' ').trim();
  entries.push({ content: normalized, channelId, timestamp: now });
  crossChannelMessages.set(key, entries);

  const distinctChannels = new Set(
    entries.filter(e => e.content === normalized).map(e => e.channelId)
  );

  return distinctChannels.size >= channelThreshold;
}

function checkMentionSpam(message, threshold = 5) {
  return (message.mentions.users.size + message.mentions.roles.size) >= threshold;
}

function checkInviteLink(content) {
  return INVITE_RE.test(content);
}

function checkNewAccount(member, thresholdDays) {
  const ageDays = (Date.now() - member.user.createdTimestamp) / 86_400_000;
  return ageDays < thresholdDays;
}

const TRUST = {
  SUSPICIOUS: 'suspicious',
  STANDARD: 'standard',
  ESTABLISHED: 'established',
};

function getTrustTier(member, config) {
  const now = Date.now();
  const accountAgeDays = (now - member.user.createdTimestamp) / 86_400_000;
  const serverTenureDays = member.joinedTimestamp
    ? (now - member.joinedTimestamp) / 86_400_000
    : 0;

  if (accountAgeDays < config.new_account_days || serverTenureDays < 1) {
    return TRUST.SUSPICIOUS;
  }

  if (serverTenureDays >= config.established_member_days) {
    return TRUST.ESTABLISHED;
  }

  return TRUST.STANDARD;
}

function getRequiredSignals(tier, threshold) {
  if (tier === TRUST.SUSPICIOUS) return 1;
  if (tier === TRUST.ESTABLISHED) return threshold + 1;
  return threshold;
}

function clearUserState(guildId, userId) {
  const key = windowKey(guildId, userId);
  messageWindows.delete(key);
  recentMessages.delete(key);
  crossChannelMessages.delete(key);
}

module.exports = {
  checkRateLimit,
  checkDuplicates,
  checkCrossChannelDuplicate,
  checkSpamPatterns,
  checkMentionSpam,
  checkInviteLink,
  checkNewAccount,
  getTrustTier,
  getRequiredSignals,
  clearUserState,
  SPAM_PATTERNS,
  TRUST,
};
