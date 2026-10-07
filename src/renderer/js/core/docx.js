import { createZip, readZip, bytesToText } from './zip.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/* ---------------- utilidades ---------------- */

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
  return /^[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : '';
}

function loadImageMeta(src) {
  return new Promise((resolve) => {
    const done = (v) => resolve(v);
    const img = new Image();
    const timer = setTimeout(() => done({ w: 480, h: 360 }), 5000);
    img.onload = () => {
      clearTimeout(timer);
      done({ w: img.naturalWidth || 480, h: img.naturalHeight || 360 });
    };
    img.onerror = () => {
      clearTimeout(timer);
      done({ w: 480, h: 360 });
    };
    img.src = src;
  });
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

/* ================= EXPORTACIÓN ================= */

class DocxBuilder {
  constructor({ html, header = '', footer = '', showPageNum = false }) {
    this.rootHtml = html;
    this.headerHtml = header;
    this.footerHtml = footer;
    this.showPageNum = showPageNum;
    this.rels = [];
    this.media = [];
    this.imageSeq = 0;
    this.numIdSeq = 2;
    this.headerXml = '';
    this.footerXml = '';
    this.doc = document.implementation.createHTMLDocument('');
    this.root = this.doc.createElement('div');
    this.root.innerHTML = this.rootHtml || '<p><br></p>';
    this.bodyXml = [];
  }

  addRel(type, target) {
    const id = 'rId' + (30 + this.rels.length);
    this.rels.push({ id, type, target, external: type === 'hyperlink' });
    return id;
  }

  async addImageRel(src) {
    const bytes = dataUrlToBytes(src);
    if (!bytes || !bytes.length) return null;
    const ext = extFromDataUrl(src);
    const name = 'image' + (++this.imageSeq) + '.' + ext;
    this.media.push({ name, bytes });
    return this.addRel('image', 'media/' + name);
  }

  async build() {
    const blocks = Array.from(this.root.children);
    const nodes = blocks.length ? blocks : [this.root];
    for (const node of nodes) await this.emitBlock(node, 0);

    const entries = [
      { name: '[Content_Types].xml', data: this.contentTypes() },
      { name: '_rels/.rels', data: this.rootRels() },
      { name: 'word/document.xml', data: this.wrapDocument(this.bodyXml.join('')) },
      { name: 'word/_rels/document.xml.rels', data: this.documentRels() },
      { name: 'word/styles.xml', data: STYLES_XML },
      { name: 'word/numbering.xml', data: this.numberingXml() }
    ];
    if (this.headerXml) entries.push({ name: 'word/header1.xml', data: this.headerXml });
    if (this.footerXml) entries.push({ name: 'word/footer1.xml', data: this.footerXml });
    for (const media of this.media) entries.push({ name: 'word/' + media.name, data: media.bytes });

    return createZip(entries);
  }

  wrapDocument(body) {
    const sect = [];
    if (this.headerXml) sect.push('<w:headerReference w:type="default" r:id="rIdH1"/>');
    if (this.footerXml) sect.push('<w:footerReference w:type="default" r:id="rIdF1"/>');
    sect.push('<w:pgSz w:w="11906" w:h="16838"/>');
    sect.push('<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/>');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr>${sect.join('')}</w:sectPr></w:body></w:document>`;
  }

  contentTypes() {
    const defaults = [
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      ...['png', 'jpg', 'gif', 'webp', 'bmp'].map((ext) => `<Default Extension="${ext}" ContentType="${mimeFromExt(ext)}"/>`)
    ];
    const overrides = [
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
    ];
    if (this.headerXml) overrides.push('<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>');
    if (this.footerXml) overrides.push('<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults.join('')}${overrides.join('')}</Types>`;
  }

  rootRels() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  }

  documentRels() {
    const rels = [
      { id: 'rId1', type: 'styles', target: 'styles.xml' },
      { id: 'rId2', type: 'numbering', target: 'numbering.xml' }
    ];
    if (this.headerXml) rels.push({ id: 'rIdH1', type: 'header', target: 'header1.xml' });
    if (this.footerXml) rels.push({ id: 'rIdF1', type: 'footer', target: 'footer1.xml' });
    rels.push(...this.rels);

    const typeMap = {
      styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
      numbering: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
      header: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header',
      footer: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer',
      image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
      hyperlink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'
    };

    const xml = rels.map((rel) =>
      `<Relationship Id="${rel.id}" Type="${typeMap[rel.type]}" Target="${esc(rel.target)}"${rel.type === 'hyperlink' ? ' TargetMode="External"' : ''}/>`
    ).join('');

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${xml}</Relationships>`;
  }

  numberingXml() {
    const lvl = (i, fmt) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${fmt === 'bullet' ? '•' : '%' + (i + 1) + '.'}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + i * 360}" w:hanging="360"/></w:pPr></w:lvl>`;
    let nums = '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>';
    for (let i = 3; i <= this.numIdSeq; i++) {
      nums += `<w:num w:numId="${i}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`;
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 9 }, (_, i) => lvl(i, 'bullet')).join('')}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 9 }, (_, i) => lvl(i, 'decimal')).join('')}</w:abstractNum>${nums}</w:numbering>`;
  }

  /* --------- bloques --------- */

  async emitBlock(node, listDepth) {
    const tag = node.tagName?.toUpperCase();
    if (!tag) return;

    if (/^H[1-6]$/.test(tag)) return this.bodyXml.push(await this.paragraph(node, { style: 'Heading' + tag[1] }));
    if (tag === 'P') return this.bodyXml.push(await this.paragraph(node, {}));
    if (tag === 'BLOCKQUOTE') return this.bodyXml.push(await this.paragraph(node, { style: 'Quote' }));
    if (tag === 'UL' || tag === 'OL') return this.emitList(node, listDepth, tag);
    if (tag === 'TABLE') return this.emitTable(node);
    if (tag === 'HR') return this.bodyXml.push(PARA_BORDER);
    if (node.classList?.contains('page-break')) return this.bodyXml.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');

    if (tag === 'DIV' || tag === 'SECTION' || tag === 'FIGURE') {
      const children = Array.from(node.children);
      if (children.length) {
        for (const child of children) await this.emitBlock(child, listDepth);
        return;
      }
    }
    this.bodyXml.push(await this.paragraph(node, {}));
  }

  async emitList(listNode, depth, tag) {
    const numId = tag === 'OL' ? ++this.numIdSeq : 1;
    const items = Array.from(listNode.children).filter((li) => li.tagName?.toUpperCase() === 'LI');

    for (const li of items) {
      const inline = [];
      const nested = [];
      for (const child of Array.from(li.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const t = child.tagName.toUpperCase();
          if (t === 'UL' || t === 'OL') nested.push(child);
          else inline.push(child);
        } else if (child.textContent) {
          inline.push(child);
        }
      }
      const runs = await this.runs(inline);
      this.bodyXml.push(`<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${Math.min(depth, 8)}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${runs}</w:p>`);
      for (const nestedList of nested) await this.emitList(nestedList, depth + 1, nestedList.tagName.toUpperCase());
    }
  }

  async emitTable(table) {
    const rows = Array.from(table.querySelectorAll('tr'));
    const body = [];

    for (const tr of rows) {
      const cells = Array.from(tr.children).filter((c) => /^(TD|TH)$/i.test(c.tagName));
      const cellXml = [];
      for (const cell of cells) {
        const isHeader = cell.tagName.toUpperCase() === 'TH';
        const blocks = Array.from(cell.children);
        const content = blocks.length
          ? await Promise.all(blocks.map((b) => this.runs([b])))
          : [await this.runs([cell])];
        let inner = content.join('');
        if (!inner.trim()) inner = '<w:p/>';
        const shd = isHeader ? '<w:shd w:val="clear" w:color="auto" w:fill="EDEEF4"/>' : '';
        cellXml.push(`<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${shd}</w:tcPr>${inner}</w:tc>`);
      }
      body.push(`<w:tr>${cellXml.join('')}</w:tr>`);
    }

    const cols = Math.max(1, ...rows.map((tr) => tr.children.length));
    this.bodyXml.push(`<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr><w:tblGrid>${Array.from({ length: cols }, () => '<w:gridCol w:w="1980"/>').join('')}</w:tblGrid>${body.join('')}</w:tbl><w:p/>`);
  }

  async paragraph(node, { style } = {}) {
    const st = node.style || {};
    const parts = [];
    if (style) parts.push(`<w:pStyle w:val="${style}"/>`);

    const align = st.textAlign;
    if (align && { center: 'center', right: 'right', justify: 'both' }[align]) {
      parts.push(`<w:jc w:val="${{ center: 'center', right: 'right', justify: 'both' }[align]}"/>`);
    }
    const lh = parseFloat(st.lineHeight);
    if (lh && Number.isFinite(lh)) parts.push(`<w:spacing w:line="${Math.round(lh * 240)}" w:lineRule="auto"/>`);
    const ml = parseFloat(st.marginLeft);
    if (ml > 0) parts.push(`<w:ind w:left="${Math.round(ml * 15)}"/>`);

    const pPr = parts.length ? `<w:pPr>${parts.join('')}</w:pPr>` : '';
    return `<w:p>${pPr}${await this.runs(Array.from(node.childNodes))}</w:p>`;
  }

  async runs(nodes) {
    const out = [];
    const holder = this.doc.createElement('div');
    nodes.forEach((n) => holder.append(n.cloneNode(true)));
    await this.walk(holder, {}, out);
    return out.join('');
  }

  async walk(node, state, out) {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (child.nodeValue) out.push(this.runXml(child.nodeValue, state));
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.tagName.toUpperCase();

      if (tag === 'BR') {
        out.push(this.runXml('', state, '<w:br/>'));
        continue;
      }
      if (tag === 'IMG') {
        const xml = await this.imageXml(child);
        if (xml) out.push(xml);
        continue;
      }
      if (tag === 'HR') {
        out.push(PARA_BORDER);
        continue;
      }

      const next = { ...state };
      if (tag === 'B' || tag === 'STRONG') next.b = true;
      else if (tag === 'I' || tag === 'EM') next.i = true;
      else if (tag === 'U') next.u = true;
      else if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') next.strike = true;
      else if (tag === 'SUB') next.sub = true;
      else if (tag === 'SUP') next.sup = true;
      else if (tag === 'MARK') next.bg = 'ffff00';
      else if (tag === 'FONT') {
        if (child.getAttribute('color')) next.color = cleanHex(child.getAttribute('color'));
        if (child.getAttribute('face')) next.font = child.getAttribute('face');
      } else if (child.style) {
        const st = child.style;
        if (st.fontWeight && (parseInt(st.fontWeight, 10) >= 600 || st.fontWeight === 'bold')) next.b = true;
        if (st.fontStyle === 'italic') next.i = true;
        if (st.textDecoration.includes('underline')) next.u = true;
        if (st.textDecoration.includes('line-through')) next.strike = true;
        if (st.color) next.color = cleanHex(st.color);
        if (st.backgroundColor) next.bg = cleanHex(st.backgroundColor);
        if (st.fontFamily) next.font = st.fontFamily.split(',')[0].replace(/["']/g, '').trim();
        const px = parseFloat(st.fontSize);
        if (px) next.sz = Math.max(4, Math.round(px * 1.5));
      }

      if (tag === 'A') {
        const href = child.getAttribute('href') || '';
        if (/^(https?:|mailto:)/i.test(href)) {
          const inner = [];
          await this.walk(child, next, inner);
          out.push(`<w:hyperlink r:id="${this.addRel('hyperlink', href)}" w:history="1">${inner.join('')}</w:hyperlink>`);
        } else {
          await this.walk(child, next, out);
        }
        continue;
      }

      if (/^(P|DIV|H[1-6]|LI|BLOCKQUOTE|FIGURE|SECTION)$/.test(tag)) {
        await this.walk(child, next, out);
        continue;
      }

      await this.walk(child, next, out);
    }
  }

  runXml(text, state, customInner) {
    const props = [];
    if (state.font) props.push(`<w:rFonts w:ascii="${esc(state.font)}" w:hAnsi="${esc(state.font)}"/>`);
    if (state.b) props.push('<w:b/>');
    if (state.i) props.push('<w:i/>');
    if (state.u) props.push('<w:u w:val="single"/>');
    if (state.strike) props.push('<w:strike/>');
    if (state.color && /^[0-9a-f]{6}$/i.test(state.color)) props.push(`<w:color w:val="${state.color}"/>`);
    if (state.bg && /^[0-9a-f]{6}$/i.test(state.bg)) props.push(`<w:shd w:val="clear" w:color="auto" w:fill="${state.bg}"/>`);
    if (state.sz) props.push(`<w:sz w:val="${state.sz}"/><w:szCs w:val="${state.sz}"/>`);
    if (state.sub) props.push('<w:vertAlign w:val="subscript"/>');
    if (state.sup) props.push('<w:vertAlign w:val="superscript"/>');
    const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
    const inner = customInner || `<w:t xml:space="preserve">${esc(text)}</w:t>`;
    return `<w:r>${rPr}${inner}</w:r>`;
  }

  async imageXml(imgEl) {
    const src = imgEl.getAttribute('src') || '';
    if (!src) return null;
    const relId = await this.addImageRel(src);
    if (!relId) return null;

    const meta = await loadImageMeta(src);
    let w = meta.w;
    let h = meta.h;
    const styleW = imgEl.style?.width || '';
    const pct = /(\d+(?:\.\d+)?)\s*%/.exec(styleW);
    const contentWidthPx = 620;

    if (pct) {
      w = contentWidthPx * (parseFloat(pct[1]) / 100);
      h = w * (meta.h / Math.max(1, meta.w));
    } else if (/px$/.test(styleW)) {
      w = parseFloat(styleW);
      h = w * (meta.h / Math.max(1, meta.w));
    } else if (w > contentWidthPx) {
      h = h * (contentWidthPx / w);
      w = contentWidthPx;
    }

    const cx = Math.max(1, Math.round(w * 9525));
    const cy = Math.max(1, Math.round(h * 9525));
    const id = ++this.imageSeq * 10 + 5;
    const st = imgEl.style || {};
    const centered = st.display === 'block' && st.marginLeft === 'auto' && st.marginRight === 'auto';
    const righted = st.display === 'block' && st.marginLeft === 'auto' && st.marginRight === '0px';
    const jc = centered ? '<wp:jc>center</wp:jc>' : righted ? '<wp:jc>right</wp:jc>' : '';

    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${jc}<wp:docPr id="${id}" name="Imagen ${id}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Imagen ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }

  async buildHeaderFooter() {
    if (this.headerHtml) {
      const div = this.doc.createElement('div');
      div.innerHTML = this.headerHtml;
      const blocks = Array.from(div.children);
      const paras = blocks.length
        ? await Promise.all(blocks.map((n) => this.paragraph(n, {})))
        : [`<w:p>${await this.runs(Array.from(div.childNodes))}</w:p>`];
      this.headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="${W}" xmlns:r="${R}">${paras.join('')}</w:hdr>`;
    }
    if (this.footerHtml || this.showPageNum) {
      const div = this.doc.createElement('div');
      div.innerHTML = this.footerHtml || '';
      const blocks = Array.from(div.children);
      const paras = blocks.length
        ? await Promise.all(blocks.map((n) => this.paragraph(n, {})))
        : div.textContent.trim() ? [`<w:p>${await this.runs(Array.from(div.childNodes))}</w:p>`] : [];
      if (this.showPageNum) {
        paras.push('<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple><w:r><w:t xml:space="preserve"> de </w:t></w:r><w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>');
      }
      this.footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="${W}" xmlns:r="${R}">${paras.join('')}</w:ftr>`;
    }
  }
}

const PARA_BORDER = '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>';

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="44"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="200" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="34"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="2"/><w:spacing w:before="160" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:color w:val="4F46E5"/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading5"><w:name w:val="heading 5"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="4"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading6"><w:name w:val="heading 6"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="5"/></w:pPr><w:rPr><w:b/><w:color w:val="5B6172"/><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/><w:color w:val="5B6172"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>
</w:styles>`;

export async function htmlToDocx({ html, header, footer, showPageNum, title }) {
  const builder = new DocxBuilder({ html, header, footer, showPageNum });
  await builder.buildHeaderFooter();
  return builder.build();
}

/* ================= IMPORTACIÓN ================= */

function localChildren(el, name) {
  return Array.from(el?.children || []).filter((c) => c.localName === name);
}

function firstLocal(el, name) {
  return localChildren(el, name)[0] || null;
}

function wAttr(el, name) {
  if (!el) return '';
  return el.getAttributeNS(W, name) || el.getAttribute('w:' + name) || '';
}

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML inválido dentro del archivo');
  return doc;
}

