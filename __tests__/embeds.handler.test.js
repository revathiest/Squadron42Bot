const { EmbedBuilder } = require('discord.js');

jest.mock('../embeds/utils', () => ({
  buildEmbedsFromText: jest.fn(),
  downloadAttachmentText: jest.fn(),
  isTemplateAttachment: jest.fn(),
  isLikelyTemplate: jest.fn(),
  canMemberUseTemplates: jest.fn(() => true),
  allowRoleForGuild: jest.fn(),
  removeRoleForGuild: jest.fn(),
  listAllowedRoles: jest.fn(),
  ensureSchema: jest.fn(),
  loadRoleCache: jest.fn(),
  clearRoleCache: jest.fn()
}));

const {
  buildEmbedsFromText,
  downloadAttachmentText,
  isTemplateAttachment,
  isLikelyTemplate,
  canMemberUseTemplates
} = require('../embeds/utils');
const { handleTemplateUpload, MAX_ATTACHMENTS_PER_MESSAGE } = require('../embeds/handlers/template');

describe('embed template handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    canMemberUseTemplates.mockReturnValue(true);
  });

  const makeAuthor = () => ({
    bot: false,
    send: jest.fn().mockResolvedValue(undefined)
  });

  const makeMember = () => ({
    guild: { id: 'guild-1' },
    permissions: { has: jest.fn().mockReturnValue(true) },
    roles: { cache: new Map([['role-allowed', true]]) }
  });

  test('ignores messages with no qualifying attachments', async () => {
    isTemplateAttachment.mockReturnValue(false);

    const author = makeAuthor();
    const message = {
      author,
      guild: { id: 'guild-1' },
      member: makeMember(),
      attachments: new Map([
        ['1', { id: '1', name: 'image.png', contentType: 'image/png' }]
      ])
    };

    const handled = await handleTemplateUpload(message);
    expect(handled).toBe(false);
    expect(downloadAttachmentText).not.toHaveBeenCalled();
  });

  test('processes up to MAX_ATTACHMENTS_PER_MESSAGE templates and sends embeds', async () => {
    isTemplateAttachment.mockReturnValue(true);
    downloadAttachmentText.mockResolvedValue('template text');
    buildEmbedsFromText.mockReturnValue([new EmbedBuilder().setDescription('Hello there!')]);
    isLikelyTemplate.mockReturnValue(true);

    const send = jest.fn().mockResolvedValue(undefined);
    const reply = jest.fn().mockResolvedValue(undefined);
    const deleteFn = jest.fn().mockResolvedValue(undefined);
    const attachments = new Map();
    for (let i = 0; i < MAX_ATTACHMENTS_PER_MESSAGE + 1; i += 1) {
      attachments.set(String(i), {
        id: String(i),
        name: `template-${i}.txt`,
        size: 512,
        url: `https://example.com/template-${i}.txt`
      });
    }

    const author = makeAuthor();
    const message = {
      id: '123',
      author,
      guild: { id: 'guild-1' },
      member: makeMember(),
      attachments,
      channel: { send },
      reply,
      delete: deleteFn
    };

    const handled = await handleTemplateUpload(message);

    expect(handled).toBe(true);
    expect(downloadAttachmentText).toHaveBeenCalledTimes(MAX_ATTACHMENTS_PER_MESSAGE);
    expect(buildEmbedsFromText).toHaveBeenCalledTimes(MAX_ATTACHMENTS_PER_MESSAGE);
    expect(send).toHaveBeenCalledTimes(MAX_ATTACHMENTS_PER_MESSAGE);
    expect(reply).not.toHaveBeenCalled(); // no errors
    expect(deleteFn).toHaveBeenCalledTimes(1);
  });

  test('replies with error when parsing fails', async () => {
    isTemplateAttachment.mockReturnValue(true);
    downloadAttachmentText.mockResolvedValue('template text');
    isLikelyTemplate.mockReturnValue(true);
    buildEmbedsFromText.mockImplementation(() => {
      throw new Error('bad template');
    });

    const send = jest.fn();
    const reply = jest.fn().mockResolvedValue(undefined);
    const deleteFn = jest.fn();
    const author = makeAuthor();
    const message = {
      id: '456',
      author,
      guild: { id: 'guild-1' },
      member: makeMember(),
      attachments: new Map([
        ['1', { id: '1', name: 'broken.txt', size: 100, url: 'https://example.com/broken.txt' }]
      ]),
      channel: { send },
      reply,
      delete: deleteFn
    };

    const handled = await handleTemplateUpload(message);

    expect(handled).toBe(false);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Failed to build embed')
    }));
    expect(deleteFn).not.toHaveBeenCalled();
  });

  test('falls back to plain text post when template markers are absent', async () => {
    isTemplateAttachment.mockReturnValue(true);
    const firstChunk = 'A'.repeat(1980);
    const secondChunk = 'More notes after the break.';
    downloadAttachmentText.mockResolvedValue(`${firstChunk}\n${secondChunk}`);
    isLikelyTemplate.mockReturnValue(false);

    const send = jest.fn().mockResolvedValue(undefined);
    const reply = jest.fn();
    const deleteFn = jest.fn().mockResolvedValue(undefined);

    const author = makeAuthor();
    const message = {
      id: '789',
      author,
      guild: { id: 'guild-1' },
      member: makeMember(),
      attachments: new Map([
        ['1', { id: '1', name: 'notes.txt', size: 50, url: 'https://example.com/notes.txt' }]
      ]),
      channel: { send },
      reply,
      delete: deleteFn
    };

    const handled = await handleTemplateUpload(message);

    expect(handled).toBe(true);
    expect(buildEmbedsFromText).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(2);
    const posted = send.mock.calls.map(call => call[0].content).join('');
    expect(posted).toBe(`${firstChunk}${secondChunk}`);
    expect(Array.from(send.mock.calls[0][0].content).length).toBe(1980);
    send.mock.calls.forEach(call => {
      expect(Array.from(call[0].content).length).toBeLessThanOrEqual(2000);
    });
    expect(deleteFn).toHaveBeenCalledTimes(1);
  });

  test('fallback honours byte limits with multi-byte characters', async () => {
    isTemplateAttachment.mockReturnValue(true);
    const emojiString = '🙂'.repeat(4500);
    downloadAttachmentText.mockResolvedValue(emojiString);
    isLikelyTemplate.mockReturnValue(false);

    const send = jest.fn().mockResolvedValue(undefined);
    const reply = jest.fn();
    const deleteFn = jest.fn().mockResolvedValue(undefined);

    const author = makeAuthor();
    const message = {
      id: '890',
      author,
      guild: { id: 'guild-1' },
      member: makeMember(),
      attachments: new Map([
        ['1', { id: '1', name: 'emoji.txt', size: 3000, url: 'https://example.com/emoji.txt' }]
      ]),
      channel: { send },
      reply,
      delete: deleteFn
    };

    const handled = await handleTemplateUpload(message);

    expect(handled).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
    const first = send.mock.calls[0][0].content;
    const second = send.mock.calls[1][0].content;
    const third = send.mock.calls[2][0].content;
    expect(Array.from(first).length).toBe(2000);
    expect(Array.from(second).length).toBe(2000);
    expect(Array.from(third).length).toBe(500);
    for (const call of send.mock.calls) {
      expect(Array.from(call[0].content).length).toBeLessThanOrEqual(2000);
    }
    const combined = send.mock.calls.map(call => call[0].content).join('');
    expect(combined).toBe(emojiString);
    expect(deleteFn).toHaveBeenCalledTimes(1);
  });

  test('denies uploads when member lacks permission', async () => {
    canMemberUseTemplates.mockReturnValue(false);
    isTemplateAttachment.mockReturnValue(true);
    const reply = jest.fn().mockResolvedValue(undefined);
    const deleteFn = jest.fn().mockResolvedValue(undefined);

    const author = makeAuthor();
    const message = {
      id: '999',
      author,
      guild: { id: 'guild-1', members: { fetch: jest.fn().mockResolvedValue(null) } },
      member: null,
      attachments: new Map([
        ['1', { id: '1', name: 'template.txt', size: 10, url: 'https://example.com/template.txt' }]
      ]),
      channel: { send: jest.fn() },
      reply,
      delete: deleteFn
    };

    const handled = await handleTemplateUpload(message);

    expect(handled).toBe(true);
    expect(downloadAttachmentText).not.toHaveBeenCalled();
    expect(author.send).toHaveBeenCalledWith(expect.stringContaining('permission'));
    expect(deleteFn).toHaveBeenCalled();
  });
});
