# Engagement Module

Tracks how much engagement a user's posts generate inside the guild. When someone reacts to a member's post or replies to it, the original poster earns configurable points that contribute toward permanent level progression.

## Commands

- `/engagement stats [user]` &mdash; View engagement points, level, and the next threshold.
- `/engagement leaderboard [size]` &mdash; Show the top members by engagement points.
- `/engagement configure set-points` &mdash; Admin-only; set the points granted for reactions and replies.
- `/engagement configure set-cooldown` &mdash; Admin-only; configure the per-source cooldown between repeated rewards.
- `/engagement configure set-announcement-channel` &mdash; Admin-only; choose where level-up announcements are posted.
- `/engagement configure toggle-announcements` &mdash; Admin-only; enable or disable level-up announcements in the configured channel.
- `/engagement configure toggle-dm` &mdash; Admin-only; toggle direct-message notifications for level-ups.
- `/engagement configure level-set` &mdash; Admin-only; define or update a named level and its point requirement.
- `/engagement configure level-remove` &mdash; Admin-only; delete a custom level definition.
- `/engagement configure level-list` &mdash; Admin-only; view current custom levels.

## Behaviour

- Each unique user reacting to a message counts once, no matter how many emoji they add.
- Replying to someone else's message grants points a single time per reply.
- Reaction points are removed when the final emoji from the reacting user disappears; reply points are removed when the reply is deleted.
- Levels are sticky: once a member reaches a level it never decreases, even if their current points fall below the previous threshold. They level again once their active points meet the threshold for the next level.
- Admins can define named level thresholds per guild. When none are configured the module falls back to the default curve.
- Cooldowns prevent the same user from instantly re-awarding the same poster; defaults to 60 seconds and can be reconfigured per guild.
- Optional level-up announcements post in a configured channel and/or DM the member.
- Engagement events track the emoji used for reactions and the member awarding or replying to each message (for future auditing and rewards).

## Files

- `index.js` &mdash; Module bootstrap, lifecycle wiring, and event listener registration.
- `commands.js` &mdash; Slash command definitions.
- `handlers/interaction.js` &mdash; Routes slash commands to the correct handler.
- `handlers/reactions.js` &mdash; Processes reaction add/remove events.
- `handlers/replies.js` &mdash; Processes reply creation/deletion.
- `handlers/commandHandlers.js` &mdash; Implements the slash command behaviour.
- `utils.js` &mdash; Configuration caching, scoring helpers, and point/level calculations.
- `schema.js` &mdash; Database bootstrap helpers.
