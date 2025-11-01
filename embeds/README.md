# Embed Templates Module

## Purpose
Listens for `.txt`/`.md` attachments that follow the Embed Template Instructions and renders the described embed(s) right in the channel where the template was uploaded. This gives staff a low-tech way to build complex announcement embeds without touching JSON or slash commands.

## Slash Commands
| Command | Scope | Description |
|---------|-------|-------------|
| _None_ | — | This module operates entirely from message attachments; no slash commands are registered. |

## Event Hooks
- `MessageCreate` – watches for text attachments, parses the template, and posts the resulting embeds. Errors are replied inline so authors can correct the template quickly.

## Persistence
- None. Templates are processed on-the-fly and never stored.

## Public Interface
- `initialize(client)` – registers the message listener (idempotent).
- `onReady(client)` – ensures the module is initialised post-login.
- `getSlashCommandDefinitions()` – returns empty arrays to satisfy the agent contract.
- `handleInteraction(interaction)` – returns `false`; no interactions are handled directly.

## Additional Notes
- Templates may produce up to 10 embeds (Discord’s hard limit). Files larger than 128 KB or missing content are rejected with a friendly error.
- Recognised directives match the “Embed Template Instructions” document (`@color`, `@image`, `@thumbnail`, `@author`, `@url`, `@timestamp`, `Footer`, `# Title`, and field syntax).
- Unknown directives throw an error so template authors spot typos immediately.
- If a text attachment contains no template markers at all, the bot simply reposts the text as one or more regular messages (chunked at 2,000 characters), then removes the original upload. |
