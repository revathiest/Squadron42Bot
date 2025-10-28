# Moderation Module

## Overview
Provides slash commands, context menu actions, and automated honey-trap tooling to support the moderation team.

## Commands
| Command | Scope | Description |
|---------|-------|-------------|
| /mod roles add / emove / list | Guild | Manage which roles can perform moderation actions. |
| /mod auto-ban set / clear / status | Guild | Configure the trap role that triggers automated bans. |
| /pardon | Guild | Clear a user's visible moderation history. |
| Context menu actions (Warn User, Kick User, Ban User, Timeout User, View Moderation History) | Guild | Quick actions for moderators executing common tasks. |

## Behaviour
- handlers/interaction.js routes all moderation interactions through the shared registry.
- handlers/actions.js executes moderation outcomes and logs results, while handlers/modal.js validates context and builds modals.
- handlers/history.js fetches and formats moderation history; handlers/roles.js maintains role permissions and ties into the honey-trap automation in utoBanTrap.js.
