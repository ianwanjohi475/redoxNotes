// Rich text note editor: a small word processor on top of contenteditable,
// plus HTML sanitising (for paste) and Word / text export.
import { Docx } from './docx.js';
import { icon } from './icons.js';

export const FONTS = ['Calibri', 'Segoe UI', 'Arial', 'Aptos', 'Cambria', 'Georgia', 'Times New Roman', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Garamond', 'Consolas', 'Courier New', 'Comic Sans MS'];
export const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 48, 60, 72];
const BASE_PT = 11;
const TEXT_COLORS = [
  ['', 'Automatic'], ['#7f7f7f', 'Gray'], ['#c0392b', 'Dark red'], ['#e5484d', 'Red'], ['#f76b15', 'Orange'], ['#c99a00', 'Gold'],
  ['#2f9e5b', 'Green'], ['#127a6b', 'Teal'], ['#1f6feb', 'Blue'], ['#1b3a8a', 'Navy'], ['#8e4ec6', 'Purple'], ['#d6409f', 'Pink'],
];
const HL_COLORS = [
  ['#fff176', 'Yellow'], ['#b9f6ca', 'Green'], ['#a7e3ff', 'Blue'], ['#ffc7e0', 'Pink'], ['#ffd8a8', 'Orange'], ['#e2d4ff', 'Purple'], ['#d9d9d9', 'Gray'], ['', 'No highlight'],
];
const BLOCKS = [['p', 'Normal'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['blockquote', 'Quote'], ['pre', 'Code']];
const ZWSP = /​/g;

// ---------------------------------------------------------------- colour / size helpers

let _cctx;
function toHex(c) {
  if (!c) return null;
  _cctx = _cctx || document.createElement('canvas').getContext('2d');
  _cctx.fillStyle = '#010203';
  _cctx.fillStyle = c;
  const v = _cctx.fillStyle;
  if (v === '#010203' && !/^#?010203$/i.test(c)) return null;
  if (v.startsWith('#')) return v.slice(1).toUpperCase();
  const m = v.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a] = m[1].split(',').map((x) => parseFloat(x));
  if (a === 0) return null;
  return [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase();
}
const isBlackish = (hex) => hex && parseInt(hex.slice(0, 2), 16) < 40 && parseInt(hex.slice(2, 4), 16) < 40 && parseInt(hex.slice(4, 6), 16) < 40;
const isWhitish = (hex) => hex && parseInt(hex.slice(0, 2), 16) > 245 && parseInt(hex.slice(2, 4), 16) > 245 && parseInt(hex.slice(4, 6), 16) > 245;

const KEYWORD_PT = { 'xx-small': 7, 'x-small': 7.5, small: 10, medium: 12, large: 13.5, 'x-large': 18, 'xx-large': 24, 'xxx-large': 36 };
function toPt(v) {
  if (!v) return null;
  v = String(v).trim();
  if (KEYWORD_PT[v]) return KEYWORD_PT[v];
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return null;
  if (v.endsWith('pt')) return n;
  if (v.endsWith('px')) return Math.round(n * 0.75 * 2) / 2;
  return null;
}
const FONT_TAG_PT = { 1: 7.5, 2: 10, 3: 12, 4: 13.5, 5: 18, 6: 24, 7: 36 };
const firstFamily = (f) => (f || '').split(',')[0].replace(/["']/g, '').trim();

// ---------------------------------------------------------------- sanitising (paste)

const ALLOWED = new Set(['P', 'DIV', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'HR', 'MARK', 'A', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'CODE', 'PRE', 'SPAN', 'FONT', 'SUP', 'SUB']);
const DROP = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'HEAD', 'IFRAME', 'OBJECT', 'SVG', 'IMG', 'VIDEO', 'AUDIO', 'XML', 'TEMPLATE', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);
const INLINE_STYLE = ['font-size', 'font-family', 'color', 'background-color', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line'];
const BLOCK_STYLE = ['text-align', 'line-height', 'margin-left'];

function cleanStyle(src, dst, allowed) {
  for (const prop of allowed) {
    let v = src.style.getPropertyValue(prop);
    if (!v) continue;
    if (prop === 'color') { const h = toHex(v); if (!h || isBlackish(h)) continue; v = '#' + h; }
    if (prop === 'background-color') { const h = toHex(v); if (!h || isWhitish(h)) continue; v = '#' + h; }
    if (prop === 'font-size') { const pt = toPt(v); if (!pt) continue; v = pt + 'pt'; }
    if (prop === 'font-family') { v = firstFamily(v); if (!v || /^(inherit|initial)$/.test(v)) continue; }
    if (prop === 'text-align' && !/^(left|center|right|justify)$/.test(v)) continue;
    if (prop === 'margin-left' && !(parseFloat(v) > 0)) continue;
    dst.style.setProperty(prop, v);
  }
}

export function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walk = (node, outParent, inPre = false) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) {
        // source-code line breaks in pasted HTML are just spaces (except inside <pre>)
        const v = inPre ? child.nodeValue : child.nodeValue.replace(/\s*[\r\n]+\s*/g, ' ');
        if (v) outParent.appendChild(document.createTextNode(v));
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName;
      if (DROP.has(tag)) continue;
      if (!ALLOWED.has(tag)) { walk(child, outParent, inPre); continue; }
      let name = { DIV: 'p', STRONG: 'b', EM: 'i', STRIKE: 's', DEL: 's', FONT: 'span', H4: 'h3', H5: 'h3', H6: 'h3' }[tag] || tag.toLowerCase();
      const el = document.createElement(name);
      if (tag === 'A' && /^(https?:|mailto:)/i.test(child.getAttribute('href') || '')) el.setAttribute('href', child.getAttribute('href'));
      if (tag === 'UL' && child.classList.contains('checklist')) el.className = 'checklist';
      if (tag === 'LI' && child.hasAttribute('data-checked')) el.setAttribute('data-checked', '');
      if (tag === 'TABLE') el.className = 'rdx-table';
      if (tag === 'FONT') {
        if (child.getAttribute('face')) el.style.fontFamily = firstFamily(child.getAttribute('face'));
        const c = toHex(child.getAttribute('color'));
        if (c && !isBlackish(c)) el.style.color = '#' + c;
        const sz = FONT_TAG_PT[child.getAttribute('size')];
        if (sz) el.style.fontSize = sz + 'pt';
      }
      cleanStyle(child, el, INLINE_STYLE);
      if (/^(P|DIV|H[1-6]|LI|BLOCKQUOTE|PRE)$/.test(tag)) cleanStyle(child, el, BLOCK_STYLE);
      walk(child, el, inPre || tag === 'PRE');
      // unwrap spans that carry nothing
      if (name === 'span' && !el.getAttribute('style')) { while (el.firstChild) outParent.appendChild(el.firstChild); continue; }
      outParent.appendChild(el);
    }
  };
  const out = document.createElement('div');
  walk(doc.body, out);
  return out.innerHTML;
}

// ---------------------------------------------------------------- toolbar

const btn = (cmd, ic, tip, extra = '') => `<button class="tb-btn" data-cmd="${cmd}" title="${tip}" ${extra}>${ic}</button>`;
const SEP = '<span class="fmt-sep"></span>';
const T = (txt) => `<span class="tb-txt">${txt}</span>`;

function toolbarHtml(view) {
  return `
    <div class="fmt-group">
      ${btn('undo', icon('undo', 17), 'Undo (Ctrl+Z)')}${btn('redo', icon('redo', 17), 'Redo (Ctrl+Y)')}
    </div>${SEP}
    <div class="fmt-group">
      <select class="fmt-select block-select" data-sel="block" title="Paragraph style">${BLOCKS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <select class="fmt-select font-select" data-sel="font" title="Font">${FONTS.map((f) => `<option value="${f}" style="font-family:'${f}'">${f}</option>`).join('')}</select>
      <div class="size-box" title="Font size">
        ${btn('sizeDown', icon('minus', 14), 'Decrease font size (Ctrl+[)')}
        <input class="size-input" data-sel="size" list="rdx-sizes" value="11" inputmode="decimal" aria-label="Font size">
        <datalist id="rdx-sizes">${SIZES.map((sz) => `<option value="${sz}">`).join('')}</datalist>
        ${btn('sizeUp', icon('plus', 14), 'Increase font size (Ctrl+])')}
      </div>
    </div>${SEP}
    <div class="fmt-group">
      ${btn('bold', icon('bold', 17), 'Bold (Ctrl+B)')}${btn('italic', icon('italic', 17), 'Italic (Ctrl+I)')}${btn('underline', icon('underline', 17), 'Underline (Ctrl+U)')}${btn('strike', icon('strike', 17), 'Strikethrough (Ctrl+Shift+X)')}
    </div>${SEP}
    <div class="fmt-group">
      <span class="split">${btn('color', `<span class="color-a">A<i class="cbar" data-bar="color"></i></span>`, 'Font colour')}${btn('colorMenu', icon('down', 12), 'More colours', 'data-narrow')}</span>
      <span class="split">${btn('hilite', `<span class="color-a">${icon('highlighter', 15)}<i class="cbar" data-bar="hilite"></i></span>`, 'Highlight (Ctrl+Shift+H)')}${btn('hiliteMenu', icon('down', 12), 'Highlight colours', 'data-narrow')}</span>
    </div>${SEP}
    <div class="fmt-group">
      <span class="split">${btn('alignMenu', `<span class="align-ic">${icon('alignLeft', 17)}</span>`, 'Alignment (Ctrl+L / E / R / J)')}</span>
      ${btn('ul', icon('ul', 17), 'Bullets (Ctrl+Shift+8)')}${btn('ol', icon('ol', 17), 'Numbering (Ctrl+Shift+7)')}${btn('check', icon('checklist', 17), 'Checklist (Ctrl+Shift+9)')}
    </div>${SEP}
    <div class="fmt-group">
      ${btn('link', icon('link', 17), 'Link (Ctrl+K)')}${btn('table', icon('table', 17), 'Table')}${btn('find', icon('search', 17), 'Find & replace (Ctrl+F / Ctrl+H)')}${btn('moreMenu', icon('more', 17), 'More: superscript, indent, line spacing, divider, time…')}
    </div>
    <span class="grow"></span>
    <button class="tb-btn view-btn" data-view="toggle" title="${view === 'wide' ? 'Switch to page view (like Word)' : 'Switch to full width (like Notepad)'}">${icon(view === 'wide' ? 'file' : 'fit', 16)}</button>
`;
}

function findBarHtml() {
  return `
    <div class="find-row">
      ${icon('search', 16)}
      <input class="find-input" placeholder="Find" aria-label="Find">
      <span class="find-count muted">0/0</span>
      <button class="tb-btn" data-find="prev" title="Previous (Shift+Enter)">${icon('up', 15)}</button>
      <button class="tb-btn" data-find="next" title="Next (Enter)">${icon('down', 15)}</button>
      <button class="tb-btn toggle" data-find="case" title="Match case">Aa</button>
      <button class="tb-btn toggle" data-find="word" title="Whole word">ab|</button>
      <span class="find-sep"></span>
      <input class="replace-input" placeholder="Replace with" aria-label="Replace with">
      <button class="pill-btn" data-find="replace">Replace</button>
      <button class="pill-btn" data-find="all">Replace all</button>
      <span class="grow"></span>
      <button class="tb-btn" data-find="close" title="Close (Esc)">${icon('x', 15)}</button>
    </div>`;
}

const VIEW_KEY = 'redox.noteView';
const readView = () => { try { return localStorage.getItem(VIEW_KEY) || 'wide'; } catch { return 'wide'; } };
const saveView = (v) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ } };

