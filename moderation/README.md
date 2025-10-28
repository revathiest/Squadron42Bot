# Moderation Module

Automates moderation tooling including slash commands, context actions, and background honey-trap automation.

## Commands
- /mod command tree for configuration and rapid actions
- Context menu shortcuts for warn, kick, ban, timeout, and history lookup
- /pardon for clearing visible history

## Structure
- handlers/actions.js – Executes moderation actions and logging
- handlers/modal.js – Builds/show modals and validates interaction context
- handlers/history.js – Fetches and formats moderation history
- handlers/roles.js – Manages role permissions and caches
- handlers/interaction.js – Routes interactions through the shared registry
