# Squadron 42 Bot – Agent Standards

This bot is organised into modular **agents**. Each agent owns a feature area (voice rooms, tickets, moderation, etc.), and exposes the same API so the bootstrap and command manager can treat every module uniformly. Follow these rules whenever you add or modify an agent.

---

## Directory Layout

Each agent lives in its own directory at the repository root:

```text
/voiceRooms/
/tickets/
/referrals/
/configStatus/
/spectrum/
/moderation/
/embeds/
```

Every module **must** contain the following files:

```text
/module/
 ├── index.js        # Entry point wiring the shared lifecycle
 ├── commands.js     # Slash/Context command builders
 ├── handlers/       # Interaction/event handlers (split by concern)
 ├── utils.js        # Module helper layer (caches, shared logic)
 ├── schema.js       # (optional) Database bootstrap helpers
 └── README.md       # Overview, commands, behaviours
```

Additional folders (e.g. `actions/`, `history/`) are fine when a module needs more structure.

---

## Required Exports

`index.js` inside every module must export the same surface:

```js
module.exports = {
  initialize,                 // async (client)
  onReady,                    // async (client)
  getSlashCommandDefinitions, // => { global: [], guild: [] }
  handleInteraction           // async (interaction) -> boolean
};
```

* **initialize** – prepare database tables, caches, listeners. Called before login.
* **onReady** – post-login setup (e.g. scheduling, cache warm-up).
* **handleInteraction** – route relevant interactions and return true when handled so the shared registry can short-circuit.

---

## Command Definition Guidelines

* Build commands with `SlashCommandBuilder` in `commands.js`.
* Return the builder instances; `commandManager` handles serialization.
* `getSlashCommandDefinitions()` must return `{ global: [...], guild: [...] }`.
* Favour guild-scoped commands unless the feature is safe globally.

---

## Event & Handler Wiring

* Interaction routing happens through the shared `interactionRegistry`.
* Register additional listeners (e.g. `MessageCreate`, `VoiceStateUpdate`) in `initialize`, but guard against double registration.
* Keep `index.js` tiny by delegating logic to `handlers/*` and helpers in `utils.js`.

---

## Database Access

* All SQL queries must use `getPool()` from `database.js`.
* Database bootstrap helpers (`ensureSchema`, cache warm-up) should live in `schema.js` when present, otherwise `utils.js`. Import those helpers inside `index.js.initialize`.
* Do not access the database in `commands.js`; keep persistence logic in handlers or utilities.

---

## Testing Expectations

* Add Jest coverage for new features.
* Import the module�s `index.js` (or a core helper) in tests to validate behaviour.
* Coverage thresholds remain enforced globally (92% statements/lines, 90% functions, 80% branches).

---

## Moderation Module Notes

The moderation agent has additional subfolders (`actions/`, `history/`, `roleConfig/`, etc.).
Interaction routing now lives in `moderation/handlers/interaction.js`, keeping `moderation/index.js` consistent with the shared interface. Continue to route new moderation features through these handlers.

---

## Adding a New Module

1. Create `/moduleName/` with the required files.
2. Implement `commands.js`, `handlers/interaction.js`, and `index.js` following the existing modules as examples (`tickets/` is a good starting point).
3. Wire the module into the root `index.js` by pushing it into both `commandModules` and `interactionModules`.
4. Add tests, README documentation, and any necessary database setup inside `initialize`.

Adhering to these standards keeps the codebase predictable and makes it straightforward to plug new agents into the Squadron 42 bot.
