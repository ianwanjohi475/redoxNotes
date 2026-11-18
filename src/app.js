import { Store, isApp, onAppClose, setWindowTitle } from './store.js';
import { icon } from './icons.js';
import * as U from './util.js';
import * as R from './report.js';
import { ReportEditor } from './reportEditor.js';
import { NoteEditor, noteToDocx, noteToText, noteSearchText } from './notes.js';
import { Board } from './whiteboard.js';

// ------------------------------------------------------------------ state
const DEFAULT_SETTINGS = {
  theme: 'system',
  fontSize: 15,
  openTodayOnStart: true,
  sidebar: true,
  openTabs: [],
  activeId: null,
  profile: {
    company: '',
    subtitle: 'DAILY WORK REPORT',
    name: '',
    branch: '',
    shift: '8AM to 4PM',
    statsTitle: 'FIELD OPERATIONS AND INSTALLATION',
    statLabels: ['Installations completed', 'Migrations', 'LOS completed', 'Pending incidents', 'Survey'],
    teams: [],
  },
};

const S = {
  docs: new Map(),
  settings: structuredClone(DEFAULT_SETTINGS),
  tabs: [],
  active: null,
  filter: 'all',
  query: '',
  calMonth: new Date(),
  editor: null,
  dirty: new Set(),
  saveState: 'saved',
  lastSaved: null,
  searchCache: new Map(),
  learnedFrom: {},
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ------------------------------------------------------------------ theme
const media = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = S.settings.theme;
  const dark = t === 'dark' || (t === 'system' && media.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try { localStorage.setItem('redox.theme', t); } catch { /* ignore */ }
  if (S.editor instanceof Board) S.editor.draw();
  renderStatus();
}
media.addEventListener('change', applyTheme);
const isDark = () => document.documentElement.dataset.theme === 'dark';

function applyFont() {
  document.documentElement.style.setProperty('--doc-size', S.settings.fontSize + 'px');
}

// ------------------------------------------------------------------ persistence
const saveSettings = U.debounce(() => Store.saveSettings(S.settings).catch((e) => toast('Could not save settings: ' + e, 'err')), 400);

async function flushDocs() {
  const ids = [...S.dirty];
  S.dirty.clear();
  if (!ids.length) return;
  setSave('saving');
  try {
    await Promise.all(ids.map((id) => { const d = S.docs.get(id); return d ? Store.save(d) : Store.remove(id); }));
    S.lastSaved = new Date();
    setSave('saved');
  } catch (e) {
    ids.forEach((id) => S.dirty.add(id));
    setSave('error');
    toast('Save failed: ' + e, 'err');
  }
}
const saveSoon = U.debounce(flushDocs, 450);

function touch(doc, { quiet = false } = {}) {
  if (!quiet) doc.updated = new Date().toISOString();
  S.dirty.add(doc.id);
  S.searchCache.delete(doc.id);
  setSave('pending');
  saveSoon();
  renderListSoon();
  if (doc.id === S.active) { renderDocHeaderMeta(); renderStatusSoon(); }
  renderTabsSoon();
}

function setSave(state) {
  S.saveState = state;
  const el = $('#save-state');
  if (!el) return;
  const txt = {
    pending: 'Editing…',
    saving: 'Saving…',
    saved: S.lastSaved ? `Saved ${U.fmtClock(S.lastSaved)}` : 'All changes saved',
    error: 'Save failed — retrying',
  }[state];
  el.innerHTML = `${state === 'saved' ? icon('check', 14) : ''}<span>${txt}</span>`;
  el.className = 'save-state ' + state;
  if (state === 'error') setTimeout(() => saveSoon(), 3000);
}

// ------------------------------------------------------------------ documents
function nowIso() { return new Date().toISOString(); }

function docTitle(d) {
  if (d.type === 'report') return R.reportTitle(d);
  if (d.type === 'board') return d.title || `Whiteboard · ${U.fmtDayMonth(d.date)}`;
  if (d.title?.trim()) return d.title.trim();
  const first = noteSearchText(d).trim().split('\n')[0];
  return first ? first.slice(0, 60) : 'Untitled note';
}

function searchText(d) {
  let t = S.searchCache.get(d.id);
  if (t == null) {
    t = docTitle(d) + '\n' + (d.type === 'report' ? R.reportSearchText(d) : d.type === 'note' ? noteSearchText(d) : Board.searchText(d));
    t = t.toLowerCase();
    S.searchCache.set(d.id, t);
  }
  return t;
}

const liveDocs = () => [...S.docs.values()].filter((d) => !d.trashed);

function findReport(dateKey) {
  return liveDocs().find((d) => d.type === 'report' && d.date === dateKey);
}

function addDoc(doc) {
  S.docs.set(doc.id, doc);
  touch(doc);
  openTab(doc.id);
  return doc;
}

function newReport(dateKey = U.todayKey()) {
  const existing = findReport(dateKey);
  if (existing) { openTab(existing.id); return existing; }
  const prev = liveDocs().filter((d) => d.type === 'report' && d.date < dateKey).sort((a, b) => b.date.localeCompare(a.date))[0];
  return addDoc({ id: U.uid(), type: 'report', date: dateKey, created: nowIso(), updated: nowIso(), pinned: false, trashed: false, report: R.emptyReport(S.settings.profile, prev) });
}

function newNote() {
  return addDoc({ id: U.uid(), type: 'note', title: '', html: '', date: U.todayKey(), created: nowIso(), updated: nowIso(), pinned: false, trashed: false });
}

function newBoard() {
  return addDoc({ id: U.uid(), type: 'board', title: '', date: U.todayKey(), created: nowIso(), updated: nowIso(), pinned: false, trashed: false, board: { items: [], view: { x: 0, y: 0, z: 1 }, bg: 'dots' } });
}

function duplicate(doc) {
  const copy = structuredClone(doc);
  copy.id = U.uid();
  copy.created = copy.updated = nowIso();
  copy.pinned = false;
  if (copy.type === 'report') {
    // a report copy goes to the next free day
    let k = U.todayKey();
    while (findReport(k)) k = U.addDays(k, 1);
    copy.date = k;
  } else copy.title = (doc.title || docTitle(doc)) + ' (copy)';
  addDoc(copy);
  toast('Duplicated');
}

function trashDoc(doc) {
  doc.trashed = true;
  doc.trashedAt = nowIso();
  touch(doc, { quiet: true });
  closeTab(doc.id);
  toast(`Moved “${docTitle(doc)}” to Trash`, 'info', { label: 'Undo', fn: () => restoreDoc(doc) });
}

function restoreDoc(doc) {
  if (doc.type === 'report' && findReport(doc.date)) {
    toast(`There's already a report for ${U.fmtShort(doc.date)} — change one of the dates first.`, 'err');
    return;
  }
  doc.trashed = false;
  delete doc.trashedAt;
  touch(doc, { quiet: true });
  openTab(doc.id);
}

async function deleteForever(doc) {
  S.docs.delete(doc.id);
  S.dirty.add(doc.id); // flushDocs deletes ids no longer present
  closeTab(doc.id);
  saveSoon();
  renderList();
}

// ------------------------------------------------------------------ tabs
function openTab(id) {
  if (!S.docs.has(id)) return;
  if (!S.tabs.includes(id)) {
    const at = S.active ? S.tabs.indexOf(S.active) + 1 : S.tabs.length;
    S.tabs.splice(at || S.tabs.length, 0, id);
  }
  activate(id);
}

function closeTab(id) {
  const i = S.tabs.indexOf(id);
  if (i < 0) return;
  S.tabs.splice(i, 1);
  if (S.active === id) {
    const next = S.tabs[i] || S.tabs[i - 1] || null;
    S.active = null;
    activate(next);
  } else renderTabs();
  persistTabs();
}

function activate(id) {
  if (S.active === id && S.editor) { renderTabs(); return; }
  flushDocs();
  S.editor?.destroy?.();
  S.editor = null;
  S.active = id;
  persistTabs();
  renderTabs();
  renderEditor();
  renderList();
  renderCalendar();
}

function persistTabs() {
  S.settings.openTabs = S.tabs.slice(-30);
  S.settings.activeId = S.active;
  saveSettings();
}

const renderTabsSoon = U.debounce(() => renderTabs(), 120);
function renderTabs() {
  const bar = $('#tabs');
  bar.innerHTML = S.tabs.map((id) => {
    const d = S.docs.get(id);
    if (!d) return '';
    const ic = d.type === 'report' ? 'report' : d.type === 'board' ? 'board' : 'note';
    return `<div class="tab ${id === S.active ? 'active' : ''}" data-id="${id}" title="${U.escHtml(docTitle(d))}" draggable="true">
      <span class="tab-ic t-${d.type}">${icon(ic, 14)}</span><span class="tab-label">${U.escHtml(docTitle(d))}</span>
      <button class="tab-x" data-close="${id}" title="Close (Ctrl+W)">${icon('x', 13)}</button></div>`;
  }).join('');
  const act = bar.querySelector('.tab.active');
  act?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const d = S.docs.get(S.active);
  setWindowTitle(d ? `${docTitle(d)} — Redox Notes` : 'Redox Notes');
}

// ------------------------------------------------------------------ sidebar
function renderSidebarShell() {
  $('#sidebar').innerHTML = `
    <div class="brand">
      <div class="logo">${icon('note', 18)}</div><span>Redox Notes</span>
      <button class="icon-btn" data-act="collapse" title="Hide sidebar (Ctrl+\\)">${icon('sidebar', 17)}</button>
    </div>
    <button class="today-btn" data-act="today">${icon('report', 18)}<span><b>Today's report</b><small>${U.fmtLong(U.todayKey())}</small></span><kbd>Ctrl+D</kbd></button>
    <div class="new-row">
      <button data-act="newNote" title="New note (Ctrl+N)">${icon('note', 16)} Note</button>
      <button data-act="newBoard" title="New whiteboard (Ctrl+Shift+N)">${icon('board', 16)} Whiteboard</button>
      <button data-act="range" title="Weekly / monthly report (Ctrl+R)">${icon('chart', 16)} Reports</button>
    </div>
    <div class="search">${icon('search', 16)}<input id="search" placeholder="Search everything  (Ctrl+F)" autocomplete="off"><button class="icon-btn clear-search" title="Clear">${icon('x', 14)}</button></div>
    <div id="calendar" class="calendar"></div>
    <div class="filters">${[['all', 'All'], ['report', 'Reports'], ['note', 'Notes'], ['board', 'Boards'], ['pinned', 'Pinned'], ['trash', 'Trash']].map(([k, l]) => `<button data-filter="${k}">${l}</button>`).join('')}</div>
    <div id="doclist" class="doclist"></div>
    <div class="side-foot">
      <button class="icon-btn" data-act="settings" title="Settings (Ctrl+,)">${icon('settings', 17)}</button>
      <button class="icon-btn" data-act="shortcuts" title="Keyboard shortcuts (Ctrl+/)">${icon('keyboard', 17)}</button>
      <button class="icon-btn" data-act="folder" title="Open data folder">${icon('folder', 17)}</button>
      <span class="grow"></span>
      <div class="theme-switch" role="group" aria-label="Theme">
        <button data-theme-set="light" title="Light mode">${icon('sun', 15)}</button>
        <button data-theme-set="dark" title="Dark mode">${icon('moon', 15)}</button>
        <button data-theme-set="system" title="Follow Windows">A</button>
      </div>
    </div>`;
  const sb = $('#sidebar');
  sb.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.filter) { S.filter = b.dataset.filter; renderList(); return; }
    if (b.dataset.themeSet) { S.settings.theme = b.dataset.themeSet; applyTheme(); saveSettings(); syncThemeSwitch(); return; }
    if (b.classList.contains('clear-search')) { $('#search').value = ''; S.query = ''; renderList(); return; }
    const a = b.dataset.act;
    if (a) actions[a]?.();
  });
  const search = $('#search');
  search.addEventListener('input', U.debounce(() => { S.query = search.value.trim().toLowerCase(); renderList(); }, 120));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { search.value = ''; S.query = ''; renderList(); search.blur(); }
    if (e.key === 'Enter') { const first = $('#doclist .item'); if (first) openTab(first.dataset.id); }
  });
  $('#doclist').addEventListener('click', (e) => {
    const more = e.target.closest('[data-more]');
    const item = e.target.closest('.item');
    if (more) { e.stopPropagation(); itemMenu(S.docs.get(more.dataset.more), more); return; }
    if (item) {
      const d = S.docs.get(item.dataset.id);
      if (d.trashed) itemMenu(d, item);
      else openTab(d.id);
    }
  });
  $('#doclist').addEventListener('contextmenu', (e) => {
    const item = e.target.closest('.item');
    if (!item) return;
    e.preventDefault();
    itemMenu(S.docs.get(item.dataset.id), { x: e.clientX, y: e.clientY });
  });
  $('#calendar').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.nav) {
      const m = S.calMonth;
      S.calMonth = b.dataset.nav === 'today' ? new Date() : new Date(m.getFullYear(), m.getMonth() + (+b.dataset.nav), 1);
      renderCalendar();
      return;
    }
    if (b.dataset.day) {
      const k = b.dataset.day;
      const rep = findReport(k);
      if (rep) openTab(rep.id);
      else if (k > U.todayKey()) toast('That day is in the future — you can still create it from here.', 'info', { label: 'Create', fn: () => newReport(k) });
      else newReport(k);
    }
  });
  syncThemeSwitch();
}

