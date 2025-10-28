# Referrals Module

Implements referral code registration and retrieval commands for community members.

## Commands

| Command | Scope | Description |
|---------|-------|-------------|
| `/register-referral-code` | Global | Register or update the caller’s Star Citizen referral code. |
| `/get-referral-code` | Global | Fetch a random unused referral code from the shared pool. |

## Data

The module uses two tables:

- `referral_codes` – Stores each user’s registered code.
- `provided_codes` – Tracks codes handed out so the pool can rotate usage.

Schema definitions live in `schema.sql`.