export async function docxToHtml(bytes) {
  const files = await readZip(bytes);

  const docText = files.has('word/document.xml') ? bytesToText(files.get('word/document.xml')) : null;
  if (!docText) throw new Error('No se encontró word/document.xml. ¿Es un archivo DOCX válido?');
  const doc = parseXml(docText);
  const body = localChildren(doc.documentElement, 'body')[0] || doc.documentElement;

  const rels = new Map();
  if (files.has('word/_rels/document.xml.rels')) {
    const relDoc = parseXml(bytesToText(files.get('word/_rels/document.xml.rels')));
    for (const rel of Array.from(relDoc.getElementsByTagName('*'))) {
      if (rel.localName !== 'Relationship') continue;
      rels.set(rel.getAttribute('Id'), {
        target: rel.getAttribute('Target') || '',
        external: rel.getAttribute('TargetMode') === 'External'
      });
    }
  }

  const numFormats = new Map();
  if (files.has('word/numbering.xml')) {
    try {
      const numDoc = parseXml(bytesToText(files.get('word/numbering.xml')));
      const abstractFmt = new Map();
      for (const abs of Array.from(numDoc.getElementsByTagName('*')).filter((e) => e.localName === 'abstractNum')) {
        const absId = wAttr(abs, 'abstractNumId');
        const lvl = localChildren(abs, 'lvl')[0];
        const fmtNode = lvl ? localChildren(lvl, 'numFmt')[0] : null;
        abstractFmt.set(absId, fmtNode ? fmtNode.textContent : 'bullet');
      }
      for (const num of Array.from(numDoc.getElementsByTagName('*')).filter((e) => e.localName === 'num')) {
        const numId = wAttr(num, 'numId');
        const absRef = localChildren(num, 'abstractNumId')[0];
        numFormats.set(numId, abstractFmt.get(absRef?.textContent || '') || 'bullet');
      }
    } catch { /* numbering opcional */ }
  }

  const out = document.implementation.createHTMLDocument('').createElement('div');
  const ctx = { rels, files, numFormats, listStack: [], counters: new Map(), out };

  for (const node of Array.from(body.children)) {
    if (node.localName === 'p') await importParagraph(node, ctx, out);
    else if (node.localName === 'tbl') await importTable(node, ctx, out);
  }
  ctx.listStack.length = 0;
  mergeAdjacentSpans(out);

  let title = '';
  if (files.has('docProps/core.xml')) {
    try {
      const coreDoc = parseXml(bytesToText(files.get('docProps/core.xml')));
      const t = Array.from(coreDoc.getElementsByTagName('*')).find((n) => n.localName === 'title');
      title = t?.textContent || '';
    } catch { /* opcional */ }
  }

  return { html: out.innerHTML.trim() || '<p><br></p>', title };
}

