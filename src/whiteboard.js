// Infinite-canvas whiteboard: pen, highlighter, shapes, arrows, text, sticky notes,
// eraser, select/move, pan & zoom, undo/redo, PNG export. Stored as vector JSON.
import { icon } from './icons.js';

const INK = 'ink';
const COLORS = [INK, '#e5484d', '#f76b15', '#f5b800', '#30a46c', '#0090ff', '#8e4ec6', '#ffffff'];
const STICKY = { yellow: '#fff3a3', pink: '#ffd1dc', green: '#c8f2cf', blue: '#cfe6ff' };
const TOOLS = [
  ['select', 'pointer', 'Select & move (V)'],
  ['pen', 'pen', 'Pen (P)'],
  ['highlighter', 'highlighter', 'Highlighter (H)'],
  ['eraser', 'eraser', 'Eraser (E)'],
  ['line', 'line', 'Line (L)'],
  ['arrow', 'arrow', 'Arrow (A)'],
  ['rect', 'rect', 'Rectangle (R)'],
  ['ellipse', 'ellipse', 'Ellipse (O)'],
  ['text', 'text', 'Text (T)'],
  ['sticky', 'sticky', 'Sticky note (S)'],
];
const KEYS = { v: 'select', p: 'pen', h: 'highlighter', e: 'eraser', l: 'line', a: 'arrow', r: 'rect', o: 'ellipse', t: 'text', s: 'sticky' };

function distSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

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
    this.color = INK;
    this.width = 3;
    this.stickyColor = 'yellow';
    this.selected = null;
    this.undoStack = [];
    this.redoStack = [];
    this.render();
  }

  // ----------------------------------------------------------- UI
  render() {
    this.host.innerHTML = `
      <div class="wb">
        <div class="wb-toolbar">
          <div class="wb-group">${TOOLS.map(([t, ic, tip]) => `<button class="tb-btn" data-tool="${t}" title="${tip}">${icon(ic)}</button>`).join('')}</div>
          <div class="wb-sep"></div>
          <div class="wb-group wb-colors">${COLORS.map((c) => `<button class="swatch" data-color="${c}" title="${c === INK ? 'Ink' : c}" style="--sw:${c === INK ? 'var(--fg)' : c}"></button>`).join('')}</div>
          <div class="wb-sep"></div>
          <div class="wb-group">${[2, 3, 6, 12].map((w) => `<button class="tb-btn width-btn" data-width="${w}" title="Size ${w}"><span style="width:${Math.min(w + 2, 14)}px;height:${Math.min(w + 2, 14)}px"></span></button>`).join('')}</div>
          <div class="wb-sep"></div>
          <div class="wb-group wb-sticky">${Object.entries(STICKY).map(([k, c]) => `<button class="swatch sq" data-sticky="${k}" title="Sticky: ${k}" style="--sw:${c}"></button>`).join('')}</div>
          <div class="wb-spacer"></div>
          <div class="wb-group">
            <button class="tb-btn" data-act="undo" title="Undo (Ctrl+Z)">${icon('undo')}</button>
            <button class="tb-btn" data-act="redo" title="Redo (Ctrl+Y)">${icon('redo')}</button>
            <button class="tb-btn" data-act="bg" title="Background: dots / grid / plain">${icon('grid')}</button>
            <button class="tb-btn" data-act="zoomOut" title="Zoom out">${icon('zoomOut')}</button>
            <button class="tb-btn zoom-label" data-act="zoomReset" title="Reset zoom">100%</button>
            <button class="tb-btn" data-act="zoomIn" title="Zoom in">${icon('zoomIn')}</button>
            <button class="tb-btn" data-act="fit" title="Fit everything">${icon('fit')}</button>
            <button class="tb-btn" data-act="clear" title="Clear board">${icon('trash')}</button>
          </div>
        </div>
        <div class="wb-stage"><canvas></canvas><div class="wb-hint">Draw anywhere · Space/right-drag to pan · Ctrl+scroll to zoom · Double-click text to edit</div></div>
      </div>`;
    this.stage = this.host.querySelector('.wb-stage');
    this.canvas = this.host.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.zoomLabel = this.host.querySelector('.zoom-label');

    this.host.querySelector('.wb-toolbar').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.tool) this.setTool(b.dataset.tool);
      if (b.dataset.color) { this.color = b.dataset.color; if (this.selected && 'c' in this.selected) { this.commit(); this.selected.c = this.color; this.changed(); } this.syncToolbar(); if (['select', 'eraser', 'sticky'].includes(this.tool)) this.setTool('pen'); }
      if (b.dataset.width) { this.width = +b.dataset.width; this.syncToolbar(); }
      if (b.dataset.sticky) { this.stickyColor = b.dataset.sticky; this.setTool('sticky'); }
      const act = b.dataset.act;
      if (act === 'undo') this.undo();
      if (act === 'redo') this.redo();
      if (act === 'bg') { this.data.bg = { dots: 'grid', grid: 'plain', plain: 'dots' }[this.data.bg]; this.changed(); }
      if (act === 'zoomIn') this.zoomAt(1.2);
      if (act === 'zoomOut') this.zoomAt(1 / 1.2);
      if (act === 'zoomReset') { this.data.view = { x: 0, y: 0, z: 1 }; this.draw(); }
      if (act === 'fit') this.fit();
      if (act === 'clear' && this.data.items.length && confirm('Clear the whole board? (You can undo.)')) { this.commit(); this.data.items = []; this.selected = null; this.changed(); }
    });

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.stage);
    this.bindPointer();
    this.syncToolbar();
    this.resize();
  }

  destroy() {
    this.ro?.disconnect();
    this.finishText();
  }

  setTool(t) {
    this.tool = t;
    if (t !== 'select') this.selected = null;
    this.syncToolbar();
    this.draw();
  }

  syncToolbar() {
    this.host.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === this.tool));
    this.host.querySelectorAll('[data-color]').forEach((b) => b.classList.toggle('on', b.dataset.color === this.color));
    this.host.querySelectorAll('[data-width]').forEach((b) => b.classList.toggle('on', +b.dataset.width === this.width));
    this.host.querySelectorAll('[data-sticky]').forEach((b) => b.classList.toggle('on', b.dataset.sticky === this.stickyColor && this.tool === 'sticky'));
    this.stage.dataset.tool = this.tool;
  }

  onKey(e) {
    if (e.target.closest('input, textarea, [contenteditable="true"]')) return false;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.shiftKey ? this.redo() : this.undo(); return true; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { this.redo(); return true; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) {
      this.commit();
      this.data.items = this.data.items.filter((i) => i !== this.selected);
      this.selected = null;
      this.changed();
      return true;
    }
    if (e.key === 'Escape') { this.selected = null; this.draw(); return true; }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && KEYS[k]) { this.setTool(KEYS[k]); return true; }
    return false;
  }

  // ----------------------------------------------------------- history
  commit() {
    this.undoStack.push(JSON.stringify(this.data.items));
    if (this.undoStack.length > 150) this.undoStack.shift();
    this.redoStack = [];
  }
  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify(this.data.items));
    this.data.items = JSON.parse(this.undoStack.pop());
    this.selected = null;
    this.changed();
  }
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(this.data.items));
    this.data.items = JSON.parse(this.redoStack.pop());
    this.selected = null;
    this.changed();
  }
  changed() { this.draw(); this.onChange(); }

  // ----------------------------------------------------------- geometry
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
  toWorld(sx, sy) {
    const v = this.data.view;
    return [(sx - v.x) / v.z, (sy - v.y) / v.z];
  }
  toScreen(wx, wy) {
    const v = this.data.view;
    return [wx * v.z + v.x, wy * v.z + v.y];
  }
  zoomAt(f, sx = this.w / 2, sy = this.h / 2) {
    const v = this.data.view;
    const nz = Math.min(5, Math.max(0.15, v.z * f));
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
      const lines = it.text.split('\n');
      const w = Math.max(...lines.map((l) => this.ctx.measureText(l).width), 10);
      return [it.x, it.y, it.x + w, it.y + lines.length * it.size * 1.3];
    }
    if (it.t === 'sticky') return [it.x, it.y, it.x + it.w, it.y + it.h];
    return [Math.min(it.x1, it.x2), Math.min(it.y1, it.y2), Math.max(it.x1, it.x2), Math.max(it.y1, it.y2)];
  }

  hit(it, x, y, tol) {
    if (it.t === 'pen') {
      const t = tol + it.w / 2;
      for (let i = 0; i < it.pts.length; i++) {
        const a = it.pts[i], b = it.pts[i + 1] || a;
        if (distSeg(x, y, a[0], a[1], b[0], b[1]) <= t) return true;
      }
      return false;
    }
    if (it.t === 'line' || it.t === 'arrow') return distSeg(x, y, it.x1, it.y1, it.x2, it.y2) <= tol + it.w / 2;
    const [x1, y1, x2, y2] = this.bbox(it);
    if (it.t === 'rect' || it.t === 'ellipse') {
      const inside = x >= x1 - tol && x <= x2 + tol && y >= y1 - tol && y <= y2 + tol;
      if (!inside) return false;
      if (this.tool === 'select') return true;
      const nearEdge = x <= x1 + tol || x >= x2 - tol || y <= y1 + tol || y >= y2 - tol;
      return nearEdge || it.fill;
    }
    return x >= x1 - tol && x <= x2 + tol && y >= y1 - tol && y <= y2 + tol;
  }

  topAt(x, y) {
    const tol = 6 / this.data.view.z;
    for (let i = this.data.items.length - 1; i >= 0; i--) if (this.hit(this.data.items[i], x, y, tol)) return this.data.items[i];
    return null;
  }

  move(it, dx, dy) {
    if (it.t === 'pen') it.pts = it.pts.map(([x, y]) => [x + dx, y + dy]);
    else if ('x1' in it) { it.x1 += dx; it.x2 += dx; it.y1 += dy; it.y2 += dy; }
    else { it.x += dx; it.y += dy; }
  }

  // ----------------------------------------------------------- input
  bindPointer() {
    const c = this.canvas;
    let mode = null;
    let start = null;
    let last = null;
    let current = null;
    let space = false;
    this._keydown = (e) => { if (e.code === 'Space' && !e.target.closest('input,textarea,[contenteditable="true"]')) { space = true; this.stage.classList.add('panning'); e.preventDefault(); } };
    this._keyup = (e) => { if (e.code === 'Space') { space = false; this.stage.classList.remove('panning'); } };
    window.addEventListener('keydown', this._keydown);
    window.addEventListener('keyup', this._keyup);
    const oldDestroy = this.destroy.bind(this);
    this.destroy = () => { window.removeEventListener('keydown', this._keydown); window.removeEventListener('keyup', this._keyup); oldDestroy(); };

    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      this.finishText();
      c.setPointerCapture(e.pointerId);
      const r = c.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const [x, y] = this.toWorld(sx, sy);
      start = [x, y];
      last = [sx, sy];
      if (space || e.button === 1 || e.button === 2) { mode = 'pan'; return; }
      const t = this.tool;
      if (t === 'select') {
        const it = this.topAt(x, y);
        this.selected = it;
        if (it) { this.commit(); mode = 'move'; } else mode = 'pan';
        this.draw();
        return;
      }
      if (t === 'eraser') { this.commit(); mode = 'erase'; this.eraseAt(x, y); return; }
      if (t === 'text' || t === 'sticky') {
        // stop the browser's mousedown focus handling from stealing focus from the new text box
        e.preventDefault();
        const hit = this.topAt(x, y);
        if (hit && (hit.t === 'text' || hit.t === 'sticky')) { this.editText(hit); return; }
      }
      if (t === 'text') { this.editText(null, x, y); return; }
      if (t === 'sticky') {
        this.commit();
        const it = { t: 'sticky', x: x - 90, y: y - 20, w: 200, h: 140, text: '', color: this.stickyColor };
        this.data.items.push(it);
        this.changed();
        this.editText(it);
        return;
      }
      this.commit();
      mode = 'draw';
      const w = t === 'highlighter' ? Math.max(14, this.width * 4) : this.width;
      if (t === 'pen' || t === 'highlighter') current = { t: 'pen', pts: [[x, y]], c: this.color === INK && t === 'highlighter' ? '#f5b800' : this.color, w, hl: t === 'highlighter' };
      else current = { t, x1: x, y1: y, x2: x, y2: y, c: this.color, w };
      this.data.items.push(current);
      this.draw();
    });
    c.addEventListener('pointermove', (e) => {
      if (!mode) return;
      const r = c.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const [x, y] = this.toWorld(sx, sy);
      if (mode === 'pan') {
        const v = this.data.view;
        v.x += sx - last[0];
        v.y += sy - last[1];
        last = [sx, sy];
        this.draw();
        return;
      }
      if (mode === 'move' && this.selected) {
        this.move(this.selected, x - start[0], y - start[1]);
        start = [x, y];
        this.draw();
        return;
      }
      if (mode === 'erase') { this.eraseAt(x, y); return; }
      if (mode === 'draw' && current) {
        if (current.t === 'pen') {
          const p = current.pts[current.pts.length - 1];
          if (Math.hypot(x - p[0], y - p[1]) * this.data.view.z > 1.5) current.pts.push([x, y]);
        } else {
          current.x2 = x;
          current.y2 = y;
          if (e.shiftKey) {
            if (current.t === 'rect' || current.t === 'ellipse') {
              const s = Math.max(Math.abs(x - current.x1), Math.abs(y - current.y1));
              current.x2 = current.x1 + Math.sign(x - current.x1) * s;
              current.y2 = current.y1 + Math.sign(y - current.y1) * s;
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
    const end = () => {
      if (!mode) return;
      if (mode === 'draw' && current) {
        const tiny = current.t === 'pen' ? false : Math.hypot(current.x2 - current.x1, current.y2 - current.y1) < 3;
        if (tiny) { this.data.items.pop(); this.undoStack.pop(); }
        this.onChange();
      } else if (mode === 'move' || mode === 'erase') this.onChange();
      else if (mode === 'pan') this.saveViewSoon();
      mode = null;
      current = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('dblclick', (e) => {
      const r = c.getBoundingClientRect();
      const [x, y] = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      const it = this.topAt(x, y);
      if (it && (it.t === 'text' || it.t === 'sticky')) this.editText(it);
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
    this.data.items = this.data.items.filter((it) => !this.hit(it, x, y, tol));
    if (this.data.items.length !== before) this.draw();
  }

  // ----------------------------------------------------------- text editing
  editText(item, wx, wy) {
    this.finishText();
    const isNew = !item;
    if (isNew) {
      this.commit();
      item = { t: 'text', x: wx, y: wy - 12, text: '', c: this.color, size: Math.max(16, this.width * 6) };
      this.data.items.push(item);
    } else this.commit();
    const ta = document.createElement('textarea');
    ta.className = 'wb-text-edit' + (item.t === 'sticky' ? ' sticky' : '');
    const z = this.data.view.z;
    const [sx, sy] = this.toScreen(item.x, item.y);
    const size = item.t === 'sticky' ? 16 : item.size;
    Object.assign(ta.style, {
      left: sx + 'px', top: sy + 'px',
      font: this.font(size * z),
      color: item.t === 'sticky' ? '#1d1d1f' : this.resolve(item.c),
    });
    if (item.t === 'sticky') Object.assign(ta.style, { width: item.w * z + 'px', height: item.h * z + 'px', background: STICKY[item.color], padding: 12 * z + 'px' });
    ta.value = item.text;
    item._editing = true;
    this.stage.appendChild(ta);
    this.draw();
    const grow = () => {
      if (item.t === 'sticky') return;
      ta.style.width = '0px';
      ta.style.height = '0px';
      ta.style.width = Math.max(80, ta.scrollWidth + 8) + 'px';
      ta.style.height = ta.scrollHeight + 'px';
    };
    grow();
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); this.finishText(); }
    });
    // The pointer press that created this box can steal focus right after we
    // set it, so focus now, again after the event settles, and ignore an
    // immediate blur.
    const born = performance.now();
    ta.addEventListener('blur', () => {
      if (performance.now() - born < 300 && this.editing?.ta === ta) { setTimeout(() => ta.focus(), 0); return; }
      this.finishText();
    });
    ta.focus();
    setTimeout(() => ta.focus(), 0);
    this.editing = { ta, item, isNew };
  }

  finishText() {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    ed.item.text = ed.ta.value.replace(/\s+$/, '');
    delete ed.item._editing;
    ed.ta.remove();
    if (ed.item.t === 'text' && !ed.item.text) {
      this.data.items = this.data.items.filter((i) => i !== ed.item);
      if (ed.isNew) this.undoStack.pop();
    }
    this.changed();
  }

  // ----------------------------------------------------------- drawing
  font(px) { return `${Math.round(px)}px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`; }
  resolve(c) {
    if (c === INK) return this.isDark() ? '#ededef' : '#1d1d1f';
    if (c === '#ffffff' && !this.isDark()) return '#d4d4d8';
    return c;
  }

  draw() {
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(() => this.paint(this.ctx, this.data.view, this.w, this.h, this.dpr, true));
    if (this.zoomLabel) this.zoomLabel.textContent = Math.round(this.data.view.z * 100) + '%';
  }

  paint(ctx, v, w, h, dpr, ui) {
    const dark = this.isDark();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = dark ? '#18181b' : '#ffffff';
    ctx.fillRect(0, 0, w, h);
    if (ui && this.data.bg !== 'plain') {
      const step = 24 * v.z;
      if (step > 6) {
        ctx.fillStyle = ctx.strokeStyle = dark ? 'rgba(255,255,255,.09)' : 'rgba(0,0,0,.09)';
        ctx.lineWidth = 1;
        const ox = ((v.x % step) + step) % step, oy = ((v.y % step) + step) % step;
        if (this.data.bg === 'dots') {
          for (let x = ox; x < w; x += step) for (let y = oy; y < h; y += step) ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
        } else {
          ctx.beginPath();
          for (let x = ox; x < w; x += step) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); }
          for (let y = oy; y < h; y += step) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); }
          ctx.stroke();
        }
      }
    }
    ctx.setTransform(dpr * v.z, 0, 0, dpr * v.z, dpr * v.x, dpr * v.y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const it of this.data.items) {
      if (it._editing && it.t === 'text') continue;
      this.drawItem(ctx, it);
    }
    if (ui && this.selected && this.data.items.includes(this.selected)) {
      const [x1, y1, x2, y2] = this.bbox(this.selected);
      ctx.save();
      ctx.strokeStyle = '#0090ff';
      ctx.lineWidth = 1.5 / v.z;
      ctx.setLineDash([5 / v.z, 4 / v.z]);
      ctx.strokeRect(x1 - 6 / v.z, y1 - 6 / v.z, x2 - x1 + 12 / v.z, y2 - y1 + 12 / v.z);
      ctx.restore();
    }
  }

  drawItem(ctx, it) {
    const col = this.resolve(it.c);
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = it.w;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (it.t === 'pen') {
      if (it.hl) { ctx.globalAlpha = 0.35; ctx.lineCap = 'butt'; }
      const p = it.pts;
      ctx.beginPath();
      if (p.length === 1) {
        ctx.arc(p[0][0], p[0][1], it.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.moveTo(p[0][0], p[0][1]);
        for (let i = 1; i < p.length - 1; i++) {
          const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
          ctx.quadraticCurveTo(p[i][0], p[i][1], mx, my);
        }
        ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.lineCap = 'round';
      return;
    }
    if (it.t === 'line' || it.t === 'arrow') {
      ctx.beginPath();
      ctx.moveTo(it.x1, it.y1);
      ctx.lineTo(it.x2, it.y2);
      ctx.stroke();
      if (it.t === 'arrow') {
        const a = Math.atan2(it.y2 - it.y1, it.x2 - it.x1);
        const s = 10 + it.w * 2.5;
        ctx.beginPath();
        ctx.moveTo(it.x2, it.y2);
        ctx.lineTo(it.x2 - s * Math.cos(a - 0.45), it.y2 - s * Math.sin(a - 0.45));
        ctx.moveTo(it.x2, it.y2);
        ctx.lineTo(it.x2 - s * Math.cos(a + 0.45), it.y2 - s * Math.sin(a + 0.45));
        ctx.stroke();
      }
      return;
    }
    if (it.t === 'rect') {
      const x = Math.min(it.x1, it.x2), y = Math.min(it.y1, it.y2);
      ctx.beginPath();
      ctx.roundRect(x, y, Math.abs(it.x2 - it.x1), Math.abs(it.y2 - it.y1), 6);
      ctx.stroke();
      return;
    }
    if (it.t === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse((it.x1 + it.x2) / 2, (it.y1 + it.y2) / 2, Math.abs(it.x2 - it.x1) / 2, Math.abs(it.y2 - it.y1) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    if (it.t === 'text') {
      ctx.font = this.font(it.size);
      ctx.textBaseline = 'top';
      it.text.split('\n').forEach((l, i) => ctx.fillText(l, it.x, it.y + i * it.size * 1.3 + it.size * 0.1));
      return;
    }
    if (it.t === 'sticky') {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.18)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = STICKY[it.color] || STICKY.yellow;
      ctx.beginPath();
      ctx.roundRect(it.x, it.y, it.w, it.h, 4);
      ctx.fill();
      ctx.restore();
      if (it._editing) return;
      ctx.fillStyle = '#1d1d1f';
      ctx.font = this.font(16);
      ctx.textBaseline = 'top';
      const lines = this.wrap(ctx, it.text, it.w - 24);
      lines.slice(0, Math.floor((it.h - 20) / 21)).forEach((l, i) => ctx.fillText(l, it.x + 12, it.y + 12 + i * 21));
    }
  }

  wrap(ctx, text, maxW) {
    const out = [];
    for (const para of text.split('\n')) {
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
    const pad = 60;
    const z = Math.min(2, Math.max(0.15, Math.min((this.w - pad * 2) / (b[2] - b[0] || 1), (this.h - pad * 2) / (b[3] - b[1] || 1))));
    this.data.view = { z, x: (this.w - (b[2] - b[0]) * z) / 2 - b[0] * z, y: (this.h - (b[3] - b[1]) * z) / 2 - b[1] * z };
    this.draw();
    this.saveViewSoon();
  }

  /** Render all content to a PNG (Uint8Array). */
  async toPng() {
    const b = this.contentBounds() || [0, 0, 800, 600];
    const pad = 40, scale = 2;
    const w = b[2] - b[0] + pad * 2, h = b[3] - b[1] + pad * 2;
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * scale);
    cv.height = Math.round(h * scale);
    this.paint(cv.getContext('2d'), { x: -b[0] + pad, y: -b[1] + pad, z: 1 }, w, h, scale, false);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }

  static searchText(doc) {
    return (doc.board?.items || []).filter((i) => i.text).map((i) => i.text).join(' ');
  }
}
