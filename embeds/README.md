# Embed Templates Module

## Purpose
Listens for `.txt`/`.md` attachments that follow the Embed Template Instructions and renders the described embed(s) right in the channel where the template was uploaded. This gives staff a low-tech way to build complex announcement embeds without touching JSON or slash commands.

## Slash Commands
| Command | Scope | Description |
|---------|-------|-------------|
| `/embed-access add` | Guild | Allow a role to upload embed templates. |
| `/embed-access remove` | Guild | Remove a role from the allowed upload list. |
| `/embed-access list` | Guild | Display the roles currently permitted to upload embed templates. |

## Event Hooks
- `MessageCreate` – watches for text attachments, parses the template, and posts the resulting embeds. Errors are replied inline so authors can correct the template quickly.

## Persistence
- `embed_allowed_roles` – stores which roles per guild are allowed to upload embed templates.

## Public Interface
- `initialize(client)` – creates the allow-list table, hydrates the cache, and registers the message listener.
- `onReady(client)` – ensures the module is initialised post-login.
- `getSlashCommandDefinitions()` – exposes the `/embed-access` management command.
- `handleInteraction(interaction)` – routes `/embed-access` subcommands to the appropriate handler.

## Additional Notes
- Templates may produce up to 10 embeds (Discord’s hard limit). Files larger than 128 KB or missing content are rejected with a friendly error.
- Recognised directives match the “Embed Template Instructions” document (`@color`, `@image`, `@thumbnail`, `@author`, `@url`, `@timestamp`, `Footer`, `# Title`, and field syntax).
- Unknown directives throw an error so template authors spot typos immediately.
- If a text attachment contains no template markers at all, the bot simply reposts the text as one or more regular messages (chunked at 2,000 characters), then removes the original upload.
- Only roles on the allow-list can upload templates; everyone else receives a friendly rejection.
- `/embed-access` itself also requires **Manage Server** to prevent unauthorised changes. |