function syncThemeSwitch() {
  $$('[data-theme-set]').forEach((b) => b.classList.toggle('on', b.dataset.themeSet === S.settings.theme));
}

function renderCalendar() {
  const el = $('#calendar');
  if (!el) return;
  const m = S.calMonth;
  const y = m.getFullYear(), mo = m.getMonth();
  const first = new Date(y, mo, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(y, mo + 1, 0).getDate();
  const reports = new Set();
  const others = new Set();
  for (const d of liveDocs()) {
    if (d.type === 'report') reports.add(d.date);
    else others.add(U.dateKey(new Date(d.created)));
  }
  const today = U.todayKey();
  const activeDate = S.docs.get(S.active)?.type === 'report' ? S.docs.get(S.active).date : null;
  let cells = '';
  for (let i = 0; i < offset; i++) cells += '<span></span>';
  for (let d = 1; d <= days; d++) {
    const k = `${y}-${U.pad(mo + 1)}-${U.pad(d)}`;
    const cls = [k === today && 'today', reports.has(k) && 'has-rep', others.has(k) && 'has-other', k === activeDate && 'sel', k > today && 'future'].filter(Boolean).join(' ');
    cells += `<button class="${cls}" data-day="${k}" title="${U.fmtLong(k)}${reports.has(k) ? ' · report' : ''}">${d}</button>`;
  }
  el.innerHTML = `
    <div class="cal-head">
      <button class="icon-btn" data-nav="-1" title="Previous month">${icon('left', 15)}</button>
      <button class="cal-title" data-nav="today" title="Jump to this month">${U.MONTHS[mo]} ${y}</button>
      <button class="icon-btn" data-nav="1" title="Next month">${icon('right', 15)}</button>
    </div>
    <div class="cal-grid dow">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span>${x}</span>`).join('')}</div>
    <div class="cal-grid">${cells}</div>`;
}

const renderListSoon = U.debounce(() => { renderList(); renderCalendar(); }, 250);
function renderList() {
  const el = $('#doclist');
  if (!el) return;
  $$('.filters button').forEach((b) => b.classList.toggle('on', b.dataset.filter === S.filter));
  let docs = [...S.docs.values()];
  if (S.filter === 'trash') docs = docs.filter((d) => d.trashed);
  else {
    docs = docs.filter((d) => !d.trashed);
    if (S.filter === 'pinned') docs = docs.filter((d) => d.pinned);
    else if (S.filter !== 'all') docs = docs.filter((d) => d.type === S.filter);
  }
  if (S.query) {
    const terms = S.query.split(/\s+/);
    docs = docs.filter((d) => { const t = searchText(d); return terms.every((q) => t.includes(q)); });
  }
  const sortKey = (d) => (d.type === 'report' ? d.date + 'T23:59' : d.updated);
  docs.sort((a, b) => (b.pinned - a.pinned) || sortKey(b).localeCompare(sortKey(a)));
  if (!docs.length) {
    el.innerHTML = `<div class="list-empty">${S.query ? `Nothing matches “${U.escHtml(S.query)}”` : S.filter === 'trash' ? 'Trash is empty' : 'Nothing here yet'}</div>`;
    return;
  }
  let html = '';
  let group = null;
  const shown = docs.slice(0, 400);
  for (const d of shown) {
    const g = d.pinned && S.filter !== 'trash' ? 'Pinned' : U.relGroup(d.type === 'report' ? d.date : U.dateKey(new Date(d.updated)));
    if (g !== group) { html += `<div class="group">${g}</div>`; group = g; }
    const ic = d.type === 'report' ? 'report' : d.type === 'board' ? 'board' : 'note';
    let sub = d.type === 'report' ? `${d.report.blocks.length} time block${d.report.blocks.length === 1 ? '' : 's'}` : `Edited ${U.fmtClock(new Date(d.updated))}`;
    if (d.type !== 'report' && U.dateKey(new Date(d.updated)) !== U.todayKey()) sub = `Edited ${U.fmtDayMonth(U.dateKey(new Date(d.updated)))}`;
    if (S.query) {
      const t = searchText(d);
      const i = t.indexOf(S.query.split(/\s+/)[0]);
      if (i >= 0) sub = '…' + U.escHtml(t.slice(Math.max(0, i - 20), i + 50).replace(/\s+/g, ' ')) + '…';
    }
    html += `<div class="item ${d.id === S.active ? 'active' : ''}" data-id="${d.id}">
      <span class="item-ic t-${d.type}">${icon(ic, 15)}</span>
      <span class="item-txt"><span class="item-title">${d.pinned ? icon('pin', 12) : ''}${U.escHtml(docTitle(d))}</span><span class="item-sub">${sub}</span></span>
      <button class="icon-btn item-more" data-more="${d.id}" title="More">${icon('more', 15)}</button></div>`;
  }
  if (docs.length > shown.length) html += `<div class="list-empty">${docs.length - shown.length} more — refine your search</div>`;
  if (S.filter === 'trash') html += '<button class="add-row danger" data-empty-trash>Empty trash</button>';
  el.innerHTML = html;
  el.querySelector('[data-empty-trash]')?.addEventListener('click', () => {
    if (!confirm('Permanently delete everything in Trash?')) return;
    [...S.docs.values()].filter((d) => d.trashed).forEach((d) => deleteForever(d));
  });
}

// ------------------------------------------------------------------ editor area
function renderEditor() {
  const host = $('#editor');
  const doc = S.docs.get(S.active);
  if (!doc) {
    host.innerHTML = welcomeHtml();
    host.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => actions[b.dataset.act]?.()));
    renderStatus();
    return;
  }
  host.innerHTML = `
    <div class="doc-head">
      <span class="doc-type t-${doc.type}">${icon(doc.type === 'report' ? 'report' : doc.type === 'board' ? 'board' : 'note', 16)}</span>
      ${doc.type === 'board' ? `<input class="board-title" value="${U.escHtml(doc.title || '')}" placeholder="${U.escHtml(docTitle({ ...doc, title: '' }))}">` : `<span class="doc-title">${U.escHtml(docTitle(doc))}</span>`}
      <span class="doc-meta"></span>
      <span class="grow"></span>
      ${doc.trashed ? `<button class="primary sm" data-x="restore">${icon('restore', 15)} Restore</button>` : ''}
      ${doc.type === 'board'
        ? `<button class="ghost sm" data-x="png" title="Export as image">${icon('image', 15)} Export PNG</button>`
        : `<button class="ghost sm" data-x="docx" title="Export to Word (Ctrl+E)">${icon('word', 15)} Word</button>
           <button class="ghost sm" data-x="print" title="Print or save as PDF (Ctrl+P)">${icon('printer', 15)} PDF / Print</button>
           <button class="ghost sm" data-x="copy" title="Copy as text — paste into WhatsApp, email… (Ctrl+Shift+C)">${icon('copy', 15)} Copy text</button>`}
      <button class="icon-btn" data-x="more" title="More actions">${icon('more', 17)}</button>
    </div>
    <div class="doc-body"></div>`;
  renderDocHeaderMeta();
  host.querySelector('.doc-head').addEventListener('click', (e) => {
    const b = e.target.closest('[data-x]');
    if (!b) return;
    const x = b.dataset.x;
    if (x === 'more') itemMenu(doc, b);
    else if (x === 'restore') restoreDoc(doc);
    else exportDoc(doc, x);
  });
  const bt = host.querySelector('.board-title');
  bt?.addEventListener('input', () => { doc.title = bt.value; touch(doc); });
  const body = host.querySelector('.doc-body');
  const onChange = (quiet) => touch(doc, { quiet: quiet === true });
  if (doc.type === 'report') {
    S.editor = new ReportEditor(body, doc, {
      onChange: (q) => {
        const p = S.settings.profile;
        let learned = false;
        // fill empty profile fields from this header, and keep following it while typing
        for (const k of ['company', 'name', 'branch']) {
          const v = doc.report.header[k];
          if (v && v !== p[k] && (!p[k] || S.learnedFrom[k] === doc.id)) { p[k] = v; S.learnedFrom[k] = doc.id; learned = true; }
        }
        if (learned) saveSettings();
        onChange(q);
      },
      onDateChange: (k) => {
        const other = findReport(k);
        if (other && other !== doc) { toast(`There's already a report for ${U.fmtShort(k)}`, 'err', { label: 'Open it', fn: () => openTab(other.id) }); return false; }
        doc.date = k;
        touch(doc);
        renderDocHeader(doc);
        return true;
      },
    });
  } else if (doc.type === 'note') {
    S.editor = new NoteEditor(body, doc, { onChange, stamp: () => `${U.fmtClock()} ${U.fmtShort(U.todayKey())}` });
  } else {
    S.editor = new Board(body, doc, { onChange, isDark });
  }
  renderStatus();
}

