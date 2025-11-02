const commands = require('../spectrum/commands');

describe('spectrum command definitions', () => {
  test('exposes guild-scoped /spectrum builder', () => {
    const defs = commands.getSlashCommandDefinitions();
    expect(defs.global).toEqual([]);
    expect(defs.guild).toHaveLength(1);

    const builder = defs.guild[0];
    const json = builder.toJSON();
    expect(json.name).toBe('spectrum');
    expect(json.options.map(option => option.name)).toEqual(
      expect.arrayContaining(['set-channel', 'set-forum', 'clear', 'post-latest'])
    );
  });
});
