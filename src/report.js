// Daily report model + generators (Word, print/PDF HTML, plain text, range summaries).
import { Docx } from './docx.js';
import { escHtml, fmtLong, fmtReportTime, fmtShort, ordinal, parseKey, MONTHS, uid } from './util.js';

export function emptyReport(profile, prev) {
  const p = prev?.report;
  const ph = p?.header || {};
  const pick = (k, fallback = '') => ph[k] || profile[k] || fallback;
  return {
    header: {
      company: pick('company'),
      subtitle: pick('subtitle', 'DAILY WORK REPORT'),
      name: pick('name'),
      branch: pick('branch'),
      shift: pick('shift'),
    },
    blocks: [],
    statsTitle: p?.statsTitle || profile.statsTitle || 'FIELD OPERATIONS AND INSTALLATION',
    statsNote: '',
    stats: (p ? p.stats.map((s) => s.label) : profile.statLabels || []).map((label) => ({ id: uid(), label, value: '' })),
    teams: (p ? p.teams.map((t) => t.name) : profile.teams || []).map((name) => ({ id: uid(), name, assigned: '', completed: '', notes: '' })),
    blockers: '',
    nextPlan: '',
    submittedBy: p?.submittedBy || profile.name || ph.name || '',
    carried: p?.nextPlan || '',
  };
}

export function reportTitle(doc) {
  return `Daily Report · ${fmtShort(doc.date)}`;
}

/**
 * Turn the free-typed lines of a block into structured items.
 *  - "  text", "\ttext", "- text", "• text" → sub point (level 1)
 *  - "1. text" / "1) text"                  → numbered sub point
 *  - "LABEL - text" (label in CAPS)         → bold label
 */
