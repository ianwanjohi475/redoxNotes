// Editor for a structured daily report: header, time-log blocks with a
// "log it now" quick entry, field stats, team deployment, blockers, plan.
import { icon } from './icons.js';
import { escHtml, fmtClock, fmtLong, fmtReportTime, nowHM, uid } from './util.js';

const autosize = (ta) => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };

export class ReportEditor {
  constructor(host, doc, { onChange, onDateChange }) {
    this.host = host;
    this.doc = doc;
    this.r = doc.report;
    this.onChange = onChange;
    this.onDateChange = onDateChange;
    this.render();
    this.clock = setInterval(() => this.tickClock(), 20000);
  }

  destroy() { clearInterval(this.clock); }

  changed() { this.onChange(); }

  render(focusSel) {
    const r = this.r;
    const h = r.header;
    const scroll = this.host.querySelector('.rep-scroll')?.scrollTop || 0;
    const detailsOpen = this.host.querySelector('.rep-head')?.open ?? !(h.name || h.branch);
    this.host.innerHTML = `
      <div class="rep-scroll"><div class="rep-page">
        <div class="rep-date-row">
          <div>
            <div class="rep-kicker">${escHtml(h.subtitle || 'Daily work report')}</div>
            <h1 class="rep-date">${escHtml(fmtLong(this.doc.date))}</h1>
          </div>
          <label class="date-pick" title="Change the date of this report">${icon('calendar', 16)}<input type="date" data-k="date" value="${this.doc.date}"></label>
        </div>

        <details class="rep-head card" ${detailsOpen ? 'open' : ''}>
          <summary>${icon('report', 16)}<span>Report header</span><span class="muted sum-line">${escHtml([h.company, h.name, h.branch, h.shift && 'Shift ' + h.shift].filter(Boolean).join(' · ') || 'Company, name, branch, shift')}</span></summary>
          <div class="grid2">
            <label>Report title<input data-h="company" value="${escHtml(h.company)}" placeholder="e.g. VTL DAILY REPORT"></label>
            <label>Subtitle<input data-h="subtitle" value="${escHtml(h.subtitle)}" placeholder="DAILY WORK REPORT"></label>
            <label>Your name<input data-h="name" value="${escHtml(h.name)}" placeholder="Full name"></label>
            <label>Branch / Department<input data-h="branch" value="${escHtml(h.branch)}" placeholder="e.g. Kakamega Branch"></label>
            <label>Shift<input data-h="shift" value="${escHtml(h.shift)}" placeholder="e.g. 8AM to 4PM"></label>
            <label>Submitted by<input data-k="submittedBy" value="${escHtml(r.submittedBy)}" placeholder="Name on the signature line"></label>
          </div>
        </details>

        ${r.carried ? `<div class="carry card"><div>${icon('restore', 16)} <b>Plan carried over from your last report</b><p>${escHtml(r.carried)}</p></div><button class="ghost sm" data-act="dismissCarry">Dismiss</button></div>` : ''}

        <div class="quick card">
          <span class="quick-time" title="Current time">${icon('clock', 16)}<b class="now-clock">${fmtClock()}</b></span>
          <input class="quick-input" placeholder="What did you just do? Type it and press Enter — it's logged under the current time">
          <button class="primary sm" data-act="quick">Log it</button>
        </div>

        <section class="rep-sec">
          <div class="sec-head"><h2>${icon('clock', 17)} Time log</h2><span class="muted">One activity per line · indent or start with “-” for a sub-point · “1.” for numbered · “CAPS LABEL - text” makes a bold label</span></div>
          <div class="blocks">
            ${r.blocks.length ? r.blocks.map((b, i) => this.blockHtml(b, i)).join('') : '<div class="empty-blocks muted">No entries yet. Use the quick log above, or add a time block.</div>'}
          </div>
          <button class="add-row" data-act="addBlock">${icon('plus', 16)} Add time block</button>
        </section>

        <section class="rep-sec">
          <div class="sec-head"><h2>${icon('chart', 17)} <input class="sec-title" data-k="statsTitle" value="${escHtml(r.statsTitle)}" placeholder="FIELD OPERATIONS"></h2></div>
          <input class="full" data-k="statsNote" value="${escHtml(r.statsNote)}" placeholder="Optional note, e.g. cross-checking of field events">
          <div class="stats">
            ${r.stats.map((s) => `<div class="stat" data-id="${s.id}"><input data-s="label" value="${escHtml(s.label)}" placeholder="Metric"><input data-s="value" class="val" value="${escHtml(s.value)}" placeholder="–"><button class="icon-btn" data-act="delStat" title="Remove">${icon('x', 14)}</button></div>`).join('')}
            <button class="add-row slim" data-act="addStat">${icon('plus', 14)} Metric</button>
          </div>
          <h3 class="sub-h">Team deployment</h3>
          <div class="teams">
            <div class="team head"><span>Team</span><span>Assigned</span><span>Completed</span><span>Rate</span><span>Notes</span><span></span></div>
            ${r.teams.map((t) => this.teamHtml(t)).join('')}
          </div>
          <button class="add-row slim" data-act="addTeam">${icon('plus', 14)} Team</button>
        </section>

        <section class="rep-sec two">
          <div>
            <div class="sec-head"><h2>Blockers</h2></div>
            <textarea data-k="blockers" rows="3" placeholder="One per line, e.g. Lack of drop cable">${escHtml(r.blockers)}</textarea>
          </div>
          <div>
            <div class="sec-head"><h2>Next day's plan</h2></div>
            <textarea data-k="nextPlan" rows="3" placeholder="What's planned for tomorrow">${escHtml(r.nextPlan)}</textarea>
          </div>
        </section>
      </div></div>`;
    this.bind();
    this.host.querySelectorAll('textarea').forEach(autosize);
    const sc = this.host.querySelector('.rep-scroll');
    sc.scrollTop = scroll;
    if (focusSel) {
      const el = this.host.querySelector(focusSel);
      if (el) { el.focus(); if (el.setSelectionRange) el.setSelectionRange(el.value.length, el.value.length); }
    }
  }

