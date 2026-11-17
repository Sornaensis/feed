import { safeUrl } from './model.js?v=6';

const ALLOWED = new Set(['P', 'BR', 'STRONG', 'EM', 'B', 'I', 'S', 'DEL', 'U', 'BLOCKQUOTE', 'PRE', 'CODE', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'SPAN', 'SUP', 'SUB', 'FIGURE', 'FIGCAPTION']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'LINK', 'META', 'BASE', 'TEMPLATE', 'NOSCRIPT', 'VIDEO', 'AUDIO', 'SOURCE']);

// A template is inert: untrusted source HTML never enters the live document.
// Rebuild an allowlisted tree. Media players are constructed separately from
// structured source data; source HTML can supply only validated plain images.
export function sanitizedFragment(html, baseUrl) {
  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  const fragment = document.createDocumentFragment();
  function copy(node, parent, depth = 0) {
    if (depth > 80) return;
    if (node.nodeType === 3) { parent.append(document.createTextNode(node.textContent)); return; }
    if (node.nodeType !== 1 || DROP.has(node.tagName)) return;
    if (node.tagName === 'IMG') {
      const src = safeUrl(node.getAttribute('src'), baseUrl);
      if (!src) return;
      const image = document.createElement('img');
      image.src = src;
      image.alt = String(node.getAttribute('alt') || '').slice(0, 2000);
      image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => {
        const fallback = document.createElement('a');
        fallback.href = src; fallback.target = '_blank'; fallback.rel = 'noopener noreferrer';
        fallback.textContent = image.alt ? `Open image: ${image.alt}` : 'Open image at source';
        image.replaceWith(fallback);
      }, { once: true });
      parent.append(image);
      return;
    }
    const allowed = ALLOWED.has(node.tagName);
    const target = allowed ? document.createElement(node.tagName.toLowerCase()) : parent;
    if (node.tagName === 'A') {
      const href = safeUrl(node.getAttribute('href'), baseUrl);
      if (href) { target.href = href; target.target = '_blank'; target.rel = 'noopener noreferrer'; }
    }
    for (const child of node.childNodes) copy(child, target, depth + 1);
    if (allowed) parent.append(target);
  }
  for (const node of template.content.childNodes) copy(node, fragment);
  return fragment;
}
