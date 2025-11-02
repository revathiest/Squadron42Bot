# Polls Module

## Purpose
Provides the `/poll` command for guided poll creation and voting. The workflow asks the creator to supply a question, up to 25 answers, an expiration time, and whether voters can pick one or multiple options. Polls are posted in the current channel with buttons for each answer; results update live as members vote.

## Slash Commands
| Command | Scope | Description |
|---------|-------|-------------|
| `/poll create` | Guild | Launch the interactive poll builder (requires a role granted via `/poll access add`). |
| `/poll access add <role>` | Guild | Allow a role to create polls. |
| `/poll access remove <role>` | Guild | Remove a role from the allow list. |

## Interaction Flow
- `/poll create` replies ephemerally with a control panel embed. Only members with an allowed role can open it.
- The expiration modal accepts either durations (`2h 30m`, `1d 4h`) or ISO timestamps. Polls must last at least one minute and no longer than 30 days.
- Once published, the bot posts an embed to the invoking channel. Each answer appears as a button (`poll:<pollId>:<optionId>`). Buttons disable automatically when the poll closes.
- The creator can manually close the poll via the control panel after publishing.
- Votes are stored in MySQL (`poll_votes`). Single-answer polls replace the member's previous choice; multi-answer polls toggle the selected option.

## Persistence
- `polls` - metadata (question, guild/channel message IDs, owner, expiration, closed state).
- `poll_options` - the answers linked to each poll.
- `poll_votes` - per-user selections.
- `poll_allowed_roles` - roles permitted to run `/poll create`. Without at least one entry, nobody can start a poll.

## Lifecycle Hooks
- `initialize(client)` ensures the schema exists, loads the allow-list cache, and starts the expiration scheduler.
- `onReady(client)` immediately catches up on overdue polls so they close even after restarts.
- `handleInteraction(interaction)` routes slash commands, components, and modals that use the `poll` custom ID namespace.

## Additional Notes
- Poll messages are updated in place with fresh vote totals after each interaction.
- When a poll closes (either at expiration or manually), buttons are disabled and the embed footer displays the final status.
- Poll messages include a **Close Poll** button. Only the poll owner or members allowed to create polls can activate it; everyone else receives an ephemeral denial.
- `/config-status` surfaces the current "Poll Creator Roles" section so you can review allowed roles without additional commands.
