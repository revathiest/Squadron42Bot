# Config Status Module

Provides the `/config-status` command so administrators can review the current bot configuration for the active guild.

## Commands

| Command | Scope | Description |
|---------|-------|-------------|
| `/config-status` | Guild | Displays ticket settings, moderation roles, referral statistics, spectrum watcher configuration, and temporary voice templates. |

## Lifecycle Hooks

The module exports `initialize`, `onReady`, `getSlashCommandDefinitions`, and `handleInteraction` so it can plug into the shared bootstrap (`index.js`) and command manager.
