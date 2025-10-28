jest.mock('../voiceRooms/core', () => ({
  onVoiceStateUpdate: jest.fn().mockResolvedValue(undefined)
}));

const core = require('../voiceRooms/core');
const { handleVoiceStateUpdate } = require('../voiceRooms/handlers/voiceState');

test('handleVoiceStateUpdate forwards to core implementation', async () => {
  const oldState = { id: 'old' };
  const newState = { id: 'new' };

  await handleVoiceStateUpdate(oldState, newState);

  expect(core.onVoiceStateUpdate).toHaveBeenCalledWith(oldState, newState);
});