function renderDocHeader(doc) {
  const t = $('#editor .doc-title');
  if (t) t.textContent = docTitle(doc);
  renderDocHeaderMeta();
  renderTabs();
}

function renderDocHeaderMeta() {
  const doc = S.docs.get(S.active);
  const el = $('#editor .doc-meta');
  if (!doc || !el) return;
  el.textContent = `Created ${U.fmtStamp(doc.created)} · Edited ${U.fmtStamp(doc.updated)}`;
  const t = $('#editor .doc-title');
  if (t) t.textContent = docTitle(doc);
}

function welcomeHtml() {
  const reps = liveDocs().filter((d) => d.type === 'report').length;
  return `<div class="welcome">
    <div class="welcome-card">
      <div class="logo big">${icon('note', 30)}</div>
      <h1>${greeting()}${S.settings.profile.name ? ', ' + U.escHtml(S.settings.profile.name.split(' ')[0]) : ''}</h1>
      <p class="muted">${U.fmtLong(U.todayKey())} · ${reps} daily report${reps === 1 ? '' : 's'} saved</p>
      <div class="welcome-actions">
        <button class="primary" data-act="today">${icon('report', 18)} Start today's report</button>
        <button class="ghost" data-act="newNote">${icon('note', 18)} New note</button>
        <button class="ghost" data-act="newBoard">${icon('board', 18)} Whiteboard</button>
        <button class="ghost" data-act="range">${icon('chart', 18)} Weekly report</button>
      </div>
      ${!S.settings.profile.name ? `<button class="link" data-act="settings">Set up your name, branch & report header →</button>` : ''}
    </div></div>`;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

// ------------------------------------------------------------------ status bar
const renderStatusSoon = U.debounce(() => renderStatus(), 300);
function renderStatus() {
  const el = $('#status');
  if (!el) return;
  const doc = S.docs.get(S.active);
  let info = '';
  if (doc) {
    let text = '';
    if (doc.type === 'report') text = R.dailyText(doc);
    else if (doc.type === 'note') text = noteSearchText(doc);
    const words = (text.match(/\S+/g) || []).length;
    info = doc.type === 'board' ? `${doc.board.items.length} object${doc.board.items.length === 1 ? '' : 's'}` : `${words.toLocaleString()} words · ${text.length.toLocaleString()} characters`;
  }
  el.innerHTML = `
    <span id="save-state" class="save-state"></span>
    <span class="sep"></span><span>${info}</span>
    <span class="grow"></span>
    <span class="muted">${isApp ? 'Saved to Documents\\RedoxNotes' : 'Browser preview'}</span>
    <span class="sep"></span>
    <button class="sb-btn" data-zoom="-1" title="Smaller text (Ctrl+-)">A−</button>
    <span class="zoom">${Math.round((S.settings.fontSize / 15) * 100)}%</span>
    <button class="sb-btn" data-zoom="1" title="Larger text (Ctrl+=)">A+</button>
    <span class="sep"></span>
    <button class="sb-btn" data-act="toggleTheme" title="Toggle light/dark (Ctrl+Shift+L)">${isDark() ? icon('sun', 14) + ' Light' : icon('moon', 14) + ' Dark'}</button>`;
  setSave(S.saveState);
}

function zoom(dir) {
  S.settings.fontSize = dir === 0 ? 15 : Math.max(11, Math.min(26, S.settings.fontSize + dir));
  applyFont();
  saveSettings();
  renderStatus();
}

// ------------------------------------------------------------------ export
async function exportDoc(doc, kind) {
  try {
    if (kind === 'docx') {
      const bytes = doc.type === 'report' ? R.dailyDocx(doc) : noteToDocx(doc, S.settings.profile.name);
      const name = U.safeFileName(doc.type === 'report' ? `Daily Report ${doc.date}` : docTitle(doc)) + '.docx';
      const path = await Store.exportFile(name, 'Word document', 'docx', bytes);
      if (path) toast('Exported to Word', 'ok', isApp ? { label: 'Open', fn: () => Store.openPath(path) } : null);
    } else if (kind === 'print') {
      printHtml(doc.type === 'report' ? R.dailyHtml(doc) : `<div class="paper note-print"><h1>${U.escHtml(docTitle(doc))}</h1>${doc.html || ''}</div>`);
    } else if (kind === 'copy') {
      await copyText(doc.type === 'report' ? R.dailyText(doc) : noteToText(doc));
      toast('Copied — paste it into WhatsApp, email or Teams', 'ok');
    } else if (kind === 'txt') {
      const text = doc.type === 'report' ? R.dailyText(doc) : noteToText(doc);
      const path = await Store.exportFile(U.safeFileName(docTitle(doc)) + '.txt', 'Text file', 'txt', new TextEncoder().encode(text.replace(/\n/g, '\r\n')));
      if (path) toast('Saved text file', 'ok');
    } else if (kind === 'png' && S.editor instanceof Board) {
      const bytes = await S.editor.toPng();
      const path = await Store.exportFile(U.safeFileName(docTitle(doc)) + '.png', 'PNG image', 'png', bytes);
      if (path) toast('Exported image', 'ok', isApp ? { label: 'Open', fn: () => Store.openPath(path) } : null);
    }
  } catch (e) {
    console.error(e);
    toast('Export failed: ' + e, 'err');
  }
}

function printHtml(html) {
  const area = $('#print-area');
  area.innerHTML = html;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); area.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 1500); }, 50);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

