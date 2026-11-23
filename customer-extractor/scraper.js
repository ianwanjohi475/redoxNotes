/*
 * Runs INSIDE the CRM tab (injected by the sidebar with chrome.scripting).
 * Must stay self-contained: no references to anything outside this function.
 *
 * Columns are found by their header id (data-focus-id="header-username", ...)
 * with the header text as a fallback, never by position. Hidden or reordered
 * columns therefore can't shift values into the wrong field.
 */
async function scrapeCustomers(opts) {
  opts = Object.assign({ allPages: true, fromFirstPage: true, pageTimeoutMs: 20000 }, opts || {});
  window.__ceStop = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const report = (data) => {
    try { chrome.runtime.sendMessage(Object.assign({ type: 'ce-progress' }, data)); } catch (e) { /* panel closed */ }
  };

  // field -> [header id, accepted header texts]
  const FIELDS = {
    username: ['username', ['username', 'user name']],
    name: ['name', ['name', 'customer name', 'full name']],
    phone: ['phone', ['phone number', 'phone', 'mobile', 'mobile number']],
    package: ['package', ['package', 'plan', 'current plan']],
    status: ['status', ['status']],
    online: ['online', ['online', 'connection']],
    uptime: ['uptime', ['uptime']],
    expiry: ['expiry', ['expiry', 'expiry date', 'expires']],
    created: ['created', ['created at', 'created']],
  };

  function findTable() {
    const th = document.querySelector('th[data-focus-id="header-username"]');
    if (th) return th.closest('table');
    for (const t of document.querySelectorAll('table')) {
      const heads = [...t.querySelectorAll('thead th')].map((h) => clean(h.textContent).toLowerCase());
      if (heads.includes('username')) return t;
    }
    return null;
  }

  function columnMap(table) {
    const headRow = table.querySelector('thead tr');
    const map = {};
    if (!headRow) return map;
    [...headRow.children].forEach((th, i) => {
      const fid = (th.getAttribute('data-focus-id') || '').replace(/^header-/, '').toLowerCase();
      const txt = clean(th.textContent).toLowerCase();
      for (const [field, [id, texts]] of Object.entries(FIELDS)) {
        if (map[field] !== undefined) continue;
        if (fid === id) { map[field] = i; return; }
      }
      for (const [field, [, texts]] of Object.entries(FIELDS)) {
        if (map[field] === undefined && texts.includes(txt)) { map[field] = i; return; }
      }
    });
    return map;
  }

  function findPagination(table) {
    let el = table;
    while (el && el !== document.body) {
      const next = el.querySelector('button[aria-label="Next page"]');
      if (next) return next.closest('ul') || el;
      el = el.parentElement;
    }
    const next = document.querySelector('button[aria-label="Next page"]');
    return next ? next.closest('ul') : null;
  }

  function currentPage(pag) {
    const b = pag && pag.querySelector('button[aria-current="true"]');
    return b ? clean(b.textContent) : '1';
  }

  function isDisabled(btn) {
    return !btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true';
  }

  function readRows(table, map) {
    const out = [];
    for (const tr of table.querySelectorAll('tbody tr')) {
      const cells = tr.children;
      const get = (f) => (map[f] !== undefined && cells[map[f]] ? clean(cells[map[f]].innerText || cells[map[f]].textContent) : '');
      const username = get('username');
      if (!username) continue; // empty / loading / "No customers" row
      out.push({
        username,
        name: get('name'),
        phone: get('phone'),
        package: get('package'),
        status: get('status'),
        online: get('online'),
        uptime: get('uptime'),
        expiry: get('expiry'),
        created: get('created'),
      });
    }
    return out;
  }

  function signature(table, pag) {
    const first = table.querySelector('tbody tr');
    return currentPage(pag) + '|' + (first ? clean(first.textContent).slice(0, 120) : '') + '|' + table.querySelectorAll('tbody tr').length;
  }

  // Wait for the table to show different content from `before`, then a short settle.
  async function waitForChange(before) {
    const t0 = Date.now();
    while (Date.now() - t0 < opts.pageTimeoutMs) {
      if (window.__ceStop) return false;
      await sleep(150);
      const table = findTable();
      if (!table) continue;
      const pag = findPagination(table);
      const sig = signature(table, pag);
      const map = columnMap(table);
      if (sig !== before && readRows(table, map).length > 0) {
        await sleep(250);
        const t2 = findTable();
        if (t2 && signature(t2, findPagination(t2)) === signature(table, pag)) return true;
      }
    }
    return false;
  }

  function readFilters() {
    const filters = {};
    for (const label of document.querySelectorAll('label[for]')) {
      const name = clean(label.textContent);
      const target = document.getElementById(label.getAttribute('for'));
      if (!name || !target || target.tagName !== 'BUTTON') continue;
      filters[name] = clean(target.textContent);
    }
    const search = document.querySelector('input[type="search"]');
    if (search && search.value) filters.Search = search.value;
    return filters;
  }

  function readTotal() {
    for (const h of document.querySelectorAll('h1, h2, h3')) {
      const m = clean(h.textContent).match(/\(([\d,]+)\s*(?:total)?\)/i);
      if (m) return parseInt(m[1].replace(/,/g, ''), 10);
    }
    return null;
  }

  let table = findTable();
  if (!table) return { ok: false, error: 'No Customers table found on this page. Open CRM → Customers first.' };

  const map = columnMap(table);
  const missing = ['username', 'phone', 'package', 'expiry'].filter((f) => map[f] === undefined);
  const meta = {
    url: location.href,
    filters: readFilters(),
    expectedTotal: readTotal(),
    missingColumns: missing,
    scrapedAt: new Date().toISOString(),
  };

  let pag = findPagination(table);
  const warnings = [];

  if (opts.allPages && opts.fromFirstPage && pag && currentPage(pag) !== '1') {
    const p1 = pag.querySelector('button[aria-label="Page 1"]');
    if (p1) {
      const before = signature(table, pag);
      p1.click();
      if (!(await waitForChange(before))) warnings.push('Could not jump back to page 1; started from the current page.');
      table = findTable();
      pag = findPagination(table);
    }
  }

  const byUser = new Map();
  let pages = 0;
  const seenPages = new Set();

  for (let guard = 0; guard < 1000; guard++) {
    if (window.__ceStop) { warnings.push('Stopped by you before the last page.'); break; }
    table = findTable();
    if (!table) { warnings.push('The table disappeared while scanning.'); break; }
    pag = findPagination(table);
    const page = currentPage(pag);
    if (seenPages.has(page)) break;
    seenPages.add(page);

    const m = columnMap(table);
    for (const row of readRows(table, m)) byUser.set(row.username, row);
    pages++;
    report({ page, pages, count: byUser.size, expectedTotal: meta.expectedTotal });

    if (!opts.allPages) break;
    const next = pag && pag.querySelector('button[aria-label="Next page"]');
    if (isDisabled(next)) break;
    const before = signature(table, pag);
    next.click();
    if (!(await waitForChange(before))) {
      if (!window.__ceStop) warnings.push('Page ' + (Number(page) + 1) + ' did not load in time; the list may be incomplete.');
      else warnings.push('Stopped by you before the last page.');
      break;
    }
  }

  return { ok: true, rows: [...byUser.values()], pages, meta, warnings };
}

function stopScrape() { window.__ceStop = true; }
