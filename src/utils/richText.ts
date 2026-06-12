export function normalizeRichTextForPage(html?: string): string {
  if (!html) return '';

  if (typeof window === 'undefined') {
    return html
      .replace(/&nbsp;/gi, ' ')
      .replace(/\u00A0/g, ' ')
      .replace(/\u00AD/g, '');
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);

  const textNodes: Node[] = [];
  let current: Node | null = walker.nextNode();

  while (current) {
    textNodes.push(current);
    current = walker.nextNode();
  }

  textNodes.forEach((node) => {
    node.textContent = (node.textContent || '')
      .replace(/\u00A0/g, ' ')
      .replace(/\u00AD/g, '');
  });

  return doc.body.innerHTML;
}
