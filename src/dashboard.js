// Home dashboard: widgets computed from your daily reports.
import { icon } from './icons.js';
import * as U from './util.js';
import { parseLines, summarize } from './report.js';

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
export const activityCount = (d) => d.report.blocks.reduce((a, b) => a + parseLines(b.text).length, 0);
const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : a ? 100 : 0);
const fmt = (n) => Number(n).toLocaleString();

function delta(cur, prev) {
  const p = pct(cur, prev);
  const up = p >= 0;
  return `<span class="delta ${up ? 'up' : 'down'}">${icon(up ? 'up' : 'down', 12)}${Math.abs(p)}%</span>`;
}

function spark(values, { w = 320, h = 90 } = {}) {
  if (!values.length) return '';
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => [i * step, h - 8 - (v / max) * (h - 18)]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  const area = `${d} L${w},${h} L0,${h} Z`;
  const last = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".22"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#sg)"/>
    <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linecap="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="4" fill="var(--accent)" stroke="var(--card)" stroke-width="2" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

export function dashboardHtml({ docs, profile, greeting, docTitle }) {
  const today = U.todayKey();
  const reports = docs.filter((d) => d.type === 'report');
  const byDate = new Map(reports.map((d) => [d.date, d]));
  const ws = U.weekStart(today);
  const daysIn = Math.round((U.parseKey(today) - U.parseKey(ws)) / 86400000) + 1;
  const range = (from, to) => reports.filter((d) => d.date >= from && d.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const week = range(ws, today);
  const prevWeek = range(U.addDays(ws, -7), U.addDays(ws, daysIn - 8));
  const acts = (list) => list.reduce((a, d) => a + activityCount(d), 0);
  const weekActs = acts(week);
  const prevActs = acts(prevWeek);
  const monthStart = today.slice(0, 8) + '01';
  const monthReports = range(monthStart, today).length;
  const prevMonthStart = U.dateKey(new Date(U.parseKey(today).getFullYear(), U.parseKey(today).getMonth() - 1, 1));
  const prevMonthReports = range(prevMonthStart, U.addDays(prevMonthStart, U.parseKey(today).getDate() - 1)).length;

  // streak of consecutive days with a report (today counts once something is logged)
  let streak = 0;
  let k = byDate.get(today) && activityCount(byDate.get(today)) ? today : U.addDays(today, -1);
  while (byDate.get(k) && activityCount(byDate.get(k)) > 0) { streak++; k = U.addDays(k, -1); }

  const todayRep = byDate.get(today);
  const todayActs = todayRep ? activityCount(todayRep) : 0;
  const lastLine = todayRep ? todayRep.report.blocks.flatMap((b) => parseLines(b.text)).pop() : null;

  const sum = summarize(week);
  const prevSum = summarize(prevWeek);
  const statTotal = sum.statOrder.reduce((a, s) => a + sum.statTotals[s], 0);
  const teams = Object.entries(sum.teamTotals).sort((a, b) => b[1].completed - a[1].completed);
  const teamAssigned = teams.reduce((a, [, t]) => a + t.assigned, 0);
  const teamDone = teams.reduce((a, [, t]) => a + t.completed, 0);

  // bars: Mon..Sun of this week
  const bars = Array.from({ length: 7 }, (_, i) => {
    const key = U.addDays(ws, i);
    const d = byDate.get(key);
    return { key, label: U.DAYS[U.parseKey(key).getDay()].slice(0, 3), v: d ? activityCount(d) : 0, future: key > today, today: key === today };
  });
  const barMax = Math.max(1, ...bars.map((b) => b.v));
  const peak = bars.reduce((a, b) => (b.v > a.v ? b : a), bars[0]);

  // 30-day trend
  const trend = Array.from({ length: 30 }, (_, i) => {
    const d = byDate.get(U.addDays(today, i - 29));
    return d ? activityCount(d) : 0;
  });
  const trendTotal = trend.reduce((a, b) => a + b, 0);

  const recent = docs.filter((d) => d.type !== 'report').sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 5);
  const first = (profile.name || '').split(' ')[0];

  return `<div class="dash-scroll"><div class="dash">
    <div class="dash-chips">
      <button class="chip-btn round" data-act="today" title="Today's report">${icon('plus', 17)}</button>
      <button class="chip-btn" data-act="today"><span class="chip-av t-report">${icon('report', 14)}</span>Today's report</button>
      <button class="chip-btn" data-act="newNote"><span class="chip-av t-note">${icon('note', 14)}</span>Note</button>
      <button class="chip-btn" data-act="newBoard"><span class="chip-av t-board">${icon('board', 14)}</span>Whiteboard</button>
      <button class="chip-btn" data-act="range"><span class="chip-av dark">${icon('chart', 14)}</span>Weekly report</button>
    </div>

    <h1 class="dash-title">${greeting}${first ? ', ' + U.escHtml(first) : ''}</h1>

    <div class="hero">
      <div class="hero-main">
        <div class="hero-label">Activities logged this week</div>
        <div class="hero-num">${fmt(weekActs)}<span class="unit">${weekActs === 1 ? 'entry' : 'entries'}</span>
          ${delta(weekActs, prevActs)}
          <span class="pill-accent">${week.length}/${Math.min(daysIn, 7)} days reported</span>
        </div>
        <div class="hero-sub">vs last week ${fmt(prevActs)} · ${U.fmtDayMonth(ws)} – ${U.fmtDayMonth(U.addDays(ws, 6))} ${U.parseKey(ws).getFullYear()}</div>
      </div>
      <div class="hero-cards">
        <button class="mini-card" data-act="range">
          <span class="mc-label">This month</span>
          <span class="mc-num">${monthReports}</span>
          <span class="mc-foot">${delta(monthReports, prevMonthReports)} reports <span class="mc-arrow">${icon('right', 14)}</span></span>
        </button>
        <button class="mini-card dark" data-act="today">
          <span class="mc-label">Today ${icon('clock', 14)}</span>
          <span class="mc-num">${todayActs} <small>${todayActs === 1 ? 'entry' : 'entries'}</small></span>
          <span class="mc-foot"><span class="ellipsis">${lastLine ? U.escHtml(lastLine.label || lastLine.text) : 'Nothing logged yet'}</span><span class="mc-arrow light">${icon('right', 14)}</span></span>
        </button>
        <div class="mini-card">
          <span class="mc-label">Streak</span>
          <span class="mc-num">${streak} <small>day${streak === 1 ? '' : 's'}</small></span>
          <span class="mc-foot">${streak >= 3 ? 'On fire 🔥' : streak ? 'Keep going 💪' : 'Log today to start'}</span>
        </div>
      </div>
    </div>

    ${teams.length ? `<div class="pill-row">${teams.slice(0, 4).map(([n, t]) => `
      <div class="share-pill"><span class="sp-av">${U.escHtml(n.slice(0, 1).toUpperCase())}</span><b>${U.escHtml(n)}</b><span>${t.completed}/${t.assigned}</span><span class="muted">${t.assigned ? Math.round((t.completed / t.assigned) * 100) : 0}%</span></div>`).join('')}</div>` : ''}

    <div class="widgets">
      <section class="widget">
        <div class="w-head"><span class="w-ico">${icon('chart', 16)}</span><span class="w-title">Metrics this week</span><button class="w-btn" data-act="range">Report ${icon('right', 13)}</button></div>
        ${sum.statOrder.length ? `<div class="metric-list">${sum.statOrder.slice(0, 6).map((s) => {
          const v = sum.statTotals[s];
          const pv = prevSum.statTotals[s] || 0;
          return `<div class="metric"><span class="m-name">${U.escHtml(s.toLowerCase())}</span><b>${fmt(v)}</b><span class="m-pct">${statTotal ? Math.round((v / statTotal) * 100) : 0}%</span>${pv || v ? delta(v, pv) : ''}</div>`;
        }).join('')}</div>` : '<div class="w-empty">Fill in the field stats on your daily reports and totals show up here.</div>'}
      </section>

      <section class="widget">
        <div class="w-head"><span class="w-ico">${icon('report', 16)}</span><span class="w-title">Entries per day</span><span class="w-sub">${peak.v ? `Peak ${peak.label}` : ''}</span></div>
        <div class="bars">${bars.map((b) => `
          <button class="bar ${b.future ? 'future' : ''} ${b.today ? 'is-today' : ''}" data-day="${b.key}" title="${U.fmtLong(b.key)}: ${b.v} entries">
            ${b.v === peak.v && b.v ? `<span class="bar-tag">${b.v}</span>` : ''}
            <span class="bar-fill" style="height:${b.future ? 100 : Math.max(6, (b.v / barMax) * 100)}%"></span>
            <span class="bar-lbl">${b.label}</span>
          </button>`).join('')}</div>
      </section>

      <section class="widget">
        <div class="w-head"><span class="w-ico">${icon('check', 16)}</span><span class="w-title">Team deployment</span><span class="w-sub">${teamAssigned ? `${teamDone}/${teamAssigned} done` : ''}</span></div>
        ${teams.length ? `<div class="team-table"><div class="tt-row head"><span>Team</span><span>Done</span><span>Assigned</span><span>Rate</span></div>${teams.slice(0, 6).map(([n, t]) => {
          const r = t.assigned ? Math.round((t.completed / t.assigned) * 100) : 0;
          return `<div class="tt-row"><span class="tt-name"><span class="sp-av">${U.escHtml(n.slice(0, 1).toUpperCase())}</span>${U.escHtml(n)}</span><span class="count dark">${t.completed}</span><span class="count">${t.assigned}</span><span class="rate-bar"><i style="width:${Math.min(100, r)}%"></i><b>${r}%</b></span></div>`;
        }).join('')}</div>` : '<div class="w-empty">Add teams to your daily report to track completions.</div>'}
      </section>

      <section class="widget">
        <div class="w-head"><span class="w-ico">${icon('zap', 16)}</span><span class="w-title">Last 30 days</span><span class="w-sub">${fmt(trendTotal)} entries</span></div>
        <div class="trend">${spark(trend)}</div>
        <div class="trend-axis"><span>${U.fmtDayMonth(U.addDays(today, -29))}</span><span>${U.fmtDayMonth(U.addDays(today, -15))}</span><span>Today</span></div>
      </section>

      <section class="widget">
        <div class="w-head"><span class="w-ico">${icon('alert', 16)}</span><span class="w-title">Blockers this week</span></div>
        ${sum.blockers.length ? `<div class="tag-cloud">${sum.blockers.slice(0, 8).map((b) => `<span class="tag">${U.escHtml(b.text)}${b.days.length > 1 ? ` <b>×${b.days.length}</b>` : ''}</span>`).join('')}</div>` : '<div class="w-empty">No blockers logged this week 🎉</div>'}
      </section>

      <section class="widget">
        <div class="w-head"><span class="w-ico">${icon('note', 16)}</span><span class="w-title">Recent notes & boards</span></div>
        ${recent.length ? `<div class="recent">${recent.map((d) => `<button class="recent-item" data-open="${d.id}"><span class="item-ic t-${d.type}">${icon(d.type === 'board' ? 'board' : 'note', 14)}</span><span class="ellipsis">${U.escHtml(docTitle(d))}</span><span class="muted small">${U.fmtDayMonth(U.dateKey(new Date(d.updated)))}</span></button>`).join('')}</div>` : '<div class="w-empty">Your notes and whiteboards will show up here.</div>'}
      </section>
    </div>
  </div></div>`;
}

export { num };