// ---------------------------------------------------------------- editor

export class NoteEditor {
  constructor(host, doc, { onChange, stamp, zoom }) {
    this.doc = doc;
    this.onChange = onChange;
    this.stamp = stamp;
    this.zoom = zoom;
    this.color = '#c0392b';
    this.hilite = '#fff176';
    this.lastSize = BASE_PT;
    const view = readView();
    host.innerHTML = `
      <div class="note-wrap ${view}">
        <div class="fmt-bar">${toolbarHtml(view)}</div>
        <div class="find-bar" hidden>${findBarHtml()}</div>
        <div class="note-scroll">
          <div class="note-page">
            <input class="note-title" placeholder="Untitled note" maxlength="200">
            <div class="note-body" contenteditable="true" spellcheck="true" data-placeholder="Start writing… (F5 inserts the time, Ctrl+Shift+9 adds a checklist)"></div>
          </div>
        </div>
      </div>`;
    this.wrap = host.querySelector('.note-wrap');
    this.bar = host.querySelector('.fmt-bar');
    this.findBar = host.querySelector('.find-bar');
    this.scroller = host.querySelector('.note-scroll');
    this.title = host.querySelector('.note-title');
    this.body = host.querySelector('.note-body');
    this.title.value = doc.title || '';
    this.body.innerHTML = doc.html || '';
    this.normaliseLegacy();
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); document.execCommand('styleWithCSS', false, false); } catch { /* ignore */ }
    this.syncSwatches();

    this.title.addEventListener('input', () => { this.doc.title = this.title.value; this.onChange(); });
    this.title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.body.focus(); } });
    this.body.addEventListener('input', () => { this.fixSizes(); this.save(); this.syncToolbarSoon(); });
    this.body.addEventListener('paste', (e) => this.paste(e));
    this.body.addEventListener('click', (e) => {
      const li = e.target.closest('ul.checklist > li');
      if (li && e.offsetX < 26) { li.toggleAttribute('data-checked'); this.save(); }
    });
    this.body.addEventListener('keydown', (e) => this.keys(e));
    this.scroller.addEventListener('mousedown', (e) => {
      // clicking the grey area / page margins puts the caret at the end, like Word
      if (e.target === this.scroller || e.target.classList.contains('note-page')) {
        e.preventDefault();
        this.body.focus();
        const r = document.createRange();
        r.selectNodeContents(this.body);
        r.collapse(false);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
      }
    });
    this.scroller.addEventListener('wheel', (e) => {
      if (e.ctrlKey && this.zoom) { e.preventDefault(); this.zoom(e.deltaY < 0 ? 1 : -1); }
    }, { passive: false });

    // toolbar: buttons act on mousedown so the text selection is never lost
    this.bar.addEventListener('mousedown', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.preventDefault();
      if (b.dataset.view) { this.setView(this.wrap.classList.contains('wide') ? 'page' : 'wide'); return; }
      this.cmd(b.dataset.cmd, b);
    });
    this.bar.querySelector('[data-sel="block"]').addEventListener('change', (e) => this.cmd('block', e.target.value));
    this.bar.querySelector('[data-sel="font"]').addEventListener('change', (e) => this.cmd('font', e.target.value));
    const size = this.bar.querySelector('[data-sel="size"]');
    const applySize = () => { const v = parseFloat(size.value); if (v >= 1 && v <= 400) this.setSize(v); };
    size.addEventListener('change', applySize);
    size.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applySize(); } });

    this._onSel = () => this.onSelection();
    document.addEventListener('selectionchange', this._onSel);
    this.bindFind();
    if (!doc.html) setTimeout(() => (doc.title ? this.body : this.title).focus(), 0);
    this.syncToolbar();
  }

  destroy() {
    document.removeEventListener('selectionchange', this._onSel);
    this.closePop();
    this.clearHighlights();
  }

  save() {
    this.doc.html = this.body.innerHTML;
    this.onChange();
  }

  focus() { this.body.focus(); }

  // ---------------------------------------------------------- selection
  onSelection() {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (!this.body.contains(r.commonAncestorContainer)) return;
    this.range = r.cloneRange();
    this.syncToolbarSoon();
    this.updateCaret();
  }

  restore() {
    // while the caret is live in the editor, the real selection is the truth;
    // only bring back the saved range after a dropdown or box took the focus
    const live = getSelection();
    if (document.activeElement === this.body && live.rangeCount && this.body.contains(live.anchorNode)) return;
    this.body.focus({ preventScroll: true });
    if (this.range && this.body.contains(this.range.commonAncestorContainer)) {
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(this.range);
    }
  }

  anchorEl() {
    const sel = getSelection();
    let n = sel.rangeCount && this.body.contains(sel.anchorNode) ? sel.anchorNode : this.range?.startContainer;
    if (!n || !this.body.contains(n)) return this.body;
    if (n.nodeType === 3) n = n.parentElement;
    return n;
  }

  currentBlock() {
    const el = this.anchorEl();
    return el.closest('p, h1, h2, h3, li, blockquote, pre, div:not(.note-body), td, th') || null;
  }

  /** Leaf blocks touched by the selection (for line spacing / indent). */
  selectedBlocks() {
    const r = this.range;
    const leaves = [...this.body.querySelectorAll('p, h1, h2, h3, li, blockquote, pre')].filter((b) => !b.querySelector('p, h1, h2, h3, li, pre'));
    let out = r ? leaves.filter((b) => r.intersectsNode(b)) : [];
    if (!out.length) {
      const b = this.currentBlock();
      if (b) out = [b];
      else {
        // bare text directly in the body: wrap it in a paragraph first
        document.execCommand('formatBlock', false, 'p');
        const nb = this.currentBlock();
        if (nb) out = [nb];
      }
    }
    return out;
  }

  // ---------------------------------------------------------- toolbar state
  syncToolbarSoon() {
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(() => this.syncToolbar());
  }

  syncToolbar() {
    const q = (c) => { try { return document.queryCommandState(c); } catch { return false; } };
    const on = (cmd, v) => this.bar.querySelector(`[data-cmd="${cmd}"]`)?.classList.toggle('on', !!v);
    on('bold', q('bold'));
    on('italic', q('italic'));
    on('underline', q('underline'));
    on('strike', q('strikeThrough'));
    on('superscript', q('superscript'));
    on('subscript', q('subscript'));
    on('ul', q('insertUnorderedList') && !this.anchorEl().closest('ul.checklist'));
    on('ol', q('insertOrderedList'));
    on('check', !!this.anchorEl().closest('ul.checklist'));
    const block = this.currentBlock();
    const align = block ? getComputedStyle(block).textAlign : 'start';
    on('alignLeft', /^(left|start)$/.test(align));
    on('alignCenter', align === 'center');
    on('alignRight', /^(right|end)$/.test(align));
    on('alignJustify', align === 'justify');
    const aic = this.bar.querySelector('.align-ic');
    if (aic) {
      const cur = align === 'center' ? 'alignCenter' : /^(right|end)$/.test(align) ? 'alignRight' : align === 'justify' ? 'alignJustify' : 'alignLeft';
      if (aic.dataset.cur !== cur) { aic.dataset.cur = cur; aic.innerHTML = icon(cur, 17); }
    }
    on('table', !!this.anchorEl().closest('table'));
    on('find', !this.findBar.hidden);

    let fb = '';
    try { fb = document.queryCommandValue('formatBlock').toLowerCase(); } catch { /* ignore */ }
    const bs = this.bar.querySelector('[data-sel="block"]');
    if (document.activeElement !== bs) bs.value = BLOCKS.some(([v]) => v === fb) ? fb : 'p';

    const el = this.anchorEl();
    const cs = getComputedStyle(el);
    const fam = firstFamily(cs.fontFamily);
    const fs = this.bar.querySelector('[data-sel="font"]');
    if (document.activeElement !== fs) {
      if (![...fs.options].some((o) => o.value === fam) && fam) fs.add(new Option(fam, fam));
      fs.value = fam || 'Calibri';
    }
    const base = parseFloat(getComputedStyle(this.body).fontSize) || 1;
    const pt = Math.round((parseFloat(cs.fontSize) / base) * BASE_PT * 2) / 2;
    const si = this.bar.querySelector('[data-sel="size"]');
    if (document.activeElement !== si) si.value = String(pt);
  }

  syncSwatches() {
    this.bar.querySelector('[data-bar="color"]').style.background = this.color || 'var(--fg)';
    this.bar.querySelector('[data-bar="hilite"]').style.background = this.hilite || 'transparent';
  }

  updateCaret() {
    const el = document.getElementById('caret-pos');
    if (!el) return;
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    const leaves = [...this.body.querySelectorAll('p, h1, h2, h3, li, blockquote, pre, td, th')].filter((b) => !b.querySelector('p, h1, h2, h3, li, pre'));
    let block = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
    block = block.closest('p, h1, h2, h3, li, blockquote, pre, td, th');
    let line = block ? leaves.indexOf(block) + 1 : 1;
    let col = 1;
    if (block) {
      const pre = document.createRange();
      pre.selectNodeContents(block);
      pre.setEnd(r.startContainer, r.startOffset);
      col = pre.toString().replace(ZWSP, '').length + 1;
    }
    if (line < 1) line = 1;
    const selLen = sel.toString().length;
    el.textContent = `Ln ${line}, Col ${col}${selLen ? ` · ${selLen} selected` : ''}`;
  }

  // ---------------------------------------------------------- commands
  ex(c, v = null) { return document.execCommand(c, false, v); }

  withCss(fn) {
    this.ex('styleWithCSS', true);
    try { fn(); } finally { this.ex('styleWithCSS', false); }
  }

  /** Chrome only knows sizes 1-7, so apply 7 and rewrite it to the real point size. */
  setSize(pt) {
    this.lastSize = pt;
    this.restore();
    this.withCss(() => this.ex('fontSize', '7'));
    this.fixSizes();
    this.save();
    this.syncToolbar();
  }

  fixSizes() {
    for (const el of this.body.querySelectorAll('[style*="xxx-large"], font[size="7"]')) {
      if (el.tagName === 'FONT') {
        const span = document.createElement('span');
        span.style.fontSize = this.lastSize + 'pt';
        span.append(...el.childNodes);
        el.replaceWith(span);
      } else el.style.fontSize = this.lastSize + 'pt';
    }
  }

  stepSize(dir) {
    const cur = parseFloat(this.bar.querySelector('[data-sel="size"]').value) || BASE_PT;
    const next = dir > 0 ? SIZES.find((s) => s > cur) || cur + 10 : [...SIZES].reverse().find((s) => s < cur) || Math.max(1, cur - 1);
    this.setSize(next);
  }

  setIndent(dir) {
    const inList = !!this.anchorEl().closest('li');
    if (inList) { this.ex(dir > 0 ? 'indent' : 'outdent'); return; }
    for (const b of this.selectedBlocks()) {
      const cur = parseFloat(b.style.marginLeft) || 0;
      const next = Math.max(0, cur + dir * 0.5);
      b.style.marginLeft = next ? next + 'in' : '';
      if (!b.getAttribute('style')) b.removeAttribute('style');
    }
  }

  cmd(c, arg) {
    if (!c) return;
    if (c === 'colorMenu') { this.colorMenu(arg, 'color'); return; }
    if (c === 'hiliteMenu') { this.colorMenu(arg, 'hilite'); return; }
    if (c === 'spacing') { this.spacingMenu(arg); return; }
    if (c === 'alignMenu') { this.alignMenu(arg); return; }
    if (c === 'moreMenu') { this.moreMenu(arg); return; }
    if (c === 'table') { this.tableMenu(arg); return; }
    if (c === 'link') { this.linkMenu(arg); return; }
    if (c === 'find') { this.openFind(false); return; }
    this.restore();
    switch (c) {
      case 'undo': this.ex('undo'); break;
      case 'redo': this.ex('redo'); break;
      case 'block': {
        this.ex('formatBlock', arg);
        break;
      }
      case 'h1': case 'h2': case 'h3': {
        const cur = document.queryCommandValue('formatBlock').toLowerCase();
        this.ex('formatBlock', cur === c ? 'p' : c);
        break;
      }
      case 'p': this.ex('formatBlock', 'p'); break;
      case 'font': this.withCss(() => this.ex('fontName', arg)); break;
      case 'sizeUp': this.stepSize(1); return;
      case 'sizeDown': this.stepSize(-1); return;
      case 'bold': case 'italic': case 'underline': case 'superscript': case 'subscript': this.ex(c); break;
      case 'strike': this.ex('strikeThrough'); break;
      case 'color': this.applyColor(this.color); break;
      case 'hilite': this.applyHilite(this.hilite); break;
      case 'mark': this.applyHilite(this.hilite || '#fff176'); break;
      case 'alignLeft': this.ex('justifyLeft'); break;
      case 'alignCenter': this.ex('justifyCenter'); break;
      case 'alignRight': this.ex('justifyRight'); break;
      case 'alignJustify': this.ex('justifyFull'); break;
      case 'ul': {
        const inCheck = this.anchorEl().closest('ul.checklist');
        if (inCheck) { inCheck.classList.remove('checklist'); break; }
        this.ex('insertUnorderedList');
        break;
      }
      case 'ol': this.ex('insertOrderedList'); break;
      case 'check': {
        const ul = this.anchorEl().closest('ul, ol');
        if (ul && ul.tagName === 'UL' && ul.classList.contains('checklist')) { this.ex('insertUnorderedList'); break; }
        if (!ul || ul.tagName !== 'UL') this.ex('insertUnorderedList');
        this.anchorEl().closest('ul')?.classList.add('checklist');
        break;
      }
      case 'indent': this.setIndent(1); break;
      case 'outdent': this.setIndent(-1); break;
      case 'quote': {
        const cur = document.queryCommandValue('formatBlock').toLowerCase();
        this.ex('formatBlock', cur === 'blockquote' ? 'p' : 'blockquote');
        break;
      }
      case 'hr': this.ex('insertHorizontalRule'); break;
      case 'time': this.insertStamp(); break;
      case 'clear': {
        this.ex('removeFormat');
        this.ex('unlink');
        for (const b of this.selectedBlocks()) { b.style.textAlign = ''; b.style.lineHeight = ''; b.style.marginLeft = ''; if (!b.getAttribute('style')) b.removeAttribute('style'); }
        break;
      }
      default: break;
    }
    this.save();
    this.syncToolbar();
  }

  applyColor(c) {
    this.restore();
    if (!c) {
      // "Automatic": strip explicit colours inside the selection
      this.withCss(() => this.ex('foreColor', '#010203'));
      this.body.querySelectorAll('[style*="color"]').forEach((el) => { if (toHex(el.style.color) === '010203') { el.style.color = ''; if (!el.getAttribute('style')) el.removeAttribute('style'); } });
    } else this.withCss(() => this.ex('foreColor', c));
  }

  applyHilite(c) {
    this.restore();
    if (!c) {
      this.withCss(() => this.ex('hiliteColor', 'transparent'));
      this.body.querySelectorAll('mark').forEach((m) => { if (getSelection().containsNode(m, true)) m.replaceWith(...m.childNodes); });
    } else this.withCss(() => this.ex('hiliteColor', c));
  }

  insertStamp() {
    this.restore();
    this.ex('insertText', this.stamp());
  }

  // ---------------------------------------------------------- popovers
  pop(anchor, html, bind) {
    this.closePop();
    const p = document.createElement('div');
    p.className = 'fmt-pop';
    p.innerHTML = html;
    document.body.appendChild(p);
    const r = anchor.getBoundingClientRect();
    let x = r.left;
    if (x + p.offsetWidth > innerWidth - 8) x = innerWidth - p.offsetWidth - 8;
    p.style.left = Math.max(8, x) + 'px';
    p.style.top = r.bottom + 6 + 'px';
    p.addEventListener('mousedown', (e) => { if (!e.target.closest('input')) e.preventDefault(); });
    // only ever act for the popup that is currently open
    const mine = () => this._pop && this._pop.el === p;
    const outside = (e) => { if (mine() && !p.contains(e.target) && !anchor.contains(e.target)) this.closePop(); };
    const esc = (e) => { if (mine() && e.key === 'Escape') { this.closePop(); this.restore(); } };
    let alive = true;
    setTimeout(() => { if (!alive) return; document.addEventListener('mousedown', outside); document.addEventListener('keydown', esc, true); }, 0);
    this._pop = { el: p, cleanup: () => { alive = false; document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', esc, true); } };
    bind(p);
    return p;
  }

  closePop() {
    if (!this._pop) return;
    this._pop.cleanup();
    this._pop.el.remove();
    this._pop = null;
  }

  colorMenu(anchor, kind) {
    const list = kind === 'color' ? TEXT_COLORS : HL_COLORS;
    this.pop(anchor, `
      <div class="pop-title">${kind === 'color' ? 'Font colour' : 'Highlight colour'}</div>
      <div class="swatch-grid">${list.map(([c, n]) => `<button class="sw ${c ? '' : 'none'}" data-c="${c}" title="${n}" style="${c ? `--c:${c}` : ''}">${c ? '' : icon('x', 14)}</button>`).join('')}</div>
      <label class="pop-custom">Custom <input type="color" value="${(kind === 'color' ? this.color : this.hilite) || '#000000'}"></label>`, (p) => {
      const pick = (c) => {
        if (kind === 'color') { this.color = c; this.applyColor(c); } else { this.hilite = c; this.applyHilite(c); }
        this.syncSwatches();
        this.closePop();
        this.save();
      };
      p.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => pick(b.dataset.c)));
      p.querySelector('input[type=color]').addEventListener('change', (e) => pick(e.target.value));
    });
  }

  alignMenu(anchor) {
    const opts = [['alignLeft', 'Align left', 'Ctrl+L'], ['alignCenter', 'Center', 'Ctrl+E'], ['alignRight', 'Align right', 'Ctrl+R'], ['alignJustify', 'Justify', 'Ctrl+J']];
    const cur = this.bar.querySelector('.align-ic')?.dataset.cur || 'alignLeft';
    this.pop(anchor, opts.map(([c, l, k]) => `<button class="pop-item row ${cur === c ? 'on' : ''}" data-a="${c}">${icon(c, 16)}<span>${l}</span><kbd>${k}</kbd></button>`).join(''), (p) => {
      p.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => { this.closePop(); this.cmd(b.dataset.a); }));
    });
  }

  moreMenu(anchor) {
    const opts = [
      ['superscript', 'Superscript', 'x²', ''], ['subscript', 'Subscript', 'x₂', ''],
      ['-'], ['indent', 'Increase indent', icon('indent', 16), 'Tab'], ['outdent', 'Decrease indent', icon('outdent', 16), 'Shift+Tab'],
      ['spacing', 'Line spacing…', icon('lineSpacing', 16), ''],
      ['-'], ['hr', 'Divider line', icon('hr', 16), ''], ['time', 'Insert time & date', icon('clock', 16), 'F5'],
      ['clear', 'Clear formatting', icon('eraseFormat', 16), 'Ctrl+Space'],
    ];
    this.pop(anchor, opts.map((o) => (o[0] === '-' ? '<div class="pop-sep"></div>' : `<button class="pop-item row" data-a="${o[0]}"><span class="pi-ic">${o[2]}</span><span>${o[1]}</span><kbd>${o[3]}</kbd></button>`)).join(''), (p) => {
      p.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => {
        const a = b.dataset.a;
        this.closePop();
        if (a === 'spacing') this.spacingMenu(anchor); else this.cmd(a);
      }));
    });
  }

  spacingMenu(anchor) {
    const cur = this.currentBlock()?.style.lineHeight || '';
    this.pop(anchor, `<div class="pop-title">Line spacing</div>${['1', '1.15', '1.5', '2', '2.5', '3'].map((v) => `<button class="pop-item ${cur === v ? 'on' : ''}" data-v="${v}">${v === '1' ? '1.0' : v}</button>`).join('')}`, (p) => {
      p.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => {
        this.restore();
        for (const bl of this.selectedBlocks()) bl.style.lineHeight = b.dataset.v === '1.15' ? '' : b.dataset.v;
        this.closePop();
        this.save();
      }));
    });
  }

  linkMenu(anchor) {
    const existing = this.anchorEl().closest('a');
    this.pop(anchor, `
      <div class="pop-title">Insert link</div>
      <input class="pop-input" placeholder="https://…" value="${existing ? existing.getAttribute('href') : ''}">
      <div class="pop-row">${existing ? '<button class="pill-btn" data-rm>Remove</button>' : ''}<span class="grow"></span><button class="pill-btn primary-pill" data-ok>Apply</button></div>`, (p) => {
      const input = p.querySelector('input');
      setTimeout(() => input.focus(), 0);
      const ok = () => {
        let url = input.value.trim();
        if (!url) return;
        if (!/^(https?:|mailto:)/i.test(url)) url = (url.includes('@') && !url.includes('/') ? 'mailto:' : 'https://') + url;
        this.closePop();
        this.restore();
        if (getSelection().isCollapsed && !existing) this.ex('insertHTML', `<a href="${url.replace(/"/g, '&quot;')}">${url.replace(/</g, '&lt;')}</a>&nbsp;`);
        else if (existing) existing.setAttribute('href', url);
        else this.ex('createLink', url);
        this.save();
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
      p.querySelector('[data-ok]').addEventListener('click', ok);
      p.querySelector('[data-rm]')?.addEventListener('click', () => { this.closePop(); this.restore(); const s = getSelection(); s.selectAllChildren(existing); this.ex('unlink'); this.save(); });
    });
  }

  tableMenu(anchor) {
    const cell = this.anchorEl().closest('td, th');
    const N = 8;
    let grid = '';
    for (let r = 1; r <= 6; r++) for (let c = 1; c <= N; c++) grid += `<span data-r="${r}" data-c="${c}"></span>`;
    this.pop(anchor, `
      <div class="pop-title">Insert table <span class="muted tbl-size"></span></div>
      <div class="tbl-grid" style="grid-template-columns:repeat(${N},18px)">${grid}</div>
      ${cell ? `<div class="pop-sep"></div>
        <button class="pop-item" data-t="rowAbove">Insert row above</button>
        <button class="pop-item" data-t="rowBelow">Insert row below</button>
        <button class="pop-item" data-t="colLeft">Insert column left</button>
        <button class="pop-item" data-t="colRight">Insert column right</button>
        <div class="pop-sep"></div>
        <button class="pop-item" data-t="delRow">Delete row</button>
        <button class="pop-item" data-t="delCol">Delete column</button>
        <button class="pop-item danger" data-t="delTable">Delete table</button>` : ''}`, (p) => {
      const cells = [...p.querySelectorAll('.tbl-grid span')];
      const label = p.querySelector('.tbl-size');
      p.querySelector('.tbl-grid').addEventListener('mousemove', (e) => {
        const s = e.target.closest('span');
        if (!s) return;
        cells.forEach((x) => x.classList.toggle('on', +x.dataset.r <= +s.dataset.r && +x.dataset.c <= +s.dataset.c));
        label.textContent = `${s.dataset.c} × ${s.dataset.r}`;
      });
      p.querySelector('.tbl-grid').addEventListener('click', (e) => {
        const s = e.target.closest('span');
        if (!s) return;
        this.closePop();
        this.insertTable(+s.dataset.r, +s.dataset.c);
      });
      p.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { this.closePop(); this.tableOp(b.dataset.t, cell); }));
    });
  }

  insertTable(rows, cols) {
    this.restore();
    const row = (tag) => `<tr>${`<${tag}><br></${tag}>`.repeat(cols)}</tr>`;
    const html = `<table class="rdx-table" data-new="1"><tbody>${row('th')}${row('td').repeat(Math.max(0, rows - 1))}</tbody></table><p><br></p>`;
    this.ex('insertHTML', html);
    const t = this.body.querySelector('table[data-new]');
    if (t) {
      t.removeAttribute('data-new');
      const r = document.createRange();
      r.selectNodeContents(t.querySelector('th, td'));
      r.collapse(true);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
    this.save();
  }

  tableOp(op, cell) {
    if (!cell || !this.body.contains(cell)) return;
    const tr = cell.parentElement;
    const table = cell.closest('table');
    const idx = [...tr.children].indexOf(cell);
    const newCell = (tag) => { const c = document.createElement(tag); c.innerHTML = '<br>'; return c; };
    if (op === 'rowAbove' || op === 'rowBelow') {
      const n = document.createElement('tr');
      [...tr.children].forEach(() => n.appendChild(newCell('td')));
      tr.parentElement.insertBefore(n, op === 'rowAbove' ? tr : tr.nextSibling);
    } else if (op === 'colLeft' || op === 'colRight') {
      for (const r of table.querySelectorAll('tr')) {
        const ref = r.children[idx];
        const c = newCell(r.children[0]?.tagName === 'TH' ? 'th' : 'td');
        r.insertBefore(c, op === 'colLeft' ? ref : ref?.nextSibling || null);
      }
    } else if (op === 'delRow') {
      tr.remove();
      if (!table.querySelector('tr')) table.remove();
    } else if (op === 'delCol') {
      for (const r of table.querySelectorAll('tr')) r.children[idx]?.remove();
      if (!table.querySelector('td, th')) table.remove();
    } else if (op === 'delTable') table.remove();
    this.save();
  }

  /** Tab / Shift+Tab inside a table moves between cells (adds a row at the end). */
  tableTab(back) {
    const cell = this.anchorEl().closest('td, th');
    if (!cell) return false;
    const cells = [...cell.closest('table').querySelectorAll('td, th')];
    let i = cells.indexOf(cell) + (back ? -1 : 1);
    if (i >= cells.length) { this.tableOp('rowBelow', cell); return this.tableTab(false); }
    if (i < 0) return true;
    const target = cells[i];
    const r = document.createRange();
    r.selectNodeContents(target);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    return true;
  }

  // ---------------------------------------------------------- keys & paste
  keys(e) {
    const mod = e.ctrlKey || e.metaKey;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === 'Tab') {
      stop();
      if (this.tableTab(e.shiftKey)) return;
      if (this.anchorEl().closest('li')) { this.ex(e.shiftKey ? 'outdent' : 'indent'); this.save(); return; }
      if (e.shiftKey) { this.cmd('outdent'); return; }
      this.ex('insertText', '\t');
      return;
    }
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 'v' && e.shiftKey) { this.plainPaste = true; return; }
    const map = { '1': 'h1', '2': 'h2', '3': 'h3', '0': 'p' };
    if (map[k] && !e.shiftKey && !e.altKey) { stop(); this.cmd(map[k]); return; }
    if (e.shiftKey && e.code === 'Digit8') { stop(); this.cmd('ul'); return; }
    if (e.shiftKey && e.code === 'Digit7') { stop(); this.cmd('ol'); return; }
    if (e.shiftKey && e.code === 'Digit9') { stop(); this.cmd('check'); return; }
    if (e.shiftKey && k === 'h') { stop(); this.cmd('hilite'); return; }
    if (e.shiftKey && k === 'x') { stop(); this.cmd('strike'); return; }
    if (!e.shiftKey && k === 'l') { stop(); this.cmd('alignLeft'); return; }
    if (!e.shiftKey && k === 'e') { stop(); this.cmd('alignCenter'); return; }
    if (!e.shiftKey && k === 'r') { stop(); this.cmd('alignRight'); return; }
    if (!e.shiftKey && k === 'j') { stop(); this.cmd('alignJustify'); return; }
    if (k === 'k') { stop(); this.linkMenu(this.bar.querySelector('[data-cmd="link"]')); return; }
    if (k === ']' || (e.shiftKey && (k === '>' || k === '.'))) { stop(); this.stepSize(1); return; }
    if (k === '[' || (e.shiftKey && (k === '<' || k === ','))) { stop(); this.stepSize(-1); return; }
    if (k === ' ' ) { stop(); this.cmd('clear'); return; }
    if (k === 'f' && !e.shiftKey) { stop(); this.openFind(false); return; }
    if (k === 'h' && !e.shiftKey) { stop(); this.openFind(true); return; }
    if (k === 'y' || (k === 'z' && e.shiftKey)) { stop(); this.cmd('redo'); return; }
  }

  paste(e) {
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    e.preventDefault();
    const plain = this.plainPaste;
    this.plainPaste = false;
    if (html && !plain) this.ex('insertHTML', sanitize(html));
    else this.ex('insertText', text);
  }

  /** Older notes used <mark>; keep them working. */
  normaliseLegacy() { /* <mark> is still rendered and exported */ }

  // ---------------------------------------------------------- view
  setView(v) {
    saveView(v);
    this.wrap.classList.toggle('page', v === 'page');
    this.wrap.classList.toggle('wide', v === 'wide');
    const vb = this.bar.querySelector('[data-view]');
    if (vb) { vb.innerHTML = icon(v === 'wide' ? 'file' : 'fit', 16); vb.title = v === 'wide' ? 'Switch to page view (like Word)' : 'Switch to full width (like Notepad)'; }
  }

  // ---------------------------------------------------------- find & replace
  bindFind() {
    const fb = this.findBar;
    this.fInput = fb.querySelector('.find-input');
    this.rInput = fb.querySelector('.replace-input');
    this.fCount = fb.querySelector('.find-count');
    this.matches = [];
    this.cur = -1;
    this.opts = { case: false, word: false };
    this.fInput.addEventListener('input', () => { this.search(); this.go(0, true); });
    this.fInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.go(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') { e.preventDefault(); this.closeFind(); }
    });
    this.rInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.replaceOne(); }
      if (e.key === 'Escape') { e.preventDefault(); this.closeFind(); }
    });
    fb.addEventListener('click', (e) => {
      const b = e.target.closest('[data-find]');
      if (!b) return;
      const a = b.dataset.find;
      if (a === 'next') this.go(1);
      if (a === 'prev') this.go(-1);
      if (a === 'close') this.closeFind();
      if (a === 'replace') this.replaceOne();
      if (a === 'all') this.replaceAll();
      if (a === 'case' || a === 'word') { this.opts[a] = !this.opts[a]; b.classList.toggle('on', this.opts[a]); this.search(); this.go(0, true); }
    });
    this.body.addEventListener('input', () => { if (!fb.hidden && this.fInput.value) { clearTimeout(this._ft); this._ft = setTimeout(() => { if (!fb.hidden) this.search(); }, 200); } });
  }

  openFind(replace) {
    this.findBar.hidden = false;
    this.findBar.classList.toggle('with-replace', true);
    const sel = getSelection().toString();
    if (sel && sel.length < 80 && !sel.includes('\n')) this.fInput.value = sel;
    (replace && this.fInput.value ? this.rInput : this.fInput).focus();
    this.fInput.select();
    this.search();
    this.go(0, true);
    this.syncToolbar();
  }

  closeFind() {
    clearTimeout(this._ft);
    this.findBar.hidden = true;
    this.clearHighlights();
    const m = this.matches[this.cur];
    this.body.focus();
    if (m) { const s = getSelection(); s.removeAllRanges(); s.addRange(m); }
    this.syncToolbar();
  }

  clearHighlights() {
    if (window.CSS?.highlights) { CSS.highlights.delete('rdx-find'); CSS.highlights.delete('rdx-find-cur'); }
  }

  search() {
    this.matches = [];
    const q = this.fInput.value;
    if (!q) { this.paint(); return; }
    const walker = document.createTreeWalker(this.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let text = '';
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push([n, text.length]); text += n.nodeValue; }
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(this.opts.word ? `\\b${esc}\\b` : esc, this.opts.case ? 'g' : 'gi');
    const locate = (pos) => {
      let lo = 0, hi = nodes.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (nodes[mid][1] <= pos) lo = mid; else hi = mid - 1; }
      return nodes[lo];
    };
    let m;
    while ((m = re.exec(text)) && this.matches.length < 5000) {
      if (!m[0].length) { re.lastIndex++; continue; }
      const [sn, so] = locate(m.index);
      const [en, eo] = locate(m.index + m[0].length - 1);
      const r = document.createRange();
      r.setStart(sn, m.index - so);
      r.setEnd(en, m.index + m[0].length - eo);
      this.matches.push(r);
    }
    if (this.cur >= this.matches.length) this.cur = this.matches.length - 1;
    this.paint();
  }

  paint() {
    if (this.findBar.hidden) { this.clearHighlights(); return; }
    if (window.CSS?.highlights && window.Highlight) {
      CSS.highlights.set('rdx-find', new Highlight(...this.matches));
      const cur = this.matches[this.cur];
      if (cur) CSS.highlights.set('rdx-find-cur', new Highlight(cur)); else CSS.highlights.delete('rdx-find-cur');
    }
    this.fCount.textContent = this.matches.length ? `${this.cur + 1}/${this.matches.length}` : (this.fInput.value ? 'No results' : '0/0');
    this.fCount.classList.toggle('none', !!this.fInput.value && !this.matches.length);
  }

  go(dir, fromCaret = false) {
    if (!this.matches.length) { this.cur = -1; this.paint(); return; }
    if (fromCaret) {
      // first match at or after the caret
      const at = this.range;
      let i = 0;
      if (at) { i = this.matches.findIndex((m) => m.compareBoundaryPoints(Range.START_TO_START, at) >= 0); if (i < 0) i = 0; }
      this.cur = i;
    } else this.cur = (this.cur + dir + this.matches.length) % this.matches.length;
    this.paint();
    const r = this.matches[this.cur].getBoundingClientRect();
    const box = this.scroller.getBoundingClientRect();
    if (r.top < box.top + 40 || r.bottom > box.bottom - 40) this.scroller.scrollTop += r.top - box.top - box.height / 3;
  }

  replaceOne() {
    const m = this.matches[this.cur];
    if (!m) { this.go(1); return; }
    this.body.focus();
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(m);
    this.ex('insertText', this.rInput.value);
    this.save();
    const keep = this.cur;
    this.search();
    this.cur = Math.min(keep, this.matches.length - 1);
    this.paint();
    this.rInput.focus();
  }

  replaceAll() {
    if (!this.matches.length) return;
    const n = this.matches.length;
    this.body.focus();
    const s = getSelection();
    for (let i = this.matches.length - 1; i >= 0; i--) {
      s.removeAllRanges();
      s.addRange(this.matches[i]);
      this.ex('insertText', this.rInput.value);
    }
    this.save();
    this.search();
    this.fCount.textContent = `Replaced ${n}`;
    this.rInput.focus();
  }
}

