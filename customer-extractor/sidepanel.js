/* global scrapeCustomers, stopScrape, chrome */
const $ = (id) => document.getElementById(id);
const ALL = '__all__';

const state = {
  rows: [],
  meta: null,
  sort: { key: 'expiry', dir: 'asc' },
  prefs: { v: 2, phoneFmt: 'local', incName: false, dateOnly: true },
  sel: { status: null, online: null, package: ALL },
  tabId: null,
};

// ---------- helpers ----------
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// "Sep 28, 2026, 08:38 AM" -> timestamp (NaN if unknown)
function parseExpiry(s) {
  const m = (s || '').match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?)?/);
  if (m && MONTHS[m[1].toLowerCase()] !== undefined) {
    let h = m[4] ? parseInt(m[4], 10) : 0;
    const ap = (m[6] || '').toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return new Date(+m[3], MONTHS[m[1].toLowerCase()], +m[2], h, m[5] ? +m[5] : 0).getTime();
  }
  const t = Date.parse(s);
  return isNaN(t) ? NaN : t;
}

function expiryText(s) {
  if (!state.prefs.dateOnly) return s;
  const m = (s || '').match(/^([A-Za-z]{3,}\.?\s+\d{1,2},?\s+\d{4})/);
  return m ? m[1] : s;
}

// Kenyan numbers come in as 2547XXXXXXXX. Show them as 0722 731 904 by default:
// easy to read and dial, and the spaces stop Excel dropping the leading 0.
function phoneText(p) {
  const d = (p || '').replace(/\D/g, '');
  if (!d) return p || '';
  let local = null; // 9 digits after the country code, e.g. 722731904
  if (d.startsWith('254') && d.length === 12) local = d.slice(3);
  else if (d.startsWith('0') && d.length === 10) local = d.slice(1);
  else if (d.length === 9 && /^[17]/.test(d)) local = d;
  if (!local) return p;
  const spaced = (x) => x.slice(0, 3) + ' ' + x.slice(3, 6) + ' ' + x.slice(6);
  switch (state.prefs.phoneFmt) {
    case 'localPlain': return '0' + local;
    case 'plus': return '+254 ' + spaced(local);
    case 'raw': return p;
    default: return '0' + spaced(local); // 'local'
  }
}

// Natural compare so VTL000019 < VTL000083 and "8Mbps" < "16Mbps"
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compare(a, b, key) {
  if (key === 'expiry') {
    const x = a._exp, y = b._exp;
    if (isNaN(x) && isNaN(y)) return 0;
    if (isNaN(x)) return 1;
    if (isNaN(y)) return -1;
    return x - y;
  }
  if (key === 'phone') return collator.compare(a.phone.replace(/\D/g, ''), b.phone.replace(/\D/g, ''));
  return collator.compare(a[key] || '', b[key] || '');
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 1600);
}

function setStatus(msg, kind) {
  const s = $('status');
  s.textContent = msg || '';
  s.className = 'status' + (kind ? ' ' + kind : '');
}

// ---------- view ----------
function visibleRows() {
  const q = $('search').value.trim().toLowerCase();
  const qDigits = q.replace(/[\s+-]/g, '');
  const phoneHit = (r) => {
    if (!/^\d{3,}$/.test(qDigits)) return false;
    const d = r.phone.replace(/\D/g, '');
    const last9 = d.slice(-9);
    return d.includes(qDigits) || ('0' + last9).includes(qDigits) || ('254' + last9).includes(qDigits);
  };
  const { status, online, package: pkg } = state.sel;
  let rows = state.rows.filter((r) =>
    (status === ALL || r.status === status) &&
    (online === ALL || r.online === online) &&
    (pkg === ALL || r.package === pkg) &&
    (!q || phoneHit(r) || [r.username, r.name, r.phone, phoneText(r.phone), r.package, r.expiry].join(' ').toLowerCase().includes(q))
  );
  const { key, dir } = state.sort;
  const mul = dir === 'asc' ? 1 : -1;
  rows = rows.slice().sort((a, b) => {
    let c = compare(a, b, key);
    // Rows with no readable expiry stay at the bottom in both directions.
    if (!(key === 'expiry' && isNaN(a._exp) !== isNaN(b._exp))) c *= mul;
    return c || collator.compare(a.username, b.username);
  });
  return rows;
}

function fillSelect(sel, values, current, allLabel) {
  sel.innerHTML = '';
  const add = (v, label) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = label;
    sel.appendChild(o);
  };
  add(ALL, allLabel);
  values.forEach((v) => add(v, v || '(blank)'));
  sel.value = values.includes(current) || current === ALL ? current : ALL;
  return sel.value;
}

