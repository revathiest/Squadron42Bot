const voiceRooms = require('../voiceRooms');
const utils = require('../voiceRooms/utils');

test('voiceRooms utils proxies core helpers', () => {
  expect(utils.templateCache).toBe(voiceRooms.__testables.templateCache);
  expect(utils.tempChannelCache).toBe(voiceRooms.__testables.tempChannelCache);

  const interaction = { isChatInputCommand: () => false };
  expect(typeof utils.addTemplateToCache).toBe('function');
  expect(utils.isTemplateChannel('guild', 'channel')).toBe(false);
});
