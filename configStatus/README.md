# Config Status Module

## Purpose
Exposes a guild-scoped `/config-status` command that summarizes configuration across every enabled feature module.

## Slash Commands
| Command | Scope | Description |
|---------|-------|-------------|
| `/config-status` | Guild | Display ticket, moderation, referral, spectrum, and voice room configuration for the current guild. |

## Event Hooks
- None.

## Persistence
- Reads from: `ticket_settings`, `ticket_roles`, `moderation_roles`, `moderation_config`, `referral_codes`, `provided_codes`, `spectrum_config`, `voice_channel_templates`.

## Public Interface
- `initialize()` – placeholder for future setup (no work required today).
- `onReady()` – placeholder for post-login hooks.
- `getSlashCommandDefinitions()` – returns the guild-scoped command definition.
- `handleInteraction(interaction)` – builds and returns the aggregated configuration embed when the command is invoked.

## Additional Notes
- `handlers/showStatus.js` assembles the embed and logs failures with a `[config-status]` prefix for easier tracing.
- Any new module that needs to appear in the status report should add a query to `showStatus.js` and extend the unit tests in `__tests__/configstatus.test.js`.
