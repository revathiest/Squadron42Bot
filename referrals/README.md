# Referrals Module

## Overview
Lets community members register their own Star Citizen referral code or draw from the shared pool when they need one.

## Commands
| Command | Scope | Description |
|---------|-------|-------------|
| /register-referral-code | Global | Register or update the caller's Star Citizen referral code. |
| /get-referral-code | Global | Fetch a random unused referral code from the shared pool. |

## Behaviour
- Stores member submissions in eferral_codes and tracks handed-out codes in provided_codes to avoid duplicates.
- Interaction routing flows through handlers/interaction.js.