  blockHtml(b, i) {
    return `<div class="block card" data-id="${b.id}">
      <div class="block-head">
        <input type="time" data-b="start" value="${b.start || ''}" title="Start time">
        <span class="muted">to</span>
        <input type="time" data-b="end" value="${b.end || ''}" title="End time (leave empty while ongoing)">
        <button class="ghost xs" data-act="endNow" title="Set end time to now">now</button>
        <input class="block-title" data-b="title" value="${escHtml(b.title || '')}" placeholder="Section title (optional), e.g. NORMAL OFFICE DUTIES">
        <span class="block-tools">
          <button class="icon-btn" data-act="up" title="Move up" ${i === 0 ? 'disabled' : ''}>${icon('up', 15)}</button>
          <button class="icon-btn" data-act="down" title="Move down" ${i === this.r.blocks.length - 1 ? 'disabled' : ''}>${icon('down', 15)}</button>
          <button class="icon-btn" data-act="delBlock" title="Delete block">${icon('trash', 15)}</button>
        </span>
      </div>
      <textarea data-b="text" rows="2" spellcheck="true" placeholder="What did you do in this time?">${escHtml(b.text || '')}</textarea>
      <div class="block-foot muted">${b.start ? escHtml(fmtReportTime(b.start)) + (b.end ? ' – ' + escHtml(fmtReportTime(b.end)) : ' – ongoing') : ''}</div>
    </div>`;
  }

