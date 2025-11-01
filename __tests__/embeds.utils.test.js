const { buildEmbedsFromText, parseTemplateText, isLikelyTemplate } = require('../embeds/utils');

describe('embed template parser', () => {
  test('builds embed with title, color, fields, footer and timestamp', () => {
    const template = `
# Title: Welcome Aboard!
@color: blue
@thumbnail: https://example.com/thumb.png
@image: https://example.com/banner.png
Welcome to the Squadron!
Make sure you read #rules.
*Status:* Active | inline
*Motto:* "Fly smart."
---
Footer: Property of the UEE | https://example.com/logo.png
@timestamp: 2024-01-01T00:00:00Z
`;

    const embeds = buildEmbedsFromText(template);
    expect(embeds).toHaveLength(1);

    const embed = embeds[0].data;
    expect(embed.title).toBe('Welcome Aboard!');
    expect(embed.color).toBe(0x3b82f6); // blue mapping
    expect(embed.thumbnail.url).toBe('https://example.com/thumb.png');
    expect(embed.image.url).toBe('https://example.com/banner.png');
    expect(embed.description).toContain('Welcome to the Squadron!');
    expect(embed.description).toContain('Make sure you read #rules.');
    expect(embed.fields).toEqual([
      { name: 'Status', value: 'Active', inline: true },
      { name: 'Motto', value: '"Fly smart."', inline: false }
    ]);
    expect(embed.footer.text).toBe('Property of the UEE');
    expect(embed.footer.icon_url).toBe('https://example.com/logo.png');
    expect(embed.timestamp).toBe('2024-01-01T00:00:00.000Z');
  });

  test('supports multiple embeds separated by title or ---', () => {
    const template = `
# Title: First
First body line.
---
Footer: First footer
@timestamp: 2024-04-05T12:00:00Z
# Title: Second
Second description.
`;

    const embeds = parseTemplateText(template);
    expect(embeds).toHaveLength(2);
    expect(embeds[0].data.title).toBe('First');
    expect(embeds[0].data.footer.text).toBe('First footer');
    expect(embeds[1].data.title).toBe('Second');
    expect(embeds[1].data.description).toBe('Second description.');
  });

  test('throws when encountering unknown directives', () => {
    const template = `
# Title: Uh oh
@unknown: value
`;

    expect(() => parseTemplateText(template)).toThrow(/Unknown directive/i);
  });

  test('throws for unsupported color names', () => {
    const template = `
# Title: Bad color
@color: sparkles
`;

    expect(() => parseTemplateText(template)).toThrow(/Unsupported color value/i);
  });

  test('isLikelyTemplate detects directives', () => {
    expect(isLikelyTemplate('# Title: Hello')).toBe(true);
    expect(isLikelyTemplate('@color: red')).toBe(true);
    expect(isLikelyTemplate('*Field:* value')).toBe(true);
    expect(isLikelyTemplate('Plain note without directives')).toBe(false);
    expect(isLikelyTemplate('')).toBe(false);
  });
});
