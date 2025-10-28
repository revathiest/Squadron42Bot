# Moderation Module

## Purpose
Provides slash commands, context menu actions, and automated honey-trap tooling to support the moderation team.

## Slash Commands
| Command | Scope | Description |
|---------|-------|-------------|
| `/mod roles add` | Guild | Allow a role to perform configured moderation actions. |
| `/mod roles remove` | Guild | Remove a role from the moderation allow list. |
| `/mod roles list` | Guild | Show which roles can moderate. |
| `/mod auto-ban set` | Guild | Configure the trap role that triggers automated bans. |
| `/mod auto-ban clear` | Guild | Remove the configured trap role. |
| `/mod auto-ban status` | Guild | Display the current trap role configuration. |
| `/pardon` | Guild | Remove a user''s recorded moderation history. |
| Context menu: Warn/Kick/Ban/Timeout/View History | Guild | Quick actions for moderators via message or user context menus. |

## Event Hooks
- `InteractionCreate` – processes slash commands, context menus, component interactions, and modals.
- `GuildMemberUpdate` – monitors role assignments for the honey-trap auto ban feature.

## Persistence
- `moderation_roles`
- `moderation_actions`
- `moderation_config`

## Public Interface
- `initialize(client)` – ensures tables exist, warms caches, registers the auto-ban trap listener, and guards against double initialization.
- `onReady(client)` – guarantees initialization has completed and stores a client reference for submodules.
- `getSlashCommandDefinitions()` – exposes guild-specific moderation command definitions and context menus.
- `handleInteraction(interaction)` – routes moderation interactions through the shared registry.

## Additional Notes
- Command handlers live under `moderation/handlers/` with dedicated files for actions, history lookups, modal workflows, and role management.
- `moderation/autoBanTrap.js` wires the trap role behaviour and emits synthetic interactions so existing handlers can process automated bans.
- The module surfaces extensive internals under `index.js.__testables` for the Jest suite to assert cache behaviour and utility helpers.