// ------------------------------------------------------------------ menus, toasts, modals
function menu(items, anchor) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'menu';
  m.innerHTML = items.map((it, i) => (it === '-' ? '<div class="menu-sep"></div>' : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.icon ? icon(it.icon, 15) : ''}<span>${it.label}</span>${it.kbd ? `<kbd>${it.kbd}</kbd>` : ''}</button>`)).join('');
  document.body.appendChild(m);
  let x, y;
  if (anchor instanceof Element) { const r = anchor.getBoundingClientRect(); x = r.right - m.offsetWidth; y = r.bottom + 4; if (x < 8) x = r.left; } else { x = anchor.x; y = anchor.y; }
  x = Math.max(8, Math.min(x, innerWidth - m.offsetWidth - 8));
  if (y + m.offsetHeight > innerHeight - 8) y = Math.max(8, innerHeight - m.offsetHeight - 8);
  m.style.left = x + 'px';
  m.style.top = y + 'px';
  m.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    closeMenu();
    items[+b.dataset.i].fn();
  });
  setTimeout(() => document.addEventListener('pointerdown', outside), 0);
  function outside(e) { if (!m.contains(e.target)) closeMenu(); }
  m._outside = outside;
}
function closeMenu() {
  const m = $('.menu');
  if (m) { document.removeEventListener('pointerdown', m._outside); m.remove(); }
}

function itemMenu(doc, anchor) {
  if (!doc) return;
  if (doc.trashed) {
    menu([
      { label: 'Restore', icon: 'restore', fn: () => restoreDoc(doc) },
      { label: 'Open (read-only preview)', icon: 'file', fn: () => openTab(doc.id) },
      '-',
      { label: 'Delete forever', icon: 'trash', danger: true, fn: () => { if (confirm(`Permanently delete “${docTitle(doc)}”?`)) deleteForever(doc); } },
    ], anchor);
    return;
  }
  const items = [{ label: 'Open', icon: 'file', fn: () => openTab(doc.id) }];
  if (doc.type !== 'board') {
    items.push(
      { label: 'Export to Word (.docx)', icon: 'word', kbd: 'Ctrl+E', fn: () => exportDoc(doc, 'docx') },
      { label: 'Print / Save as PDF', icon: 'printer', kbd: 'Ctrl+P', fn: () => exportDoc(doc, 'print') },
      { label: 'Copy as text', icon: 'copy', fn: () => exportDoc(doc, 'copy') },
      { label: 'Save as .txt', icon: 'download', fn: () => exportDoc(doc, 'txt') },
    );
  } else items.push({ label: 'Export PNG', icon: 'image', fn: () => { openTab(doc.id); setTimeout(() => exportDoc(doc, 'png'), 80); } });
  items.push('-',
    { label: doc.pinned ? 'Unpin' : 'Pin to top', icon: 'pin', fn: () => { doc.pinned = !doc.pinned; touch(doc, { quiet: true }); renderList(); } },
    { label: 'Duplicate', icon: 'duplicate', fn: () => duplicate(doc) },
    '-',
    { label: 'Move to Trash', icon: 'trash', danger: true, kbd: 'Ctrl+Del', fn: () => trashDoc(doc) });
  menu(items, anchor);
}

function toast(msg, kind = 'info', action = null) {
  const root = $('#toasts');
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.innerHTML = `<span>${U.escHtml(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { action.fn(); t.remove(); };
    t.appendChild(b);
  }
  root.appendChild(t);
  setTimeout(() => t.classList.add('out'), action ? 6000 : 3200);
  setTimeout(() => t.remove(), action ? 6400 : 3600);
}

function modal(title, bodyHtml, { wide = false, onMount } = {}) {
  closeModal();
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="modal-head"><h2>${title}</h2><button class="icon-btn" data-close title="Close (Esc)">${icon('x', 17)}</button></div><div class="modal-body">${bodyHtml}</div></div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) closeModal(); });
  wrap.querySelector('[data-close]').addEventListener('click', closeModal);
  onMount?.(wrap.querySelector('.modal'));
  return wrap;
}
function closeModal() { $('.modal-wrap')?.remove(); }

