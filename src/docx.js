// Tiny, dependency-free .docx (Word) writer.
// Builds WordprocessingML parts and packs them into a zip (stored, no compression).

const enc = new TextEncoder();
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true);
    h.setUint16(8, 0, true);
    h.setUint16(10, time, true);
    h.setUint16(12, date, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, name.length, true);
    h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, time, true);
    c.setUint16(14, date, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true);
  e.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // strip characters that are illegal in XML 1.0
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const ACCENT = 'C0392B';
const PAGE_W = 9026; // A4 width minus 1" margins, in twips

// Bullet / numbering definitions (abstract numbering ids)
const ABS = { bullet: 0, arrow: 1, diamond: 2, decimal: 3, dash: 4 };
const BULLET_CHARS = {
  bullet: ['❖', '◦', '▪'],
  arrow: ['➢', '◦', '▪'],
  diamond: ['◆', '◦', '▪'],
  dash: ['–', '◦', '▪'],
};

function runXml(r) {
  if (typeof r === 'string') r = { text: r };
  let pr = '';
  if (r.font) pr += `<w:rFonts w:ascii="${r.font}" w:hAnsi="${r.font}"/>`;
  if (r.b) pr += '<w:b/>';
  if (r.i) pr += '<w:i/>';
  if (r.caps) pr += '<w:caps/>';
  if (r.s) pr += '<w:strike/>';
  if (r.color) pr += `<w:color w:val="${r.color}"/>`;
  if (r.size) pr += `<w:sz w:val="${Math.round(r.size * 2)}"/>`;
  if (r.hl) pr += '<w:highlight w:val="yellow"/>';
  if (r.u) pr += '<w:u w:val="single"/>';
  if (r.sup) pr += '<w:vertAlign w:val="superscript"/>';
  const rpr = pr ? `<w:rPr>${pr}</w:rPr>` : '';
  const text = String(r.text ?? '');
  let inner = '';
  const lines = text.split('\n');
  lines.forEach((line, li) => {
    if (li > 0) inner += '<w:br/>';
    line.split('\t').forEach((seg, si) => {
      if (si > 0) inner += '<w:tab/>';
      if (seg) inner += `<w:t xml:space="preserve">${esc(seg)}</w:t>`;
    });
  });
  return `<w:r>${rpr}${inner}</w:r>`;
}

export class Docx {
  constructor({ title = '', author = '' } = {}) {
    this.title = title;
    this.author = author;
    this.body = [];
    this.nums = []; // {id, abs}
    this.kinds = {};
  }

  numFor(kind) {
    if (!this.kinds[kind]) this.kinds[kind] = this.newNum(kind);
    return this.kinds[kind];
  }

  newNum(kind) {
    const id = this.nums.length + 1;
    this.nums.push({ id, abs: ABS[kind] ?? 0, restart: kind === 'decimal' });
    return id;
  }

  /**
   * Add a paragraph.
   * runs: string | run | run[]
   * o: { style, align, keepNext, num:{id, lvl}, tabs:[pos], before, after, indent, border, shade }
   */
  p(runs, o = {}) {
    const list = Array.isArray(runs) ? runs : [runs ?? ''];
    let ppr = '';
    if (o.style) ppr += `<w:pStyle w:val="${o.style}"/>`;
    if (o.keepNext) ppr += '<w:keepNext/>';
    if (o.num) ppr += `<w:numPr><w:ilvl w:val="${o.num.lvl || 0}"/><w:numId w:val="${o.num.id}"/></w:numPr>`;
    if (o.border) ppr += `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="${o.border === true ? 'BFBFBF' : o.border}"/></w:pBdr>`;
    if (o.leftBar) ppr += `<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="${o.leftBar}"/></w:pBdr>`;
    if (o.shade) ppr += `<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>`;
    if (o.tabs) ppr += `<w:tabs>${o.tabs.map((t) => `<w:tab w:val="left" w:pos="${t}"/>`).join('')}</w:tabs>`;
    if (o.before != null || o.after != null) {
      ppr += `<w:spacing${o.before != null ? ` w:before="${o.before}"` : ''}${o.after != null ? ` w:after="${o.after}"` : ''}/>`;
    }
    if (o.indent) ppr += `<w:ind w:left="${o.indent}"/>`;
    if (o.align) ppr += `<w:jc w:val="${o.align}"/>`;
    this.body.push(`<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${list.map(runXml).join('')}</w:p>`);
    return this;
  }

