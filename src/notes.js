// Rich text note editor (contenteditable) + HTML sanitising + Word export.
import { Docx } from './docx.js';
import { icon } from './icons.js';

const ALLOWED = new Set(['P', 'DIV', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'HR', 'MARK', 'A', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'CODE', 'PRE']);
const DROP = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'HEAD', 'IFRAME', 'OBJECT', 'SVG', 'IMG', 'VIDEO', 'AUDIO', 'XML']);

export function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walk = (node, outParent) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) { outParent.appendChild(document.createTextNode(child.nodeValue)); continue; }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName;
      if (DROP.has(tag)) continue;
      if (ALLOWED.has(tag)) {
        const el = document.createElement(tag === 'DIV' ? 'p' : tag === 'STRONG' ? 'b' : tag === 'EM' ? 'i' : tag === 'STRIKE' || tag === 'DEL' ? 's' : tag.toLowerCase());
        if (tag === 'A' && child.getAttribute('href')) el.setAttribute('href', child.getAttribute('href'));
        if (tag === 'UL' && child.classList.contains('checklist')) el.className = 'checklist';
        if (tag === 'LI' && child.hasAttribute('data-checked')) el.setAttribute('data-checked', '');
        // keep bold/italic expressed as inline styles (e.g. from Word / Google Docs)
        walk(child, el);
        outParent.appendChild(el);
      } else {
        const st = child.getAttribute('style') || '';
        let target = outParent;
        if (/font-weight:\s*(bold|[6-9]00)/.test(st)) { const b = document.createElement('b'); target.appendChild(b); target = b; }
        if (/font-style:\s*italic/.test(st)) { const i = document.createElement('i'); target.appendChild(i); target = i; }
        walk(child, target);
      }
    }
  };
  const out = document.createElement('div');
  walk(doc.body, out);
  return out.innerHTML;
}

const BTNS = [
  ['h1', 'H1', 'Heading 1 (Ctrl+1)'],
  ['h2', 'H2', 'Heading 2 (Ctrl+2)'],
  ['p', '¶', 'Normal text (Ctrl+0)'],
  '|',
  ['bold', icon('bold'), 'Bold (Ctrl+B)'],
  ['italic', icon('italic'), 'Italic (Ctrl+I)'],
  ['underline', icon('underline'), 'Underline (Ctrl+U)'],
  ['strike', icon('strike'), 'Strikethrough'],
  ['mark', icon('mark'), 'Highlight (Ctrl+Shift+H)'],
  '|',
  ['ul', icon('ul'), 'Bullet list (Ctrl+Shift+8)'],
  ['ol', icon('ol'), 'Numbered list (Ctrl+Shift+7)'],
  ['check', icon('checklist'), 'Checklist (Ctrl+Shift+9)'],
  ['quote', icon('quote'), 'Quote'],
  ['hr', icon('hr'), 'Divider line'],
  '|',
  ['time', icon('clock'), 'Insert time & date (F5)'],
  ['clear', icon('eraseFormat'), 'Clear formatting'],
];

