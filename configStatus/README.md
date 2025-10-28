# Config Status Module

## Overview
Provides the /config-status command so administrators can review the current bot configuration for the active guild.

## Commands
| Command | Scope | Description |
|---------|-------|-------------|
| /config-status | Guild | Displays ticket settings, moderation roles, referral statistics, spectrum watcher configuration, and temporary voice templates. |

## Behaviour
- Executes read-only queries across other modules' tables to build a snapshot of guild configuration.
- Exposed via handlers/interaction.js and plugged into the shared interaction registry.
