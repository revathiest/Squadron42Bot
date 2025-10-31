# Squadron 42 Community Bot

A Discord bot for the **Squadron 42** community server: event coordination, spoiler-safe discussion, announcements, and community utilities. Built to be simple to operate, easy to extend, and impossible to confuse with an actual Idris.

> Status: **In development**. Core infrastructure, database connectivity, and dynamic voice rooms are live.

---

## Current Feature Set

- **Dynamic voice rooms**: designate lobby channels that spawn personal rooms on join, auto-cleaned when empty.
- **Command registry**: startup regenerates both global and guild slash commands using `commandManager.js` for consistent deployments.

Planned pillars still on the roadmap:
- Spoiler management, event coordination, announcement scheduling, onboarding flows, and moderation helpers.

---

## Tech Stack

- **Runtime**: Node.js 20+
- **Discord Client**: `discord.js` v14
- **Database**: MySQL/MariaDB via `mysql2` pooled connector
- **Configuration**: `.env` loaded with `dotenv`

---

## Requirements

- Discord application and bot created in the Developer Portal (invite with the `applications.commands` scope).
- Bot token with the right **Privileged Gateway Intents** enabled:
  - Server Members
  - Message Content (only if you truly need it; prefer slash commands)
- Node.js 20+ and npm (or pnpm/yarn)

Optional, depending on future features:
- Job scheduler (cron, PM2, or library)
- Object storage for attachments/logs

---

## Environment Variables

Create a `.env` file with the values your deployment needs.

```bash
DISCORD_TOKEN=your_bot_token
APPLICATION_ID=your_application_id
GUILD_ID=primary_guild_id          # optional; enables fast guild-scoped command updates

# Database configuration (MySQL/MariaDB)
DB_SERVER=host
DB_PORT=3306
DB_USER=username
DB_PASS=super_secret_password
DB_NAME=database_name              # optional if you connect without selecting a schema
DB_POOL_LIMIT=5                    # optional, concurrent connections in the pool

LOG_LEVEL=info
SPECTRUM_POLL_INTERVAL_MS=300000   # optional, override Spectrum watcher polling interval (ms)
```

---

## Slash Command Registration Strategy

- Every module exports `getSlashCommandDefinitions()` and indicates whether each command is global or guild-scoped.
- At startup `commandManager.registerAllCommands()` clears all existing global and guild commands, then re-registers only the current definitions. This prevents duplicate entries and ensures guild-specific commands become available immediately.
- Set `GUILD_ID` when deploying to a single server so guild commands register instantly; omit it if you want global rollout and can tolerate propagation delays.

---

## Module Architecture

Feature work is organised into self-contained **agents**. Each agent lives under its own directory and exposes the same public surface so the bootstrapper and command manager can treat them uniformly.

```
/module/
 ├── index.js
 ├── commands.js
 ├── handlers/
 ├── utils.js
 ├── schema.js   # optional
 └── README.md
```

- Use `schema.js` for database setup helpers (e.g. `ensureSchema`, cache warm-up). Modules without persistence can omit it and keep helpers in `utils.js`.
- Keep `commands.js` limited to slash/context builders—handlers and utilities own database calls.

`index.js` must export:

```js
module.exports = {
  initialize,                 // async (client)
  onReady,                    // async (client)
  getSlashCommandDefinitions, // => { global: [], guild: [] }
  handleInteraction           // async (interaction) -> boolean
};
```


For more detail, see [AGENTS.md](AGENTS.md).

---

## Interaction Responses

- Always use `flags: MessageFlags.Ephemeral` for private replies or deferred responses; the legacy `ephemeral` option is deprecated in discord.js v14.
- When adding shared interaction helpers, bake the flags option in so future agents inherit the correct behaviour.

---

## Testing

- Run `npm test` to execute the Jest suite with coverage.
- Coverage reports output to `reports/coverage/unit/` (open `reports/coverage/unit/lcov-report/index.html`).
- The suite enforces minimum coverage: 92% statements/lines, 90% functions, 80% branches across command modules.

## Ticketing System

- Configure the lobby with `/ticket set-channel` (optionally specify an archive category).
- Manage moderator roles with `/ticket roles add|remove|list`.
- The bot posts a persistent embed + button panel; users click **Open Ticket** to submit a modal.
- Tickets spawn private channels named `ticket-<username>-<id>` visible to the reporter and moderators.
- Claim/close tickets via the buttons inside each ticket; closing moves the channel to the configured archive category and locks it.
- Ticket metadata, moderator roles, and channel mappings are stored in MySQL for persistence.


## Dynamic Voice Rooms

- Mark a lobby channel with `/voice-rooms set-template` (administrators only).
- Slash command responses stay private to admins via `MessageFlags.Ephemeral`.
- When a member joins that lobby the bot clones a personal voice channel, moves them there, and grants management permissions.
- The temporary channel is removed automatically as soon as it is empty.
- Use `/voice-rooms list` and `/voice-rooms clear-template` to review or remove lobby channels.
- Ensure `APPLICATION_ID` (and optionally `GUILD_ID` for faster guild command deployment) are set so slash commands register correctly.