// ------------------------------------------------------------------ settings
async function openSettings() {
  const p = S.settings.profile;
  const loc = await Store.dataLocation();
  modal('Settings', `
    <h3>Your report header</h3>
    <p class="muted small">These pre-fill every new daily report. You can still change them on any single report.</p>
    <div class="grid2">
      <label>Report title (company)<input data-p="company" value="${U.escHtml(p.company)}" placeholder="e.g. VTL DAILY REPORT"></label>
      <label>Subtitle<input data-p="subtitle" value="${U.escHtml(p.subtitle)}"></label>
      <label>Your name<input data-p="name" value="${U.escHtml(p.name)}" placeholder="e.g. Jacques Shamalla"></label>
      <label>Branch / Department<input data-p="branch" value="${U.escHtml(p.branch)}" placeholder="e.g. Kakamega Branch"></label>
      <label>Default shift<input data-p="shift" value="${U.escHtml(p.shift)}"></label>
      <label>Stats section title<input data-p="statsTitle" value="${U.escHtml(p.statsTitle)}"></label>
      <label>Metrics you track (one per line)<textarea data-pl="statLabels" rows="5">${U.escHtml(p.statLabels.join('\n'))}</textarea></label>
      <label>Your teams (one per line)<textarea data-pl="teams" rows="5" placeholder="e.g. Dennis&#10;Sylvester">${U.escHtml(p.teams.join('\n'))}</textarea></label>
    </div>
    <p class="muted small">New reports copy the metrics and teams from your previous report, so changes here mostly matter for your first report.</p>
    <h3>App</h3>
    <div class="grid2">
      <label>Theme<select data-s="theme"><option value="system">Follow Windows</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <label>Text size<select data-s="fontSize">${[12, 13, 14, 15, 16, 17, 18, 20, 22].map((n) => `<option value="${n}">${n}px</option>`).join('')}</select></label>
    </div>
    <label class="check"><input type="checkbox" data-s="openTodayOnStart"> Open today's report automatically when the app starts</label>
    <h3>Your data</h3>
    <p class="small">Everything is saved automatically as you type, to:<br><code>${U.escHtml(loc)}</code></p>
    <div class="row-btns">
      ${isApp ? `<button class="ghost sm" data-a="folder">${icon('folder', 15)} Open folder</button>` : ''}
      <button class="ghost sm" data-a="backup">${icon('download', 15)} Back up everything</button>
      <button class="ghost sm" data-a="import">${icon('upload', 15)} Restore from backup</button>
      <input type="file" accept=".json,application/json" hidden data-a-file>
    </div>
    <p class="muted small">Tip: put the folder above in OneDrive / Google Drive to sync between PCs.</p>
  `, {
    wide: true,
    onMount(m) {
      m.querySelectorAll('[data-p]').forEach((el) => el.addEventListener('input', () => { p[el.dataset.p] = el.value; saveSettings(); }));
      m.querySelectorAll('[data-pl]').forEach((el) => el.addEventListener('input', () => { p[el.dataset.pl] = el.value.split('\n').map((s) => s.trim()).filter(Boolean); saveSettings(); }));
      m.querySelectorAll('[data-s]').forEach((el) => {
        const k = el.dataset.s;
        if (el.type === 'checkbox') el.checked = !!S.settings[k]; else el.value = S.settings[k];
        el.addEventListener('change', () => {
          S.settings[k] = el.type === 'checkbox' ? el.checked : k === 'fontSize' ? +el.value : el.value;
          applyTheme(); applyFont(); syncThemeSwitch(); saveSettings(); renderStatus();
        });
      });
      m.querySelector('[data-a="folder"]')?.addEventListener('click', () => Store.openDataFolder());
      m.querySelector('[data-a="backup"]').addEventListener('click', backup);
      const file = m.querySelector('[data-a-file]');
      m.querySelector('[data-a="import"]').addEventListener('click', () => file.click());
      file.addEventListener('change', () => file.files[0] && restoreBackup(file.files[0]));
    },
  });
}