function mergeAdjacentSpans(container) {
  container.querySelectorAll('span[data-rp]').forEach((span) => {
    const next = span.nextElementSibling;
    if (next && next.tagName === 'SPAN' && next.getAttribute('data-rp') === span.getAttribute('data-rp')) {
      while (next.firstChild) span.append(next.firstChild);
      next.remove();
    }
    span.replaceWith(...span.childNodes);
  });
  container.querySelectorAll('[data-rp]').forEach((n) => n.removeAttribute('data-rp'));
}

function openList(ctx, fmt, depth, out) {
  const el = document.createElement(fmt === 'bullet' ? 'ul' : 'ol');
  const last = ctx.listStack[ctx.listStack.length - 1];
  if (last) {
    const lastLi = last.el.lastElementChild;
    (lastLi || last.el).append(el);
  } else {
    out.append(el);
  }
  const entry = { el, depth, fmt };
  ctx.listStack.push(entry);
  return entry;
}

async function importParagraph(pNode, ctx, container) {
  const pPr = firstLocal(pNode, 'pPr');
  let styleVal = '';
  let numId = '';
  let ilvl = 0;
  let jc = '';
  let indLeft = 0;

  if (pPr) {
    const styleNode = firstLocal(pPr, 'pStyle');
    styleVal = styleNode ? styleNode.textContent : '';
    const numPr = firstLocal(pPr, 'numPr');
    if (numPr) {
      numId = firstLocal(numPr, 'numId')?.textContent || '1';
      ilvl = Number(firstLocal(numPr, 'ilvl')?.textContent) || 0;
    }
    jc = firstLocal(pPr, 'jc')?.textContent || '';
    const ind = firstLocal(pPr, 'ind');
    if (ind) indLeft = Number(wAttr(ind, 'left')) || 0;
  }

  const inlineNodes = Array.from(pNode.children).filter((c) => c.localName !== 'pPr');
  const hasPageBreak = inlineNodes.some((n) =>
    Array.from(n.getElementsByTagName('*')).some(
      (d) => d.localName === 'br' && wAttr(d, 'type') === 'page'
    )
  );

  if (numId) {
    const fmt = ctx.numFormats.get(numId) === 'decimal' ? 'decimal' : 'bullet';
    const depth = Math.min(ilvl, 8);
    const stack = ctx.listStack;
    while (stack.length && stack[stack.length - 1].depth > depth) stack.pop();

    let entry = stack[stack.length - 1];
    if (entry && entry.depth === depth && entry.fmt !== fmt) {
      stack.pop();
      entry = stack[stack.length - 1];
    }
    if (!entry || entry.depth < depth) entry = openList(ctx, fmt, depth, container);

    const li = document.createElement('li');
    entry.el.append(li);

    const key = numId + ':' + depth;
    if (fmt === 'decimal') ctx.counters.set(key, (ctx.counters.get(key) || 0) + 1);

    for (const child of inlineNodes) await importInline(child, ctx, li);
    if (!li.textContent.trim() && !li.querySelector('img')) li.append(document.createElement('br'));
    return;
  }

  while (ctx.listStack.length) ctx.listStack.pop();

  if (hasPageBreak) {
    const div = document.createElement('div');
    div.className = 'page-break';
    div.contentEditable = 'false';
    container.append(div);
  }

  let tag = 'p';
  const styleMatch = /Heading\s*(\d)/i.exec(styleVal) || /(?:T.tulo|Título)\s*(\d)/i.exec(styleVal);
  if (styleMatch) tag = 'h' + Math.min(6, Number(styleMatch[1]));
  else if (/^(Title|Título)$/i.test(styleVal)) tag = 'h1';
  else if (/Subtitle/i.test(styleVal)) tag = 'h2';
  else if (/Quote|Cita/i.test(styleVal)) tag = 'blockquote';

  const el = document.createElement(tag);
  if (jc && { center: 'center', right: 'right', both: 'justify', justify: 'justify' }[jc]) {
    el.style.textAlign = { center: 'center', right: 'right', both: 'justify', justify: 'justify' }[jc];
  }
  if (indLeft > 0 && tag === 'p') el.style.marginLeft = Math.round(indLeft / 15) + 'px';

  for (const child of inlineNodes) await importInline(child, ctx, el);
  if (!el.textContent.trim() && !el.querySelector('img')) el.innerHTML = '<br>';
  container.append(el);
}