// ---------------------------------------------------------------- export helpers

function inlineRuns(node, style = {}, out = []) {
  for (const c of node.childNodes) {
    if (c.nodeType === 3) {
      const text = c.nodeValue.replace(/ /g, ' ').replace(ZWSP, '');
      if (text) out.push({ text, ...style });
      continue;
    }
    if (c.nodeType !== 1) continue;
    const t = c.tagName;
    if (t === 'BR') { out.push({ text: '\n', ...style }); continue; }
    if (t === 'UL' || t === 'OL' || t === 'TABLE') continue;
    const s = { ...style };
    if (t === 'B' || t === 'STRONG') s.b = true;
    if (t === 'I' || t === 'EM') s.i = true;
    if (t === 'U') s.u = true;
    if (t === 'S' || t === 'STRIKE' || t === 'DEL') s.s = true;
    if (t === 'MARK') s.bg = 'FFF176';
    if (t === 'SUP') s.sup = true;
    if (t === 'SUB') s.sub = true;
    if (t === 'A') { s.u = true; s.color = '0563C1'; }
    if (t === 'CODE') s.font = 'Consolas';
    if (t === 'FONT') {
      if (c.getAttribute('face')) s.font = firstFamily(c.getAttribute('face'));
      const col = toHex(c.getAttribute('color'));
      if (col) s.color = col;
      if (FONT_TAG_PT[c.getAttribute('size')]) s.size = FONT_TAG_PT[c.getAttribute('size')];
    }
    const st = c.style;
    if (st) {
      const fw = st.fontWeight;
      if (fw === 'bold' || parseInt(fw, 10) >= 600) s.b = true;
      else if (fw === 'normal' || parseInt(fw, 10) < 600) s.b = false;
      if (st.fontStyle === 'italic') s.i = true;
      const deco = `${st.textDecoration} ${st.textDecorationLine}`;
      if (deco.includes('underline')) s.u = true;
      if (deco.includes('line-through')) s.s = true;
      if (st.color) { const h = toHex(st.color); if (h) s.color = h; }
      if (st.backgroundColor) { const h = toHex(st.backgroundColor); if (h) s.bg = h; else delete s.bg; }
      const pt = toPt(st.fontSize);
      if (pt) s.size = pt;
      if (st.fontFamily) s.font = firstFamily(st.fontFamily);
    }
    inlineRuns(c, s, out);
  }
  // trim a trailing line break that browsers leave in empty blocks
  if (out.length && out[out.length - 1].text === '\n') out.pop();
  return out;
}