function countBy(field) {
  const m = new Map();
  state.rows.forEach((r) => m.set(r[field], (m.get(r[field]) || 0) + 1));
  return [...m.keys()].sort(collator.compare);
}

function refreshFilters() {
  const statuses = countBy('status');
  const onlines = countBy('online');
  // Default to the page's own filters (Expired / No internet) when those values exist.
  const pageF = (state.meta && state.meta.filters) || {};
  if (state.sel.status === null) state.sel.status = statuses.includes(pageF.Status) ? pageF.Status : (statuses.includes('Expired') ? 'Expired' : ALL);
  if (state.sel.online === null) state.sel.online = onlines.includes(pageF.Connection) ? pageF.Connection : (onlines.includes('No internet') ? 'No internet' : ALL);
  state.sel.status = fillSelect($('fStatus'), statuses, state.sel.status, 'All statuses');
  state.sel.online = fillSelect($('fOnline'), onlines, state.sel.online, 'All connections');
  state.sel.package = fillSelect($('fPackage'), countBy('package'), state.sel.package, 'All packages');
}

function render() {
  const has = state.rows.length > 0;
  $('controls').hidden = !has;
  $('tbl').hidden = !has;
  document.body.classList.toggle('show-name', state.prefs.incName);

  document.querySelectorAll('#tbl th[data-key]').forEach((th) => {
    th.dataset.dir = th.dataset.key === state.sort.key ? state.sort.dir : '';
  });

  const rows = visibleRows();
  const tb = document.querySelector('#tbl tbody');
  tb.innerHTML = '';
  const frag = document.createDocumentFragment();
  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    const cell = (text, cls) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (cls) td.className = cls;
      tr.appendChild(td);
    };
    cell(String(i + 1), 'num');
    cell(r.username, 'user');
    cell(r.name, 'col-name');
    cell(phoneText(r.phone), 'phone');
    cell(r.package);
    cell(expiryText(r.expiry), 'exp');
    frag.appendChild(tr);
  });
  tb.appendChild(frag);

  $('count').textContent = has ? `Showing ${rows.length} of ${state.rows.length} collected` : '';

  const f = $('filters');
  f.innerHTML = '';
  if (state.meta && state.meta.filters) {
    Object.entries(state.meta.filters).forEach(([k, v]) => {
      const c = document.createElement('span');
      c.className = 'chip';
      c.append(k + ': ');
      const b = document.createElement('b');
      b.textContent = v;
      c.appendChild(b);
      f.appendChild(c);
    });
  }
}

// ---------- export ----------
function columns() {
  const cols = [
    ['Username', (r) => r.username],
    ['Phone', (r) => phoneText(r.phone)],
    ['Package', (r) => r.package],
    ['Expiry', (r) => expiryText(r.expiry)],
  ];
  if (state.prefs.incName) cols.splice(1, 0, ['Name', (r) => r.name]);
  return cols;
}

function title() {
  const parts = [];
  if (state.sel.status !== ALL) parts.push(state.sel.status);
  if (state.sel.online !== ALL) parts.push(state.sel.online);
  if (state.sel.package !== ALL) parts.push(state.sel.package);
  const d = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return (parts.length ? parts.join(' – ') : 'Customers') + ` (${visibleRows().length}) – ${d}`;
}

function asText() {
  const rows = visibleRows();
  const cols = columns();
  const lines = [title(), ''];
  rows.forEach((r, i) => lines.push(`${i + 1}. ` + cols.map(([, f]) => f(r) || '-').join(' | ')));
  return lines.join('\n');
}

function asDelimited(sep) {
  const cols = columns();
  const esc = (v) => {
    v = v == null ? '' : String(v);
    if (sep === '\t') return v.replace(/[\t\r\n]+/g, ' ');
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  const out = [['#', ...cols.map(([h]) => h)].map(esc).join(sep)];
  visibleRows().forEach((r, i) => out.push([i + 1, ...cols.map(([, f]) => f(r))].map(esc).join(sep)));
  return out.join('\r\n');
}

async function copy(text, msg) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(msg);
}

