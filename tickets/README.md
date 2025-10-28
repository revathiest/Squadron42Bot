# Tickets Module

## Overview
Runs the community support ticket workflow using lobby buttons, private follow-up channels, and moderator controls.

## Commands
| Command | Scope | Description |
|---------|-------|-------------|
| /ticket set-channel | Guild | Configure the lobby channel where users can open tickets. |
| /ticket set-archive | Guild | Configure the archive category for closed ticket channels. |
| /ticket roles add / emove / list | Guild | Manage moderator roles that can claim or close tickets. |

## Behaviour
- Handles component interactions (buttons and modals) with the 	icket: prefix.
- Listens to MessageCreate events to keep the lobby channel tidy for users.
