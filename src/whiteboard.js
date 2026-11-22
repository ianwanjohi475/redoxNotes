// Infinite-canvas whiteboard.
// Tools: select, hand, pen, highlighter, eraser, line, arrow, rectangle, ellipse,
// diamond, triangle, text, sticky note, image. Shapes have stroke + fill colours,
// stroke width/style, opacity and an optional label. Multi-select with a
// selection box, resize handles, copy/paste/duplicate, layer order, undo/redo,
// pan & zoom, PNG export and copy-as-image. Everything is stored as vector JSON.
import { icon } from './icons.js';

const INK = 'ink';
const STROKES = [INK, '#e03131', '#f08c00', '#f5b800', '#2f9e44', '#1971c2', '#7048e8', '#c2255c', '#868e96', '#ffffff'];
const FILLS = [null, '#ffc9c9', '#ffec99', '#b2f2bb', '#a5d8ff', '#d0bfff', '#fcc2d7', '#e9ecef', INK];
const STICKY = { yellow: '#fff3a3', pink: '#ffd1dc', green: '#c8f2cf', blue: '#cfe6ff', purple: '#e5d4ff', orange: '#ffd8a8' };
const WIDTHS = [[1.5, 'Thin'], [3, 'Medium'], [5, 'Bold'], [9, 'Extra bold']];
const TEXT_SIZES = [[16, 'S'], [22, 'M'], [32, 'L'], [48, 'XL']];
const SHAPES = new Set(['rect', 'ellipse', 'diamond', 'triangle']);
const LINES = new Set(['line', 'arrow']);
const TOOLS = [
  ['select', 'pointer', 'Select (V)', 'v'],
  ['hand', 'hand', 'Hand – move around (H or hold Space)', 'h'],
  '|',
  ['pen', 'pen', 'Pen (P)', 'p'],
  ['highlighter', 'highlighter', 'Highlighter (M)', 'm'],
  ['eraser', 'eraser', 'Eraser (E)', 'e'],
  '|',
  ['rect', 'rect', 'Rectangle (R)', 'r'],
  ['ellipse', 'ellipse', 'Ellipse (O)', 'o'],
  ['diamond', 'diamondShape', 'Diamond (D)', 'd'],
  ['triangle', 'triangle', 'Triangle (G)', 'g'],
  ['line', 'line', 'Line (L)', 'l'],
  ['arrow', 'arrow', 'Arrow (A)', 'a'],
  '|',
  ['text', 'text', 'Text (T)', 't'],
  ['sticky', 'sticky', 'Sticky note (S)', 's'],
  ['image', 'image', 'Insert image (I) – or paste / drag one in', 'i'],
];
const KEYS = Object.fromEntries(TOOLS.filter((t) => t !== '|').map((t) => [t[3], t[0]]));
const HINTS = {
  select: 'Click to select · drag to box-select · Shift+click adds · double-click a shape to label it',
  hand: 'Drag to move around · Ctrl+scroll to zoom',
  pen: 'Draw freely · hold Space to pan',
  highlighter: 'Highlight over anything',
  eraser: 'Drag over things to erase them',
  rect: 'Drag to draw · Shift for a square · double-click to add a label',
  ellipse: 'Drag to draw · Shift for a circle',
  diamond: 'Drag to draw · great for decisions in flowcharts',
  triangle: 'Drag to draw',
  line: 'Drag to draw · Shift snaps to 45°',
  arrow: 'Drag to draw · Shift snaps to 45°',
  text: 'Click to type · Ctrl+Enter or Esc to finish',
  sticky: 'Click to drop a sticky note',
  image: 'Pick an image, paste one (Ctrl+V) or drag one in',
};

function distSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Ramer–Douglas–Peucker simplification for pen strokes. */
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  let max = 0, idx = 0;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distSeg(pts[i][0], pts[i][1], a[0], a[1], b[0], b[1]);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const r1 = (n) => Math.round(n * 10) / 10;

export class Board {
  constructor(host, doc, { onChange, isDark }) {
    this.host = host;
    this.doc = doc;
    this.data = doc.board;
    this.data.items = this.data.items || [];
    this.data.view = this.data.view || { x: 0, y: 0, z: 1 };
    this.data.bg = this.data.bg || 'dots';
    this.onChange = onChange;
    this.isDark = isDark;
    this.tool = 'pen';
    this.style = { c: INK, bg: null, w: 3, dash: 'solid', op: 1, size: 22, sticky: 'yellow', heads: 'end' };
    this.sel = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.images = new Map();
    this.render();
  }

