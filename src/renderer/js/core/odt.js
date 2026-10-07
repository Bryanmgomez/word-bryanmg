import { createZip, readZip, bytesToText } from './zip.js';

const OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
const TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
const TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const DRAW = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0';
const STYLE = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
const FO = 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0';
const XLINK = 'http://www.w3.org/1999/xlink';
const SVG = 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cleanHex(color) {
  if (!color) return '';
  let hex = String(color).trim();
  if (hex.startsWith('#')) hex = hex.slice(1);
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  return /^[0-9a-fA-F]{6}$/.test(hex) ? '#' + hex.toLowerCase() : '';
}

function extFromDataUrl(src) {
  const m = /^data:image\/([a-z0-9.+-]+);/i.exec(src || '');
  if (!m) return 'png';
  const ext = m[1].toLowerCase();
  if (ext === 'jpeg') return 'jpg';
  return ['png', 'jpg', 'gif', 'webp', 'bmp'].includes(ext) ? ext : 'png';
}

function mimeFromExt(ext) {
  return { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' }[ext] || 'application/octet-stream';
}

function dataUrlToBytes(src) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(src || '');
  if (!m) return null;
  if (m[2]) {
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  return new TextEncoder().decode(decodeURIComponent(m[3]));
}

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function pxToPt(px) {
  return Math.round(px * 0.75 * 10) / 10;
}

/* ================= EXPORTACIÓN ================= */

class OdtBuilder {
  constructor({ html, title }) {
    this.title = title || '';
    this.root = document.implementation.createHTMLDocument('').createElement('div');
    this.root.innerHTML = html || '<p><br></p>';
    this.autoStyles = [];
    this.fontFaces = new Set();
    this.paragraphStyles = new Map();
    this.textStyles = new Map();
    this.images = [];
    this.imageSeq = 0;
    this.out = [];
  }

  registerParagraphStyle(css) {
    if (!css.align && !css.lineHeight && !css.marginLeft && !css.breakBefore) return '';
    const key = JSON.stringify(css);
    if (this.paragraphStyles.has(key)) return this.paragraphStyles.get(key);
    const name = 'P' + (this.paragraphStyles.size + 1);
    const props = [];
    if (css.breakBefore) props.push('<style:paragraph-properties fo:break-before="page"/>');
    if (css.align) props.push(`<style:paragraph-properties fo:text-align="${css.align}"/>`);
    if (css.lineHeight) props.push(`<style:paragraph-properties fo:line-height="${Math.round(css.lineHeight * 100)}%"/>`);
    if (css.marginLeft) props.push(`<style:paragraph-properties fo:margin-left="${pxToPt(css.marginLeft)}pt" fo:margin-right="0pt"/>`);
    const merged = mergePropXml(props);
    this.autoStyles.push(`<style:style style:name="${name}" style:family="paragraph">${merged}</style:style>`);
    this.paragraphStyles.set(key, name);
    return name;
  }

  registerTextStyle(props) {
    const key = JSON.stringify(props);
    if (this.textStyles.has(key)) return this.textStyles.get(key);
    const name = 'T' + (this.textStyles.size + 1);
    const xml = [];
    if (props.b) xml.push('<style:text-properties fo:font-weight="bold"/>');
    if (props.i) xml.push('<style:text-properties fo:font-style="italic"/>');
    const deco = [];
    if (props.u) deco.push('<style:text-properties style:text-underline-style="solid" style:text-underline-width="auto"/>');
    if (props.strike) deco.push('<style:text-properties style:text-line-through-style="solid"/>');
    if (props.color) xml.push(`<style:text-properties fo:color="${props.color}"/>`);
    if (props.bg) xml.push(`<style:text-properties fo:background-color="${props.bg}"/>`);
    if (props.fontSize) xml.push(`<style:text-properties fo:font-size="${props.fontSize}pt"/>`);
    if (props.font) {
      xml.push(`<style:text-properties style:font-name="${esc(props.font)}"/>`);
      this.fontFaces.add(props.font);
    }
    this.autoStyles.push(`<style:style style:name="${name}" style:family="text">${xml.join('')}${deco.join('')}</style:style>`);
    this.textStyles.set(key, name);
    return name;
  }

  async build() {
    const blocks = Array.from(this.root.children);
    const nodes = blocks.length ? blocks : [this.root];
    for (const node of nodes) await this.emitBlock(node, 0);

    const contentXml = this.contentXml();
    const entries = [
      { name: 'mimetype', data: 'application/vnd.oasis.opendocument.text', store: true },
      { name: 'META-INF/manifest.xml', data: this.manifestXml() },
      { name: 'content.xml', data: contentXml },
      { name: 'styles.xml', data: STYLES_XML },
      { name: 'meta.xml', data: this.metaXml() }
    ];
    for (const img of this.images) {
      entries.push({ name: 'Pictures/' + img.name, data: img.bytes });
    }
    return createZip(entries);
  }

  manifestXml() {
    const imgEntries = this.images.map((img) =>
      `<manifest:file-entry manifest:full-path="Pictures/${img.name}" manifest:media-type="${mimeFromExt(img.name.split('.').pop())}"/>`
    ).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>${imgEntries}</manifest:manifest>`;
  }

  metaXml() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="${OFFICE}" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.3"><office:meta><dc:title>${esc(this.title)}</dc:title><meta:generator>Word BryanMG</meta:generator></office:meta></office:document-meta>`;
  }

  contentXml() {
    const fontFaces = Array.from(this.fontFaces).map((f) =>
      `<style:font-face style:name="${esc(f)}" svg:font-family="'${esc(f)}'"/>`
    ).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="${OFFICE}" xmlns:text="${TEXT}" xmlns:table="${TABLE}" xmlns:draw="${DRAW}" xmlns:svg="${SVG}" xmlns:xlink="${XLINK}" xmlns:fo="${FO}" xmlns:style="${STYLE}" office:version="1.3"><office:font-face-decls>${fontFaces}</office:font-face-decls><office:automatic-styles>${LIST_STYLES}${this.autoStyles.join('')}</office:automatic-styles><office:body><office:text>${this.out.join('')}</office:text></office:body></office:document-content>`;
  }

  async emitBlock(node, depth) {
    const tag = node.tagName?.toUpperCase();
    if (!tag) return;

    if (/^H[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      const styleName = 'Heading_20_' + level;
      const inner = await this.inline(Array.from(node.childNodes), {});
      this.out.push(`<text:h text:style-name="${styleName}" text:outline-level="${level}">${inner}</text:h>`);
      return;
    }
    if (tag === 'P') return this.out.push(await this.paragraph(node));
    if (tag === 'BLOCKQUOTE') {
      const inner = await this.inline(Array.from(node.childNodes), {});
      const styleName = this.registerTextStyle({ i: true, color: '#5b6172' });
      this.out.push(`<text:p text:style-name="QuoteP"><text:span text:style-name="${styleName}">${inner}</text:span></text:p>`);
      return;
    }
    if (tag === 'UL' || tag === 'OL') return this.emitList(node, depth, tag);
    if (tag === 'TABLE') return this.emitTable(node);
    if (tag === 'HR') {
      this.out.push('<text:p text:style-name="Horizontal_20_Line"/>');
      return;
    }
    if (node.classList?.contains('page-break')) {
      this.out.push('<text:p text:style-name="PageBreakP"/>');
      return;
    }
    if (tag === 'IMG') {
      const frame = await this.imageFrame(node);
      if (frame) this.out.push(`<text:p>${frame}</text:p>`);
      return;
    }
    if (tag === 'DIV' || tag === 'SECTION' || tag === 'FIGURE') {
      const children = Array.from(node.children);
      if (children.length) {
        for (const child of children) await this.emitBlock(child, depth);
        return;
      }
    }
    this.out.push(await this.paragraph(node));
  }

  async paragraph(node) {
    const st = node.style || {};
    const css = {};
    if (st.textAlign && st.textAlign !== 'start' && st.textAlign !== 'left') {
      css.align = { center: 'center', right: 'right', justify: 'justify' }[st.textAlign] || st.textAlign;
    }
    const lh = parseFloat(st.lineHeight);
    if (lh && Number.isFinite(lh)) css.lineHeight = lh;
    const ml = parseFloat(st.marginLeft);
    if (ml > 0) css.marginLeft = ml;

    const styleName = this.registerParagraphStyle(css) || 'Standard';
    const inner = await this.inline(Array.from(node.childNodes), {});
    return `<text:p text:style-name="${styleName}">${inner || ''}</text:p>`;
  }

  async inline(nodes, state) {
    const parts = [];
    const holder = document.implementation.createHTMLDocument('').createElement('div');
    nodes.forEach((n) => holder.append(n.cloneNode(true)));
    await this.walk(holder, state, parts);
    return parts.join('');
  }

  async walk(node, state, out) {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (!child.nodeValue) continue;
        out.push(this.spanText(child.nodeValue, state));
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.tagName.toUpperCase();

      if (tag === 'BR') {
        out.push('<text:line-break/>');
        continue;
      }
      if (tag === 'IMG') {
        const frame = await this.imageFrame(child);
        if (frame) out.push(frame);
        continue;
      }
      if (tag === 'HR') {
        out.push('<text:line-break/><text:s>──</text:s>');
        continue;
      }

      const next = { ...state };
      if (tag === 'B' || tag === 'STRONG') next.b = true;
      else if (tag === 'I' || tag === 'EM') next.i = true;
      else if (tag === 'U') next.u = true;
      else if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') next.strike = true;
      else if (tag === 'SUB') next.sub = true;
      else if (tag === 'SUP') next.sup = true;
      else if (tag === 'MARK') next.bg = '#ffff00';
      else if (child.style) {
        const st = child.style;
        if (st.fontWeight && (parseInt(st.fontWeight, 10) >= 600 || st.fontWeight === 'bold')) next.b = true;
        if (st.fontStyle === 'italic') next.i = true;
        if (st.textDecoration.includes('underline')) next.u = true;
        if (st.textDecoration.includes('line-through')) next.strike = true;
        if (st.color) next.color = cleanHex(st.color);
        if (st.backgroundColor) next.bg = cleanHex(st.backgroundColor);
        if (st.fontFamily) next.font = st.fontFamily.split(',')[0].replace(/["']/g, '').trim();
        const px = parseFloat(st.fontSize);
        if (px) next.fontSize = pxToPt(px);
      }

      if (tag === 'A') {
        const href = child.getAttribute('href') || '';
        if (/^(https?:|mailto:)/i.test(href)) {
          const inner = await this.inline(Array.from(child.childNodes), next);
          out.push(`<text:a xlink:href="${esc(href)}" xlink:type="simple">${inner}</text:a>`);
        } else {
          out.push(await this.inline(Array.from(child.childNodes), next));
        }
        continue;
      }

      out.push(await this.inline(Array.from(child.childNodes), next));
    }
  }

  spanText(text, state) {
    const props = {};
    if (state.b) props.b = true;
    if (state.i) props.i = true;
    if (state.u) props.u = true;
    if (state.strike) props.strike = true;
    if (state.color) props.color = state.color;
    if (state.bg) props.bg = state.bg;
    if (state.fontSize) props.fontSize = state.fontSize;
    if (state.font) props.font = state.font;

    const escaped = esc(text).replace(/\t/g, '<text:tab/>');
    if (!Object.keys(props).length) return escaped;
    const name = this.registerTextStyle(props);
    return `<text:span text:style-name="${name}">${escaped}</text:span>`;
  }

  async imageFrame(img) {
    const src = img.getAttribute('src') || '';
    if (!src) return '';
    const bytes = dataUrlToBytes(src);
    if (!bytes || !bytes.length) return '';
    const ext = extFromDataUrl(src);
    const name = 'image' + (++this.imageSeq) + '.' + ext;
    this.images.push({ name, bytes });

    let w = 10;
    let h = 7;
    const imgEl = new Image();
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 3000);
      imgEl.onload = () => { clearTimeout(t); resolve(); };
      imgEl.onerror = () => { clearTimeout(t); resolve(); };
      imgEl.src = src;
    });
    const nw = imgEl.naturalWidth || 480;
    const nh = imgEl.naturalHeight || 360;
    const pct = /(\d+(?:\.\d+)?)\s*%/.exec(img.style?.width || '');
    let widthPx = nw;
    if (pct) widthPx = 620 * (parseFloat(pct[1]) / 100);
    else if (/px$/.test(img.style?.width || '')) widthPx = parseFloat(img.style.width);
    if (widthPx > 620) widthPx = 620;
    h = (widthPx * nh) / nw;
    w = widthPx * 0.0264583;
    h = h * 0.0264583;

    const st = img.style || {};
    const centered = st.display === 'block' && st.marginLeft === 'auto';
    const paraStyle = this.registerParagraphStyle(centered ? { align: 'center' } : {});

    return `<draw:frame draw:style-name="fr1" draw:name="Imagen${this.imageSeq}" text:anchor-type="paragraph" svg:width="${w.toFixed(2)}cm" svg:height="${h.toFixed(2)}cm"${paraStyle ? '' : ''}><draw:image xlink:href="Pictures/${name}" xlink:type="simple" xlink:show="embed" xlink:iterate="no" office:embedded="false"/></draw:frame>`;
  }

  async emitList(listNode, depth, tag) {
    const styleName = tag === 'UL' ? 'L1' : 'L2';
    const items = Array.from(listNode.children).filter((li) => li.tagName?.toUpperCase() === 'LI');
    const itemXml = [];

    for (const li of items) {
      const inlineNodes = [];
      const nestedLists = [];
      for (const child of Array.from(li.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const t = child.tagName.toUpperCase();
          if (t === 'UL' || t === 'OL') nestedLists.push(child);
          else inlineNodes.push(child);
        } else if (child.textContent) {
          inlineNodes.push(child);
        }
      }
      let content = await this.inline(inlineNodes, {});
      if (!content) content = '';
      let item = `<text:list-item><text:p text:style-name="Standard">${content}</text:p>`;
      for (const nested of nestedLists) {
        item += await this.listXml(nested, depth + 1, nested.tagName.toUpperCase());
      }
      itemXml.push(item + '</text:list-item>');
    }

    this.out.push(`<text:list text:style-name="${styleName}">${itemXml.join('')}</text:list>`);
  }

  async listXml(listNode, depth, tag) {
    const styleName = tag === 'UL' ? 'L1' : 'L2';
    const items = Array.from(listNode.children).filter((li) => li.tagName?.toUpperCase() === 'LI');
    const itemXml = [];
    for (const li of items) {
      const inlineNodes = [];
      const nestedLists = [];
      for (const child of Array.from(li.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const t = child.tagName.toUpperCase();
          if (t === 'UL' || t === 'OL') nestedLists.push(child);
          else inlineNodes.push(child);
        } else if (child.textContent) inlineNodes.push(child);
      }
      const content = await this.inline(inlineNodes, {});
      let item = `<text:list-item><text:p text:style-name="Standard">${content}</text:p>`;
      for (const nested of nestedLists) item += await this.listXml(nested, depth + 1, nested.tagName.toUpperCase());
      itemXml.push(item + '</text:list-item>');
    }
    return `<text:list text:style-name="${styleName}">${itemXml.join('')}</text:list>`;
  }

  async emitTable(table) {
    const rows = Array.from(table.querySelectorAll('tr'));
    const cols = Math.max(1, ...rows.map((tr) => Array.from(tr.children).length));
    const colXml = `<table:table-column table:number-columns-repeated="${cols}" table:style-name="co1"/>`;
    const rowsXml = [];

    for (const tr of rows) {
      const cells = [];
      for (const cell of Array.from(tr.children)) {
        const isHeader = cell.tagName.toUpperCase() === 'TH';
        const cellStyle = isHeader ? 'HeaderCell' : 'td1';
        const blocks = Array.from(cell.children);
        const content = blocks.length
          ? (await Promise.all(blocks.map((b) => this.paragraphCell(b)))).join('')
          : await this.inline(Array.from(cell.childNodes), {});
        cells.push(`<table:table-cell table:style-name="${cellStyle}" office:value-type="string">${content || '<text:p/>'}</table:table-cell>`);
      }
      rowsXml.push(`<table:table-row>${cells.join('')}</table:table-row>`);
    }

    this.out.push(`<table:table table:name="Tabla${this.imageSeq + 1}" table:style-name="ta1">${colXml}${rowsXml.join('')}</table:table>`);
  }

  async paragraphCell(node) {
    const tag = node.tagName?.toUpperCase();
    if (tag === 'UL' || tag === 'OL') {
      const saved = this.out;
      this.out = [];
      await this.emitList(node, 0, tag);
      const xml = this.out;
      this.out = saved;
      return xml.join('');
    }
    return this.paragraph(node);
  }
}

function mergePropXml(propsList) {
  const map = new Map();
  for (const item of propsList) {
    const m = item.match(/<style:paragraph-properties\s+([^/]+?)\/>/);
    if (!m) continue;
    const attrs = m[1];
    for (const a of attrs.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)) {
      map.set(a[1], a[2]);
    }
  }
  const attrsXml = Array.from(map.entries()).map(([k, v]) => `${k}="${v}"`).join(' ');
  return attrsXml ? `<style:paragraph-properties ${attrsXml}/>` : '';
}

const LIST_STYLES = `
<style:style style:name="QuoteP" style:family="paragraph"><style:paragraph-properties fo:margin-left="0.5cm" fo:margin-right="0.2cm"/></style:style>
<style:style style:name="PageBreakP" style:family="paragraph"><style:paragraph-properties fo:break-before="page"/></style:style>
<style:style style:name="Horizontal_20_Line" style:family="paragraph"><style:paragraph-properties fo:border-bottom="0.5pt solid #808080" fo:padding-bottom="0.05cm" fo:margin-bottom="0.2cm"/></style:style>
<text:list-style style:name="L1"><text:list-level-style-bullet text:level="1" text:bullet-char="•"><style:list-level-properties text:space-before="0.4cm" text:min-label-width="0.4cm"/></text:list-level-style-bullet><text:list-level-style-bullet text:level="2" text:bullet-char="◦"><style:list-level-properties text:space-before="0.9cm" text:min-label-width="0.4cm"/></text:list-level-style-bullet><text:list-level-style-bullet text:level="3" text:bullet-char="▪"><style:list-level-properties text:space-before="1.4cm" text:min-label-width="0.4cm"/></text:list-level-style-bullet></text:list-style>
<text:list-style style:name="L2"><text:list-level-style-number text:level="1" style:num-format="1" style:num-suffix="." text:display-levels="1"><style:list-level-properties text:space-before="0.4cm" text:min-label-width="0.4cm"/></text:list-level-style-number><text:list-level-style-number text:level="2" style:num-format="1" style:num-suffix="." text:display-levels="2"><style:list-level-properties text:space-before="0.9cm" text:min-label-width="0.4cm"/></text:list-level-style-number><text:list-level-style-number text:level="3" style:num-format="1" style:num-suffix="." text:display-levels="3"><style:list-level-properties text:space-before="1.4cm" text:min-label-width="0.4cm"/></text:list-level-style-number></text:list-style>
<style:style style:name="ta1" style:family="table"><style:table-properties style:width="100%" table:border-model="collapsing"/></style:style>
<style:style style:name="co1" style:family="table-column"><style:table-column-properties style:column-width="3cm"/></style:style>
<style:style style:name="td1" style:family="table-cell"><style:table-cell-properties fo:border="0.5pt solid #b9bdc9" fo:padding="0.08cm"/></style:style>
<style:style style:name="HeaderCell" style:family="table-cell"><style:table-cell-properties fo:border="0.5pt solid #b9bdc9" fo:padding="0.08cm" fo:background-color="#edeef4"/></style:style>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="${OFFICE}" xmlns:text="${TEXT}" xmlns:table="${TABLE}" xmlns:draw="${DRAW}" xmlns:svg="${SVG}" xmlns:xlink="${XLINK}" xmlns:fo="${FO}" xmlns:style="${STYLE}" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.3">
<office:meta><dc:title/><meta:generator>Word BryanMG</meta:generator></office:meta>
<office:font-face-decls><style:font-face style:name="Calibri" svg:font-family="Calibri"/><style:font-face style:name="Arial" svg:font-family="Arial"/><style:font-face style:name="Liberation Sans" svg:font-family="'Liberation Sans'"/></office:font-face-decls>
<office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" style:print-orientation="portrait" fo:margin-top="1.9cm" fo:margin-bottom="1.9cm" fo:margin-left="2cm" fo:margin-right="2cm"/></style:page-layout></office:automatic-styles>
<office:styles>
<style:default-style style:family="paragraph"><style:paragraph-properties fo:line-height="150%" fo:margin-top="0cm" fo:margin-bottom="0.25cm"/><style:text-properties fo:font-size="12pt" fo:language="es" fo:country="ES"/></style:default-style>
<style:style style:name="Standard" style:family="paragraph" style:class="text"/>
<style:style style:name="Heading_20_1" style:display-name="Heading 1" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:class="chapter"><style:paragraph-properties fo:margin-top="0.4cm" fo:margin-bottom="0.2cm" fo:keep-with-next="always"/><style:text-properties fo:font-size="22pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading_20_2" style:display-name="Heading 2" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:class="chapter"><style:paragraph-properties fo:margin-top="0.35cm" fo:margin-bottom="0.15cm" fo:keep-with-next="always"/><style:text-properties fo:font-size="17pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading_20_3" style:display-name="Heading 3" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:class="chapter"><style:paragraph-properties fo:margin-top="0.3cm" fo:margin-bottom="0.12cm" fo:keep-with-next="always"/><style:text-properties fo:font-size="14pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading_20_4" style:display-name="Heading 4" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:class="chapter"><style:paragraph-properties fo:keep-with-next="always"/><style:text-properties fo:font-size="12pt" fo:font-weight="bold" fo:color="#4f46e5"/></style:style>
<style:style style:name="Heading_20_5" style:display-name="Heading 5" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:class="chapter"><style:text-properties fo:font-size="12pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading_20_6" style:display-name="Heading 6" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:class="chapter"><style:text-properties fo:font-size="10pt" fo:font-weight="bold" fo:color="#5b6172"/></style:style>
${LIST_STYLES.replace(/<style:style /g, '<style:style ')}
</office:styles>
<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles>
</office:document-styles>`;

export async function htmlToOdt({ html, title }) {
  const builder = new OdtBuilder({ html, title });
  return builder.build();
}

/* ================= IMPORTACIÓN ================= */

function localChildren(el, name) {
  return Array.from(el?.children || []).filter((c) => c.localName === name);
}

function firstLocal(el, name) {
  return localChildren(el, name)[0] || null;
}

function nsAttr(el, ns, name) {
  if (!el) return '';
  return el.getAttributeNS(ns, name) || el.getAttribute(name) || '';
}

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML inválido dentro del archivo ODT');
  return doc;
}

function parseStyleDefs(doc) {
  const paraStyles = new Map();
  const textStyles = new Map();
  const listStyles = new Map();

  const collect = (root) => {
    if (!root) return;
    for (const style of Array.from(root.children).filter((c) => c.localName === 'style')) {
      const name = nsAttr(style, STYLE, 'name');
      const family = nsAttr(style, STYLE, 'family');
      if (!name) continue;

      if (family === 'paragraph') {
        const props = {};
        const p = firstLocal(style, 'paragraph-properties');
        if (p) {
          const align = nsAttr(p, FO, 'text-align');
          if (align && align !== 'start') props.align = align === 'justify' ? 'justify' : align;
          const lh = nsAttr(p, FO, 'line-height');
          if (lh.endsWith('%')) props.lineHeight = parseInt(lh, 10) / 100;
          const ml = nsAttr(p, FO, 'margin-left');
          if (ml) props.marginLeft = ml;
          if (nsAttr(p, FO, 'break-before') === 'page') props.breakBefore = true;
        }
        const t = firstLocal(style, 'text-properties');
        if (t) Object.assign(props, textProps(t));
        paraStyles.set(name, props);
      } else if (family === 'text') {
        const t = firstLocal(style, 'text-properties');
        textStyles.set(name, t ? textProps(t) : {});
      } else if (style.localName === 'list-style') {
        const bullet = Array.from(style.children).find((c) => c.localName === 'list-level-style-bullet');
        const number = Array.from(style.children).find((c) => c.localName === 'list-level-style-number');
        listStyles.set(name, bullet ? 'bullet' : number ? 'decimal' : 'bullet');
      }
    }
  };

  collect(firstLocal(doc.documentElement, 'styles'));
  collect(firstLocal(doc.documentElement, 'automatic-styles'));

  for (const listStyle of Array.from(doc.getElementsByTagName('*')).filter((e) => e.localName === 'list-style')) {
    const name = nsAttr(listStyle, STYLE, 'name');
    const bullet = Array.from(listStyle.children).find((c) => c.localName === 'list-level-style-bullet');
    const number = Array.from(listStyle.children).find((c) => c.localName === 'list-level-style-number');
    if (name) listStyles.set(name, bullet ? 'bullet' : number ? 'decimal' : 'bullet');
  }

  return { paraStyles, textStyles, listStyles };
}

function textProps(t) {
  const props = {};
  if (nsAttr(t, FO, 'font-weight') === 'bold' || Number(nsAttr(t, FO, 'font-weight')) >= 600) props.b = true;
  if (nsAttr(t, FO, 'font-style') === 'italic') props.i = true;
  if (nsAttr(t, STYLE, 'text-underline-style') && nsAttr(t, STYLE, 'text-underline-style') !== 'none') props.u = true;
  if (nsAttr(t, STYLE, 'text-line-through-style') && nsAttr(t, STYLE, 'text-line-through-style') !== 'none') props.strike = true;
  const color = nsAttr(t, FO, 'color');
  if (color && color !== '#000000' && color !== 'transparent') props.color = color;
  const bg = nsAttr(t, FO, 'background-color');
  if (bg && bg !== 'transparent') props.bg = bg;
  const size = nsAttr(t, FO, 'font-size');
  if (size) props.fontSize = size;
  const font = nsAttr(t, STYLE, 'font-name');
  if (font) props.font = font;
  return props;
}

export async function odtToHtml(bytes) {
  const files = await readZip(bytes);
  const contentText = files.has('content.xml') ? bytesToText(files.get('content.xml')) : null;
  if (!contentText) throw new Error('No se encontró content.xml. ¿Es un archivo ODT válido?');

  const contentDoc = parseXml(contentText);
  const { paraStyles, textStyles, listStyles } = parseStyleDefs(contentDoc);

  let stylesDoc = null;
  if (files.has('styles.xml')) {
    try {
      stylesDoc = parseXml(bytesToText(files.get('styles.xml')));
      const fromStyles = parseStyleDefs(stylesDoc);
      for (const [k, v] of fromStyles.paraStyles) if (!paraStyles.has(k)) paraStyles.set(k, v);
      for (const [k, v] of fromStyles.textStyles) if (!textStyles.has(k)) textStyles.set(k, v);
      for (const [k, v] of fromStyles.listStyles) if (!listStyles.has(k)) listStyles.set(k, v);
    } catch { /* styles opcional */ }
  }

  const textRoot = (() => {
    let found = null;
    const walk = (el) => {
      if (found) return;
      if (el.localName === 'text' && (el.namespaceURI === OFFICE || !el.namespaceURI)) {
        found = el;
        return;
      }
      for (const child of Array.from(el.children || [])) walk(child);
    };
    walk(contentDoc.documentElement);
    return found;
  })();

  if (!textRoot) throw new Error('El archivo ODT no contiene texto');

  const out = document.implementation.createHTMLDocument('').createElement('div');
  const ctx = { files, paraStyles, textStyles, listStyles, listStack: [], out };

  for (const node of Array.from(textRoot.children)) {
    await importOdtBlock(node, ctx, out);
  }
  ctx.listStack.length = 0;

  return { html: out.innerHTML.trim() || '<p><br></p>', title: '' };
}

function applyParaStyle(el, styleName, ctx) {
  const props = ctx.paraStyles.get(styleName);
  if (!props) return;
  if (props.align && { center: 'center', right: 'right', justify: 'justify', left: 'left' }[props.align]) {
    el.style.textAlign = props.align;
  }
  if (props.marginLeft && /^[\d.]+(cm|in|pt|px|mm)/.test(props.marginLeft)) {
    const num = parseFloat(props.marginLeft);
    const unit = props.marginLeft.replace(/[\d.]/g, '');
    const px = unit === 'cm' ? num * 37.8
      : unit === 'mm' ? num * 3.78
      : unit === 'in' ? num * 96
      : unit === 'pt' ? num * (96 / 72)
      : num;
    if (px > 0) el.style.marginLeft = Math.round(px) + 'px';
  }
}

async function importOdtBlock(node, ctx, container) {
  const name = node.localName;

  if (name === 'p') {
    const styleName = nsAttr(node, TEXT, 'style-name');
    const paraProps = ctx.paraStyles.get(styleName) || {};
    let tag = 'p';
    const headingMatch = /^Heading_20_(\d)$/.exec(styleName) || /^H(\d)$/.exec(styleName);
    if (headingMatch) tag = 'h' + Math.min(6, Number(headingMatch[1]));
    else if (paraProps.breakBefore) {
      const brk = document.createElement('div');
      brk.className = 'page-break';
      brk.contentEditable = 'false';
      container.append(brk);
    }
    const el = document.createElement(tag);
    applyParaStyle(el, styleName, ctx);
    await importOdtInline(Array.from(node.childNodes), ctx, el);
    if (!el.textContent.trim() && !el.querySelector('img')) el.innerHTML = '<br>';
    container.append(el);
    return;
  }

  if (name === 'h') {
    const level = Math.min(6, Number(nsAttr(node, TEXT, 'outline-level')) || 1);
    const styleName = nsAttr(node, TEXT, 'style-name');
    const el = document.createElement('h' + level);
    await importOdtInline(Array.from(node.childNodes), ctx, el);
    if (!el.textContent.trim()) el.innerHTML = '<br>';
    container.append(el);
    return;
  }

  if (name === 'list') {
    await importOdtList(node, ctx, container);
    return;
  }

  if (name === 'table') {
    await importOdtTable(node, ctx, container);
    return;
  }

  if (name === 'section' || name === 'soft-page-break') {
    if (name === 'soft-page-break') {
      const brk = document.createElement('div');
      brk.className = 'page-break';
      brk.contentEditable = 'false';
      container.append(brk);
    } else {
      for (const child of Array.from(node.children)) await importOdtBlock(child, ctx, container);
    }
    return;
  }

  if (name === 'illustration' || name === 'text-box') {
    for (const child of Array.from(node.children)) await importOdtBlock(child, ctx, container);
    return;
  }
}

function openOdtList(fmt, container, ctx) {
  const el = document.createElement(fmt === 'bullet' ? 'ul' : 'ol');
  const last = ctx.listStack[ctx.listStack.length - 1];
  if (last) {
    const lastLi = last.el.lastElementChild;
    (lastLi || last.el).append(el);
  } else {
    container.append(el);
  }
  const entry = { el, fmt };
  ctx.listStack.push(entry);
  return entry;
}

async function importOdtList(listNode, ctx, container) {
  const styleName = nsAttr(listNode, TEXT, 'style-name');
  const fmt = ctx.listStyles.get(styleName) === 'decimal' ? 'decimal' : 'bullet';

  if (!ctx.listStack.length || ctx.listStack[ctx.listStack.length - 1].fmt !== fmt) {
    openOdtList(fmt, container, ctx);
  }
  const entry = ctx.listStack[ctx.listStack.length - 1];

  for (const item of localChildren(listNode, 'list-item')) {
    const li = document.createElement('li');
    entry.el.append(li);
    for (const child of Array.from(item.childNodes)) {
      if (child.localName === 'list') {
        await importOdtList(child, ctx, li);
      } else if (child.localName === 'p') {
        await importOdtInline(Array.from(child.childNodes), ctx, li);
      } else {
        await importOdtInline([child], ctx, li);
      }
    }
    if (!li.textContent.trim() && !li.querySelector('ul, ol')) li.append(document.createElement('br'));
  }
}

async function importOdtInline(nodes, ctx, target) {
  for (const node of nodes) {
    const name = node.localName;

    if (name === 'span') {
      const styleName = nsAttr(node, TEXT, 'style-name');
      const props = ctx.textStyles.get(styleName) || {};
      const wrap = document.createElement('span');
      const deco = [];
      if (props.u) deco.push('underline');
      if (props.strike) deco.push('line-through');
      if (deco.length) wrap.style.textDecoration = deco.join(' ');
      if (props.b) wrap.style.fontWeight = 'bold';
      if (props.i) wrap.style.fontStyle = 'italic';
      if (props.color) wrap.style.color = props.color;
      if (props.bg) wrap.style.backgroundColor = props.bg;
      if (props.fontSize) wrap.style.fontSize = props.fontSize;
      if (props.font) wrap.style.fontFamily = props.font;
      await importOdtInline(Array.from(node.childNodes), ctx, wrap);
      if (wrap.style.cssText && wrap.childNodes.length) target.append(wrap);
      else target.append(...wrap.childNodes);
      continue;
    }

    if (name === 'a') {
      const href = nsAttr(node, XLINK, 'href') || node.getAttribute('href') || '';
      const a = document.createElement('a');
      if (/^(https?:|mailto:)/i.test(href)) {
        a.href = href;
        a.rel = 'noopener';
        await importOdtInline(Array.from(node.childNodes), ctx, a);
        target.append(a);
      } else {
        await importOdtInline(Array.from(node.childNodes), ctx, target);
      }
      continue;
    }

    if (name === 'line-break') {
      target.append(document.createElement('br'));
      continue;
    }

    if (name === 'tab') {
      target.append(document.createTextNode('\t'));
      continue;
    }

    if (name === 's') {
      const count = Number(nsAttr(node, TEXT, 'c')) || 1;
      target.append(document.createTextNode(' '.repeat(Math.min(count, 50))));
      continue;
    }

    if (name === 'page-break') {
      const brk = document.createElement('div');
      brk.className = 'page-break';
      brk.contentEditable = 'false';
      target.append(brk);
      continue;
    }

    if (name === 'frame' || name === 'image') {
      const imageNode = name === 'frame' ? firstLocal(node, 'image') : node;
      const href = nsAttr(imageNode, XLINK, 'href') || '';
      if (href && !href.startsWith('http')) {
        const path = href.replace(/^\.\//, '');
        const mediaBytes = filesGet(ctx, path);
        if (mediaBytes) {
          const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() || 'png';
          const img = document.createElement('img');
          img.src = `data:${mimeFromExt(ext)};base64,${bytesToBase64(mediaBytes)}`;
          img.style.maxWidth = '100%';
          const w = nsAttr(node, SVG, 'width');
          if (w && /cm$/.test(w)) img.style.width = (parseFloat(w) * 37.8).toFixed(0) + 'px';
          target.append(img);
        }
      }
      continue;
    }

    if (name === 'p' || name === 'h') {
      await importOdtBlock(node, ctx, target);
      continue;
    }

    if (name === 'table') {
      await importOdtTable(node, ctx, target);
      continue;
    }

    if (name === 'list') {
      await importOdtList(node, ctx, target);
      continue;
    }

    if (node.childNodes && node.childNodes.length) {
      await importOdtInline(Array.from(node.childNodes), ctx, target);
    } else if (node.textContent) {
      target.append(document.createTextNode(node.textContent));
    }
  }
}

function filesGet(ctx, path) {
  if (ctx.files.has(path)) return ctx.files.get(path);
  const alt = path.replace(/^\//, '');
  if (ctx.files.has(alt)) return ctx.files.get(alt);
  if (ctx.files.has('Pictures/' + path.split('/').pop())) return ctx.files.get('Pictures/' + path.split('/').pop());
  return null;
}

async function importOdtTable(tableNode, ctx, container) {
  const table = document.createElement('table');
  const tbody = document.createElement('tbody');

  for (const row of localChildren(tableNode, 'table-row')) {
    const tr = document.createElement('tr');
    for (const cell of localChildren(row, 'table-cell')) {
      const td = document.createElement('td');
      const covered = localChildren(cell, 'covered-table-cell');
      const spanRepeat = Number(nsAttr(cell, TABLE, 'number-columns-repeated')) || 1;
      const styleName = nsAttr(cell, TABLE, 'style-name');
      if (/Header/i.test(styleName)) {
        const th = document.createElement('th');
        await fillTableCell(cell, ctx, th);
        tr.append(th);
      } else {
        await fillTableCell(cell, ctx, td);
      }
      for (let i = 1; i < Math.min(spanRepeat, 20); i++) {
        const clone = document.createElement('td');
        clone.innerHTML = '<p><br></p>';
        tr.append(clone);
      }
      if (covered.length) continue;
    }
    if (tr.children.length) tbody.append(tr);
  }

  table.append(tbody);
  container.append(table);
}

async function fillTableCell(cellNode, ctx, target) {
  const blocks = Array.from(cellNode.children);
  if (!blocks.length) {
    target.innerHTML = '<p><br></p>';
    return;
  }
  for (const child of blocks) {
    if (child.localName === 'p' || child.localName === 'h' || child.localName === 'list') {
      await importOdtBlock(child, ctx, target);
    } else {
      await importOdtInline([child], ctx, target);
    }
  }
  if (!target.textContent.trim() && !target.querySelector('img, p, ul, ol')) target.innerHTML = '<p><br></p>';
}