async function backup() {
  const data = { app: 'redox-notes', version: 1, exported: nowIso(), settings: S.settings, docs: [...S.docs.values()] };
  const path = await Store.exportFile(`RedoxNotes-backup-${U.todayKey()}.json`, 'Backup', 'json', new TextEncoder().encode(JSON.stringify(data)));
  if (path) toast('Backup saved', 'ok');
}

async function restoreBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.docs)) throw new Error('not a Redox Notes backup');
    let added = 0;
    for (const d of data.docs) {
      if (!d.id || !d.type) continue;
      const cur = S.docs.get(d.id);
      if (!cur || (d.updated || '') > (cur.updated || '')) { S.docs.set(d.id, d); S.dirty.add(d.id); added++; }
    }
    S.searchCache.clear();
    await flushDocs();
    renderList(); renderCalendar();
    toast(`Restored ${added} item${added === 1 ? '' : 's'}`, 'ok');
  } catch (e) { toast('Restore failed: ' + e.message, 'err'); }
}

function openShortcuts() {
  const rows = [
    ['Ctrl+D', "Open today's report"], ['Ctrl+N', 'New note'], ['Ctrl+Shift+N', 'New whiteboard'], ['Ctrl+R', 'Weekly / range report'],
    ['Ctrl+W', 'Close tab'], ['Ctrl+Tab', 'Next tab'], ['Ctrl+Shift+Tab', 'Previous tab'], ['Ctrl+F', 'Search everything'],
    ['Ctrl+S', 'Save now (it autosaves anyway)'], ['Ctrl+E', 'Export to Word'], ['Ctrl+P', 'Print / save as PDF'], ['Ctrl+Shift+C', 'Copy as text'],
    ['F5', 'Insert current time (and date in notes)'], ['Ctrl+Shift+L', 'Toggle dark / light'], ['Ctrl+\\', 'Show / hide sidebar'], ['Ctrl+= / Ctrl+-', 'Text bigger / smaller'],
    ['Ctrl+,', 'Settings'], ['Ctrl+Del', 'Move current item to Trash'],
    ['Tab / Shift+Tab', 'Indent / outdent a line (time log & lists)'], ['Ctrl+1 / 2 / 0', 'Heading 1 / 2 / normal (notes)'], ['Ctrl+Shift+9', 'Checklist (notes)'],
    ['V P H E L A R O T S', 'Whiteboard tools'], ['Space + drag', 'Pan the whiteboard'], ['Ctrl+scroll', 'Zoom the whiteboard'],
  ];
  modal('Keyboard shortcuts', `<div class="shortcuts">${rows.map(([k, v]) => `<div><kbd>${k}</kbd><span>${v}</span></div>`).join('')}</div>`, { wide: true });
}

