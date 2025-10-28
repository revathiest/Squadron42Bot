# Tickets Module

Manages the community support ticket workflow using lobby buttons and private follow-up channels.

## Commands
| Command | Scope | Description |
|---------|-------|-------------|
| /ticket set-channel | Guild | Configure the lobby channel where users can open tickets. |
| /ticket set-archive | Guild | Configure the archive category for closed ticket channels. |
| /ticket roles add/remove/list | Guild | Manage moderator roles that can claim or close tickets. |

## Events
- Handles component interactions (buttons, modals) under the 	icket: prefix.
- Listens to MessageCreate events to keep the lobby channel tidy.

See schema.sql for required database tables.
