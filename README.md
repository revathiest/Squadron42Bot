# Squadron 42 Community Bot

A Discord bot for the **Squadron 42** community server: event coordination, spoiler-safe discussion, announcements, and community utilities. Built to be simple to operate, easy to extend, and impossible to confuse with an actual Idris.

> Status: **In development**. Core infrastructure, database connectivity, and dynamic voice rooms are live.

---

## Current Feature Set

- **Dynamic voice rooms**: designate lobby channels that spawn personal rooms on join, auto-cleaned when empty.
- **Engagement XP & levels**: award points to post authors when others react or reply, complete with custom level titles and optional announcements.
- **Interactive polls**: guided slash commands for creating, managing, and auto-closing community polls.
- **Moderation workflows**: action queues, promo/ORG link checks, and configurable auto-ban traps.
- **Referral tracking**: assign, audit, and enforce referral codes for onboarding.
- **Embed templates**: build reusable rich-message layouts with granular role access controls.
- **Spectrum watcher**: mirror RSI Spectrum announcements into Discord with configurable filters.
- **Config status dashboard**: quick slash command to verify guild setup and highlight missing configuration.
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
  - Message Content (required for org/referral moderation)
  - Message Reactions (required for engagement tracking on historical messages)
- Gateway intents requested by the bot code:
  - Guild Messages (delivers `messageCreate` events)
  - Guild Message Reactions (delivers `messageReactionAdd`/`Remove` events for uncached messages)
  - Guild Voice States, Members, Moderation (already required elsewhere)
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
- Guild-scoped registrations automatically target every guild the bot is connected to once the client is ready—no static `GUILD_ID` is required.

---

## Module Architecture

Feature work is organised into self-contained **agents**. Each agent lives under its own directory and exposes the same public surface so the bootstrapper and command manager can treat them uniformly.

```
/module/
 â”œâ”€â”€ index.js
 â”œâ”€â”€ commands.js
 â”œâ”€â”€ handlers/
 â”œâ”€â”€ utils.js
 â”œâ”€â”€ schema.js   # optional
 â””â”€â”€ README.md
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

## Engagement System

The `engagement/` agent tracks how much excitement a member generates:

- Reactions and replies grant configurable points to the original poster; self-interactions and bot activity are ignored.
- Admins manage weights, cooldowns, and notification channels with `/engagement configure â€¦`.
- Custom level titles and thresholds are supported via `/engagement configure level-set|level-remove|level-list`. When no custom curve exists the default quadratic progression is used.
- Leaderboards and `/engagement stats` show the userâ€™s active points, sticky level, name, and the next milestone. Reaction metadata (emoji id/name/type) and reply authors are stored for auditing.

## Polls

The polls agent guides moderators through building time-boxed surveys:

- `/poll create` launches an interactive wizard that collects the question, options, duration, and audience permissions, then posts a message with custom buttons.
- `/poll access add|remove|list` manages the allow-list of roles permitted to run polls; state is cached for performance and persisted via MySQL.
- Automatic closing and archival is handled by the scheduler; expired polls are cleaned up on startup and via recurring tasks.

## Embed Templates

Custom embeds live under the embeds agent:

- `/embed template create|edit|publish` workflows produce reusable message layouts stored in MySQL and protected by per-role access policies.
- Handlers in `handlers/interaction.js` centralise routing for buttons, modals, and select menus—extend them when adding new actions.

## Referrals

Referral tracking ensures each recruit is attributed correctly:

- `/referral register` binds a recruit to a sponsor, writing metadata to the database for future audits.
- `/referral get` surfaces a memberâ€™s current referral assignment and history.
- Additional utilities enforce referral-only channels and can be extended from the shared helpers in `referrals/utils.js`.

## Spectrum Watcher

The Spectrum agent mirrors RSI announcements into Discord:

- Polls Spectrum at a configurable interval (`SPECTRUM_POLL_INTERVAL_MS`) and posts new threads via webhook-driven helpers.
- Command interfaces allow moderators to configure channels, filters, and preview upcoming posts.
- Background services reside in `spectrum/watcher/*`; use the provided state store and API client wrappers when extending functionality.

## Config Status Dashboard

Admins can quickly validate guild configuration with `/config-status`:

- Displays whether mandatory settings—like moderation roles, referral channels, or announcement targets—are in place.
- Summarizes engagement scoring weights, announcement destinations, and custom level definitions.
- Useful during onboarding to ensure each module has run its initialization steps after deployment.

## Moderation Tools

The moderation agent wraps automated safety nets and manual workflows:

- Slash commands cover warn/timeout/ban actions, role configuration, and case history queries.
- Auto-ban traps monitor new members against watchlists; promo/org link handlers keep channels clean.
- Interaction routing is centralised in `moderation/handlers/interaction.js` to keep the module consistent with other agents.

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
- Use `/voice-rooms clear-template` to remove lobby channels; check `/config-status` for the current lobby list.
- Ensure `APPLICATION_ID` (and optionally `GUILD_ID` for faster guild command deployment) are set so slash commands register correctly.