// ------------------------------------------------------------------ range reports
function openRange() {
  const t = U.todayKey();
  const presets = {
    thisWeek: ['This week', U.weekStart(t), t, 'Weekly Report'],
    lastWeek: ['Last week', U.addDays(U.weekStart(t), -7), U.addDays(U.weekStart(t), -1), 'Weekly Report'],
    last7: ['Last 7 days', U.addDays(t, -6), t, 'Weekly Report'],
    thisMonth: ['This month', t.slice(0, 8) + '01', t, 'Monthly Report'],
    lastMonth: ['Last month', U.dateKey(new Date(U.parseKey(t).getFullYear(), U.parseKey(t).getMonth() - 1, 1)), U.dateKey(new Date(U.parseKey(t).getFullYear(), U.parseKey(t).getMonth(), 0)), 'Monthly Report'],
  };
  modal('Generate a report', `
    <p class="muted small">Combines your daily reports into one summary: totals for every metric, team performance, blockers and the full daily log.</p>
    <div class="chips">${Object.entries(presets).map(([k, [l]]) => `<button class="chip" data-preset="${k}">${l}</button>`).join('')}</div>
    <div class="grid3">
      <label>From<input type="date" data-r="from"></label>
      <label>To<input type="date" data-r="to"></label>
      <label>Title<input data-r="title"></label>
    </div>
    <label class="check"><input type="checkbox" data-r="details" checked> Include the full daily log for each day</label>
    <div class="range-info"></div>
    <div class="row-btns end">
      <button class="ghost" data-go="copy">${icon('copy', 15)} Copy summary</button>
      <button class="ghost" data-go="print">${icon('printer', 15)} PDF / Print</button>
      <button class="primary" data-go="docx">${icon('word', 15)} Export to Word</button>
    </div>`, {
    wide: true,
    onMount(m) {
      const f = (k) => m.querySelector(`[data-r="${k}"]`);
      const set = (k) => { const [, a, b, title] = presets[k]; f('from').value = a; f('to').value = b; f('title').value = title; m.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.preset === k)); upd(); };
      const pick = () => {
        const from = f('from').value, to = f('to').value;
        return liveDocs().filter((d) => d.type === 'report' && d.date >= from && d.date <= to).sort((a, b) => a.date.localeCompare(b.date));
      };
      const upd = () => {
        const reps = pick();
        m.querySelector('.range-info').innerHTML = reps.length
          ? `<b>${reps.length}</b> daily report${reps.length === 1 ? '' : 's'} found: ${reps.map((d) => U.escHtml(U.fmtDayMonth(d.date))).join(', ')}`
          : '<span class="warn">No daily reports in this period yet.</span>';
      };
      m.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => set(c.dataset.preset)));
      ['from', 'to'].forEach((k) => f(k).addEventListener('change', () => { m.querySelectorAll('.chip').forEach((c) => c.classList.remove('on')); upd(); }));
      set('thisWeek');
      m.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', async () => {
        const reps = pick();
        if (!reps.length) { toast('No daily reports in that period', 'err'); return; }
        const h = reps[reps.length - 1].report.header;
        const prof = { ...S.settings.profile };
        for (const k of ['company', 'name', 'branch']) if (!prof[k]) prof[k] = h[k] || '';
        const opts = { title: f('title').value || 'Work Report', from: f('from').value, to: f('to').value, profile: prof, details: f('details').checked };
        try {
          if (b.dataset.go === 'docx') {
            const path = await Store.exportFile(U.safeFileName(`${opts.title} ${opts.from} to ${opts.to}`) + '.docx', 'Word document', 'docx', R.rangeDocx(reps, opts));
            if (path) toast('Report exported to Word', 'ok', isApp ? { label: 'Open', fn: () => Store.openPath(path) } : null);
          } else if (b.dataset.go === 'print') { closeModal(); printHtml(R.rangeHtml(reps, opts)); }
          else { await copyText(R.rangeText(reps, opts)); toast('Summary copied', 'ok'); }
        } catch (e) { console.error(e); toast('Failed: ' + e, 'err'); }
      }));
    },
  });
}

// ------------------------------------------------------------------ actions & keys
const actions = {
  today: () => newReport(U.todayKey()),
  newNote,
  newBoard,
  range: openRange,
  settings: openSettings,
  shortcuts: openShortcuts,
  folder: () => (isApp ? Store.openDataFolder() : toast('Available in the desktop app')),
  collapse: () => toggleSidebar(),
  toggleTheme: () => { S.settings.theme = isDark() ? 'light' : 'dark'; applyTheme(); syncThemeSwitch(); saveSettings(); },
};

function toggleSidebar(force) {
  S.settings.sidebar = force ?? !S.settings.sidebar;
  document.body.classList.toggle('no-sidebar', !S.settings.sidebar);
  saveSettings();
  if (S.editor instanceof Board) setTimeout(() => S.editor.resize(), 0);
}

function onKey(e) {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  const doc = S.docs.get(S.active);
  if (e.key === 'Escape' && $('.modal-wrap')) { closeModal(); return; }
  if (e.key === 'Escape' && $('.menu')) { closeMenu(); return; }
  if (e.key === 'F5') {
    e.preventDefault();
    if (S.editor?.insertStamp) {
      const handled = S.editor instanceof NoteEditor ? (document.activeElement === S.editor.body ? (S.editor.insertStamp(), true) : false) : S.editor.insertStamp();
      if (handled) return;
    }
    const el = document.activeElement;
    if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
      el.setRangeText(`${U.fmtClock()} ${U.fmtShort(U.todayKey())}`, el.selectionStart, el.selectionEnd, 'end');
      el.dispatchEvent(new Event('input'));
    }
    return;
  }
  if (mod) {
    if (k === 'tab') { e.preventDefault(); cycleTab(e.shiftKey ? -1 : 1); return; }
    if (k === 'd' && !e.shiftKey) { e.preventDefault(); actions.today(); return; }
    if (k === 'n') { e.preventDefault(); e.shiftKey ? newBoard() : newNote(); return; }
    if (k === 'r' && !e.shiftKey) { e.preventDefault(); openRange(); return; }
    if (k === 'w') { e.preventDefault(); if (S.active) closeTab(S.active); return; }
    if (k === 'f') { e.preventDefault(); toggleSidebar(true); $('#search').focus(); $('#search').select(); return; }
    if (k === 's') { e.preventDefault(); flushDocs().then(() => toast('Saved', 'ok')); return; }
    if (k === 'e' && doc && doc.type !== 'board') { e.preventDefault(); exportDoc(doc, 'docx'); return; }
    if (k === 'p' && doc && doc.type !== 'board') { e.preventDefault(); exportDoc(doc, 'print'); return; }
    if (k === 'c' && e.shiftKey && doc && doc.type !== 'board') { e.preventDefault(); exportDoc(doc, 'copy'); return; }
    if (k === 'l' && e.shiftKey) { e.preventDefault(); actions.toggleTheme(); return; }
    if (k === '\\') { e.preventDefault(); toggleSidebar(); return; }
    if (k === ',') { e.preventDefault(); openSettings(); return; }
    if (k === '/') { e.preventDefault(); openShortcuts(); return; }
    if (k === '=' || k === '+') { e.preventDefault(); zoom(1); return; }
    if (k === '-') { e.preventDefault(); zoom(-1); return; }
    if (k === '0' && !(S.editor instanceof NoteEditor && document.activeElement === S.editor.body)) { e.preventDefault(); zoom(0); return; }
    if (k === 'delete' && doc && !doc.trashed) { e.preventDefault(); trashDoc(doc); return; }
  }
  if (S.editor instanceof Board && !$('.modal-wrap') && S.editor.onKey(e)) e.preventDefault();
}

