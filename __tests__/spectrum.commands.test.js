jest.mock('../spectrum/config', () => ({
  getSlashCommandDefinitions: jest.fn(() => ({ guild: ['command'], global: [] }))
}));

const commands = require('../spectrum/commands');
const spectrumConfig = require('../spectrum/config');

test('spectrum commands delegates to config definitions', () => {
  expect(commands.getSlashCommandDefinitions()).toEqual({ guild: ['command'], global: [] });
  expect(spectrumConfig.getSlashCommandDefinitions).toHaveBeenCalled();
});