function download() {
  const blob = new Blob(['﻿' + asDelimited(',')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = title().split(' (')[0].replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  a.href = URL.createObjectURL(blob);
  a.download = `${slug || 'customers'}-${stamp}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('CSV downloaded');
}

// ---------- scanning ----------
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function busy(on) {
  $('scanAll').disabled = on;
  $('scanOne').disabled = on;
  $('stop').hidden = !on;
}

async function scan(allPages) {
  const tab = await activeTab();
  if (!tab || !tab.id) return setStatus('No active tab.', 'err');
  state.tabId = tab.id;
  busy(true);
  setStatus(allPages ? 'Scanning… page 1' : 'Reading this page…');
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeCustomers,
      args: [{ allPages, fromFirstPage: true }],
    });
    const r = res && res.result;
    if (!r || !r.ok) {
      setStatus((r && r.error) || 'Could not read the page.', 'err');
      return;
    }
    state.rows = r.rows.map((x) => Object.assign(x, { _exp: parseExpiry(x.expiry) }));
    state.meta = r.meta;
    state.sel = { status: null, online: null, package: ALL };
    refreshFilters();
    render();

    const lines = [`Collected ${r.rows.length} customers from ${r.pages} page${r.pages === 1 ? '' : 's'}.`];
    let kind = 'ok';
    if (allPages && r.meta.expectedTotal != null) {
      if (r.meta.expectedTotal === r.rows.length) lines[0] += ` Matches the page total (${r.meta.expectedTotal}) ✓`;
      else { lines.push(`The page header says ${r.meta.expectedTotal} total. Check the filters, or scan again.`); kind = 'warn'; }
    }
    if (r.meta.missingColumns.length) { lines.push('Columns not visible on the page: ' + r.meta.missingColumns.join(', ') + '. Turn them on in the table ⚙ preferences.'); kind = 'warn'; }
    if (r.warnings.length) { lines.push(...r.warnings); kind = 'warn'; }
    setStatus(lines.join('\n'), kind);
    save();
  } catch (e) {
    setStatus('Error: ' + (e && e.message ? e.message : e), 'err');
  } finally {
    busy(false);
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'ce-progress' && sender.tab && sender.tab.id === state.tabId) {
    const of = msg.expectedTotal != null ? ` of ~${msg.expectedTotal}` : '';
    setStatus(`Scanning… page ${msg.page} (${msg.count}${of} customers so far)`);
  }
});

// ---------- persistence ----------
function save() {
  chrome.storage.local.set({ ceData: { rows: state.rows, meta: state.meta }, cePrefs: state.prefs, ceSort: state.sort }).catch(() => {});
}

async function load() {
  try {
    const d = await chrome.storage.local.get(['ceData', 'cePrefs', 'ceSort']);
    if (d.cePrefs && d.cePrefs.v === 2) Object.assign(state.prefs, d.cePrefs);
    else if (d.cePrefs) Object.assign(state.prefs, d.cePrefs, { v: 2, phoneFmt: 'local' });
    if (d.ceSort) state.sort = d.ceSort;
    if (d.ceData && d.ceData.rows) {
      state.rows = d.ceData.rows.map((x) => Object.assign(x, { _exp: parseExpiry(x.expiry) }));
      state.meta = d.ceData.meta;
      const when = state.meta && state.meta.scrapedAt ? new Date(state.meta.scrapedAt).toLocaleString() : '';
      setStatus(`Last scan: ${state.rows.length} customers${when ? ' · ' + when : ''}. Scan again for fresh data.`);
    }
  } catch (e) { /* first run */ }
  $('phoneFmt').value = state.prefs.phoneFmt;
  $('incName').checked = state.prefs.incName;
  $('dateOnly').checked = state.prefs.dateOnly;
  refreshFilters();
  render();
}

// ---------- events ----------
$('scanAll').onclick = () => scan(true);
$('scanOne').onclick = () => scan(false);
$('stop').onclick = async () => {
  if (state.tabId) await chrome.scripting.executeScript({ target: { tabId: state.tabId }, func: stopScrape }).catch(() => {});
  setStatus('Stopping…');
};
$('fStatus').onchange = (e) => { state.sel.status = e.target.value; render(); };
$('fOnline').onchange = (e) => { state.sel.online = e.target.value; render(); };
$('fPackage').onchange = (e) => { state.sel.package = e.target.value; render(); };
$('search').oninput = render;
$('phoneFmt').onchange = (e) => { state.prefs.phoneFmt = e.target.value; save(); render(); };
$('incName').onchange = (e) => { state.prefs.incName = e.target.checked; save(); render(); };
$('dateOnly').onchange = (e) => { state.prefs.dateOnly = e.target.checked; save(); render(); };
$('copyText').onclick = () => copy(asText(), 'List copied – paste in WhatsApp/email');
$('copyTsv').onclick = () => copy(asDelimited('\t'), 'Copied – paste into Excel/Sheets');
$('csv').onclick = download;
document.querySelectorAll('#tbl th[data-key]').forEach((th) => {
  th.onclick = () => {
    const k = th.dataset.key;
    state.sort = state.sort.key === k ? { key: k, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' };
    save();
    render();
  };
});

load();
