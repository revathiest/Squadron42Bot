const { buildDescriptionFromThread } = require('../spectrum/watcher/descriptionBuilder');

describe('spectrum descriptionBuilder', () => {
  test('collapses Known Issues section into count summary', () => {
    const threadDetails = {
      content_blocks: [
        {
          type: 'text',
          data: {
            blocks: [
              { type: 'header-one', text: 'Features' },
              { type: 'unstyled', text: 'New gameplay feature added' },
              { type: 'header-two', text: 'Known Issues' },
              { type: 'unordered-list-item', text: 'Issue 1' },
              { type: 'unordered-list-item', text: 'Issue 2' },
              { type: 'unordered-list-item', text: 'Issue 3' },
              { type: 'unstyled', text: 'Some additional freeform text about issues' }
            ]
          }
        }
      ]
    };

    const result = buildDescriptionFromThread(threadDetails);

    // Should contain the Features section
    expect(result).toContain('**Features**');
    expect(result).toContain('New gameplay feature added');

    // Should NOT contain the individual Known Issues items
    expect(result).not.toContain('Issue 1');
    expect(result).not.toContain('Issue 2');
    expect(result).not.toContain('Issue 3');
    expect(result).not.toContain('Some additional freeform text about issues');

    // Should contain a summary count
    expect(result).toContain('Known Issues: 3');
  });

  test('collapses Bug Fixes section into count summary', () => {
    const threadDetails = {
      content_blocks: [
        {
          type: 'text',
          data: {
            blocks: [
              { type: 'header-one', text: 'Gameplay' },
              { type: 'unstyled', text: 'Important gameplay changes' },
              { type: 'header-two', text: 'Bug Fixes' },
              { type: 'unordered-list-item', text: 'Fixed issue A' },
              { type: 'unordered-list-item', text: 'Fixed issue B' }
            ]
          }
        }
      ]
    };

    const result = buildDescriptionFromThread(threadDetails);

    // Should contain the Gameplay section
    expect(result).toContain('**Gameplay**');
    expect(result).toContain('Important gameplay changes');

    // Should NOT contain the individual Bug Fix items
    expect(result).not.toContain('Fixed issue A');
    expect(result).not.toContain('Fixed issue B');

    // Should contain a summary count
    expect(result).toContain('Bug Fixes: 2');
  });

  test('handles both Known Issues and Bug Fixes together', () => {
    const threadDetails = {
      content_blocks: [
        {
          type: 'text',
          data: {
            blocks: [
              { type: 'header-one', text: 'Features' },
              { type: 'unstyled', text: 'New content' },
              { type: 'header-two', text: 'Bug Fixes' },
              { type: 'unordered-list-item', text: 'Fix 1' },
              { type: 'unordered-list-item', text: 'Fix 2' },
              { type: 'header-two', text: 'Known Issues' },
              { type: 'unordered-list-item', text: 'Known 1' },
              { type: 'unordered-list-item', text: 'Known 2' },
              { type: 'unordered-list-item', text: 'Known 3' }
            ]
          }
        }
      ]
    };

    const result = buildDescriptionFromThread(threadDetails);

    // Should contain Features
    expect(result).toContain('**Features**');
    expect(result).toContain('New content');

    // Should have both summaries
    expect(result).toContain('Bug Fixes: 2');
    expect(result).toContain('Known Issues: 3');

    // Should NOT contain individual items
    expect(result).not.toContain('Fix 1');
    expect(result).not.toContain('Known 1');
  });

  test('preserves regular content sections', () => {
    const threadDetails = {
      content_blocks: [
        {
          type: 'text',
          data: {
            blocks: [
              { type: 'header-one', text: 'Alpha Patch 4.2' },
              { type: 'unstyled', text: 'Released to all backers' },
              { type: 'header-two', text: 'Testing Focus' },
              { type: 'unordered-list-item', text: 'Test item 1' },
              { type: 'unordered-list-item', text: 'Test item 2' }
            ]
          }
        }
      ]
    };

    const result = buildDescriptionFromThread(threadDetails);

    // All content should be preserved since there's no Known Issues/Bug Fixes
    expect(result).toContain('**Alpha Patch 4.2**');
    expect(result).toContain('Released to all backers');
    expect(result).toContain('__Testing Focus__');
    expect(result).toContain('- Test item 1');
    expect(result).toContain('- Test item 2');
  });
});
