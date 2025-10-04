# Squadron 42 Community Bot

A Discord bot for the **Squadron 42** community server: event coordination, spoiler-safe discussion, announcements, and community utilities. Built to be simple to operate, easy to extend, and impossible to confuse with an actual Idris.

> Status: **Planning**. No code has been harmed yet.

---

## Goals

- **Spoiler management**: automatic spoiler tagging, spoiler channels, and opt-in roles.
- **Events**: create and manage watch parties, Q&A sessions, and play sessions with reminders.
- **Announcements**: scheduled or manual server updates, patch notes, and dev post highlights.
- **Roles & onboarding**: opt-in roles (platforms, regions, spoiler level), welcome flow, server rules acknowledgment.
- **Utilities**: `/faq`, `/links`, `/lore`, `/rules`, `/report`, `/mod` shortcuts.
- **Moderation helpers**: rate limits, anti-spam, link policies, quick actions for mods.

> Tailor features to your server. Everything is optional, except the part where you read this file.

---

## Tech Assumptions

Choose your stack when you actually start coding. This README assumes either of these paths:

- **Node.js** with `discord.js` (v14+)
- **Python** with `discord.py` (2.x+)

Pick one and delete the other bits below when you commit real code.

---

## Requirements

- Discord application and bot created in the [Developer Portal] (give it a name you will not regret).
- Bot token with the right **Privileged Gateway Intents** enabled:
  - Server Members
  - Message Content (only if you truly need it; prefer slash commands)
- One of:
  - Node.js 20+ and npm/pnpm/yarn
  - Python 3.11+ and `pip`

Optional, depending on features you adopt:
- Postgres/SQLite for persistence
- A job scheduler (cron, hosted scheduler, or library)
- S3/Cloud storage for logs/attachments

---

## Environment Variables

Create a `.env` file. Add or remove as your design solidifies.

```bash
DISCORD_TOKEN=your_bot_token
APPLICATION_ID=your_application_id
GUILD_ID=primary_guild_id          # optional if global commands

# Database configuration (MySQL/MariaDB)
DB_SERVER=host
DB_PORT=3306
DB_USER=username
DB_PASS=super_secret_password
DB_NAME=database_name              # optional if you connect without selecting a schema
DB_POOL_LIMIT=5                    # optional, concurrent connections in the pool

LOG_LEVEL=info
PUBLIC_COMMANDS=true
```

---

## Dynamic Voice Rooms

- Mark a lobby channel with `/voice-rooms set-template` (requires `Manage Channels`).
- When a member joins that lobby the bot clones a personal voice channel, moves them there, and grants management permissions.
- The temporary channel is removed automatically as soon as it is empty.
- Use `/voice-rooms list` and `/voice-rooms clear-template` to review or remove lobby channels.
- Ensure `APPLICATION_ID` (and optionally `GUILD_ID` for faster guild command deployment) are set so slash commands register correctly.
