# Moderation Module

## Purpose
Provides slash commands and automated honey-trap tooling to support the moderation team. The warn/kick/ban/timeout context menu actions and their role-permission system have been removed; this module now only covers the auto-ban trap role and organization promotion forum management.

## Slash Commands
| Command | Scope | Description |
|---------|-------|-------------|
| `/mod auto-ban set` | Guild | Configure the trap role that triggers automated bans. |
| `/mod auto-ban clear` | Guild | Remove the configured trap role. |
| `/mod org-promos add` | Guild | Allow a forum channel to host organization promotion threads. |
| `/mod org-promos remove` | Guild | Remove a forum channel from organization promotion duties. |

## Event Hooks
- `InteractionCreate` - processes the `/mod` slash command and its subcommand groups.
- `GuildMemberUpdate` - monitors role assignments for the honey-trap auto ban feature.
- `MessageCreate` - enforces referral/org link policies, including duplicate detection inside approved forums.

## Persistence
- `moderation_actions` - historical log of automated actions (e.g. spam-detection timeouts).
- `moderation_config` - the configured honey-trap role.
- `moderation_org_posts`
- `moderation_org_forum_channels`

## Public Interface
- `initialize(client)` — ensures tables exist, warms the org-forum cache, registers the auto-ban trap listener, and guards against double initialization.
- `onReady(client)` — guarantees initialization has completed and stores a client reference for submodules.
- `getSlashCommandDefinitions()` — exposes guild-specific moderation command definitions.
- `handleInteraction(interaction)` — routes moderation interactions through the shared registry.

## Additional Notes
- Command handlers live under `moderation/handlers/` — `roles.js` now only hosts the `memberHasRole` helper (used by the auto-ban trap) and the `/mod` subcommand-group dispatcher.
- `moderation/autoBanTrap.js` wires the trap role behaviour and emits synthetic interactions so existing handlers can process automated bans.
- The module surfaces extensive internals under `index.js.__testables` for the Jest suite to assert utility helpers.
- `/config-status` shows the org promotion forums and the honey-trap role; it no longer has a moderation-roles section since that feature was removed.
