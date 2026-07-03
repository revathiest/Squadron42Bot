# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Squadron 42 Bot is a Discord bot for the Star Citizen Squadron 42 community server. It handles event coordination, moderation, referral tracking, engagement XP, and various community utilities. Built with discord.js v14, Node.js 20+, and MySQL/MariaDB.

## Commands

```bash
npm start          # Run the bot (clears console first)
npm run dev        # Run with --watch for auto-reload during development
npm test           # Run Jest tests with coverage
```

## Architecture

### Modular Agent System

The bot uses a modular "agent" architecture where each feature lives in its own directory. All agents expose the same interface and are wired through two registries:

- **commandModules** in `index.js` - for slash command registration
- **interactionModules** in `index.js` - for interaction handling

Current agents: `voiceRooms/`, `tickets/`, `moderation/`, `spectrum/`, `referrals/`, `configStatus/`, `embeds/`, `polls/`, `engagement/`

### Required Agent Exports

Every agent's `index.js` must export:

```js
module.exports = {
  initialize,                 // async (client) - pre-login setup, DB tables, caches
  onReady,                    // async (client) - post-login setup, scheduling
  getSlashCommandDefinitions, // => { global: [], guild: [] }
  handleInteraction           // async (interaction) -> boolean (return true when handled)
};
```

### Core Infrastructure Files

- **database.js** - MySQL connection pool via `getPool()`. All modules must use this, never direct connections.
- **commandManager.js** - Aggregates and registers slash commands from all modules at startup. Clears old definitions first.
- **interactionRegistry.js** - Routes Discord interactions to module handlers in order until one returns `true` or replies.

### Agent File Structure

```
/module/
 ├── index.js        # Entry point with standard exports
 ├── commands.js     # SlashCommandBuilder definitions only
 ├── handlers/       # Interaction and event handlers
 ├── utils.js        # Helper functions, caches
 ├── schema.js       # Database bootstrap helpers (optional)
 └── README.md
```

### Key Patterns

- Commands use `SlashCommandBuilder` in `commands.js`; return `{ global: [...], guild: [...] }`
- Favour guild-scoped commands unless the feature needs global availability
- Database queries go in handlers or `utils.js`, never in `commands.js`
- Use `MessageFlags.Ephemeral` for private responses (not the deprecated `ephemeral` option)
- Register event listeners in `initialize()` with guards against double registration

## Testing

Tests live in `__tests__/` directory. Coverage thresholds enforced:
- 92% statements/lines
- 90% functions
- 80% branches

Modules expose `__testables` object for internal function testing (see `voiceRooms/index.js` as example).

## Adding a New Agent

1. Create `/moduleName/` with required files following existing patterns (`tickets/` is a good reference)
2. Implement the four required exports in `index.js`
3. Add to both `commandModules` and `interactionModules` arrays in root `index.js`
4. Add tests and database setup in `initialize()`

## Environment Variables

Required: `DISCORD_TOKEN`, `APPLICATION_ID`, `DB_SERVER`, `DB_USER`, `DB_PASS`

Optional: `DB_NAME`, `DB_PORT`, `DB_POOL_LIMIT`, `SPECTRUM_POLL_INTERVAL_MS`, `CLEAR_GUILD_COMMANDS`, `FORCE_REREGISTER`
