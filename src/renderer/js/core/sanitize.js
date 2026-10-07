const ALLOWED_TAGS = new Set([
  'P', 'DIV', 'SPAN', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'LI',
  'A', 'IMG', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH',
  'HR', 'PRE', 'CODE', 'SUB', 'SUP', 'MARK', 'FONT', 'SECTION', 'FIGURE', 'FIGCAPTION'
]);

const ALLOWED_STYLE = new Set([
  'color', 'background-color', 'font-family', 'font-size', 'font-weight',
  'font-style', 'text-decoration', 'text-align', 'line-height',
  'margin-left', 'margin-right', 'margin-top', 'margin-bottom',
  'padding-left', 'padding-right', 'padding-top', 'padding-bottom',
  'border', 'border-collapse', 'border-color', 'border-style', 'border-width',
  'width', 'height', 'max-width', 'vertical-align', 'list-style-type',
  'white-space', 'opacity'
]);

function safeUrl(value) {
  const url = String(value || '').trim();
  if (/^(https?:|mailto:|tel:|#|\/|data:image\/)/i.test(url)) return url;
  if (/^javascript:/i.test(url) || /^vbscript:/i.test(url)) return '';
  if (!url.includes(':')) return url;
  return '';
}

function cleanStyle(cssText) {
  const decls = [];
  for (const part of String(cssText || '').split(';')) {
    const idx = part.indexOf(':');
    if (idx < 0) continue;
    const prop = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim();
    if (!prop || !value) continue;
    if (!ALLOWED_STYLE.has(prop)) continue;
    if (/expression\s*\(|javascript:/i.test(value)) continue;
    decls.push(prop + ': ' + value);
  }
  return decls.join('; ');
}

function convertFontElement(font) {
  const span = document.createElement('span');
  const style = [];
  const face = font.getAttribute('face');
  const color = font.getAttribute('color');
  const size = font.getAttribute('size');
  if (face) style.push('font-family: ' + face);
  if (color) style.push('color: ' + color);
  if (size) {
    const map = { 1: '10px', 2: '13px', 3: '16px', 4: '18px', 5: '24px', 6: '32px', 7: '48px' };
    style.push('font-size: ' + (map[size] || '16px'));
  }
  if (style.length) span.setAttribute('style', style.join('; '));
  while (font.firstChild) span.append(font.firstChild);
  return span;
}

function walk(node, handler) {
  const children = Array.from(node.childNodes);
  for (const child of children) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      walk(child, handler);
      handler(child);
    } else if (child.nodeType === Node.COMMENT_NODE) {
      child.remove();
    }
  }
}

export function sanitizeHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString('<div id="root">' + html + '</div>', 'text/html');
  const root = doc.getElementById('root');
  if (!root) return '';

  walk(root, (node) => {
    const tag = node.tagName;

    if (tag === 'FONT') {
      node.replaceWith(convertFontElement(node));
      return;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      const parent = node.parentNode;
      if (!parent) return;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME' || tag === 'OBJECT' || tag === 'LINK' || tag === 'META') {
        node.remove();
        return;
      }
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
      node.remove();
      return;
    }

    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      if (name === 'style') {
        const cleaned = cleanStyle(attr.value);
        if (cleaned) node.setAttribute('style', cleaned);
        else node.removeAttribute('style');
        continue;
      }
      if (name === 'src') {
        if (tag !== 'IMG') { node.removeAttribute(attr.name); continue; }
        const val = safeUrl(attr.value);
        if (val) node.setAttribute('src', val);
        else node.remove();
        continue;
      }
      if (name === 'href') {
        const val = safeUrl(attr.value);
        if (val) node.setAttribute('href', val);
        else node.removeAttribute('href');
        continue;
      }
      if (name === 'class') {
        node.removeAttribute('class');
        continue;
      }
      const allowedGlobal = ['colspan', 'rowspan', 'alt', 'title', 'target', 'rel', 'width', 'height', 'start', 'type'];
      if (name === 'target') {
        node.setAttribute('rel', 'noopener');
        continue;
      }
      if (name === 'type' && tag !== 'OL' && tag !== 'UL') {
        node.removeAttribute(attr.name);
        continue;
      }
      if (!allowedGlobal.includes(name)) node.removeAttribute(attr.name);
    }

    if (tag === 'A') {
      const href = node.getAttribute('href') || '';
      if (/^https?:/i.test(href)) node.setAttribute('rel', 'noopener');
      if (node.getAttribute('target') === '_blank') node.setAttribute('target', '_blank');
    }

    if (tag === 'IMG') {
      if (!node.getAttribute('src')) node.remove();
    }
  });

  return root.innerHTML;
}

export function sanitizeTextToHtml(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  return lines.map((line) => {
    const clean = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return clean.trim() ? '<p>' + clean + '</p>' : '<p><br></p>';
  }).join('');
}
