# Voice Rooms Module

## Purpose
Manages dynamic voice channels that spawn from configured lobby templates and removes them automatically when empty.

## Slash Commands
| Command | Scope | Description |
|---------|-------|-------------|
| `/voice-rooms set-template` | Guild | Mark a lobby voice channel that should spawn personal rooms. |
| `/voice-rooms clear-template` | Guild | Remove a lobby channel from the dynamic room list. |

## Event Hooks
- `VoiceStateUpdate` – clones or removes temporary channels when members join or leave monitored lobbies.

## Persistence
- `voice_channel_templates`
- `temporary_voice_channels`

## Public Interface
- `initialize(client)` – ensures schema, hydrates caches, and registers the voice state listener once.
- `onReady(client)` – rehydrates cached channel state after login.
- `getSlashCommandDefinitions()` – returns the guild-scoped slash command definitions.
- `handleInteraction(interaction)` – routes `/voice-rooms` commands through the shared interaction registry.

## Additional Notes
- Cached template and temporary channel maps live in `voiceRooms/core.js` and are exposed via `index.js.__testables` for unit testing.
- `/config-status` shows all configured lobby templates under the "Temp Channels" section.