async function importInline(node, ctx, target) {
  const name = node.localName;

  if (name === 'hyperlink' || name === 'ins' || name === 'sdt' || name === 'sdtContent' || name === 'smartTag') {
    const rid = node.getAttributeNS(R, 'id') || node.getAttribute('r:id') || '';
    const rel = ctx.rels.get(rid);
    let anchor = target;
    if (rel && rel.external && /^(https?:|mailto:)/i.test(rel.target)) {
      const a = document.createElement('a');
      a.href = rel.target;
      a.rel = 'noopener';
      target.append(a);
      anchor = a;
    }
    for (const child of Array.from(node.children)) await importInline(child, ctx, anchor);
    if (anchor !== target && !anchor.textContent.trim() && !anchor.querySelector('img')) anchor.remove();
    return;
  }

  if (name === 'r') {
    const rPr = firstLocal(node, 'rPr');
    const props = parseRunProps(rPr);
    const hasProps = Object.keys(props).length > 0;

    let wrap = null;
    const holder = () => {
      if (!hasProps) return target;
      if (!wrap) {
        wrap = document.createElement('span');
        wrap.setAttribute('data-rp', JSON.stringify(props));
        applySpanProps(wrap, props);
        target.append(wrap);
      }
      return wrap;
    };

    for (const item of Array.from(node.children)) {
      if (item.localName === 't') {
        const text = item.textContent || '';
        if (text) holder().append(document.createTextNode(text));
      } else if (item.localName === 'tab') {
        holder().append(document.createTextNode('\t'));
      } else if (item.localName === 'noBreakHyphen') {
        holder().append(document.createTextNode('-'));
      } else if (item.localName === 'br') {
        if (wAttr(item, 'type') === 'page') continue;
        target.append(document.createElement('br'));
        wrap = null;
      } else if (item.localName === 'drawing' || item.localName === 'pict') {
        await importDrawing(item, ctx, target);
        wrap = null;
      }
    }
    return;
  }

  if (name === 'fldSimple') {
    target.append(document.createTextNode(node.textContent || ''));
    return;
  }

  if (name === 'tbl') {
    await importTable(node, ctx, target);
    return;
  }

  if (['bookmarkStart', 'bookmarkEnd', 'proofErr', 'commentRangeStart', 'commentRangeEnd', 'pPr', 'sectPr'].includes(name)) return;

  if (node.children && node.children.length) {
    for (const child of Array.from(node.children)) await importInline(child, ctx, target);
  } else if (node.textContent) {
    target.append(document.createTextNode(node.textContent));
  }
}

