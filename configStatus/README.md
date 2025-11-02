# Config Status Module

## Purpose
Exposes a guild-scoped `/config-status` command that summarizes configuration across every enabled feature module.

## Slash Commands
| Command | Scope | Description |
|---------|-------|-------------|
| `/config-status` | Guild | Display ticket, moderation (including org promo forums), referral, spectrum, voice room, embed template access, poll, and engagement configuration for the current guild. |

## Event Hooks
- None.

## Persistence
- Reads from: `ticket_settings`, `ticket_roles`, `moderation_roles`, `moderation_org_forum_channels`, `moderation_config`, `referral_codes`, `provided_codes`, `spectrum_config`, `voice_channel_templates`, `embed_allowed_roles`, `poll_allowed_roles`, `engagement_config`, `engagement_levels`.

## Public Interface
- `initialize()` – placeholder for future setup (no work required today).
- `onReady()` – placeholder for post-login hooks.
- `getSlashCommandDefinitions()` – returns the guild-scoped command definition.
- `handleInteraction(interaction)` – builds and returns the aggregated configuration embed when the command is invoked.

## Additional Notes
- `handlers/showStatus.js` assembles the embed and logs failures with a `[config-status]` prefix for easier tracing.
- Any new module that needs to appear in the status report should add a query to `handlers/showStatus.js` and extend the unit tests in `__tests__/configstatus.test.js`.