export function parseLines(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    if (!raw.trim()) continue;
    let level = 0;
    let kind = 'bullet';
    let line = raw;
    if (/^(\s{2,}|\t)/.test(line)) level = 1;
    line = line.trim();
    let m;
    if ((m = line.match(/^[-–•*]\s+(.*)$/))) { level = 1; line = m[1]; kind = 'dash'; }
    else if ((m = line.match(/^(\d+)[.)]\s+(.*)$/))) { level = 1; kind = 'number'; line = m[2]; }
    else if (level === 1) kind = 'dash';
    let label = '';
    const lm = line.match(/^([A-Z0-9][A-Z0-9 &/'’().,-]{2,}?)\s+[-–:]\s+(.+)$/);
    if (lm && lm[1] === lm[1].toUpperCase() && /[A-Z]/.test(lm[1])) { label = lm[1].trim(); line = lm[2]; }
    out.push({ level, kind, label, text: line });
  }
  return out;
}

const filled = (s) => String(s ?? '').trim() !== '';
const nonEmptyLines = (t) => String(t || '').split('\n').map((l) => l.trim().replace(/^[-–•*]\s+/, '')).filter(Boolean);
const num = (v) => {
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

export function blockRange(b) {
  if (!b.start && !b.end) return '';
  if (!b.end) return `${fmtReportTime(b.start)}`;
  return `${fmtReportTime(b.start)} TO ${fmtReportTime(b.end)}`;
}

function dateParts(k) {
  const d = parseKey(k);
  return { day: d.getDate(), ord: ordinal(d.getDate()).toUpperCase(), mon: MONTHS[d.getMonth()].slice(0, 3).toUpperCase(), year: d.getFullYear() };
}

function teamRate(t) {
  const a = num(t.assigned);
  const c = num(t.completed);
  if (!a || c == null) return '';
  return `${Math.round((c / a) * 100)}%`;
}

const hasStats = (r) => r.stats.some((s) => filled(s.value));
const hasTeams = (r) => r.teams.some((t) => filled(t.assigned) || filled(t.completed) || filled(t.notes));

// ---------------------------------------------------------------- Word: daily

function writeItems(dx, items) {
  let numId = null;
  for (const it of items) {
    const runs = it.label ? [{ text: it.label, b: true }, { text: ' - ' + it.text }] : [{ text: it.text }];
    if (it.kind === 'number') {
      if (!numId) numId = dx.newNum('decimal');
      dx.item(runs, 'decimal', 1, numId);
      continue;
    }
    numId = null;
    if (it.level === 1) dx.item(runs, 'bullet', 1);
    else dx.item(runs, 'bullet', 0);
  }
}

function writeDailyBody(dx, doc, { compact = false } = {}) {
  const r = doc.report;
  for (const b of r.blocks) {
    const items = parseLines(b.text);
    if (!items.length && !filled(b.title)) continue;
    const range = blockRange(b);
    if (range) dx.p([{ text: range.toUpperCase(), b: true }], { keepNext: true, before: compact ? 80 : 160, after: 40 });
    if (filled(b.title)) dx.p([{ text: b.title.toUpperCase(), b: !range }], { keepNext: true, after: 40 });
    writeItems(dx, items);
  }

  if (hasStats(r) || hasTeams(r) || filled(r.statsNote)) {
    dx.p([{ text: (r.statsTitle || 'FIELD OPERATIONS').toUpperCase(), b: true }], { keepNext: true, before: 200, after: 40 });
    if (filled(r.statsNote)) dx.p(r.statsNote, { after: 40 });
    for (const s of r.stats) {
      if (!filled(s.label) && !filled(s.value)) continue;
      dx.item([{ text: s.label.toUpperCase() }, { text: '\t' + (filled(s.value) ? s.value : 'None'), b: true }], 'diamond', 0, null, { tabs: [5200] });
    }
    const teams = r.teams.filter((t) => filled(t.name) || filled(t.assigned));
    if (teams.length && hasTeams(r)) {
      dx.item([{ text: 'TEAM DEPLOYMENT', b: true }], 'diamond', 0);
      dx.table([
        ['Team', 'Assigned', 'Completed', 'Rate', 'Notes'],
        ...teams.map((t) => [t.name, t.assigned, t.completed, teamRate(t), t.notes]),
      ], { widths: [0.24, 0.13, 0.15, 0.1, 0.38], align: [null, 'center', 'center', 'center', null] });
    }
  }

  const blockers = nonEmptyLines(r.blockers);
  if (blockers.length) {
    dx.p([{ text: 'BLOCKERS', b: true }], { keepNext: true, before: 200, after: 40 });
    blockers.forEach((l) => dx.item(l, 'dash', 0));
  }
  if (filled(r.nextPlan)) {
    dx.p([{ text: "NEXT DAY'S PLAN", b: true }], { keepNext: true, before: 200, after: 40 });
    const lines = nonEmptyLines(r.nextPlan);
    if (lines.length > 1) lines.forEach((l) => dx.item(l, 'arrow', 0));
    else dx.p(lines[0] || '');
  }
}

export function dailyDocx(doc) {
  const r = doc.report;
  const h = r.header;
  const dx = new Docx({ title: reportTitle(doc), author: h.name });
  if (filled(h.company)) dx.p([{ text: h.company.toUpperCase(), b: true, size: 13 }], { align: 'center', after: 240 });
  const { day, ord, mon, year } = dateParts(doc.date);
  const lines = [
    [{ text: (h.subtitle || 'DAILY WORK REPORT').toUpperCase() }],
    [{ text: String(day) }, { text: ord, sup: true }, { text: ` ${mon} ${year}` }],
  ];
  if (filled(h.name)) lines.push([{ text: h.name.toUpperCase() }]);
  if (filled(h.branch)) lines.push([{ text: h.branch.toUpperCase() }]);
  if (filled(h.shift)) lines.push([{ text: `SHIFT ${h.shift.toUpperCase()}` }]);
  lines.forEach((l, i) => dx.p(l, { after: i === lines.length - 1 ? 200 : 0 }));
  writeDailyBody(dx, doc);
  const by = r.submittedBy || h.name;
  if (filled(by)) dx.p([{ text: `SUBMITTED BY | ${by.toUpperCase()}`, b: true }], { before: 360 });
  return dx.build();
}

// ---------------------------------------------------------------- text

export function dailyText(doc) {
  const r = doc.report;
  const h = r.header;
  const { day, ord, mon, year } = dateParts(doc.date);
  const out = [];
  if (filled(h.company)) out.push(h.company.toUpperCase(), '');
  out.push((h.subtitle || 'DAILY WORK REPORT').toUpperCase(), `${day}${ord} ${mon} ${year}`);
  if (filled(h.name)) out.push(h.name.toUpperCase());
  if (filled(h.branch)) out.push(h.branch.toUpperCase());
  if (filled(h.shift)) out.push(`SHIFT ${h.shift.toUpperCase()}`);
  for (const b of r.blocks) {
    const items = parseLines(b.text);
    if (!items.length && !filled(b.title)) continue;
    out.push('');
    const range = blockRange(b);
    if (range) out.push(`*${range}*`);
    if (filled(b.title)) out.push(b.title.toUpperCase());
    let n = 0;
    for (const it of items) {
      const t = it.label ? `${it.label} - ${it.text}` : it.text;
      if (it.kind === 'number') out.push(`    ${++n}. ${t}`);
      else { n = 0; out.push(it.level ? `    - ${t}` : `• ${t}`); }
    }
  }
  if (hasStats(r) || hasTeams(r)) {
    out.push('', `*${(r.statsTitle || 'FIELD OPERATIONS').toUpperCase()}*`);
    if (filled(r.statsNote)) out.push(r.statsNote);
    r.stats.filter((s) => filled(s.label)).forEach((s) => out.push(`◆ ${s.label.toUpperCase()}: ${filled(s.value) ? s.value : 'None'}`));
    const teams = r.teams.filter((t) => filled(t.name) && (filled(t.assigned) || filled(t.completed)));
    if (teams.length) {
      out.push('◆ TEAM DEPLOYMENT');
      teams.forEach((t, i) => out.push(`    ${i + 1}. Team ${t.name} - ${t.assigned || 0} assigned, ${t.completed || 0} completed${teamRate(t) ? ` (${teamRate(t)})` : ''}${t.notes ? ` - ${t.notes}` : ''}`));
    }
  }
  const blockers = nonEmptyLines(r.blockers);
  if (blockers.length) { out.push('', '*BLOCKERS*'); blockers.forEach((l) => out.push(`- ${l}`)); }
  if (filled(r.nextPlan)) out.push('', "*NEXT DAY'S PLAN*", r.nextPlan.trim());
  const by = r.submittedBy || h.name;
  if (filled(by)) out.push('', `SUBMITTED BY | ${by.toUpperCase()}`);
  return out.join('\n');
}

// ---------------------------------------------------------------- print HTML

function itemsHtml(items) {
  let html = '';
  let open = null; // 'ul0' | 'ul1' | 'ol'
  const close = () => { if (open) { html += open === 'ol' ? '</ol>' : '</ul>'; open = null; } };
  for (const it of items) {
    const want = it.kind === 'number' ? 'ol' : it.level ? 'ul1' : 'ul0';
    if (want !== open) { close(); html += want === 'ol' ? '<ol class="sub">' : `<ul class="${want === 'ul1' ? 'sub' : 'top'}">`; open = want; }
    html += `<li>${it.label ? `<b>${escHtml(it.label)}</b> - ` : ''}${escHtml(it.text)}</li>`;
  }
  close();
  return html;
}

export function dailyBodyHtml(doc) {
  const r = doc.report;
  let html = '';
  for (const b of r.blocks) {
    const items = parseLines(b.text);
    if (!items.length && !filled(b.title)) continue;
    const range = blockRange(b);
    if (range) html += `<h4>${escHtml(range)}</h4>`;
    if (filled(b.title)) html += `<p class="${range ? '' : 'b'}">${escHtml(b.title.toUpperCase())}</p>`;
    html += itemsHtml(items);
  }
  if (hasStats(r) || hasTeams(r)) {
    html += `<h4>${escHtml((r.statsTitle || 'FIELD OPERATIONS').toUpperCase())}</h4>`;
    if (filled(r.statsNote)) html += `<p>${escHtml(r.statsNote)}</p>`;
    html += '<ul class="diamond">' + r.stats.filter((s) => filled(s.label)).map((s) => `<li><span class="lbl">${escHtml(s.label.toUpperCase())}</span><b>${escHtml(filled(s.value) ? s.value : 'None')}</b></li>`).join('') + '</ul>';
    const teams = r.teams.filter((t) => filled(t.name) && (filled(t.assigned) || filled(t.completed) || filled(t.notes)));
    if (teams.length) {
      html += '<ul class="diamond"><li><b>TEAM DEPLOYMENT</b></li></ul><table><thead><tr><th>Team</th><th>Assigned</th><th>Completed</th><th>Rate</th><th>Notes</th></tr></thead><tbody>';
      html += teams.map((t) => `<tr><td>${escHtml(t.name)}</td><td class="c">${escHtml(t.assigned)}</td><td class="c">${escHtml(t.completed)}</td><td class="c">${teamRate(t)}</td><td>${escHtml(t.notes)}</td></tr>`).join('');
      html += '</tbody></table>';
    }
  }
  const blockers = nonEmptyLines(r.blockers);
  if (blockers.length) html += `<h4>BLOCKERS</h4><ul class="dash">${blockers.map((l) => `<li>${escHtml(l)}</li>`).join('')}</ul>`;
  if (filled(r.nextPlan)) html += `<h4>NEXT DAY'S PLAN</h4><p>${escHtml(r.nextPlan.trim()).replace(/\n/g, '<br>')}</p>`;
  return html;
}

export function dailyHtml(doc) {
  const r = doc.report;
  const h = r.header;
  const { day, ord, mon, year } = dateParts(doc.date);
  let html = '<div class="paper">';
  if (filled(h.company)) html += `<h2 class="center">${escHtml(h.company.toUpperCase())}</h2>`;
  html += '<div class="meta">';
  html += `<div>${escHtml((h.subtitle || 'DAILY WORK REPORT').toUpperCase())}</div><div>${day}<sup>${ord}</sup> ${mon} ${year}</div>`;
  if (filled(h.name)) html += `<div>${escHtml(h.name.toUpperCase())}</div>`;
  if (filled(h.branch)) html += `<div>${escHtml(h.branch.toUpperCase())}</div>`;
  if (filled(h.shift)) html += `<div>SHIFT ${escHtml(h.shift.toUpperCase())}</div>`;
  html += '</div>';
  html += dailyBodyHtml(doc);
  const by = r.submittedBy || h.name;
  if (filled(by)) html += `<p class="sig"><b>SUBMITTED BY | ${escHtml(by.toUpperCase())}</b></p>`;
  return html + '</div>';
}

// ---------------------------------------------------------------- range / weekly

export function summarize(reports) {
  const statOrder = [];
  const statTotals = {};
  const teamTotals = {};
  const blockers = new Map();
  for (const d of reports) {
    const r = d.report;
    for (const s of r.stats) {
      const key = s.label.trim().toUpperCase();
      if (!key) continue;
      if (!(key in statTotals)) { statOrder.push(key); statTotals[key] = 0; }
      const v = num(s.value);
      if (v != null) statTotals[key] += v;
    }
    for (const t of r.teams) {
      const key = t.name.trim();
      if (!key) continue;
      const a = num(t.assigned);
      const c = num(t.completed);
      if (a == null && c == null) continue;
      teamTotals[key] = teamTotals[key] || { assigned: 0, completed: 0, days: 0 };
      teamTotals[key].assigned += a || 0;
      teamTotals[key].completed += c || 0;
      teamTotals[key].days += 1;
    }
    for (const b of nonEmptyLines(r.blockers)) {
      const k = b.toLowerCase();
      const cur = blockers.get(k) || { text: b, days: [] };
      cur.days.push(d.date);
      blockers.set(k, cur);
    }
  }
  return { statOrder, statTotals, teamTotals, blockers: [...blockers.values()] };
}

export function rangeDocx(reports, opts) {
  const { title, from, to, profile, details = true } = opts;
  const dx = new Docx({ title, author: profile.name });
  if (filled(profile.company)) dx.p([{ text: profile.company.toUpperCase(), b: true, size: 13 }], { align: 'center', after: 120 });
  dx.p([{ text: title.toUpperCase(), b: true, size: 12 }], { align: 'center', after: 200 });
  const meta = [`PERIOD: ${fmtLong(from).toUpperCase()} – ${fmtLong(to).toUpperCase()}`];
  if (filled(profile.name)) meta.push(profile.name.toUpperCase());
  if (filled(profile.branch)) meta.push(profile.branch.toUpperCase());
  meta.push(`DAYS REPORTED: ${reports.length}`);
  meta.forEach((m, i) => dx.p(m, { after: i === meta.length - 1 ? 200 : 0 }));

  const sum = summarize(reports);
  if (sum.statOrder.length) {
    dx.heading('Summary', 1);
    dx.table([['Metric', 'Total'], ...sum.statOrder.map((k) => [k, String(sum.statTotals[k])])], { widths: [0.7, 0.3], align: [null, 'center'] });
    if (reports.length > 1) {
      const cols = sum.statOrder;
      const rows = reports.map((d) => {
        const map = Object.fromEntries(d.report.stats.map((s) => [s.label.trim().toUpperCase(), s.value]));
        return [fmtShort(d.date), ...cols.map((c) => map[c] || '–')];
      });
      dx.heading('Daily breakdown', 2);
      const first = 0.22;
      dx.table([['Day', ...cols], ...rows], { widths: [first, ...cols.map(() => (1 - first) / cols.length)], align: [null, ...cols.map(() => 'center')] });
    }
  }
  const teams = Object.entries(sum.teamTotals);
  if (teams.length) {
    dx.heading('Team performance', 1);
    dx.table([['Team', 'Days', 'Assigned', 'Completed', 'Rate'], ...teams.map(([n, t]) => [n, String(t.days), String(t.assigned), String(t.completed), t.assigned ? `${Math.round((t.completed / t.assigned) * 100)}%` : ''])], { widths: [0.32, 0.12, 0.18, 0.2, 0.18], align: [null, 'center', 'center', 'center', 'center'] });
  }
  if (sum.blockers.length) {
    dx.heading('Blockers', 1);
    sum.blockers.forEach((b) => dx.item([{ text: b.text }, { text: `  (${b.days.length > 1 ? `${b.days.length} days` : fmtShort(b.days[0])})`, i: true, color: '808080' }], 'dash', 0));
  }
  const last = reports[reports.length - 1];
  if (last && filled(last.report.nextPlan)) {
    dx.heading('Next steps', 1);
    dx.p(last.report.nextPlan.trim());
  }
  if (details) {
    dx.heading('Daily details', 1);
    reports.forEach((d, i) => {
      dx.p([{ text: fmtLong(d.date).toUpperCase(), b: true, color: 'C0392B' }], { keepNext: true, before: i ? 280 : 80, border: true, after: 80 });
      writeDailyBody(dx, d, { compact: true });
    });
  }
  return dx.build();
}

export function rangeHtml(reports, opts) {
  const { title, from, to, profile, details = true } = opts;
  const sum = summarize(reports);
  let html = '<div class="paper">';
  if (filled(profile.company)) html += `<h2 class="center">${escHtml(profile.company.toUpperCase())}</h2>`;
  html += `<h3 class="center">${escHtml(title.toUpperCase())}</h3><div class="meta"><div>PERIOD: ${escHtml(fmtLong(from).toUpperCase())} – ${escHtml(fmtLong(to).toUpperCase())}</div>`;
  if (filled(profile.name)) html += `<div>${escHtml(profile.name.toUpperCase())}</div>`;
  if (filled(profile.branch)) html += `<div>${escHtml(profile.branch.toUpperCase())}</div>`;
  html += `<div>DAYS REPORTED: ${reports.length}</div></div>`;
  if (sum.statOrder.length) {
    html += '<h3>Summary</h3><table><thead><tr><th>Metric</th><th>Total</th></tr></thead><tbody>' + sum.statOrder.map((k) => `<tr><td>${escHtml(k)}</td><td class="c">${sum.statTotals[k]}</td></tr>`).join('') + '</tbody></table>';
  }
  const teams = Object.entries(sum.teamTotals);
  if (teams.length) {
    html += '<h3>Team performance</h3><table><thead><tr><th>Team</th><th>Days</th><th>Assigned</th><th>Completed</th><th>Rate</th></tr></thead><tbody>' + teams.map(([n, t]) => `<tr><td>${escHtml(n)}</td><td class="c">${t.days}</td><td class="c">${t.assigned}</td><td class="c">${t.completed}</td><td class="c">${t.assigned ? Math.round((t.completed / t.assigned) * 100) + '%' : ''}</td></tr>`).join('') + '</tbody></table>';
  }
  if (sum.blockers.length) html += `<h3>Blockers</h3><ul class="dash">${sum.blockers.map((b) => `<li>${escHtml(b.text)} <i class="muted">(${b.days.length > 1 ? b.days.length + ' days' : fmtShort(b.days[0])})</i></li>`).join('')}</ul>`;
  if (details) {
    html += '<h3>Daily details</h3>';
    reports.forEach((d) => { html += `<h4 class="day">${escHtml(fmtLong(d.date).toUpperCase())}</h4>${dailyBodyHtml(d)}`; });
  }
  return html + '</div>';
}

export function rangeText(reports, opts) {
  const sum = summarize(reports);
  const out = [opts.title.toUpperCase(), `${fmtLong(opts.from)} – ${fmtLong(opts.to)}`];
  if (filled(opts.profile.name)) out.push(opts.profile.name.toUpperCase());
  out.push(`Days reported: ${reports.length}`);
  if (sum.statOrder.length) { out.push('', '*SUMMARY*'); sum.statOrder.forEach((k) => out.push(`◆ ${k}: ${sum.statTotals[k]}`)); }
  const teams = Object.entries(sum.teamTotals);
  if (teams.length) { out.push('', '*TEAM PERFORMANCE*'); teams.forEach(([n, t]) => out.push(`• ${n}: ${t.completed}/${t.assigned} completed${t.assigned ? ` (${Math.round((t.completed / t.assigned) * 100)}%)` : ''}`)); }
  if (sum.blockers.length) { out.push('', '*BLOCKERS*'); sum.blockers.forEach((b) => out.push(`- ${b.text}`)); }
  return out.join('\n');
}

/** Flatten everything in a report into searchable text. */
export function reportSearchText(doc) {
  const r = doc.report;
  return [
    ...Object.values(r.header),
    ...r.blocks.map((b) => `${b.title} ${b.text}`),
    r.statsTitle, r.statsNote,
    ...r.stats.map((s) => `${s.label} ${s.value}`),
    ...r.teams.map((t) => `${t.name} ${t.notes}`),
    r.blockers, r.nextPlan,
  ].join(' \n ');
}