function parseRunProps(rPr) {
  const props = {};
  if (!rPr) return props;
  for (const child of Array.from(rPr.children)) {
    const v = wAttr(child, 'val');
    if (child.localName === 'b') { if (!/^(0|false|none)$/i.test(v)) props.b = true; }
    else if (child.localName === 'i') { if (!/^(0|false|none)$/i.test(v)) props.i = true; }
    else if (child.localName === 'u') { if (!/^none$/i.test(v)) props.u = true; }
    else if (child.localName === 'strike' || child.localName === 'dstrike') { if (!/^(0|false|none)$/i.test(v)) props.strike = true; }
    else if (child.localName === 'color' && v && v !== 'auto') props.color = v;
    else if (child.localName === 'shd') { const fill = wAttr(child, 'fill'); if (fill && fill !== 'auto') props.bg = fill; }
    else if (child.localName === 'sz') { const n = Number(v); if (n) props.fontSize = Math.round(n / 2 * 4 / 3) + 'px'; }
    else if (child.localName === 'rFonts') { const f = wAttr(child, 'ascii') || wAttr(child, 'cs'); if (f) props.font = f; }
    else if (child.localName === 'vertAlign') { if (v === 'subscript') props.sub = true; if (v === 'superscript') props.sup = true; }
  }
  return props;
}