export class NoteEditor {
  constructor(host, doc, { onChange, stamp }) {
    this.doc = doc;
    this.onChange = onChange;
    this.stamp = stamp;
    host.innerHTML = `
      <div class="note-wrap">
        <div class="fmt-bar">${BTNS.map((b) => (b === '|' ? '<span class="fmt-sep"></span>' : `<button class="tb-btn" data-cmd="${b[0]}" title="${b[2]}">${b[1]}</button>`)).join('')}</div>
        <div class="note-scroll">
          <div class="note-page">
            <input class="note-title" placeholder="Untitled note" maxlength="200">
            <div class="note-body" contenteditable="true" spellcheck="true" data-placeholder="Start writing… (F5 inserts the time, Ctrl+Shift+9 adds a checklist)"></div>
          </div>
        </div>
      </div>`;
    this.title = host.querySelector('.note-title');
    this.body = host.querySelector('.note-body');
    this.title.value = doc.title || '';
    this.body.innerHTML = doc.html || '';
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); document.execCommand('styleWithCSS', false, false); } catch { /* ignore */ }

    this.title.addEventListener('input', () => { this.doc.title = this.title.value; this.onChange(); });
    this.title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.body.focus(); } });
    this.body.addEventListener('input', () => this.save());
    this.body.addEventListener('paste', (e) => {
      const html = e.clipboardData.getData('text/html');
      const text = e.clipboardData.getData('text/plain');
      e.preventDefault();
      if (html) document.execCommand('insertHTML', false, sanitize(html));
      else document.execCommand('insertText', false, text);
    });
    this.body.addEventListener('click', (e) => {
      const li = e.target.closest('ul.checklist > li');
      if (li && e.offsetX < 26) {
        li.toggleAttribute('data-checked');
        this.save();
      }
    });
    this.body.addEventListener('keydown', (e) => this.keys(e));
    host.querySelector('.fmt-bar').addEventListener('mousedown', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.preventDefault();
      this.cmd(b.dataset.cmd);
    });
    if (!doc.html) setTimeout(() => (doc.title ? this.body : this.title).focus(), 0);
  }

  save() {
    this.doc.html = this.body.innerHTML;
    this.onChange();
  }

  focus() { this.body.focus(); }

  insertStamp() { document.execCommand('insertText', false, this.stamp()); }

  keys(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Tab') {
      if (document.queryCommandState('insertUnorderedList') || document.queryCommandState('insertOrderedList')) {
        e.preventDefault();
        document.execCommand(e.shiftKey ? 'outdent' : 'indent');
      } else {
        e.preventDefault();
        document.execCommand('insertText', false, '\t');
      }
      return;
    }
    if (!mod) return;
    const k = e.key.toLowerCase();
    const map = { '1': 'h1', '2': 'h2', '3': 'h3', '0': 'p' };
    if (map[k] && !e.shiftKey) { e.preventDefault(); this.cmd(map[k]); return; }
    if (e.shiftKey && (e.code === 'Digit8')) { e.preventDefault(); this.cmd('ul'); return; }
    if (e.shiftKey && (e.code === 'Digit7')) { e.preventDefault(); this.cmd('ol'); return; }
    if (e.shiftKey && (e.code === 'Digit9')) { e.preventDefault(); this.cmd('check'); return; }
    if (e.shiftKey && k === 'h') { e.preventDefault(); this.cmd('mark'); return; }
  }

  cmd(c) {
    this.body.focus();
    const ex = (a, v = null) => document.execCommand(a, false, v);
    switch (c) {
      case 'h1': case 'h2': case 'h3': {
        const cur = document.queryCommandValue('formatBlock').toLowerCase();
        ex('formatBlock', cur === c ? 'p' : c);
        break;
      }
      case 'p': ex('formatBlock', 'p'); break;
      case 'bold': case 'italic': case 'underline': ex(c); break;
      case 'strike': ex('strikeThrough'); break;
      case 'mark': {
        const sel = window.getSelection();
        if (!sel.rangeCount || sel.isCollapsed) break;
        const node = sel.anchorNode?.parentElement?.closest('mark');
        if (node) { node.replaceWith(...node.childNodes); } else {
          const html = sel.getRangeAt(0).cloneContents();
          const div = document.createElement('div');
          div.appendChild(html);
          ex('insertHTML', `<mark>${div.innerHTML}</mark>`);
        }
        break;
      }
      case 'ul': ex('insertUnorderedList'); this.fixLists(false); break;
      case 'ol': ex('insertOrderedList'); break;
      case 'check': {
        const ul = this.currentList();
        if (ul && ul.tagName === 'UL' && ul.classList.contains('checklist')) { ex('insertUnorderedList'); break; }
        if (!ul || ul.tagName !== 'UL') ex('insertUnorderedList');
        const list = this.currentList();
        if (list) list.classList.add('checklist');
        break;
      }
      case 'quote': {
        const cur = document.queryCommandValue('formatBlock').toLowerCase();
        ex('formatBlock', cur === 'blockquote' ? 'p' : 'blockquote');
        break;
      }
      case 'hr': ex('insertHorizontalRule'); break;
      case 'time': this.insertStamp(); break;
      case 'clear': ex('removeFormat'); ex('formatBlock', 'p'); break;
      default: break;
    }
    this.save();
  }

  currentList() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    let n = sel.anchorNode;
    if (n && n.nodeType === 3) n = n.parentElement;
    return n?.closest?.('ul, ol') || null;
  }

  fixLists(check) {
    const ul = this.currentList();
    if (ul && !check) ul.classList.remove('checklist');
  }
}

