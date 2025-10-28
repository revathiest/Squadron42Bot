const tickets = require('../tickets');
const utils = require('../tickets/utils');

test('tickets utils exposes core caches', () => {
  expect(utils.settingsCache).toBe(tickets.__testables.settingsCache);
  expect(utils.rolesCache).toBe(tickets.__testables.rolesCache);
  expect(utils.openTickets).toBe(tickets.__testables.openTickets);
});