function applySpanProps(span, props) {
  const deco = [];
  if (props.u) deco.push('underline');
  if (props.strike) deco.push('line-through');
  if (deco.length) span.style.textDecoration = deco.join(' ');
  if (props.b) span.style.fontWeight = 'bold';
  if (props.i) span.style.fontStyle = 'italic';
  if (props.color && /^[0-9a-f]{6}$/i.test(props.color)) span.style.color = '#' + props.color;
  if (props.bg && /^[0-9a-f]{6}$/i.test(props.bg)) span.style.backgroundColor = '#' + props.bg;
  if (props.fontSize) span.style.fontSize = props.fontSize;
  if (props.font) span.style.fontFamily = props.font;
  if (props.sub) span.style.verticalAlign = 'sub';
  if (props.sup) span.style.verticalAlign = 'super';
}

async function importDrawing(node, ctx, target) {
  const blips = Array.from(node.getElementsByTagName('*')).filter((n) => n.localName === 'blip');
  for (const blip of blips) {
    const rid = blip.getAttributeNS(R, 'embed') || blip.getAttribute('r:embed') ||
      blip.getAttributeNS(R, 'link') || blip.getAttribute('r:link') || '';
    const rel = ctx.rels.get(rid);
    if (!rel) continue;

    const mediaPath = rel.target.startsWith('word/') ? rel.target : 'word/' + rel.target.replace(/^\.\//, '');
    let mediaBytes = ctx.files.get(mediaPath);
    if (!mediaBytes) mediaBytes = ctx.files.get(mediaPath.replace(/\.\.\//g, ''));
    if (!mediaBytes) continue;

    const extMatch = /\.([a-z0-9]+)$/i.exec(rel.target);
    const mime = mimeFromExt(extMatch ? extMatch[1].toLowerCase() : 'png');
    const img = document.createElement('img');
    img.src = `data:${mime};base64,${bytesToBase64(mediaBytes)}`;
    img.alt = '';
    img.style.maxWidth = '100%';
    target.append(img);
  }
}

async function importTable(tblNode, ctx, container) {
  const table = document.createElement('table');
  const tbody = document.createElement('tbody');
  const trNodes = localChildren(tblNode, 'tr');

  const plans = trNodes.map((trNode) => {
    const cells = [];
    let col = 0;
    for (const tc of localChildren(trNode, 'tc')) {
      const tcPr = firstLocal(tc, 'tcPr');
      const span = Number(tcPr ? wAttr(firstLocal(tcPr, 'gridSpan'), 'val') : 1) || 1;
      const vMerge = tcPr ? firstLocal(tcPr, 'vMerge') : null;
      const vVal = vMerge ? (wAttr(vMerge, 'val') || 'continue') : '';
      cells.push({ tc, col, span, vMerge: vMerge ? (vVal === 'restart' ? 'restart' : 'continue') : '' });
      col += span;
    }
    return cells;
  });

  const activeV = new Map();
  const spans = new Map();

  for (let r = 0; r < plans.length; r++) {
    for (const cell of plans[r]) {
      if (cell.vMerge === 'restart') {
        activeV.set(cell.col, r);
        spans.set(cell.col, 1);
      } else if (cell.vMerge === 'continue') {
        const start = activeV.get(cell.col);
        if (start !== undefined) spans.set(cell.col, (spans.get(cell.col) || 1) + 1);
      } else {
        activeV.delete(cell.col);
        spans.delete(cell.col);
      }
    }
  }

  const activeAtRow = plans.map((_, r) => {
    const rowSpans = new Map();
    for (const cell of plans[r]) {
      if (cell.vMerge === 'restart') {
        rowSpans.set(cell.col, { cell, span: spans.get(cell.col) || 1, start: true });
      }
    }
    return rowSpans;
  });

  for (let r = 0; r < plans.length; r++) {
    const tr = document.createElement('tr');
    const handled = new Set();

    for (const cell of plans[r]) {
      if (cell.vMerge === 'continue') continue;
      const td = document.createElement('td');
      const tcPr = firstLocal(cell.tc, 'tcPr');
      const shd = tcPr ? firstLocal(tcPr, 'shd') : null;
      const fill = shd ? wAttr(shd, 'fill') : '';
      if (fill && /^[0-9a-f]{6}$/i.test(fill)) td.style.backgroundColor = '#' + fill;
      if (cell.span > 1) td.colSpan = cell.span;
      const rowSpanInfo = activeAtRow[r].get(cell.col);
      if (rowSpanInfo && rowSpanInfo.cell === cell) td.rowSpan = rowSpanInfo.span;

      for (const child of Array.from(cell.tc.children)) {
        if (child.localName === 'tcPr') continue;
        if (child.localName === 'p') {
          const p = document.createElement('p');
          for (const c of Array.from(child.children)) {
            if (c.localName !== 'pPr') await importInline(c, ctx, p);
          }
          if (!p.textContent.trim() && !p.querySelector('img')) p.innerHTML = '<br>';
          td.append(p);
        } else {
          await importInline(child, ctx, td);
        }
      }
      tr.append(td);
      handled.add(cell.col);
    }
    if (tr.children.length) tbody.append(tr);
  }

  table.append(tbody);
  container.append(table);
}
