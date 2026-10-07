import { htmlToDocx, docxToHtml } from './docx.js';
import { htmlToOdt, odtToHtml } from './odt.js';
import { sanitizeHtml, sanitizeTextToHtml } from './sanitize.js';
import { readFileAsText, readFileAsArrayBuffer } from './util.js';

export const IMPORT_FORMATS = ['docx', 'odt', 'txt', 'md', 'html', 'htm'];
export const EXPORT_FORMATS = ['pdf', 'docx', 'odt', 'txt', 'html'];

function escapeHtmlText(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function htmlToText(html) {
  const root = document.implementation.createHTMLDocument('').createElement('div');
  root.innerHTML = html || '';
  const lines = [];

  function inlineText(node, listPrefix = '') {
    let text = '';
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) text += child.nodeValue;
      else if (child.nodeName === 'BR') text += '\n';
      else if (child.nodeName === 'IMG') text += '[imagen]';
      else if (/^H[1-6]$/.test(child.nodeName)) text += child.textContent + '\n\n';
      else if (child.nodeName === 'LI') continue;
      else text += inlineText(child);
    }
    return text;
  }

  function walkList(list, depth, counter) {
    const items = Array.from(list.children).filter((c) => c.nodeName === 'LI');
    items.forEach((li, i) => {
      const indent = '  '.repeat(depth);
      const marker = list.nodeName === 'OL' ? `${i + 1}. ` : '• ';
      const clone = li.cloneNode(true);
      Array.from(clone.querySelectorAll('ul, ol')).forEach((n) => n.remove());
      lines.push(indent + marker + inlineText(clone).trim());
      Array.from(li.children).filter((c) => c.nodeName === 'UL' || c.nodeName === 'OL').forEach((nested) => {
        walkList(nested, depth + 1, counter);
      });
    });
  }

  for (const node of Array.from(root.children)) {
    const tag = node.nodeName;
    if (/^H[1-6]$/.test(tag)) {
      lines.push(inlineText(node).trim(), '');
    } else if (tag === 'P' || tag === 'DIV' || tag === 'BLOCKQUOTE') {
      const t = inlineText(node).trim();
      if (t) lines.push(t, '');
      else lines.push('');
    } else if (tag === 'UL' || tag === 'OL') {
      walkList(node, 0, {});
      lines.push('');
    } else if (tag === 'TABLE') {
      Array.from(node.querySelectorAll('tr')).forEach((tr) => {
        const cells = Array.from(tr.children).map((c) => c.textContent.trim().replace(/\s+/g, ' '));
        lines.push(cells.join('\t'));
      });
      lines.push('');
    } else if (tag === 'HR') {
      lines.push('----------', '');
    } else if (tag === 'IMG') {
      lines.push('[imagen]', '');
    } else {
      const t = inlineText(node).trim();
      if (t) lines.push(t, '');
    }
  }

  let text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return text + '\n';
}

export function htmlToStandaloneDocument(title, html) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtmlText(title || 'Documento')}</title>
<style>
  body { font-family: "Segoe UI", Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 24px; color: #1f2430; line-height: 1.6; font-size: 16px; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.2em 0 .5em; }
  blockquote { border-left: 3px solid #4f46e5; margin: 1em 0; padding: .3em 0 .3em 1em; color: #5b6172; font-style: italic; }
  img { max-width: 100%; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  td, th { border: 1px solid #d3d7e3; padding: 7px 10px; }
  th { background: #f0f1f6; text-align: left; }
  a { color: #4f46e5; }
  hr { border: none; border-top: 1.5px solid #d3d7e3; margin: 1.2em 0; }
  .page-break { border-top: 2px dashed #4f46e5; margin: 1.5em 0; }
  @media print { body { margin: 0; } .page-break { break-after: page; border: none; } }
</style>
</head>
<body>
${html}
</body>
</html>
`;
}

export async function exportDocument({ format, name, html, header, footer, showPageNum }) {
  const base = (name || 'documento').replace(/[\\/:*?"<>|]/g, '_');

  if (format === 'txt') {
    const text = htmlToText(html);
    return { blob: new Blob([text], { type: 'text/plain;charset=utf-8' }), filename: base + '.txt' };
  }

  if (format === 'html') {
    const doc = htmlToStandaloneDocument(name, html);
    return { blob: new Blob([doc], { type: 'text/html;charset=utf-8' }), filename: base + '.html' };
  }

  if (format === 'docx') {
    const bytes = await htmlToDocx({ html, header, footer, showPageNum, title: name });
    return {
      blob: new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
      filename: base + '.docx'
    };
  }

  if (format === 'odt') {
    const bytes = await htmlToOdt({ html, title: name });
    return {
      blob: new Blob([bytes], { type: 'application/vnd.oasis.opendocument.text' }),
      filename: base + '.odt'
    };
  }

  if (format === 'pdf') {
    return { print: true, filename: base + '.pdf' };
  }

  throw new Error('Formato no soportado: ' + format);
}

export async function importDocumentFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const base = file.name.replace(/\.[^.]+$/, '');

  if (ext === 'txt' || ext === 'md') {
    const text = await readFileAsText(file);
    return { html: sanitizeTextToHtml(text), title: base };
  }

  if (ext === 'html' || ext === 'htm') {
    const text = await readFileAsText(file);
    const parsed = new DOMParser().parseFromString(text, 'text/html');
    const body = parsed.body ? parsed.body.innerHTML : text;
    return { html: sanitizeHtml(body), title: parsed.title || base };
  }

  if (ext === 'docx') {
    const buffer = await readFileAsArrayBuffer(file);
    const result = await docxToHtml(new Uint8Array(buffer));
    return { html: sanitizeHtml(result.html), title: result.title || base };
  }

  if (ext === 'odt') {
    const buffer = await readFileAsArrayBuffer(file);
    const result = await odtToHtml(new Uint8Array(buffer));
    return { html: sanitizeHtml(result.html), title: result.title || base };
  }

  throw new Error('Formato no reconocido: .' + ext);
}