const INLINE = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'MARK', 'A', 'SPAN', 'CODE', 'BR', 'FONT', 'SUP', 'SUB']);

/** Paragraph options (alignment, line spacing, indent) from a block element's style. */
function blockOpts(el) {
  const o = {};
  const ta = el.style?.textAlign;
  if (ta) o.align = { left: 'left', center: 'center', right: 'right', justify: 'both' }[ta];
  const lh = parseFloat(el.style?.lineHeight);
  if (lh > 0 && lh < 6) o.line = lh;
  const ml = el.style?.marginLeft;
  if (ml) {
    const v = parseFloat(ml);
    const tw = ml.endsWith('in') ? v * 1440 : ml.endsWith('pt') ? v * 20 : v * 15;
    if (tw > 0) o.indent = Math.round(tw);
  }
  return o;
}

function listToDocx(dx, list, lvl, numId) {
  const ordered = list.tagName === 'OL';
  const check = list.classList.contains('checklist');
  const id = ordered ? numId || dx.newNum('decimal') : null;
  for (const li of list.children) {
    if (li.tagName !== 'LI') continue;
    let runs = inlineRuns(li);
    if (check) runs = [{ text: li.hasAttribute('data-checked') ? '☑  ' : '☐  ', font: 'Segoe UI Symbol' }, ...runs.map((r) => (li.hasAttribute('data-checked') ? { ...r, s: true, color: '808080' } : r))];
    if (check) dx.p(runs, { indent: 360 + lvl * 400, after: 40 });
    else if (ordered) dx.item(runs, 'decimal', Math.min(lvl, 2), id, blockOpts(li));
    else dx.item(runs, 'bullet', Math.min(lvl, 2), null, blockOpts(li));
    for (const sub of li.children) if (sub.tagName === 'UL' || sub.tagName === 'OL') listToDocx(dx, sub, lvl + 1);
  }
}