function cycleTab(dir) {
  if (!S.tabs.length) return;
  const i = S.tabs.indexOf(S.active);
  activate(S.tabs[(i + dir + S.tabs.length) % S.tabs.length]);
}

function bindTabs() {
  const bar = $('#tabs');
  bar.addEventListener('click', (e) => {
    const x = e.target.closest('[data-close]');
    if (x) { e.stopPropagation(); closeTab(x.dataset.close); return; }
    const t = e.target.closest('.tab');
    if (t) activate(t.dataset.id);
  });
  bar.addEventListener('auxclick', (e) => { const t = e.target.closest('.tab'); if (t && e.button === 1) closeTab(t.dataset.id); });
  bar.addEventListener('contextmenu', (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;
    e.preventDefault();
    const id = t.dataset.id;
    menu([
      { label: 'Close', icon: 'x', fn: () => closeTab(id) },
      { label: 'Close others', fn: () => { S.tabs = [id]; activate(id); persistTabs(); } },
      { label: 'Close all', fn: () => { S.tabs = []; S.active = null; S.editor?.destroy?.(); S.editor = null; renderTabs(); renderEditor(); persistTabs(); } },
    ], { x: e.clientX, y: e.clientY });
  });
  let dragId = null;
  bar.addEventListener('dragstart', (e) => { dragId = e.target.closest('.tab')?.dataset.id; });
  bar.addEventListener('dragover', (e) => e.preventDefault());
  bar.addEventListener('drop', (e) => {
    e.preventDefault();
    const over = e.target.closest('.tab')?.dataset.id;
    if (!dragId || !over || dragId === over) return;
    S.tabs.splice(S.tabs.indexOf(dragId), 1);
    S.tabs.splice(S.tabs.indexOf(over) + (e.offsetX > e.target.closest('.tab').offsetWidth / 2 ? 1 : 0), 0, dragId);
    renderTabs();
    persistTabs();
  });
  $('#new-tab').addEventListener('click', (e) => menu([
    { label: "Today's report", icon: 'report', kbd: 'Ctrl+D', fn: actions.today },
    { label: 'Report for another day…', icon: 'calendar', fn: pickDateReport },
    { label: 'Note', icon: 'note', kbd: 'Ctrl+N', fn: newNote },
    { label: 'Whiteboard', icon: 'board', kbd: 'Ctrl+Shift+N', fn: newBoard },
  ], e.currentTarget));
  $('#show-sidebar').addEventListener('click', () => toggleSidebar(true));
}

function pickDateReport() {
  modal('Report for another day', `<label>Date<input type="date" data-d value="${U.addDays(U.todayKey(), -1)}"></label><div class="row-btns end"><button class="primary" data-ok>Open report</button></div>`, {
    onMount(m) {
      const go = () => { const v = m.querySelector('[data-d]').value; if (v) { closeModal(); newReport(v); } };
      m.querySelector('[data-ok]').addEventListener('click', go);
      m.querySelector('[data-d]').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    },
  });
}

// ------------------------------------------------------------------ boot
async function boot() {
  try {
    const saved = await Store.loadSettings();
    if (saved) S.settings = { ...structuredClone(DEFAULT_SETTINGS), ...saved, profile: { ...DEFAULT_SETTINGS.profile, ...(saved.profile || {}) } };
  } catch (e) { console.warn(e); }
  applyTheme();
  applyFont();
  document.body.classList.toggle('no-sidebar', !S.settings.sidebar);
  renderSidebarShell();
  bindTabs();
  document.addEventListener('keydown', onKey);

  try {
    for (const d of await Store.loadAll()) if (d && d.id && d.type) S.docs.set(d.id, d);
  } catch (e) { toast('Could not load your notes: ' + e, 'err'); }

  // purge trash older than 30 days
  const cutoff = Date.now() - 30 * 86400000;
  for (const d of [...S.docs.values()]) if (d.trashed && d.trashedAt && new Date(d.trashedAt).getTime() < cutoff) { S.docs.delete(d.id); S.dirty.add(d.id); }

  S.tabs = (S.settings.openTabs || []).filter((id) => S.docs.has(id) && !S.docs.get(id).trashed);
  renderList();
  renderCalendar();
  if (S.settings.openTodayOnStart) newReport(U.todayKey());
  else if (S.settings.activeId && S.tabs.includes(S.settings.activeId)) activate(S.settings.activeId);
  else if (S.tabs.length) activate(S.tabs[S.tabs.length - 1]);
  else renderEditor();
  renderStatus();
  setSave('saved');
  if (S.dirty.size) saveSoon();

  onAppClose(async () => { await flushDocs(); await Store.saveSettings(S.settings); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushDocs(); });

  // Roll over at midnight: refresh "today" in the sidebar
  let day = U.todayKey();
  setInterval(() => {
    if (U.todayKey() !== day) {
      day = U.todayKey();
      const sub = $('.today-btn small');
      if (sub) sub.textContent = U.fmtLong(day);
      S.calMonth = new Date();
      renderList();
      renderCalendar();
    }
  }, 60000);
  document.body.classList.add('ready');
}

boot();

// expose for debugging in dev tools
window.redox = { S, actions };
