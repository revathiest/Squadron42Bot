# Spectrum Module

## Purpose
Monitors RSI Spectrum forums for new threads and routes `/spectrum` administrative commands for configuring announcements.

## Slash Commands
| Command | Scope | Description |
|---------|-------|-------------|
| `/spectrum set-channel` | Guild | Choose the channel where Spectrum updates should be posted. |
| `/spectrum set-forum` | Guild | Select the Spectrum forum identifier to watch. |
| `/spectrum status` | Guild | Display the current Spectrum watcher configuration. |
| `/spectrum clear` | Guild | Remove the guild''s Spectrum configuration. |
| `/spectrum post-latest` | Guild | Immediately post the latest thread to the configured channel. |

## Event Hooks
- `setInterval` polling cycle – checks configured forums for new threads and posts updates.
- `InteractionCreate` – processes `/spectrum` slash commands through the shared registry.

## Persistence
- `spectrum_config`
- `spectrum_watcher_state`

## Public Interface
- `initialize(client)` – ensures configuration and state tables exist, loads cached settings, and prepares the watcher.
- `onReady(client)` – starts polling and schedules the initial check after the bot logs in.
- `getSlashCommandDefinitions()` – returns the guild-scoped `/spectrum` command definition.
- `handleInteraction(interaction)` – routes all `/spectrum` subcommands, including immediate posting.

## Additional Notes
- Watcher logic lives under `spectrum/watcher/` with dedicated modules for API access, state management, and Discord posting.
- The polling interval honours `SPECTRUM_POLL_INTERVAL_MS` from the environment; defaults are defined in `watcher/constants.js`.
