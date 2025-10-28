# Tickets Module

## Purpose
Runs the community support ticket workflow using lobby controls, dedicated ticket channels, and moderator actions.

## Slash Commands
| Command | Scope | Description |
|---------|-------|-------------|
| `/ticket set-channel` | Guild | Configure the lobby channel that hosts the ticket panel. |
| `/ticket set-archive` | Guild | Select the category where closed tickets are moved. |
| `/ticket roles add` | Guild | Grant a role access to ticket management actions. |
| `/ticket roles remove` | Guild | Remove a role from the ticket moderator list. |
| `/ticket roles list` | Guild | Show the roles that can manage tickets. |

## Event Hooks
- `InteractionCreate` – handles buttons and modals with the `ticket:` prefix.
- `MessageCreate` – keeps the lobby channel tidy by removing stray messages around the ticket embed.

## Persistence
- `ticket_settings`
- `ticket_roles`
- `tickets`

## Public Interface
- `initialize(client)` – creates tables, primes caches, and binds the lobby message listener once.
- `onReady(client)` – rehydrates configuration from the database after login.
- `getSlashCommandDefinitions()` – exposes the guild-scoped `/ticket` command tree.
- `handleInteraction(interaction)` – routes slash commands, buttons, and modals through the shared interaction registry.

## Additional Notes
- In-memory `settingsCache`, `rolesCache`, and `openTickets` structures live in `tickets/core.js` and are surfaced for tests via `index.js.__testables`.
