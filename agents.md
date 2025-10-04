# Squadron 42 Bot Agents

Planning guide for the modular "agents" that will eventually power the Squadron 42 community bot. Each agent encapsulates a domain concern, exposing explicit command and event interfaces while sharing a thin core for Discord connectivity, persistence, and observability.

---

## Shared Foundations
- **Runtime**: Node.js 20+, `discord.js` v14 gateway client.
- **Persistence**: MySQL via the pooled connector in `database.js`.
- **Configuration**: `.env` variables (see `README.md`) loaded through `dotenv`.
- **Logging**: Structured `console` output for now; plan to wrap with Winston/Pino once telemetry requirements solidify.
- **Scheduling**: Use `setTimeout`/`setInterval` for lightweight reminders; evaluate `bullmq` or `agenda` if recurrent jobs grow complex.

All agents import the shared Discord client and rely on standardized utility helpers (validation, localization, embed builders) once those exist. A thin service registry should mediate access to the database, cache, and shared state.

---

## Agent Catalogue

### 1. Core Flight Control
- **Purpose**: bootstrap the bot, register global/guild commands, route interactions to the correct agent handlers.
- **Triggers**: `ready` event, slash-command creation/update webhooks.
- **Key Tasks**:
  - Own startup order (env validation -> DB ping -> Discord login).
  - Register slash commands (lazy sync once per deploy).
  - Provide shared error boundary and fallback responses.
- **Dependencies**: `DISCORD_TOKEN`, `APPLICATION_ID`, optional `GUILD_ID`.

### 2. Spoiler Sentinel
- **Purpose**: protect story-sensitive discussion by tagging and isolating content.
- **Triggers**: `messageCreate`, `interactionCreate` for `/spoiler` commands, scheduled expiry checks.
- **Key Tasks**:
  - Auto-tag messages containing spoiler keywords or phrases.
  - Manage spoiler-only channel access based on opt-in roles.
  - Provide `/spoiler mute|unmute|status` slash commands.
- **Data Needs**: tables `spoiler_flags`, `spoiler_roles`, optional keyword corpus.
- **Observability**: log every auto-flag with message link and outcome.

### 3. Event Quartermaster
- **Purpose**: coordinate watch parties, Q&As, and play sessions.
- **Triggers**: `/event` command group, button interactions for RSVP, scheduled reminders.
- **Key Tasks**:
  - Create/update/delete events and persist schedule metadata.
  - Send reminder DM/channel pings at configurable offsets.
  - Export calendar feed (`.ics`) where feasible.
- **Data Needs**: table `events` with recurrence metadata, occupant link table for RSVPs.
- **Scheduling**: maintain in-memory queue seeded at startup and refreshed on change.

### 4. Announcement Courier
- **Purpose**: disseminate official updates, patch notes, dev tracker highlights.
- **Triggers**: `/announce` slash command, webhook ingestion (future), publish timers.
- **Key Tasks**:
  - Draft announcements in mod-only channels with preview embeds.
  - Support scheduled publishing and crossposting to news channels.
  - Archive announcements to DB for audit.
- **Data Needs**: table `announcements` plus history log.

### 5. Onboarding Quarterdeck
- **Purpose**: welcome new members and shepherd them through roles/rules.
- **Triggers**: `guildMemberAdd`, `/welcome` admin command.
- **Key Tasks**:
  - DM/Channel welcome message with rule acknowledgement buttons.
  - Present opt-in role menu (platforms, regions, spoiler tolerance).
  - Track completion metrics to refine onboarding copy.
- **Data Needs**: table `onboarding_sessions` capturing timestamps & selections.

### 6. Moderation Sentry
- **Purpose**: augment mod team with lightweight automation.
- **Triggers**: message events, `/mod` command shortcuts, scheduled sweeps.
- **Key Tasks**:
  - Rate-limit anti-spam (cooldowns based on channel heat).
  - Detect forbidden links/content via pattern rules.
  - Log mod actions to a dedicated channel and DB.
- **Data Needs**: `moderation_actions`, `rule_violations` tables.
- **Integration**: coordinate with Spoiler Sentinel to avoid double-handling.

### 7. Lore Archivist
- **Purpose**: provide quick access to Squadron 42 lore, FAQs, and key links.
- **Triggers**: `/faq`, `/links`, `/lore`, context menu commands.
- **Key Tasks**:
  - Serve curated embeds sourced from structured content (JSON or DB-backed).
  - Allow staff to submit updates via `/lore add` with approval workflow.
  - Cache frequently requested entries in-memory.
- **Data Needs**: `knowledge_entries` table, optional revision history.

---

## Cross-Agent Patterns
- **Permission Model**: enforce Discord role checks in a centralized helper; log denials for visibility.
- **Error Handling**: standardized ephemeral error responses with correlation IDs for logs.
- **Localization**: plan for copy extraction once multiple languages become a priority.
- **Testing**: unit-test command handlers with mocked `discord.js` objects; integration-test DB workflows via transactional fixtures.
- **Deployment Flow**: CI pipeline to lint, run tests, push commands, and restart the process manager (PM2/systemd/docker) used in production.

---

## Implementation Roadmap
1. Stabilize Core Flight Control and database layer (already stubbed in `index.js` / `database.js`).
2. Ship Event Quartermaster MVP (creates events + reminder pings).
3. Add Spoiler Sentinel auto-tagging, then integrate with Moderation Sentry.
4. Layer in Announcement Courier scheduling.
5. Build Onboarding Quarterdeck flows and opt-in role menus.
6. Expand Lore Archivist with staff editing tools.

Treat each agent as a deployable slice: design command schema, write handler tests, implement service, then hook into the shared router. Document command changes in `CHANGELOG.md` (to be created) and update `.env.example` when new configuration is required.