  heading(text, level = 1) { return this.p([{ text }], { style: `Heading${level}`, keepNext: true }); }

  item(runs, kind = 'bullet', lvl = 0, numId, extra = {}) {
    return this.p(runs, { ...extra, num: { id: numId || this.numFor(kind), lvl } });
  }

  spacer(after = 0) { return this.p('', { after }); }

  pageBreak() { this.body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>'); return this; }

  /**
   * rows: array of arrays of cells (string | run[]); first row = header when o.header.
   * o: { header: true, widths: [fractions] }
   */
  table(rows, o = {}) {
    if (!rows.length) return this;
    const cols = Math.max(...rows.map((r) => r.length));
    const fr = o.widths || Array(cols).fill(1 / cols);
    const w = fr.map((f) => Math.round(PAGE_W * f));
    let x = `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${PAGE_W}" w:type="dxa"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>`;
    x += w.map((v) => `<w:gridCol w:w="${v}"/>`).join('') + '</w:tblGrid>';
    rows.forEach((row, ri) => {
      const isHead = o.header !== false && ri === 0;
      x += `<w:tr>${isHead ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}`;
      for (let ci = 0; ci < cols; ci++) {
        const cell = row[ci] ?? '';
        let runs = Array.isArray(cell) ? cell : [{ text: String(cell) }];
        if (isHead) runs = runs.map((r) => ({ ...(typeof r === 'string' ? { text: r } : r), b: true }));
        const shade = isHead ? '<w:shd w:val="clear" w:color="auto" w:fill="F2E3E1"/>' : '';
        const align = o.align && o.align[ci] ? `<w:jc w:val="${o.align[ci]}"/>` : '';
        x += `<w:tc><w:tcPr><w:tcW w:w="${w[ci]}" w:type="dxa"/>${shade}</w:tcPr><w:p><w:pPr><w:spacing w:before="40" w:after="40"/>${align}</w:pPr>${runs.map(runXml).join('')}</w:p></w:tc>`;
      }
      x += '</w:tr>';
    });
    x += '</w:tbl>';
    this.body.push(x);
    this.p('', { after: 60 });
    return this;
  }

  numberingXml() {
    const lvl = (i, fmt, text, font) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + i * 400}" w:hanging="360"/></w:pPr>${font ? `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:hint="default"/></w:rPr>` : ''}</w:lvl>`;
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">';
    for (const [kind, id] of Object.entries(ABS)) {
      x += `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>`;
      for (let i = 0; i < 3; i++) {
        if (kind === 'decimal') x += lvl(i, 'decimal', `%${i + 1}.`, null);
        else x += lvl(i, 'bullet', esc(BULLET_CHARS[kind][i]), 'Segoe UI Symbol');
      }
      x += '</w:abstractNum>';
    }
    for (const n of this.nums) {
      x += `<w:num w:numId="${n.id}"><w:abstractNumId w:val="${n.abs}"/>`;
      if (n.restart) x += [0, 1, 2].map((l) => `<w:lvlOverride w:ilvl="${l}"><w:startOverride w:val="1"/></w:lvlOverride>`).join('');
      x += '</w:num>';
    }
    if (!this.nums.length) x += '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
    return x + '</w:numbering>';
  }

  build() {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${this.body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1300" w:right="1440" w:bottom="1300" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="200"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="${ACCENT}"/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="40"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(this.title)}</dc:title><dc:creator>${esc(this.author)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`;
    return zip([
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rels },
      { name: 'word/document.xml', data: documentXml },
      { name: 'word/styles.xml', data: stylesXml },
      { name: 'word/numbering.xml', data: this.numberingXml() },
      { name: 'word/_rels/document.xml.rels', data: docRels },
      { name: 'docProps/core.xml', data: coreXml },
    ]);
  }
}
