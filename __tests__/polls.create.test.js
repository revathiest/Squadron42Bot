const createHandler = require('../polls/handlers/create');
const { buildPollComponents } = require('../polls/render');

describe('polls create handler utilities', () => {
  const { createSession, getSession, renderControlPanel, MAX_OPTIONS } = createHandler.__testables;

  test('createSession initialises defaults', () => {
    const interaction = {
      user: { id: 'creator-1' },
      guildId: 'guild-1',
      channelId: 'channel-1'
    };

    const session = createSession(interaction);
    expect(session.question).toBeNull();
    expect(session.options).toEqual([]);
    expect(session.isMulti).toBe(false);
    expect(getSession(session.id)).toBeDefined();
  });

  test('renderControlPanel disables publish until ready', () => {
    const baseInteraction = {
      user: { id: 'creator-2' },
      guildId: 'guild-1',
      channelId: 'channel-1'
    };
    const session = createSession(baseInteraction);

    let panel = renderControlPanel(session);
    const publishButton = panel.components[1].components[1];
    expect(publishButton.data.disabled).toBe(true);

    session.question = 'Favourite colour?';
    session.options = [
      { id: 'opt-1', label: 'Red' },
      { id: 'opt-2', label: 'Blue' }
    ];
    session.expiresAt = new Date(Date.now() + 3600_000);

    panel = renderControlPanel(session);
    const updatedPublish = panel.components[1].components[1];
    expect(updatedPublish.data.disabled).toBe(false);
  });

  test('renderControlPanel includes close button when published', () => {
    const interaction = {
      user: { id: 'creator-3' },
      guildId: 'guild-1',
      channelId: 'channel-1'
    };
    const session = createSession(interaction);
    session.status = 'published';
    session.pollId = 42;
    session.options = [
      { id: 'opt-1', label: 'Option 1' },
      { id: 'opt-2', label: 'Option 2' }
    ];
    session.expiresAt = new Date(Date.now() + 3600_000);
    session.question = 'A question';

    const panel = renderControlPanel(session);
    const closeRow = panel.components[panel.components.length - 1];
    expect(closeRow.components[0].data.custom_id).toContain('polls:ctrl:close');
  });

  test('MAX_OPTIONS exposes component limit', () => {
    expect(MAX_OPTIONS).toBe(25);
  });

  test('buildPollComponents adds close button while poll is open', () => {
    const rows = buildPollComponents({
      poll: { id: 11, closed_at: null },
      options: [{ id: 101, position: 1, label: 'Option', votes: 0 }],
      disabled: false
    });
    const hasClose = rows.some(row =>
      row.components.some(component => component.data.custom_id === 'polls:close:11')
    );
    expect(hasClose).toBe(true);
  });
});
