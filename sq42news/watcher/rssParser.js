// Minimal RSS 2.0 / Atom parser for the specific feeds used by sq42news.
// Handles CDATA, namespaced tags, and attribute extraction without a full XML library.

function escapeTag(tag) {
  // Escape regex specials except `:` which we handle separately for namespaces
  return tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(':', '\\:');
}

// Extract text content from the first matching open/close tag pair.
// Handles <![CDATA[...]]> sections.
function tagContent(xml, tag) {
  const t = escapeTag(tag);
  const re = new RegExp(
    `<${t}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${t}>`,
    'i'
  );
  const m = re.exec(xml);
  if (!m) return '';
  return (m[1] !== undefined ? m[1] : m[2] ?? '').trim();
}

// Extract an attribute value from the first matching tag (open or self-closing).
// Uses [^>]* so it works even when the target attribute is the first one on the tag.
function tagAttr(xml, tag, attr) {
  const t = escapeTag(tag);
  const re = new RegExp(`<${t}[^>]*\\s${attr}="([^"]*)"`, 'i');
  const m = re.exec(xml);
  return m ? m[1] : '';
}

// Split the document into individual item/entry blocks.
function splitBlocks(xml, tag) {
  const t = escapeTag(tag);
  const re = new RegExp(`<${t}[\\s>][\\s\\S]*?<\\/${t}>`, 'gi');
  const blocks = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    blocks.push(m[0]);
  }
  return blocks;
}

// Parse RSS 2.0 feed into an array of plain objects.
function parseRss(xml) {
  return splitBlocks(xml, 'item').map(block => {
    const linkText = tagContent(block, 'link');
    const linkHref = tagAttr(block, 'link', 'href');
    return {
      title: tagContent(block, 'title'),
      link: linkText || linkHref,
      guid: tagContent(block, 'guid') || linkText || linkHref,
      pubDate: tagContent(block, 'pubDate'),
      description: tagContent(block, 'description'),
      sourceName: tagContent(block, 'source'),
      sourceUrl: tagAttr(block, 'source', 'url'),
      author: tagContent(block, 'author') || tagContent(block, 'dc:creator'),
    };
  });
}

// Parse Atom feed (YouTube) into an array of plain objects.
function parseAtom(xml) {
  return splitBlocks(xml, 'entry').map(block => {
    const rawId = tagContent(block, 'yt:videoId') || tagContent(block, 'id');
    const videoId = rawId.startsWith('yt:video:') ? rawId.slice('yt:video:'.length) : rawId;
    return {
      id: videoId,
      title: tagContent(block, 'title'),
      link: tagAttr(block, 'link', 'href'),
      published: tagContent(block, 'published'),
      author: tagContent(block, 'name'),
      thumbnailUrl: tagAttr(block, 'media:thumbnail', 'url'),
      description: tagContent(block, 'media:description'),
    };
  });
}

module.exports = { tagContent, tagAttr, splitBlocks, parseRss, parseAtom };
