# Voice Rooms Module

Handles dynamic voice channels that spin up when members join configured lobby templates.

## Commands
| Command | Scope | Description |
|---------|-------|-------------|
| /voice-rooms set-template | Guild | Register a lobby channel that spawns temporary rooms. |
| /voice-rooms clear-template | Guild | Remove a lobby channel from the dynamic list. |
| /voice-rooms list | Guild | Display configured lobby channels. |

## Events
- Responds to VoiceStateUpdate events to spawn and clean up rooms.
- Uses the shared interaction registry to handle /voice-rooms commands.

