# Spectrum Module

## Overview
Watches RSI Spectrum forums and posts updates into Discord channels while exposing commands for manual control.

## Commands
| Command | Scope | Description |
|---------|-------|-------------|
| /spectrum set-channel | Guild | Select the announcement channel for Spectrum updates. |
| /spectrum set-forum | Guild | Configure which RSI Spectrum forum to monitor. |
| /spectrum status | Guild | Show the current Spectrum watcher configuration. |
| /spectrum clear | Guild | Remove the guild's Spectrum configuration. |
| /spectrum post-latest | Guild | Immediately post the latest Spectrum thread to the configured channel. |

## Behaviour
- Uses watcher/service.js to poll Spectrum forums on an interval and post updates.
- Configuration commands live in commands.js and route through handlers/interaction.js via the shared registry.
