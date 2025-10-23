const TIMEOUT_DURATIONS = [
  { value: '10m', label: '10 minutes', milliseconds: 10 * 60 * 1000 },
  { value: '1h', label: '1 hour', milliseconds: 60 * 60 * 1000 },
  { value: '12h', label: '12 hours', milliseconds: 12 * 60 * 60 * 1000 },
  { value: '24h', label: '24 hours', milliseconds: 24 * 60 * 60 * 1000 },
  { value: '3d', label: '3 days', milliseconds: 3 * 24 * 60 * 60 * 1000 },
  { value: '7d', label: '7 days', milliseconds: 7 * 24 * 60 * 60 * 1000 }
];

const ACTIONS = {
  warn: {
    label: '1. Warn User'
  },
  timeout: {
    label: '2. Timeout User',
    durationChoices: TIMEOUT_DURATIONS
  },
  kick: {
    label: '3. Kick User'
  },
  ban: {
    label: '4. Ban User'
  }
};

const PARDON_COMMAND_NAME = 'pardon';
const PARDON_COMMAND_DESCRIPTION = 'Pardon a user by clearing their visible moderation history.';
const HISTORY_CONTEXT_LABEL = 'View Moderation History';

module.exports = {
  ACTIONS,
  TIMEOUT_DURATIONS,
  PARDON_COMMAND_NAME,
  PARDON_COMMAND_DESCRIPTION,
  HISTORY_CONTEXT_LABEL
};