function blockToDocx(dx, el) {
  const t = el.tagName;
  const o = blockOpts(el);
  if (/^H[1-3]$/.test(t)) return dx.p(inlineRuns(el), { ...o, style: `Heading${t[1]}`, keepNext: true });
  if (t === 'UL' || t === 'OL') return listToDocx(dx, el, 0);
  if (t === 'HR') return dx.p('', { border: true, after: 160 });
  if (t === 'BLOCKQUOTE') {
    if ([...el.children].some((c) => !INLINE.has(c.tagName))) {
      // quotes that contain paragraphs
      for (const c of el.children) dx.p(inlineRuns(c, { i: true, color: '595959' }), { leftBar: 'C0392B', indent: 300 });
      return;
    }
    return dx.p(inlineRuns(el, { i: true, color: '595959' }), { ...o, leftBar: 'C0392B', indent: 300 });
  }
  if (t === 'PRE') return dx.p([{ text: el.textContent.replace(ZWSP, ''), font: 'Consolas', size: 10 }], { shade: 'F2F2F2' });
  if (t === 'TABLE') {
    const trs = [...el.querySelectorAll('tr')];
    const rows = trs.map((tr) => [...tr.children].map((td) => inlineRuns(td)));
    const header = trs[0] && [...trs[0].children].every((c) => c.tagName === 'TH');
    return dx.table(rows, { header });
  }
  // P/DIV that (invalidly, but browsers do it) contain lists or other blocks
  if ([...el.children].some((c) => !INLINE.has(c.tagName))) return blocksToDocx(dx, el);
  return dx.p(inlineRuns(el), o);
}

