# Voice Rooms Module

## Overview
Manages dynamic voice channels that spin up when members join pre-configured lobby templates and cleans them up when idle.

## Commands
| Command | Scope | Description |
|---------|-------|-------------|
| `/voice-rooms set-template` | Guild | Register a lobby channel that spawns temporary rooms. |
| `/voice-rooms clear-template` | Guild | Remove a lobby channel from the dynamic list. |
| `/voice-rooms list` | Guild | Display configured lobby channels. |

## Behaviour
- Listens for `VoiceStateUpdate` events to spawn or clean up temporary channels.
- All interaction handling flows through the shared interaction registry via `handlers/interaction.js`.

