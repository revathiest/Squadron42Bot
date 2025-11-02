# Moderation Module

## Purpose
Provides slash commands, context menu actions, and automated honey-trap tooling to support the moderation team.

## Slash Commands
| Command | Scope | Description |
|---------|-------|-------------|
| `/mod roles add` | Guild | Allow a role to perform configured moderation actions. |
| `/mod roles remove` | Guild | Remove a role from the moderation allow list. |
| `/mod auto-ban set` | Guild | Configure the trap role that triggers automated bans. |
| `/mod auto-ban clear` | Guild | Remove the configured trap role. |
| `/mod org-promos add` | Guild | Allow a forum channel to host organization promotion threads. |
| `/mod org-promos remove` | Guild | Remove a forum channel from organization promotion duties. |
| `/pardon` | Guild | Remove a user''s recorded moderation history. |
| Context menu: Warn/Kick/Ban/Timeout/View History | Guild | Quick actions for moderators via message or user context menus. |

## Event Hooks
- `InteractionCreate` - processes slash commands, context menus, component interactions, and modals.
- `GuildMemberUpdate` - monitors role assignments for the honey-trap auto ban feature.
- `MessageCreate` - enforces referral/org link policies, including duplicate detection inside approved forums.

## Persistence
- `moderation_roles`
- `moderation_actions`
- `moderation_config`
- `moderation_org_posts`
- `moderation_org_forum_channels`

## Public Interface
- `initialize(client)` ï¿½ ensures tables exist, warms caches, registers the auto-ban trap listener, and guards against double initialization.
- `onReady(client)` ï¿½ guarantees initialization has completed and stores a client reference for submodules.
- `getSlashCommandDefinitions()` ï¿½ exposes guild-specific moderation command definitions and context menus.
- `handleInteraction(interaction)` ï¿½ routes moderation interactions through the shared registry.

## Additional Notes
- Command handlers live under `moderation/handlers/` with dedicated files for actions, history lookups, modal workflows, and role management.
- `moderation/autoBanTrap.js` wires the trap role behaviour and emits synthetic interactions so existing handlers can process automated bans.
- The module surfaces extensive internals under `index.js.__testables` for the Jest suite to assert cache behaviour and utility helpers.
- `/config-status` includes separate sections for moderation roles, org promotion forums, and the honey-trap role to make audits easy without additional commands.
