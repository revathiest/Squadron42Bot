# Referrals Module

## Purpose
Allows members to register their own Star Citizen referral code and share unused codes with others on demand.

## Slash Commands
| Command | Scope | Description |
|---------|-------|-------------|
| `/register-referral-code` | Global | Save or update the caller''s Star Citizen referral code. |
| `/get-referral-code` | Global | Retrieve an unused referral code from the shared community pool. |

## Event Hooks
- None.

## Persistence
- `referral_codes`
- `provided_codes`

## Public Interface
- `initialize()` – ensures the referral tables exist before the bot logs in.
- `onReady()` – currently a no-op; reserved for future warm-up work.
- `getSlashCommandDefinitions()` – returns the global command definitions for registration and retrieval.
- `handleInteraction(interaction)` – routes referral slash commands and returns `true` when handled.

## Additional Notes
- Validation uses `REFERRAL_REGEX` in `referrals/utils.js` to enforce the `STAR-XXXX-XXXX` pattern.
- Handlers live under `referrals/handlers/` and rely on `mysql2` pooled queries through the shared database wrapper.