// ---------------------------------------------------------------- export helpers

function inlineRuns(node, style = {}, out = []) {
  for (const c of node.childNodes) {
    if (c.nodeType === 3) {
      const text = c.nodeValue.replace(/ /g, ' ');
      if (text) out.push({ text, ...style });
      continue;
    }
    if (c.nodeType !== 1) continue;
    const t = c.tagName;
    if (t === 'BR') { out.push({ text: '\n', ...style }); continue; }
    if (t === 'UL' || t === 'OL') continue;
    const s = { ...style };
    if (t === 'B' || t === 'STRONG') s.b = true;
    if (t === 'I' || t === 'EM') s.i = true;
    if (t === 'U') s.u = true;
    if (t === 'S' || t === 'STRIKE' || t === 'DEL') s.s = true;
    if (t === 'MARK') s.hl = true;
    if (t === 'A') { s.u = true; s.color = '0563C1'; }
    if (t === 'CODE') s.font = 'Consolas';
    inlineRuns(c, s, out);
  }
  // trim a trailing line break that browsers leave in empty blocks
  if (out.length && out[out.length - 1].text === '\n') out.pop();
  return out;
}

const INLINE = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'MARK', 'A', 'SPAN', 'CODE', 'BR', 'FONT']);

function listToDocx(dx, list, lvl, numId) {
  const ordered = list.tagName === 'OL';
  const check = list.classList.contains('checklist');
  const id = ordered ? numId || dx.newNum('decimal') : null;
  for (const li of list.children) {
    if (li.tagName !== 'LI') continue;
    let runs = inlineRuns(li);
    if (check) runs = [{ text: li.hasAttribute('data-checked') ? '☑  ' : '☐  ', font: 'Segoe UI Symbol' }, ...runs.map((r) => (li.hasAttribute('data-checked') ? { ...r, s: true, color: '808080' } : r))];
    if (check) dx.p(runs, { indent: 360 + lvl * 400, after: 40 });
    else if (ordered) dx.item(runs, 'decimal', Math.min(lvl, 2), id);
    else dx.item(runs, 'bullet', Math.min(lvl, 2));
    for (const sub of li.children) if (sub.tagName === 'UL' || sub.tagName === 'OL') listToDocx(dx, sub, lvl + 1, sub.tagName === 'OL' ? null : undefined);
  }
}

function blockToDocx(dx, el) {
  const t = el.tagName;
  if (t === 'H1') return dx.heading(el.textContent, 1);
  if (t === 'H2') return dx.heading(el.textContent, 2);
  if (t === 'H3') return dx.heading(el.textContent, 3);
  if (t === 'UL' || t === 'OL') return listToDocx(dx, el, 0);
  if (t === 'HR') return dx.p('', { border: true, after: 160 });
  if (t === 'BLOCKQUOTE') return dx.p(inlineRuns(el, { i: true, color: '595959' }), { leftBar: 'C0392B', indent: 300 });
  if (t === 'PRE') return dx.p([{ text: el.textContent, font: 'Consolas', size: 10 }], { shade: 'F2F2F2' });
  if (t === 'TABLE') {
    const rows = [...el.querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
    return dx.table(rows, {});
  }
  // P/DIV that (invalidly, but browsers do it) contain lists or other blocks
  if ([...el.children].some((c) => !INLINE.has(c.tagName))) return blocksToDocx(dx, el);
  return dx.p(inlineRuns(el));
}

/** Walk mixed content: runs of inline nodes become paragraphs, blocks are dispatched. */
function blocksToDocx(dx, parent) {
  let pending = null;
  const flush = () => {
    if (pending && pending.textContent.trim()) dx.p(inlineRuns(pending));
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
  root.querySelectorAll('p, h1, h2, h3, li, blockquote, div').forEach((el) => el.append('\n'));
  root.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  return `${doc.title || 'Untitled note'}\n\n${root.textContent.replace(/\n{3,}/g, '\n\n').trim()}`;
}

export function noteSearchText(doc) {
  const d = document.createElement('div');
  d.innerHTML = doc.html || '';
  return d.textContent;
}