  // =========================================================== UI
  render() {
    this.host.innerHTML = `
      <div class="wb">
        <div class="wb-stage">
          <canvas></canvas>
          <div class="wb-tools">${TOOLS.map((t) => (t === '|' ? '<span class="wb-sep"></span>' : `<button class="wb-tool" data-tool="${t[0]}" title="${t[2]}">${icon(t[1], 18)}<i>${t[3].toUpperCase()}</i></button>`)).join('')}</div>
          <div class="wb-props"></div>
          <div class="wb-corner">
            <button class="wb-chip" data-act="bg" title="Background: dots / grid / lines / plain">${icon('grid', 16)}</button>
            <button class="wb-chip" data-act="copyImg" title="Copy the board as an image">${icon('copy', 16)}</button>
            <button class="wb-chip" data-act="clear" title="Clear board">${icon('trash', 16)}</button>
          </div>
          <div class="wb-zoom">
            <button class="wb-chip" data-act="undo" title="Undo (Ctrl+Z)">${icon('undo', 16)}</button>
            <button class="wb-chip" data-act="redo" title="Redo (Ctrl+Y)">${icon('redo', 16)}</button>
            <span class="wb-zsep"></span>
            <button class="wb-chip" data-act="zoomOut" title="Zoom out (Ctrl+-)">${icon('minus', 16)}</button>
            <button class="wb-chip zoom-label" data-act="zoomReset" title="Reset to 100%">100%</button>
            <button class="wb-chip" data-act="zoomIn" title="Zoom in (Ctrl+=)">${icon('plus', 16)}</button>
            <button class="wb-chip" data-act="fit" title="Zoom to fit everything (Shift+1)">${icon('fit', 16)}</button>
          </div>
          <div class="wb-hint"></div>
          <input type="file" accept="image/*" hidden class="wb-file">
        </div>
      </div>`;
    this.stage = this.host.querySelector('.wb-stage');
    this.canvas = this.host.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.zoomLabel = this.host.querySelector('.zoom-label');
    this.props = this.host.querySelector('.wb-props');
    this.hintEl = this.host.querySelector('.wb-hint');
    this.fileInput = this.host.querySelector('.wb-file');

    this.host.querySelector('.wb-tools').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tool]');
      if (b) this.setTool(b.dataset.tool);
    });
    this.stage.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b) this.act(b.dataset.act);
    });
    this.props.addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      const k = b.dataset.p;
      let v = b.dataset.v;
      if (k === 'w' || k === 'size') v = +v;
      if (k === 'bg' || k === 'c') v = v === 'none' ? null : v;
      if (k === 'action') { this.action(v); return; }
      this.setProp(k, v);
    });
    this.props.addEventListener('input', (e) => {
      if (e.target.matches('[data-op]')) this.setProp('op', +e.target.value / 100, true);
      if (e.target.matches('[data-custom]')) this.setProp(e.target.dataset.custom, e.target.value, true);
    });
    this.props.addEventListener('change', (e) => { if (e.target.matches('[data-op], [data-custom]')) this.onChange(); });
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files[0];
      this.fileInput.value = '';
      if (f) this.insertImageFile(f);
    });

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.stage);
    this.bindPointer();
    this.bindPasteDrop();
    this.syncUi();
    this.resize();
  }

  destroy() {
    this.ro?.disconnect();
    this.finishText();
    window.removeEventListener('keydown', this._keydown);
    window.removeEventListener('keyup', this._keyup);
    window.removeEventListener('paste', this._paste);
    this.closeMenu();
  }

  setTool(t) {
    if (t === 'image') { this.fileInput.click(); return; }
    this.finishText();
    this.tool = t;
    if (t !== 'select') this.sel.clear();
    this.syncUi();
    this.draw();
  }

  syncUi() {
    this.host.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === this.tool));
    this.stage.dataset.tool = this.tool;
    this.hintEl.textContent = HINTS[this.tool] || '';
    this.renderProps();
  }

  /** Which property sections apply to the current selection, or to the active tool. */
  context() {
    const types = this.sel.size ? [...this.sel].map((i) => (i.t === 'pen' ? (i.hl ? 'highlighter' : 'pen') : i.t)) : [this.tool];
    const has = (pred) => types.some(pred);
    const all = (pred) => types.every(pred);
    return {
      stroke: has((t) => t !== 'image' && t !== 'sticky' && t !== 'select' && t !== 'hand' && t !== 'eraser'),
      fill: has((t) => SHAPES.has(t)),
      sticky: all((t) => t === 'sticky'),
      width: has((t) => t === 'pen' || t === 'highlighter' || SHAPES.has(t) || LINES.has(t)),
      dash: has((t) => SHAPES.has(t) || LINES.has(t)),
      heads: has((t) => LINES.has(t)),
      size: has((t) => t === 'text' || SHAPES.has(t)),
      opacity: has((t) => !['select', 'hand', 'eraser'].includes(t)),
      actions: this.sel.size > 0,
    };
  }

  current(key) {
    if (this.sel.size) {
      const first = [...this.sel][0];
      if (key === 'heads') return first.heads || (first.t === 'arrow' ? 'end' : 'none');
      if (key === 'sticky') return first.color;
      if (key in first) return first[key];
    }
    return this.style[key];
  }

  renderProps() {
    const cx = this.context();
    const show = Object.values(cx).some(Boolean);
    this.props.hidden = !show;
    if (!show) return;
    const cur = (k) => this.current(k);
    const sw = (k, list) => list.map((c) => {
      const val = c === null ? 'none' : c;
      const on = (cur(k) ?? null) === c;
      const style = c === null ? '' : `--sw:${c === INK ? 'var(--fg)' : c}`;
      return `<button class="wb-sw ${c === null ? 'none' : ''} ${on ? 'on' : ''}" data-p="${k}" data-v="${val}" style="${style}" title="${c === null ? 'None' : c === INK ? 'Ink' : c}">${c === null ? icon('x', 12) : ''}</button>`;
    }).join('');
    const seg = (k, opts) => `<div class="wb-seg">${opts.map(([v, label, tip]) => `<button data-p="${k}" data-v="${v}" class="${String(cur(k)) === String(v) ? 'on' : ''}" title="${tip || ''}">${label}</button>`).join('')}</div>`;
    let h = '';
    if (cx.actions) {
      h += `<div class="wb-sec"><label>${this.sel.size} selected</label><div class="wb-actions">
        <button data-p="action" data-v="dup" title="Duplicate (Ctrl+D)">${icon('duplicate', 16)}</button>
        <button data-p="action" data-v="front" title="Bring to front">${icon('up', 16)}</button>
        <button data-p="action" data-v="back" title="Send to back">${icon('down', 16)}</button>
        <button data-p="action" data-v="delete" class="danger" title="Delete (Del)">${icon('trash', 16)}</button>
      </div></div>`;
    }
    if (cx.stroke) h += `<div class="wb-sec"><label>Stroke</label><div class="wb-sws">${sw('c', STROKES)}<label class="wb-custom" title="Custom colour"><input type="color" data-custom="c" value="${/^#/.test(cur('c') || '') ? cur('c') : '#1e1e1e'}"></label></div></div>`;
    if (cx.fill) h += `<div class="wb-sec"><label>Fill</label><div class="wb-sws">${sw('bg', FILLS)}<label class="wb-custom" title="Custom colour"><input type="color" data-custom="bg" value="${/^#/.test(cur('bg') || '') ? cur('bg') : '#ffec99'}"></label></div></div>`;
    if (cx.sticky) h += `<div class="wb-sec"><label>Note colour</label><div class="wb-sws">${Object.entries(STICKY).map(([k, c]) => `<button class="wb-sw sq ${cur('sticky') === k ? 'on' : ''}" data-p="sticky" data-v="${k}" style="--sw:${c}" title="${k}"></button>`).join('')}</div></div>`;
    if (cx.width) h += `<div class="wb-sec"><label>Thickness</label>${seg('w', WIDTHS.map(([w, n]) => [w, `<span class="wb-thick" style="height:${Math.max(1.5, w * 0.9)}px"></span>`, n]))}</div>`;
    if (cx.dash) h += `<div class="wb-sec"><label>Line style</label>${seg('dash', [['solid', '<span class="wb-dash solid"></span>', 'Solid'], ['dash', '<span class="wb-dash dash"></span>', 'Dashed'], ['dot', '<span class="wb-dash dot"></span>', 'Dotted']])}</div>`;
    if (cx.heads) h += `<div class="wb-sec"><label>Arrowheads</label>${seg('heads', [['none', '—', 'None'], ['end', '→', 'End'], ['both', '↔', 'Both ends']])}</div>`;
    if (cx.size) h += `<div class="wb-sec"><label>Text size</label>${seg('size', TEXT_SIZES.map(([s, n]) => [s, n, `${s}px`]))}</div>`;
    if (cx.opacity) h += `<div class="wb-sec"><label>Opacity <span class="muted">${Math.round((cur('op') ?? 1) * 100)}%</span></label><input type="range" min="10" max="100" step="5" data-op value="${Math.round((cur('op') ?? 1) * 100)}"></div>`;
    this.props.innerHTML = h;
  }

  setProp(k, v, live = false) {
    this.style[k] = v;
    if (this.sel.size) {
      if (!live || !this._propCommitted) this.commit();
      this._propCommitted = live;
      for (const it of this.sel) {
        if (k === 'c' && it.t !== 'image' && it.t !== 'sticky') it.c = v ?? INK;
        if (k === 'bg' && SHAPES.has(it.t)) it.bg = v;
        if (k === 'w' && (it.t === 'pen' || SHAPES.has(it.t) || LINES.has(it.t))) it.w = it.hl ? Math.max(14, v * 4) : v;
        if (k === 'dash' && (SHAPES.has(it.t) || LINES.has(it.t))) it.dash = v;
        if (k === 'heads' && LINES.has(it.t)) { it.heads = v; it.t = v === 'none' ? 'line' : 'arrow'; }
        if (k === 'size' && (it.t === 'text' || SHAPES.has(it.t))) it.size = v;
        if (k === 'op') it.op = v;
        if (k === 'sticky' && it.t === 'sticky') it.color = v;
      }
      this.draw();
      if (!live) this.onChange();
    } else {
      if (k === 'heads' && LINES.has(this.tool)) this.tool = v === 'none' ? 'line' : 'arrow';
      if (k === 'c' && ['select', 'hand', 'eraser'].includes(this.tool)) this.tool = 'pen';
    }
    if (!live) { this._propCommitted = false; this.syncUi(); }
    else {
      const lbl = this.props.querySelector('[data-op]')?.previousElementSibling?.querySelector('.muted');
      if (lbl && k === 'op') lbl.textContent = Math.round(v * 100) + '%';
    }
  }

  act(a) {
    const v = this.data.view;
    if (a === 'undo') this.undo();
    if (a === 'redo') this.redo();
    if (a === 'bg') { this.data.bg = { dots: 'grid', grid: 'lines', lines: 'plain', plain: 'dots' }[this.data.bg] || 'dots'; this.changed(); }
    if (a === 'zoomIn') this.zoomAt(1.2);
    if (a === 'zoomOut') this.zoomAt(1 / 1.2);
    if (a === 'zoomReset') { const [cx, cy] = this.toWorld(this.w / 2, this.h / 2); v.z = 1; v.x = this.w / 2 - cx; v.y = this.h / 2 - cy; this.draw(); this.saveViewSoon(); }
    if (a === 'fit') this.fit();
    if (a === 'copyImg') this.copyImage();
    if (a === 'clear' && this.data.items.length && confirm('Clear the whole board? (You can undo.)')) { this.commit(); this.data.items = []; this.sel.clear(); this.changed(); }
  }

  action(a) {
    if (!this.sel.size) return;
    const items = this.data.items;
    if (a === 'delete') { this.commit(); this.data.items = items.filter((i) => !this.sel.has(i)); this.sel.clear(); }
    if (a === 'dup') { this.paste(clone([...this.sel])); return; }
    if (a === 'front') { this.commit(); this.data.items = [...items.filter((i) => !this.sel.has(i)), ...items.filter((i) => this.sel.has(i))]; }
    if (a === 'back') { this.commit(); this.data.items = [...items.filter((i) => this.sel.has(i)), ...items.filter((i) => !this.sel.has(i))]; }
    this.changed();
    this.syncUi();
  }

  onKey(e) {
    if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return false;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') { e.shiftKey ? this.redo() : this.undo(); return true; }
    if (mod && k === 'y') { this.redo(); return true; }
    if (mod && k === 'a') { this.tool = 'select'; this.sel = new Set(this.data.items); this.syncUi(); this.draw(); return true; }
    if (mod && k === 'c' && this.sel.size) { this.clip = clone([...this.sel]); return true; }
    if (mod && k === 'x' && this.sel.size) { this.clip = clone([...this.sel]); this.action('delete'); return true; }
    if (mod && k === 'd' && this.sel.size) { this.action('dup'); return true; }
    if (mod) return false; // Ctrl+V is handled by the paste event
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel.size) { this.action('delete'); return true; }
    if (e.key === 'Escape') { this.sel.clear(); this.closeMenu(); this.syncUi(); this.draw(); return true; }
    if (e.key.startsWith('Arrow') && this.sel.size) {
      const d = e.shiftKey ? 10 : 1;
      if (!e.repeat) this.commit();
      const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
      const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
      for (const it of this.sel) this.move(it, dx, dy);
      this.changed();
      return true;
    }
    if (e.shiftKey && e.code === 'Digit1') { this.fit(); return true; }
    if (!e.altKey && KEYS[k] && !e.shiftKey) { this.setTool(KEYS[k]); return true; }
    return false;
  }

  // =========================================================== history
  commit() {
    this.undoStack.push(JSON.stringify(this.data.items));
    if (this.undoStack.length > 150) this.undoStack.shift();
    this.redoStack = [];
  }
  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify(this.data.items));
    this.data.items = JSON.parse(this.undoStack.pop());
    this.sel.clear();
    this.changed();
    this.syncUi();
  }
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(this.data.items));
    this.data.items = JSON.parse(this.redoStack.pop());
    this.sel.clear();
    this.changed();
    this.syncUi();
  }
  changed() { this.draw(); this.onChange(); }

  // =========================================================== geometry
  resize() {
    const r = this.stage.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    this.draw();
  }
  toWorld(sx, sy) { const v = this.data.view; return [(sx - v.x) / v.z, (sy - v.y) / v.z]; }
  toScreen(wx, wy) { const v = this.data.view; return [wx * v.z + v.x, wy * v.z + v.y]; }
  zoomAt(f, sx = this.w / 2, sy = this.h / 2) {
    const v = this.data.view;
    const nz = Math.min(6, Math.max(0.1, v.z * f));
    const [wx, wy] = this.toWorld(sx, sy);
    v.z = nz;
    v.x = sx - wx * nz;
    v.y = sy - wy * nz;
    this.draw();
    this.saveViewSoon();
  }
  saveViewSoon() {
    clearTimeout(this._vt);
    this._vt = setTimeout(() => this.onChange(true), 800);
  }

  bbox(it) {
    if (it.t === 'pen') {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const [x, y] of it.pts) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
      const p = it.w / 2;
      return [x1 - p, y1 - p, x2 + p, y2 + p];
    }
    if (it.t === 'text') {
      this.ctx.font = this.font(it.size);
      const lines = String(it.text).split('\n');
      const w = Math.max(...lines.map((l) => this.ctx.measureText(l).width), 10);
      return [it.x, it.y, it.x + w, it.y + lines.length * it.size * 1.3];
    }
    if (it.t === 'sticky' || it.t === 'image') return [it.x, it.y, it.x + it.w, it.y + it.h];
    return [Math.min(it.x1, it.x2), Math.min(it.y1, it.y2), Math.max(it.x1, it.x2), Math.max(it.y1, it.y2)];
  }

  selBox() {
    if (!this.sel.size) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const it of this.sel) {
      const b = this.bbox(it);
      x1 = Math.min(x1, b[0]); y1 = Math.min(y1, b[1]); x2 = Math.max(x2, b[2]); y2 = Math.max(y2, b[3]);
    }
    return [x1, y1, x2, y2];
  }

  polygon(it) {
    const [x1, y1, x2, y2] = this.bbox(it);
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    if (it.t === 'diamond') return [[cx, y1], [x2, cy], [cx, y2], [x1, cy]];
    if (it.t === 'triangle') return [[cx, y1], [x2, y2], [x1, y2]];
    if (it.t === 'ellipse') {
      const rx = (x2 - x1) / 2, ry = (y2 - y1) / 2;
      return Array.from({ length: 40 }, (_, i) => [cx + rx * Math.cos((i / 40) * Math.PI * 2), cy + ry * Math.sin((i / 40) * Math.PI * 2)]);
    }
    return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
  }

  hit(it, x, y, tol, strict) {
    if (it.t === 'pen') {
      const t = tol + it.w / 2;
      for (let i = 0; i < it.pts.length; i++) {
        const a = it.pts[i], b = it.pts[i + 1] || a;
        if (distSeg(x, y, a[0], a[1], b[0], b[1]) <= t) return true;
      }
      return false;
    }
    if (LINES.has(it.t)) return distSeg(x, y, it.x1, it.y1, it.x2, it.y2) <= tol + it.w / 2;
    if (SHAPES.has(it.t)) {
      const poly = this.polygon(it);
      // inside counts when filled, labelled, or when selecting (not for the eraser)
      if ((it.bg || it.label || !strict) && pointInPoly(x, y, poly)) return true;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        if (distSeg(x, y, a[0], a[1], b[0], b[1]) <= tol + it.w / 2) return true;
      }
      return false;
    }
    const [x1, y1, x2, y2] = this.bbox(it);
    return x >= x1 - tol && x <= x2 + tol && y >= y1 - tol && y <= y2 + tol;
  }

  topAt(x, y, strict = false) {
    const tol = 6 / this.data.view.z;
    for (let i = this.data.items.length - 1; i >= 0; i--) if (this.hit(this.data.items[i], x, y, tol, strict)) return this.data.items[i];
    return null;
  }

  move(it, dx, dy) {
    if (it.t === 'pen') it.pts = it.pts.map(([x, y]) => [x + dx, y + dy]);
    else if ('x1' in it) { it.x1 += dx; it.x2 += dx; it.y1 += dy; it.y2 += dy; }
    else { it.x += dx; it.y += dy; }
  }

  /** Map an item from one bounding box to another (used by the resize handles). */
  transform(it, from, to) {
    const sx = (to[2] - to[0]) / (from[2] - from[0] || 1);
    const sy = (to[3] - to[1]) / (from[3] - from[1] || 1);
    const fx = (x) => to[0] + (x - from[0]) * sx;
    const fy = (y) => to[1] + (y - from[1]) * sy;
    if (it.t === 'pen') it.pts = it.pts.map(([x, y]) => [r1(fx(x)), r1(fy(y))]);
    else if ('x1' in it) { it.x1 = fx(it.x1); it.x2 = fx(it.x2); it.y1 = fy(it.y1); it.y2 = fy(it.y2); }
    else if (it.t === 'text') { it.x = fx(it.x); it.y = fy(it.y); it.size = Math.max(6, Math.min(400, it.size * Math.abs(sy))); }
    else { it.x = fx(it.x); it.y = fy(it.y); it.w = Math.max(10, it.w * Math.abs(sx)); it.h = Math.max(10, it.h * Math.abs(sy)); }
  }

  handles(box) {
    const [x1, y1, x2, y2] = box;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    return { nw: [x1, y1], n: [mx, y1], ne: [x2, y1], e: [x2, my], se: [x2, y2], s: [mx, y2], sw: [x1, y2], w: [x1, my] };
  }

  handleAt(sx, sy) {
    const box = this.selBox();
    if (!box || this.tool !== 'select') return null;
    const pad = 6 / this.data.view.z;
    const b = [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad];
    for (const [k, [hx, hy]] of Object.entries(this.handles(b))) {
      const [px, py] = this.toScreen(hx, hy);
      if (Math.abs(px - sx) <= 7 && Math.abs(py - sy) <= 7) return k;
    }
    return null;
  }

  // =========================================================== input
  bindPointer() {
    const c = this.canvas;
    let mode = null, start = null, last = null, current = null, moved = false, startBox = null, handle = null, button = 0;
    let space = false;
    this._keydown = (e) => { if (e.code === 'Space' && !e.repeat && !e.target.closest('input,textarea,[contenteditable="true"]')) { space = true; this.stage.classList.add('panning'); e.preventDefault(); } };
    this._keyup = (e) => { if (e.code === 'Space') { space = false; this.stage.classList.remove('panning'); } };
    window.addEventListener('keydown', this._keydown);
    window.addEventListener('keyup', this._keyup);

    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      this.closeMenu();
      if (this.editing) { this.finishText(); if (this.tool === 'text' || this.tool === 'sticky') return; }
      c.setPointerCapture(e.pointerId);
      const r = c.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const [x, y] = this.toWorld(sx, sy);
      start = [x, y];
      last = [sx, sy];
      moved = false;
      button = e.button;
      if (space || e.button === 1 || e.button === 2 || this.tool === 'hand') { mode = 'pan'; this.stage.classList.add('grabbing'); return; }
      const t = this.tool;
      if (t === 'select') {
        handle = this.handleAt(sx, sy);
        if (handle) { this.commit(); mode = 'resize'; startBox = this.selBox(); this._orig = new Map([...this.sel].map((it) => [it, clone(it)])); return; }
        const it = this.topAt(x, y);
        if (it) {
          if (e.shiftKey) { this.sel.has(it) ? this.sel.delete(it) : this.sel.add(it); }
          else if (!this.sel.has(it)) this.sel = new Set([it]);
          if (e.altKey) { // Alt+drag duplicates
            const copies = clone([...this.sel]);
            this.commit();
            this.data.items.push(...copies);
            this.sel = new Set(copies);
          } else this.commit();
          mode = 'move';
        } else {
          if (!e.shiftKey) this.sel.clear();
          mode = 'marquee';
          this.marquee = [x, y, x, y];
        }
        this.syncUi();
        this.draw();
        return;
      }
      if (t === 'eraser') { this.commit(); mode = 'erase'; this.eraseAt(x, y); return; }
      if (t === 'text' || t === 'sticky') {
        e.preventDefault(); // keep the browser from stealing focus from the new text box
        const hit = this.topAt(x, y);
        if (hit && (hit.t === 'text' || hit.t === 'sticky')) { this.editText(hit); return; }
        if (t === 'text') { this.editText(null, x, y); return; }
        this.commit();
        const it = { t: 'sticky', x: x - 100, y: y - 20, w: 200, h: 150, text: '', color: this.style.sticky, op: this.style.op };
        this.data.items.push(it);
        this.changed();
        this.editText(it);
        return;
      }
      this.commit();
      mode = 'draw';
      const st = this.style;
      if (t === 'pen' || t === 'highlighter') {
        const hl = t === 'highlighter';
        current = { t: 'pen', pts: [[r1(x), r1(y)]], c: hl && st.c === INK ? '#f5b800' : st.c, w: hl ? Math.max(14, st.w * 4) : st.w, op: st.op, ...(hl ? { hl: true } : {}) };
      } else if (LINES.has(t)) current = { t, x1: x, y1: y, x2: x, y2: y, c: st.c, w: st.w, dash: st.dash, op: st.op, heads: t === 'arrow' ? (st.heads === 'none' ? 'end' : st.heads) : 'none' };
      else current = { t, x1: x, y1: y, x2: x, y2: y, c: st.c, bg: st.bg, w: st.w, dash: st.dash, op: st.op, size: st.size };
      this.data.items.push(current);
      this.draw();
    });

    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (!mode) {
        // cursor feedback for resize handles
        const hd = this.handleAt(sx, sy);
        this.stage.dataset.handle = hd || '';
        return;
      }
      const [x, y] = this.toWorld(sx, sy);
      if (Math.hypot(sx - last[0], sy - last[1]) > 2) moved = true;
      if (mode === 'pan') {
        const v = this.data.view;
        v.x += sx - last[0];
        v.y += sy - last[1];
        last = [sx, sy];
        this.draw();
        return;
      }
      if (mode === 'move') {
        for (const it of this.sel) this.move(it, x - start[0], y - start[1]);
        start = [x, y];
        this.draw();
        return;
      }
      if (mode === 'resize') {
        let [x1, y1, x2, y2] = startBox;
        if (handle.includes('w')) x1 = x;
        if (handle.includes('e')) x2 = x;
        if (handle.includes('n')) y1 = y;
        if (handle.includes('s')) y2 = y;
        const corner = handle.length === 2;
        const keepAspect = corner && (e.shiftKey !== [...this.sel].some((i) => i.t === 'image' || i.t === 'text'));
        if (keepAspect) {
          const ow = startBox[2] - startBox[0] || 1, oh = startBox[3] - startBox[1] || 1;
          const s = Math.max(Math.abs(x2 - x1) / ow, Math.abs(y2 - y1) / oh);
          if (handle.includes('w')) x1 = x2 - ow * s; else x2 = x1 + ow * s;
          if (handle.includes('n')) y1 = y2 - oh * s; else y2 = y1 + oh * s;
        }
        if (x2 - x1 < 4) { if (handle.includes('w')) x1 = x2 - 4; else x2 = x1 + 4; }
        if (y2 - y1 < 4) { if (handle.includes('n')) y1 = y2 - 4; else y2 = y1 + 4; }
        for (const it of this.sel) {
          Object.assign(it, clone(this._orig.get(it)));
          this.transform(it, startBox, [x1, y1, x2, y2]);
        }
        this.draw();
        return;
      }
      if (mode === 'marquee') {
        this.marquee[2] = x;
        this.marquee[3] = y;
        this.draw();
        return;
      }
      if (mode === 'erase') { this.eraseAt(x, y); return; }
      if (mode === 'draw' && current) {
        if (current.t === 'pen') {
          const p = current.pts[current.pts.length - 1];
          if (Math.hypot(x - p[0], y - p[1]) * this.data.view.z > 1.2) current.pts.push([r1(x), r1(y)]);
        } else {
          current.x2 = x;
          current.y2 = y;
          if (e.shiftKey) {
            if (SHAPES.has(current.t)) {
              const s = Math.max(Math.abs(x - current.x1), Math.abs(y - current.y1));
              current.x2 = current.x1 + Math.sign(x - current.x1 || 1) * s;
              current.y2 = current.y1 + Math.sign(y - current.y1 || 1) * s;
            } else {
              const ang = Math.round(Math.atan2(y - current.y1, x - current.x1) / (Math.PI / 4)) * (Math.PI / 4);
              const len = Math.hypot(x - current.x1, y - current.y1);
              current.x2 = current.x1 + Math.cos(ang) * len;
              current.y2 = current.y1 + Math.sin(ang) * len;
            }
          }
        }
        this.draw();
      }
    });

    const end = (e) => {
      if (!mode) return;
      this.stage.classList.remove('grabbing');
      if (mode === 'draw' && current) {
        if (current.t === 'pen') {
          if (current.pts.length > 2) current.pts = simplify(current.pts, 0.5 / this.data.view.z);
        } else if (Math.hypot(current.x2 - current.x1, current.y2 - current.y1) < 3) {
          // a click with a shape tool: drop a default-sized shape
          if (SHAPES.has(current.t)) { current.x2 = current.x1 + 140; current.y2 = current.y1 + (current.t === 'ellipse' || current.t === 'rect' ? 90 : 120); }
          else { this.data.items.pop(); this.undoStack.pop(); }
        }
        this.onChange();
      } else if (mode === 'move' || mode === 'resize') {
        if (!moved) { this.undoStack.pop(); if (mode === 'move' && !e?.shiftKey && this.sel.size > 1) { const it = this.topAt(start[0], start[1]); if (it) this.sel = new Set([it]); } }
        else this.onChange();
        this.syncUi();
      } else if (mode === 'erase') this.onChange();
      else if (mode === 'marquee') {
        const [ax, ay, bx, by] = this.marquee;
        const box = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
        if (box[2] - box[0] > 2 || box[3] - box[1] > 2) {
          for (const it of this.data.items) {
            const b = this.bbox(it);
            if (b[0] >= box[0] && b[1] >= box[1] && b[2] <= box[2] && b[3] <= box[3]) this.sel.add(it);
          }
        }
        this.marquee = null;
        this.syncUi();
        this.draw();
      } else if (mode === 'pan') {
        if (!moved && button === 2 && e) this.contextMenu(e);
        else this.saveViewSoon();
      }
      mode = null;
      current = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', () => end(null));

    c.addEventListener('dblclick', (e) => {
      const r = c.getBoundingClientRect();
      const [x, y] = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      const it = this.topAt(x, y);
      if (it && (it.t === 'text' || it.t === 'sticky')) this.editText(it);
      else if (it && SHAPES.has(it.t)) this.editText(it);
      else if (!it && this.tool === 'select') this.editText(null, x, y);
    });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) this.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
      else {
        this.data.view.x -= e.shiftKey ? e.deltaY : e.deltaX;
        this.data.view.y -= e.shiftKey ? 0 : e.deltaY;
        this.draw();
        this.saveViewSoon();
      }
    }, { passive: false });
  }

  eraseAt(x, y) {
    const tol = 8 / this.data.view.z;
    const before = this.data.items.length;
    this.data.items = this.data.items.filter((it) => !this.hit(it, x, y, tol, true));
    if (this.data.items.length !== before) this.draw();
  }

  // =========================================================== context menu
  contextMenu(e) {
    const r = this.canvas.getBoundingClientRect();
    const [x, y] = this.toWorld(e.clientX - r.left, e.clientY - r.top);
    const it = this.topAt(x, y);
    if (it && !this.sel.has(it)) { this.sel = new Set([it]); this.tool = 'select'; this.syncUi(); this.draw(); }
    const items = this.sel.size
      ? [['dup', 'Duplicate', 'Ctrl+D'], ['copy', 'Copy', 'Ctrl+C'], ['front', 'Bring to front', ''], ['back', 'Send to back', ''], ['delete', 'Delete', 'Del']]
      : [['paste', 'Paste', 'Ctrl+V'], ['selectAll', 'Select all', 'Ctrl+A'], ['fit', 'Zoom to fit', 'Shift+1'], ['image', 'Insert image…', 'I']];
    this.closeMenu();
    const m = document.createElement('div');
    m.className = 'wb-menu';
    m.innerHTML = items.map(([k, l, kb]) => `<button data-m="${k}" class="${k === 'delete' ? 'danger' : ''}"><span>${l}</span><kbd>${kb}</kbd></button>`).join('');
    this.stage.appendChild(m);
    const sr = this.stage.getBoundingClientRect();
    m.style.left = Math.min(e.clientX - sr.left, sr.width - m.offsetWidth - 8) + 'px';
    m.style.top = Math.min(e.clientY - sr.top, sr.height - m.offsetHeight - 8) + 'px';
    m.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-m]');
      if (!b) return;
      const k = b.dataset.m;
      this.closeMenu();
      if (k === 'copy') this.clip = clone([...this.sel]);
      else if (k === 'paste') { if (this.clip) this.paste(clone(this.clip), [x, y]); }
      else if (k === 'selectAll') { this.tool = 'select'; this.sel = new Set(this.data.items); this.syncUi(); this.draw(); }
      else if (k === 'fit') this.fit();
      else if (k === 'image') this.fileInput.click();
      else this.action(k);
    });
  }

  closeMenu() { this.stage?.querySelector('.wb-menu')?.remove(); }

  // =========================================================== clipboard, images
  paste(items, at) {
    if (!items.length) return;
    this.commit();
    let dx = 24, dy = 24;
    if (at) {
      const b = items.map((i) => this.bbox(i)).reduce((a, b2) => [Math.min(a[0], b2[0]), Math.min(a[1], b2[1])], [Infinity, Infinity]);
      dx = at[0] - b[0];
      dy = at[1] - b[1];
    }
    for (const it of items) this.move(it, dx, dy);
    this.data.items.push(...items);
    this.tool = 'select';
    this.sel = new Set(items);
    this.clip = clone(items);
    this.changed();
    this.syncUi();
  }

  bindPasteDrop() {
    this._paste = (e) => {
      if (!this.stage.isConnected) return;
      if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
      const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); files.forEach((f) => this.insertImageFile(f)); return; }
      if (this.clip) { e.preventDefault(); this.paste(clone(this.clip)); return; }
      const text = e.clipboardData?.getData('text/plain');
      if (text) {
        e.preventDefault();
        this.commit();
        const [x, y] = this.toWorld(this.w / 2, this.h / 2);
        const it = { t: 'text', x: x - 80, y: y - 12, text: text.slice(0, 5000), c: this.style.c, size: this.style.size, op: this.style.op };
        this.data.items.push(it);
        this.tool = 'select';
        this.sel = new Set([it]);
        this.changed();
        this.syncUi();
      }
    };
    window.addEventListener('paste', this._paste);
    this.stage.addEventListener('dragover', (e) => { if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) { e.preventDefault(); this.stage.classList.add('drop'); } });
    this.stage.addEventListener('dragleave', () => this.stage.classList.remove('drop'));
    this.stage.addEventListener('drop', (e) => {
      e.preventDefault();
      this.stage.classList.remove('drop');
      const r = this.canvas.getBoundingClientRect();
      const at = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')).forEach((f, i) => this.insertImageFile(f, [at[0] + i * 30, at[1] + i * 30]));
    });
  }

  /** Load an image file, shrink very large ones, and place it on the board. */
  insertImageFile(file, at) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1600;
        let { width: w, height: h } = img;
        let src = reader.result;
        if (w > MAX || h > MAX || file.size > 1.5e6) {
          const s = Math.min(1, MAX / Math.max(w, h));
          w = Math.round(w * s); h = Math.round(h * s);
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          src = file.type === 'image/png' && file.size < 4e6 ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.85);
        }
        // fit within 60% of the visible area
        const vz = this.data.view.z;
        const fit = Math.min(1, (this.w * 0.6) / vz / w, (this.h * 0.6) / vz / h);
        const dw = w * fit, dh = h * fit;
        const [cx, cy] = at || this.toWorld(this.w / 2, this.h / 2);
        this.commit();
        const it = { t: 'image', x: cx - dw / 2, y: cy - dh / 2, w: dw, h: dh, src, op: 1 };
        this.data.items.push(it);
        this.tool = 'select';
        this.sel = new Set([it]);
        this.changed();
        this.syncUi();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  imageFor(src) {
    let im = this.images.get(src);
    if (!im) {
      im = new Image();
      im.onload = () => this.draw();
      im.src = src;
      this.images.set(src, im);
    }
    return im;
  }

  // =========================================================== text editing
  editText(item, wx, wy) {
    this.finishText();
    const isNew = !item;
    this.commit();
    if (isNew) {
      item = { t: 'text', x: wx, y: wy - this.style.size * 0.6, text: '', c: this.style.c, size: this.style.size, op: this.style.op };
      this.data.items.push(item);
    }
    const isLabel = SHAPES.has(item.t);
    const ta = document.createElement('textarea');
    ta.className = 'wb-text-edit' + (item.t === 'sticky' ? ' sticky' : '') + (isLabel ? ' label' : '');
    const z = this.data.view.z;
    const dark = this.isDark();
    if (isLabel) {
      const [x1, y1, x2, y2] = this.bbox(item);
      const [sx, sy] = this.toScreen(x1, y1);
      const size = (item.size || 22) * z;
      Object.assign(ta.style, { left: sx + 'px', top: sy + (y2 - y1) * z / 2 - size * 0.7 + 'px', width: (x2 - x1) * z + 'px', font: this.font(size), color: this.labelColor(item, dark) });
      ta.value = item.label || '';
    } else {
      const [sx, sy] = this.toScreen(item.x, item.y);
      const size = item.t === 'sticky' ? 17 : item.size;
      Object.assign(ta.style, { left: sx + 'px', top: sy + 'px', font: this.font(size * z), color: item.t === 'sticky' ? '#1d1d1f' : this.resolve(item.c, dark) });
      if (item.t === 'sticky') Object.assign(ta.style, { width: item.w * z + 'px', height: item.h * z + 'px', background: STICKY[item.color] || STICKY.yellow, padding: 14 * z + 'px' });
      ta.value = item.text;
    }
    item._editing = true;
    this.stage.appendChild(ta);
    this.draw();
    const grow = () => {
      if (item.t === 'sticky') return;
      if (!isLabel) { ta.style.width = '0px'; ta.style.width = Math.max(80, ta.scrollWidth + 8) + 'px'; }
      ta.style.height = '0px';
      ta.style.height = ta.scrollHeight + 'px';
    };
    grow();
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); this.finishText(); }
    });
    const born = performance.now();
    ta.addEventListener('blur', () => {
      if (performance.now() - born < 300 && this.editing?.ta === ta) { setTimeout(() => ta.focus(), 0); return; }
      this.finishText();
    });
    ta.focus();
    ta.select();
    setTimeout(() => ta.focus(), 0);
    this.editing = { ta, item, isNew, isLabel };
  }

  finishText() {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    const val = ed.ta.value.replace(/\s+$/, '');
    if (ed.isLabel) ed.item.label = val || undefined;
    else ed.item.text = val;
    delete ed.item._editing;
    ed.ta.remove();
    if (ed.item.t === 'text' && !ed.item.text) {
      this.data.items = this.data.items.filter((i) => i !== ed.item);
      if (ed.isNew) this.undoStack.pop();
    }
    this.changed();
  }

  // =========================================================== drawing
  font(px) { return `${Math.round(px)}px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`; }
  /** Labels sit on the fill, so pick a readable colour for light fills in dark mode. */
  labelColor(it, dark) {
    if (it.bg && it.bg !== INK && (!it.c || it.c === INK || it.c === '#ffffff')) {
      const h = it.bg.replace('#', '');
      const lum = (0.299 * parseInt(h.slice(0, 2), 16) + 0.587 * parseInt(h.slice(2, 4), 16) + 0.114 * parseInt(h.slice(4, 6), 16)) / 255;
      return lum > 0.6 ? '#1e1e1e' : '#ffffff';
    }
    if (it.bg === INK) return dark ? '#1e1e1e' : '#ffffff';
    return this.resolve(it.c, dark);
  }

  resolve(c, dark) {
    if (!c || c === INK) return dark ? '#ececef' : '#1e1e1e';
    if (c === '#ffffff' && !dark) return '#ced4da';
    return c;
  }

  draw() {
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(() => this.paint(this.ctx, this.data.view, this.w, this.h, this.dpr, true, this.isDark()));
    if (this.zoomLabel) this.zoomLabel.textContent = Math.round(this.data.view.z * 100) + '%';
  }

  paint(ctx, v, w, h, dpr, ui, dark) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = dark ? '#16161a' : '#ffffff';
    ctx.fillRect(0, 0, w, h);
    if (ui && this.data.bg !== 'plain') {
      const step = 24 * v.z;
      if (step > 6) {
        ctx.fillStyle = ctx.strokeStyle = dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.1)';
        ctx.lineWidth = 1;
        const ox = ((v.x % step) + step) % step, oy = ((v.y % step) + step) % step;
        if (this.data.bg === 'dots') {
          for (let x = ox; x < w; x += step) for (let y = oy; y < h; y += step) ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
        } else {
          ctx.beginPath();
          if (this.data.bg === 'grid') for (let x = ox; x < w; x += step) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); }
          for (let y = oy; y < h; y += step) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); }
          ctx.stroke();
        }
      }
    }
    ctx.setTransform(dpr * v.z, 0, 0, dpr * v.z, dpr * v.x, dpr * v.y);
    for (const it of this.data.items) {
      if (it._editing && it.t === 'text') continue;
      ctx.save();
      this.drawItem(ctx, it, dark);
      ctx.restore();
    }
    if (!ui) return;
    // selection outline + handles (screen space)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const box = this.selBox();
    if (box && this.tool === 'select') {
      const pad = 6 / v.z;
      const b = [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad];
      const [ax, ay] = this.toScreen(b[0], b[1]);
      const [bx, by] = this.toScreen(b[2], b[3]);
      ctx.strokeStyle = '#4c6ef5';
      ctx.lineWidth = 1.5;
      if (this.sel.size > 1) {
        ctx.setLineDash([4, 3]);
        for (const it of this.sel) {
          const ib = this.bbox(it);
          const [p, q] = this.toScreen(ib[0], ib[1]);
          const [p2, q2] = this.toScreen(ib[2], ib[3]);
          ctx.strokeRect(p - 2, q - 2, p2 - p + 4, q2 - q + 4);
        }
        ctx.setLineDash([]);
      }
      ctx.strokeRect(ax, ay, bx - ax, by - ay);
      ctx.fillStyle = '#ffffff';
      for (const [hx, hy] of Object.values(this.handles(b))) {
        const [px, py] = this.toScreen(hx, hy);
        ctx.beginPath();
        ctx.roundRect(px - 5, py - 5, 10, 10, 3);
        ctx.fill();
        ctx.stroke();
      }
    }
    if (this.marquee) {
      const [ax, ay] = this.toScreen(this.marquee[0], this.marquee[1]);
      const [bx, by] = this.toScreen(this.marquee[2], this.marquee[3]);
      ctx.fillStyle = 'rgba(76,110,245,.08)';
      ctx.strokeStyle = '#4c6ef5';
      ctx.lineWidth = 1;
      ctx.fillRect(ax, ay, bx - ax, by - ay);
      ctx.strokeRect(ax, ay, bx - ax, by - ay);
    }
  }

  setDash(ctx, it) {
    const w = it.w || 2;
    if (it.dash === 'dash') ctx.setLineDash([w * 3 + 4, w * 2 + 4]);
    else if (it.dash === 'dot') ctx.setLineDash([0.1, w * 2 + 3]);
    else ctx.setLineDash([]);
  }

  arrowHead(ctx, x1, y1, x2, y2, w) {
    const a = Math.atan2(y2 - y1, x2 - x1);
    const s = 10 + w * 2.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x2 - s * Math.cos(a - 0.45), y2 - s * Math.sin(a - 0.45));
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2 - s * Math.cos(a + 0.45), y2 - s * Math.sin(a + 0.45));
    ctx.stroke();
  }

  drawItem(ctx, it, dark) {
    const col = this.resolve(it.c, dark);
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = it.w || 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = it.op ?? 1;
    if (it.t === 'pen') {
      if (it.hl) { ctx.globalAlpha = 0.35 * (it.op ?? 1); ctx.lineCap = 'butt'; }
      const p = it.pts;
      ctx.beginPath();
      if (p.length === 1) { ctx.arc(p[0][0], p[0][1], it.w / 2, 0, Math.PI * 2); ctx.fill(); return; }
      ctx.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < p.length - 1; i++) {
        const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
        ctx.quadraticCurveTo(p[i][0], p[i][1], mx, my);
      }
      ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
      ctx.stroke();
      return;
    }
    if (LINES.has(it.t)) {
      this.setDash(ctx, it);
      ctx.beginPath();
      ctx.moveTo(it.x1, it.y1);
      ctx.lineTo(it.x2, it.y2);
      ctx.stroke();
      const heads = it.heads || (it.t === 'arrow' ? 'end' : 'none');
      if (heads === 'end' || heads === 'both') this.arrowHead(ctx, it.x1, it.y1, it.x2, it.y2, it.w);
      if (heads === 'both') this.arrowHead(ctx, it.x2, it.y2, it.x1, it.y1, it.w);
      return;
    }
    if (SHAPES.has(it.t)) {
      const [x1, y1, x2, y2] = this.bbox(it);
      ctx.beginPath();
      if (it.t === 'rect') ctx.roundRect(x1, y1, x2 - x1, y2 - y1, Math.min(10, (x2 - x1) / 4, (y2 - y1) / 4));
      else if (it.t === 'ellipse') ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, (x2 - x1) / 2, (y2 - y1) / 2, 0, 0, Math.PI * 2);
      else {
        const poly = this.polygon(it);
        ctx.moveTo(poly[0][0], poly[0][1]);
        for (const [px, py] of poly.slice(1)) ctx.lineTo(px, py);
        ctx.closePath();
      }
      if (it.bg) { ctx.fillStyle = this.resolve(it.bg, dark); ctx.fill(); }
      this.setDash(ctx, it);
      ctx.stroke();
      if (it.label && !it._editing) {
        ctx.setLineDash([]);
        const size = it.size || 22;
        ctx.font = this.font(size);
        ctx.fillStyle = this.labelColor(it, dark);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const inner = (x2 - x1) * (it.t === 'rect' ? 0.9 : 0.7);
        const lines = this.wrap(ctx, it.label, Math.max(20, inner));
        const lh = size * 1.25;
        const cy = (y1 + y2) / 2 + (it.t === 'triangle' ? (y2 - y1) * 0.15 : 0);
        lines.forEach((l, i) => ctx.fillText(l, (x1 + x2) / 2, cy + (i - (lines.length - 1) / 2) * lh));
      }
      return;
    }
    if (it.t === 'text') {
      ctx.font = this.font(it.size);
      ctx.textBaseline = 'top';
      String(it.text).split('\n').forEach((l, i) => ctx.fillText(l, it.x, it.y + i * it.size * 1.3 + it.size * 0.1));
      return;
    }
    if (it.t === 'image') {
      const im = this.imageFor(it.src);
      if (im.complete && im.naturalWidth) ctx.drawImage(im, it.x, it.y, it.w, it.h);
      else { ctx.fillStyle = dark ? '#2a2a2f' : '#f1f3f5'; ctx.fillRect(it.x, it.y, it.w, it.h); }
      return;
    }
    if (it.t === 'sticky') {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.18)';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 5;
      ctx.fillStyle = STICKY[it.color] || STICKY.yellow;
      ctx.beginPath();
      ctx.roundRect(it.x, it.y, it.w, it.h, 6);
      ctx.fill();
      ctx.restore();
      if (it._editing) return;
      ctx.fillStyle = '#1d1d1f';
      ctx.font = this.font(17);
      ctx.textBaseline = 'top';
      const lines = this.wrap(ctx, it.text, it.w - 28);
      lines.slice(0, Math.floor((it.h - 24) / 23)).forEach((l, i) => ctx.fillText(l, it.x + 14, it.y + 14 + i * 23));
    }
  }

  wrap(ctx, text, maxW) {
    const out = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxW && line) { out.push(line); line = word; } else line = test;
      }
      out.push(line);
    }
    return out;
  }

  contentBounds() {
    if (!this.data.items.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const it of this.data.items) {
      const b = this.bbox(it);
      x1 = Math.min(x1, b[0]); y1 = Math.min(y1, b[1]); x2 = Math.max(x2, b[2]); y2 = Math.max(y2, b[3]);
    }
    return [x1, y1, x2, y2];
  }

  fit() {
    const b = this.contentBounds();
    if (!b) { this.data.view = { x: 0, y: 0, z: 1 }; this.draw(); return; }
    const pad = 80;
    const z = Math.min(2, Math.max(0.1, Math.min((this.w - pad * 2) / (b[2] - b[0] || 1), (this.h - pad * 2) / (b[3] - b[1] || 1))));
    this.data.view = { z, x: (this.w - (b[2] - b[0]) * z) / 2 - b[0] * z, y: (this.h - (b[3] - b[1]) * z) / 2 - b[1] * z };
    this.draw();
    this.saveViewSoon();
  }

  /** Render all content to a PNG (light background so it reads well anywhere). */
  async toBlob() {
    const imgs = this.data.items.filter((i) => i.t === 'image').map((i) => this.imageFor(i.src));
    await Promise.all(imgs.map((im) => (im.complete ? null : new Promise((r) => { im.onload = r; im.onerror = r; }))));
    const b = this.contentBounds() || [0, 0, 800, 600];
    const pad = 40;
    const w = b[2] - b[0] + pad * 2, h = b[3] - b[1] + pad * 2;
    const scale = Math.min(2, 8000 / Math.max(w, h));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w * scale));
    cv.height = Math.max(1, Math.round(h * scale));
    this.paint(cv.getContext('2d'), { x: -b[0] + pad, y: -b[1] + pad, z: 1 }, w, h, scale, false, false);
    return new Promise((r) => cv.toBlob(r, 'image/png'));
  }

  async toPng() {
    const blob = await this.toBlob();
    return new Uint8Array(await blob.arrayBuffer());
  }

  async copyImage() {
    try {
      const blob = await this.toBlob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      this.flash('Copied — paste it into WhatsApp, Word or email');
    } catch (e) {
      this.flash('Could not copy the image: ' + e.message);
    }
  }

  flash(msg) {
    const el = document.createElement('div');
    el.className = 'wb-flash';
    el.textContent = msg;
    this.stage.appendChild(el);
    setTimeout(() => el.classList.add('out'), 2200);
    setTimeout(() => el.remove(), 2600);
  }

  static searchText(doc) {
    return (doc.board?.items || []).map((i) => [i.text, i.label].filter(Boolean).join(' ')).filter(Boolean).join(' ');
  }
}