/** Walk mixed content: runs of inline nodes become paragraphs, blocks are dispatched. */
function blocksToDocx(dx, parent) {
  let pending = null;
  const flush = () => {
    if (pending && pending.textContent.replace(ZWSP, '').trim()) dx.p(inlineRuns(pending));
    pending = null;
  };
  for (const n of [...parent.childNodes]) {
    if (n.nodeType === 3 || (n.nodeType === 1 && INLINE.has(n.tagName))) {
      if (!pending) pending = document.createElement('p');
      pending.appendChild(n.cloneNode(true));
      continue;
    }
    flush();
    if (n.nodeType === 1) blockToDocx(dx, n);
  }
  flush();
}

export function noteToDocx(doc, author) {
  const dx = new Docx({ title: doc.title || 'Note', author });
  dx.p([{ text: doc.title || 'Untitled note', b: true, size: 18 }], { after: 60 });
  const root = document.createElement('div');
  root.innerHTML = doc.html || '';
  blocksToDocx(dx, root);
  return dx.build();
}

export function noteToText(doc) {
  const root = document.createElement('div');
  root.innerHTML = doc.html || '';
  root.querySelectorAll('ul.checklist > li').forEach((li) => li.prepend(li.hasAttribute('data-checked') ? '[x] ' : '[ ] '));
  root.querySelectorAll('ul:not(.checklist) > li').forEach((li) => li.prepend('• '));
  root.querySelectorAll('ol').forEach((ol) => [...ol.children].forEach((li, i) => li.prepend(`${i + 1}. `)));
  root.querySelectorAll('td, th').forEach((c) => { if (c.nextElementSibling) c.append(' | '); });
  root.querySelectorAll('p, h1, h2, h3, li, blockquote, div, tr, pre').forEach((el) => el.append('\n'));
  root.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  return `${doc.title || 'Untitled note'}\n\n${root.textContent.replace(ZWSP, '').replace(/\n{3,}/g, '\n\n').trim()}`;
}

export function noteSearchText(doc) {
  const d = document.createElement('div');
  d.innerHTML = doc.html || '';
  d.querySelectorAll('p, h1, h2, h3, li, blockquote, tr, pre, br').forEach((el) => el.after('\n'));
  return d.textContent.replace(ZWSP, '');
}