  teamHtml(t) {
    const a = parseFloat(t.assigned), c = parseFloat(t.completed);
    const rate = a > 0 && Number.isFinite(c) ? Math.round((c / a) * 100) : null;
    return `<div class="team" data-id="${t.id}">
      <input data-t="name" value="${escHtml(t.name)}" placeholder="Team name">
      <input data-t="assigned" value="${escHtml(t.assigned)}" inputmode="numeric" placeholder="0">
      <input data-t="completed" value="${escHtml(t.completed)}" inputmode="numeric" placeholder="0">
      <span class="rate ${rate == null ? '' : rate >= 80 ? 'good' : rate >= 50 ? 'mid' : 'low'}">${rate == null ? '–' : rate + '%'}</span>
      <input data-t="notes" value="${escHtml(t.notes)}" placeholder="Notes">
      <button class="icon-btn" data-act="delTeam" title="Remove">${icon('x', 14)}</button>
    </div>`;
  }

  tickClock() {
    const el = this.host.querySelector('.now-clock');
    if (el) el.textContent = fmtClock();
  }

  findBlock(el) { const id = el.closest('.block')?.dataset.id; return this.r.blocks.find((b) => b.id === id); }

  bind() {
    const host = this.host;
    host.querySelectorAll('[data-h]').forEach((el) => el.addEventListener('input', () => {
      this.r.header[el.dataset.h] = el.value;
      this.changed();
    }));
    host.querySelectorAll('[data-k]').forEach((el) => el.addEventListener(el.type === 'date' ? 'change' : 'input', () => {
      const k = el.dataset.k;
      if (k === 'date') {
        if (!el.value) return;
        if (!this.onDateChange(el.value)) { el.value = this.doc.date; return; }
        this.render();
        return;
      }
      this.r[k] = el.value;
      if (el.tagName === 'TEXTAREA') autosize(el);
      this.changed();
    }));
    host.querySelectorAll('[data-b]').forEach((el) => el.addEventListener(el.type === 'time' ? 'change' : 'input', () => {
      const b = this.findBlock(el);
      b[el.dataset.b] = el.value;
      if (el.tagName === 'TEXTAREA') autosize(el);
      if (el.type === 'time') {
        const foot = el.closest('.block').querySelector('.block-foot');
        foot.textContent = b.start ? fmtReportTime(b.start) + (b.end ? ' – ' + fmtReportTime(b.end) : ' – ongoing') : '';
      }
      this.changed();
    }));
    host.querySelectorAll('textarea[data-b="text"]').forEach((ta) => ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = ta.selectionStart;
        const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
        const end = ta.selectionEnd;
        if (e.shiftKey) {
          if (ta.value.slice(lineStart, lineStart + 2) === '  ') {
            ta.setRangeText('', lineStart, lineStart + 2);
            ta.setSelectionRange(Math.max(lineStart, s - 2), Math.max(lineStart, end - 2));
          }
        } else {
          ta.setRangeText('  ', lineStart, lineStart);
          ta.setSelectionRange(s + 2, end + 2);
        }
        ta.dispatchEvent(new Event('input'));
      } else if (e.key === 'Enter' && !e.shiftKey) {
        // keep the indentation of the current line, like a code editor
        const s = ta.selectionStart;
        const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
        const line = ta.value.slice(lineStart, s);
        const m = line.match(/^(\s*)(\d+)([.)])\s+/);
        const prefix = m ? m[0] : line.match(/^(\s*(?:[-–•*]\s+)?)/)[1];
        if (!prefix) return; // plain line: normal Enter
        e.preventDefault();
        if (!line.slice(prefix.length).trim()) {
          // empty bullet: end the sub-list
          ta.setRangeText('', lineStart, s, 'end');
        } else {
          const next = m ? `${m[1]}${+m[2] + 1}${m[3]} ` : prefix;
          ta.setRangeText('\n' + next, s, ta.selectionEnd, 'end');
        }
        ta.dispatchEvent(new Event('input'));
      }
    }));
    host.querySelectorAll('[data-s]').forEach((el) => el.addEventListener('input', () => {
      const s = this.r.stats.find((x) => x.id === el.closest('.stat').dataset.id);
      s[el.dataset.s] = el.value;
      this.changed();
    }));
    host.querySelectorAll('[data-t]').forEach((el) => el.addEventListener('input', () => {
      const row = el.closest('.team');
      const t = this.r.teams.find((x) => x.id === row.dataset.id);
      t[el.dataset.t] = el.value;
      if (el.dataset.t !== 'name' && el.dataset.t !== 'notes') {
        const a = parseFloat(t.assigned), c = parseFloat(t.completed);
        const rate = a > 0 && Number.isFinite(c) ? Math.round((c / a) * 100) : null;
        const span = row.querySelector('.rate');
        span.textContent = rate == null ? '–' : rate + '%';
        span.className = 'rate ' + (rate == null ? '' : rate >= 80 ? 'good' : rate >= 50 ? 'mid' : 'low');
      }
      this.changed();
    }));
    const quick = host.querySelector('.quick-input');
    quick.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.quickLog(quick.value); } });
    host.querySelectorAll('[data-act]').forEach((el) => el.addEventListener('click', () => this.act(el.dataset.act, el)));
  }

  quickLog(text) {
    text = text.trim();
    if (!text) return;
    const now = nowHM(1);
    const blocks = this.r.blocks;
    const last = blocks[blocks.length - 1];
    let target = blocks.find((b) => b.start && b.end && b.start <= now && now <= b.end);
    if (!target && last && !last.end) target = last;
    if (!target) {
      target = { id: uid(), start: last?.end || nowHM(5), end: '', title: '', text: '' };
      blocks.push(target);
    }
    target.text = (target.text ? target.text.replace(/\s+$/, '') + '\n' : '') + text;
    this.changed();
    this.render('.quick-input');
    const el = this.host.querySelector(`.block[data-id="${target.id}"]`);
    el?.classList.add('flash');
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  act(a, el) {
    const r = this.r;
    const b = this.findBlock(el);
    const idx = b ? r.blocks.indexOf(b) : -1;
    switch (a) {
      case 'quick': this.quickLog(this.host.querySelector('.quick-input').value); return;
      case 'dismissCarry': r.carried = ''; break;
      case 'addBlock': {
        const last = r.blocks[r.blocks.length - 1];
        if (last && !last.end) last.end = nowHM(5);
        const nb = { id: uid(), start: last?.end || nowHM(5), end: '', title: '', text: '' };
        r.blocks.push(nb);
        this.changed();
        this.render(`.block[data-id="${nb.id}"] textarea`);
        return;
      }
      case 'endNow': b.end = nowHM(5); break;
      case 'delBlock':
        if ((b.text || '').trim() && !confirm('Delete this time block and its entries?')) return;
        r.blocks.splice(idx, 1);
        break;
      case 'up': if (idx > 0) [r.blocks[idx - 1], r.blocks[idx]] = [r.blocks[idx], r.blocks[idx - 1]]; break;
      case 'down': if (idx < r.blocks.length - 1) [r.blocks[idx + 1], r.blocks[idx]] = [r.blocks[idx], r.blocks[idx + 1]]; break;
      case 'addStat': r.stats.push({ id: uid(), label: '', value: '' }); this.changed(); this.render('.stat:last-of-type input'); return;
      case 'delStat': r.stats = r.stats.filter((s) => s.id !== el.closest('.stat').dataset.id); break;
      case 'addTeam': r.teams.push({ id: uid(), name: '', assigned: '', completed: '', notes: '' }); this.changed(); this.render('.team:last-child input'); return;
      case 'delTeam': r.teams = r.teams.filter((t) => t.id !== el.closest('.team').dataset.id); break;
      default: return;
    }
    this.changed();
    this.render();
  }

  /** F5 inside a report: insert the current time into the focused field */
  insertStamp() {
    const el = document.activeElement;
    if (el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text') || (el.tagName === 'INPUT' && !el.type))) {
      el.setRangeText(fmtClock() + ' ', el.selectionStart, el.selectionEnd, 'end');
      el.dispatchEvent(new Event('input'));
      return true;
    }
    return false;
  }

  focus() { this.host.querySelector('.quick-input')?.focus(); }
}
