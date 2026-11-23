'use strict';
/* Training app. All program content comes from data/program.json and data/howto.json.
   Everything you log is saved on this phone only (localStorage). */

let P = null, H = null;
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAYNAME = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const REST_SECONDS = 120;
const VERSION = 13; // shown at the bottom of Body, so you can tell which version the phone is running

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parse(k); d.setDate(d.getDate() + n); return keyOf(d); };
const today = () => keyOf(new Date());
const dowOf = k => DOW[parse(k).getDay()];
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
const short = k => { const d = parse(k); return `${DAYNAME[dowOf(k)].slice(0, 3)} ${d.getDate()} ${MON[d.getMonth()]}`; };
const weekOf = k => Math.floor(daysBetween(P.block.start, k) / 7) + 1;

/* ---------- storage ---------- */
const LS = {
  get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('Could not save'); } }
};
const day = k => LS.get('day:' + k, {});
const upd = (k, fn) => { const d = day(k); fn(d); LS.set('day:' + k, d); };
const settings = () => LS.get('settings', {});
const setSetting = (n, v) => { const s = settings(); s[n] = v; LS.set('settings', s); };
function setPath(obj, path, val) {
  const parts = path.split('.'); let o = obj;
  parts.slice(0, -1).forEach(p => { o[p] = o[p] && typeof o[p] === 'object' ? o[p] : {}; o = o[p]; });
  o[parts[parts.length - 1]] = val;
}
const getPath = (obj, path) => path.split('.').reduce((o, p) => (o == null ? undefined : o[p]), obj);

/* ---------- program logic ---------- */
const exName = id => (P.exercises[id] && P.exercises[id].name) || id;
const planFor = k => P.week[dowOf(k)];
const sessionIdFor = k => day(k).session || planFor(k).session;

function locFor(sid, k) {
  const s = P.sessions[sid];
  if (!s.location || s.location.sameBothPlaces) return null;
  const d = day(k);
  return (d.loc && d.loc[sid]) || (settings().loc || {})[sid] || s.location.default;
}

function resolveItems(items, loc, wk) {
  return (items || []).map(it => {
    let r = { ...it };
    if (loc && it.alt && it.alt[loc]) r = { ...r, ...it.alt[loc], _alt: true };
    else if (it.targetByWeek && it.targetByWeek[wk]) r.target = it.targetByWeek[wk];
    delete r.alt;
    return r;
  });
}

function sessionBlocks(sid, k) {
  const s = P.sessions[sid], loc = locFor(sid, k), wk = weekOf(k);
  return s.blocks
    .filter(b => !b.onlyAt || !loc || b.onlyAt === loc)
    .map(b => {
      if (b.useBlock) { const ub = P.blocks[b.useBlock]; return { ...b, note: ub.note, items: resolveItems(ub.items, loc, wk) }; }
      return { ...b, items: resolveItems(b.items, loc, wk) };
    });
}

const kneeFlags = c => c ? [['kneeSwelling', 'swelling'], ['kneeStraightensLess', 'straightens less'], ['kneePainfulClicking', 'painful clicking']].filter(([f]) => c[f]).map(([, l]) => l) : [];
const kneeStop = k => kneeFlags(day(k).check).length > 0;
const plyoFreq = () => settings().plyoFreq || P.blocks.plyo.frequency;
const runStage = () => settings().runStage || P.run.current;
const plyoDue = k => plyoFreq() === 'daily' || daysBetween(P.block.start, k) % 2 === 0;
const runDay = k => P.run.days.includes(dowOf(k));
const isSaunaDay = k => sessionBlocks(sessionIdFor(k), k).some(b => /sauna/i.test(b.name));
const waterTarget = k => (isSaunaDay(k) ? P.food.water.saunaDayLitres : P.food.water.targetLitres) * 1000;
const protein = () => settings().protein || P.food.protein.current;
const painClass = v => v == null ? '' : v >= 6 ? 'red' : v >= 3 ? 'amber' : '';

/* ---------- UI state ---------- */
const S = { view: 'today', date: today(), stack: [], sheet: null, rest: null, mealOpen: {}, lastTop: null };

/* Remember which dropdowns are open, so re-drawing the screen never closes them. */
const OPEN = new Set();
function dkey(d) {
  const top = S.stack[S.stack.length - 1];
  const scope = d.closest('#overlay') ? 'ov:' + (top ? top.type : '') : d.closest('#sheet') ? 'sheet' : 'view:' + S.view;
  const sum = d.querySelector('summary');
  return scope + ':' + (sum && sum.childNodes[0] ? sum.childNodes[0].textContent.trim() : '');
}
document.addEventListener('toggle', e => {
  const d = e.target;
  if (!d || d.tagName !== 'DETAILS' || !d.isConnected) return;
  if (d.open) OPEN.add(dkey(d)); else OPEN.delete(dkey(d));
}, true);
/* Save buttons. Everything is stored the moment you enter it; the button confirms it,
   and flips back to "Save" as soon as that section changes again. */
const isSaved = (sec, k) => sec === 'appts' ? !!settings().apptsSaved : !!((day(k || S.date).saved || {})[sec]);
const saveBtn = sec => { const ok = isSaved(sec); return `<button class="btn mt ${ok ? 'saved' : ''}" data-act="saveSec" data-sec="${sec}">${ok ? 'Saved ✓' : 'Save'}</button>`; };
function markDirty(sec) {
  if (sec === 'appts') { if (settings().apptsSaved) setSetting('apptsSaved', false); }
  else if (isSaved(sec)) upd(S.date, d => { d.saved[sec] = false; });
  const finished = !!(day(S.date).end || {}).finished;
  document.querySelectorAll(`[data-sec="${sec}"]`).forEach(b => {
    b.classList.remove('saved');
    b.textContent = sec !== 'session' ? 'Save' : finished ? 'Save changes' : 'Finish session';
  });
}
function restoreOpen() { document.querySelectorAll('details').forEach(d => { if (OPEN.has(dkey(d))) d.open = true; }); }

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 1600);
}

function applyTheme() {
  const pref = settings().theme || P.appearance.default;
  const dark = pref === 'dark' || (pref === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]').content = dark ? '#0C0E13' : '#F3F5F9';
}

/* ---------- render ---------- */
function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
  $('#view').innerHTML = S.view === 'food' ? viewFood() : S.view === 'body' ? viewBody() : viewToday();
  const top = S.stack[S.stack.length - 1];
  const ov = $('#overlay');
  const prevScroll = ov.scrollTop;
  if (top) {
    ov.innerHTML = `<div class="ov-body">${top.type === 'howto' ? viewHowTo(top.ex) : viewSession()}</div>`;
    ov.classList.add('on'); document.body.classList.add('ov-open');
    restoreOpen(); // before restoring the scroll, so the page is its full height again
    if (top.scroll != null) { ov.scrollTop = top.scroll; top.scroll = null; }
    else if (top === S.lastTop) ov.scrollTop = prevScroll;
  } else { ov.classList.remove('on'); ov.innerHTML = ''; document.body.classList.remove('ov-open'); }
  const sh = $('#sheet');
  if (S.sheet && !(top && top.fromSheet)) { sh.innerHTML = `<div class="scrim" data-act="back"></div><div class="panel"><div class="grab"></div><button class="back" data-act="back" aria-label="Close" style="float:right;margin-left:10px">×</button>${viewSheet()}</div>`; sh.classList.add('on'); }
  else { sh.classList.remove('on'); sh.innerHTML = ''; }
  S.lastTop = top || null;
  restoreOpen();
  paintRest();
}

/* ----- Today ----- */
function viewToday() {
  const k = S.date, d = day(k), plan = planFor(k), wk = weekOf(k), isToday = k === today();
  const head = `<div class="top">
      <div style="flex:1"><h1>${isToday ? 'Today' : esc(DAYNAME[dowOf(k)])}</h1><div class="sub">${esc(short(k))} · Block ${P.block.number}, week ${wk}</div></div>
      <button class="arrow" data-act="day" data-n="-1" aria-label="Previous day">‹</button>
      <button class="arrow" data-act="day" data-n="1" aria-label="Next day">›</button></div>
    <div class="chips">${plan.fastDay ? '<span class="chip acc">Fast day</span>' : ''}
      ${!isToday ? '<button class="chip" data-act="toToday">Back to today</button>' : ''}
      ${wk === 6 ? '<span class="chip">Deload week</span>' : ''}</div>`;
  if (!d.check || d.editCheck) return head + viewCheck(k, d);
  return head + viewDay(k, d);
}

function viewCheck(k, d) {
  const c = d.check || {};
  const y = addDays(k, -1);
  const showAfter = (planFor(y).timeline.some(t => t.kind === 'plyo') && plyoDue(y)) || runDay(y);
  let groupDone = false;
  const rows = P.morningCheck.fields.map(f => {
    if (f.id === 'afterPlyos' && !showAfter) return '';
    if (f.type === 'time') {
      const v = c[f.id] || f.default;
      const [h, m] = v.split(':');
      return `<div class="row"><div class="grow">${esc(f.label)}</div><input class="field small" type="time" data-f="${f.id}" value="${pad(+h)}:${m}"></div>`;
    }
    if (f.type === 'number') return `<div class="row"><div class="grow">${esc(f.label)}</div><input class="field small" type="number" inputmode="decimal" step="0.1" data-f="${f.id}" value="${esc(c[f.id] ?? '')}" placeholder="${esc(f.unit)}"></div>`;
    if (f.type === 'slider') {
      const v = c[f.id] ?? 0;
      return `<div class="row" style="flex-wrap:wrap"><div class="grow">${esc(f.label)} <span class="sub">0–10</span></div><span class="pain-val ${painClass(v)}" id="pv">${v}</span>
        <input type="range" min="${f.min}" max="${f.max}" step="1" value="${v}" data-f="${f.id}" data-in="painSlider"></div>`;
    }
    if (f.type === 'yesNo') {
      const v = !!c[f.id];
      let g = '';
      if (f.group && !groupDone) { g = `<div class="lbl" style="margin:14px 0 2px">${esc(f.group)}</div>`; groupDone = true; }
      return `${g}<div class="row"><div class="grow">${esc(f.label)}</div><div class="seg danger" data-f="${f.id}">
        <button data-act="seg" data-val="false" class="${v ? '' : 'on'}">No</button><button data-act="seg" data-val="true" class="${v ? 'on' : ''}">Yes</button></div></div>`;
    }
    return '';
  }).join('');
  return `<div class="card">${rows}</div>
    <button class="btn mt" data-act="saveCheck">Save</button>
    ${d.editCheck ? '<button class="btn ghost mt" data-act="cancelEdit">Cancel</button>' : ''}`;
}

function viewDay(k, d) {
  const c = d.check, plan = planFor(k), flags = kneeFlags(c), stop = flags.length > 0;
  const sid = sessionIdFor(k), s = P.sessions[sid], loc = locFor(sid, k);
  const done = d.done || {};
  const parts = [];
  if (c.weightKg) parts.push(`${c.weightKg} kg`);
  parts.push(`<span class="${painClass(c.backPain)}">Back ${c.backPain ?? 0}</span>`);
  parts.push(stop ? `<span class="red">Knee: ${esc(flags.join(', '))}</span>` : 'Knee clear');
  let html = `<div class="sub" style="margin:-6px 0 12px">${parts.join(' · ')} · <button class="link" data-act="editCheck">Edit</button></div>`;
  if (stop) html += `<div class="alert"><b>Knee stop signal.</b> No lower-body work, plyos or running today. Get it seen.</div>`;
  if (c.afterPlyos) html += `<div class="alert warn">${esc(P.run.nextMorningRule)}</div>`;
  if (c.backPain >= 6) html += `<div class="alert warn">Back pain ${c.backPain}/10. Go by the back rules in the session's Guidelines.</div>`;

  const rows = plan.timeline.map(t => {
    const tick = (key, label, sub, act, extra) => `<div class="tl ${done[key] ? 'done' : ''}"><div class="t">${esc(t.time)}</div>
      <div class="grow" ${act || ''}><div class="name">${label}</div>${sub ? `<div class="sub">${sub}</div>` : ''}${extra || ''}</div>
      <button class="tick ${done[key] ? 'on' : ''}" data-act="tick" data-k="${key}" aria-label="Done"></button></div>`;
    switch (t.kind) {
      case 'water': return tick('water', 'Water on waking', `${P.food.water.onWakingMl} ml`);
      case 'back': return tick('back', 'Back routine', `${esc(P.blocks.backRoutine.minutes)} min · tap for the list`, 'data-act="sheet" data-s="block" data-b="backRoutine"');
      case 'session': {
        const fin = !!d.end;
        const where = loc ? (loc === 'home' ? 'Home' : 'Gym') : s.where;
        return `<div class="tl"><div class="t">${esc(t.time)}</div><div class="grow"><div class="sess ${fin ? 'done' : ''}">
          <div class="name">${esc(s.name)}${fin ? ' · done' : ''}</div><div class="sub">${s.minutes} min · ${esc(where || '')}</div>
          ${stop && s.rewriteAfterSurgery ? '<div class="note red">Knee stop signal: skip this one today.</div>' : ''}
          <div class="acts"><button class="btn ghost sm" data-act="sheet" data-s="change">Change session</button>
          <button class="btn sm" data-act="openSession">${fin ? 'Open' : 'Start'}</button></div></div></div></div>`;
      }
      case 'meal': {
        const m = (plan.fastDay ? P.food.meals.fast : P.food.meals.normal)[t.meal];
        const mk = 'meal_' + t.meal;
        const open = !!S.mealOpen[k + ':' + t.meal];
        const items = m.items || m[protein()] || [];
        const list = open ? `<div class="meal"><div class="items">${items.map(([n, a]) => `<div class="it"><span>${esc(n)}</span><span>${esc(a)}</span></div>`).join('')}</div></div>` : '';
        return tick(mk, esc(m.name), open ? 'Tap to hide portions' : 'Tap for portions', `data-act="meal" data-m="${t.meal}"`, list);
      }
      case 'plyo':
        if (stop || !plyoDue(k)) return '';
        return tick('plyo', 'Physio plyos', `${P.blocks.plyo.minutes} min${t.sub ? ' · ' + esc(t.sub) : ''} · tap for the list`, 'data-act="sheet" data-s="block" data-b="plyo"');
      case 'run':
        if (stop || !runDay(k)) return '';
        return tick('run', `Run · stage ${runStage()}`, esc(P.run.stages[runStage()].session));
      default: return '';
    }
  }).join('');
  html += `<div class="card">${rows}</div>`;
  html += `<div class="lbl">Notes</div><textarea class="field" data-in="note" placeholder="Anything for the weekly check-in">${esc(d.notes || '')}</textarea>${saveBtn('today')}`;
  return html;
}

/* ----- Session ----- */
function viewSession() {
  const k = S.date, d = day(k), sid = sessionIdFor(k), s = P.sessions[sid], loc = locFor(sid, k);
  const blocks = sessionBlocks(sid, k), stop = kneeStop(k);
  let html = `<div class="ov-top"><button class="back" data-act="back" aria-label="Back">‹</button>
    <div style="flex:1"><h1>${esc(s.name)}</h1><div class="sub">${esc(short(k))} · ${s.minutes} min</div></div>
    ${loc ? `<div class="seg"><button data-act="loc" data-val="home" class="${loc === 'home' ? 'on' : ''}">Home</button><button data-act="loc" data-val="gym" class="${loc === 'gym' ? 'on' : ''}">Gym</button></div>` : ''}</div>`;
  html += `<div id="restbox"></div>`;
  if (stop && s.rewriteAfterSurgery) html += `<div class="alert"><b>Knee stop signal.</b> No lower-body work today.</div>`;
  html += guidelinesBox(blocks);
  const wk = weekOf(k);
  if (P.block.weekNotes[wk]) html += `<div class="note" style="margin:-2px 2px 10px">${esc(P.block.weekNotes[wk])}</div>`;

  blocks.forEach((b, bi) => {
    if (stop && b.useBlock === 'plyo') return;
    const logged = b.items.some(i => i.log);
    if (logged) {
      html += `<div class="lbl">${esc(b.name)} <span style="text-transform:none;letter-spacing:0;font-weight:400">· ${b.minutes} min</span></div>`;
      b.items.forEach(it => { html += liftCard(k, d, it); });
      return;
    }
    const list = b.items.length ? b.items.map(it => exRow(it)).join('') : '';
    html += `<details><summary>${esc(b.name)} <span class="sub">· ${b.minutes} min</span></summary><div class="dd">
      ${b.note ? `<p class="note" style="margin-top:0">${esc(b.note)}</p>` : ''}${list}</div></details>`;
  });

  const end = d.end || {};
  const sauna = blocks.some(b => /sauna/i.test(b.name));
  const scale = (f) => `<div class="row"><div class="grow">${esc(f.label)} <span class="sub">${f.min}–${f.max}</span></div><div class="seg" data-save="end.${f.id}">
    ${Array.from({ length: f.max - f.min + 1 }, (_, i) => f.min + i).map(v => `<button data-act="seg" data-val="${v}" class="${end[f.id] === v ? 'on' : ''}">${v}</button>`).join('')}</div></div>`;
  const yn = (f) => `<div class="row"><div class="grow">${esc(f.label)}</div><div class="seg" data-save="end.${f.id}">
    <button data-act="seg" data-val="false" class="${end[f.id] === false ? 'on' : ''}">No</button><button data-act="seg" data-val="true" class="${end[f.id] === true ? 'on' : ''}">Yes</button></div></div>`;
  const endRows = P.sessionEnd.fields.map(f => f.type === 'scale' ? scale(f) : (f.id === 'sauna' && !sauna) ? '' : yn(f)).join('');
  html += `<div class="lbl">How was it?</div><div class="card">${endRows}</div>
    <button class="btn ${isSaved('session') ? 'saved' : ''}" data-act="finish" data-sec="session">${!(d.end && d.end.finished) ? 'Finish session' : isSaved('session') ? 'Saved ✓' : 'Save changes'}</button>`;
  return html;
}

function guidelinesBox(blocks) {
  const g = P.guidelines;
  const ids = new Set(); blocks.forEach(b => b.items.forEach(i => { ids.add(i.ex); if (i.orInstead) ids.add(i.orInstead.ex); }));
  const limits = [];
  ids.forEach(id => { const e = P.exercises[id]; if (e && e.limit) Object.values(e.limit).forEach(l => limits.push(`<li><b>${esc(e.name)}:</b> ${esc(l)}</li>`)); });
  const list = sec => `<h3>${esc(sec.title)}</h3><ul class="plain">${sec.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>${sec.note ? `<p class="note">${esc(sec.note)}</p>` : ''}`;
  return `<details class="slim"><summary>Guidelines</summary><div class="dd">
    ${list(g.kneeStop)}${list(g.kneeRules)}
    ${limits.length ? `<h3>Today's exercises</h3><ul class="plain">${limits.join('')}</ul>` : ''}
    ${list(g.back)}${list(g.daily)}</div></details>`;
}

function exRow(it) {
  return `<div class="ex"><div class="grow"><div class="name">${esc(exName(it.ex))}</div>
    <div class="sub">${esc(it.target || '')}${it.note ? ' · ' + esc(it.note) : ''}${it.alternateDays ? ' · Other days: ' + esc(it.alternateDays) : ''}</div></div>
    <button class="info" data-act="howto" data-ex="${esc(it.ex)}" aria-label="How to">i</button></div>`;
}

function liftCard(k, d, item) {
  const swapped = item.orInstead && d.swap && d.swap[item.slot];
  const it = swapped ? { ...item, ...item.orInstead } : item;
  const slot = item.slot || item.ex;
  const sets = (d.sets && d.sets[slot]) || [];
  const loads = settings().loads || {};
  const load = (d.loads && d.loads[slot]) ?? loads[it.ex] ?? (it.load ? String(it.load).replace(/\s*kg$/, '') : '');
  const unit = it.log === 'seconds' ? 's' : '';
  const ph = (String(it.target).match(/×\s*(\d+)/) || [])[1] || '';
  const n = it.sets || 3;
  const pain = d.pain && d.pain[slot];
  const boxes = Array.from({ length: n }, (_, i) => `<input class="field" type="number" inputmode="numeric" data-in="set" data-slot="${esc(slot)}" data-i="${i}" value="${esc(sets[i] ?? '')}" placeholder="${esc(ph + unit)}" aria-label="Set ${i + 1}">`).join('');
  const usesLoad = !!(it.load || loads[it.ex] || (d.loads && d.loads[slot] != null) || /weighted|press|deadlift|rdl|row|squat|thrust|curl|carry/i.test(it.ex));
  return `<div class="lift"><div class="head">${item.slot ? `<span class="slot">${esc(item.slot)}</span>` : ''}
      <div style="flex:1;min-width:0"><div class="name">${esc(exName(it.ex))}</div><div class="sub">${esc(it.target)}</div>${it.note ? `<div class="note">${esc(it.note)}</div>` : ''}</div>
      <button class="info" data-act="howto" data-ex="${esc(it.ex)}" aria-label="How to">i</button></div>
    ${usesLoad ? `<div class="load">Load <input class="field" inputmode="decimal" data-in="load" data-slot="${esc(slot)}" data-ex="${esc(it.ex)}" value="${esc(load)}" placeholder="kg"> kg
      ${it.warmUpSets ? `<span>· Warm up ${esc(it.warmUpSets)}</span>` : ''}</div>` : ''}
    ${it.loadNote && !loads[it.ex] ? `<div class="note">${esc(it.loadNote)}</div>` : ''}
    <div class="sets">${boxes}<button class="pain ${pain || ''}" data-act="pain" data-slot="${esc(slot)}">${pain === 'amber' ? 'Pain 3–5' : pain === 'red' ? 'Pain 6+' : '+ Pain'}</button></div>
    ${pain ? `<div class="note ${pain === 'red' ? 'red' : 'amber'}">${esc(P.sessionEnd.painButton[pain])}</div>` : ''}
    ${item.orInstead ? `<button class="swap" data-act="swap" data-slot="${esc(item.slot)}">${swapped ? '↺ Back to ' + esc(exName(item.ex)) : 'Or instead: ' + esc(exName(item.orInstead.ex)) + ' ' + esc(item.orInstead.target)}</button>` : ''}
  </div>`;
}

/* ----- How-to ----- */
function viewHowTo(id) {
  const h = H.exercises[id] || { steps: [], watchFor: [] }, e = P.exercises[id] || {};
  let html = `<div class="ov-top"><button class="back" data-act="back" aria-label="Back">‹</button><h1>${esc(exName(id))}</h1></div>`;
  if (h.photos) html += `<div class="photos"><img src="photos/${encodeURIComponent(h.photos)}__0.jpg" alt="Start position" loading="lazy"><img src="photos/${encodeURIComponent(h.photos)}__1.jpg" alt="End position" loading="lazy"></div>${h.photoNote ? `<p class="note" style="margin:0 0 10px">${esc(h.photoNote)}</p>` : ''}`;
  if (e.cue || e.limit) html += `<div class="card">${e.cue ? `<div>${esc(e.cue)}</div>` : ''}${e.limit ? Object.values(e.limit).map(l => `<div class="limit">${esc(l)}</div>`).join('') : ''}</div>`;
  if (h.steps.length) html += `<div class="card"><ol class="steps">${h.steps.map(([t, x]) => `<li><b>${esc(t)}</b>${esc(x)}</li>`).join('')}</ol></div>`;
  if (h.watchFor && h.watchFor.length) html += `<div class="lbl">Watch for</div><div class="card"><ul class="plain" style="margin:0">${h.watchFor.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>`;
  if (h.video) {
    const top = S.stack[S.stack.length - 1];
    html += `<div class="lbl">Video</div>`;
    html += top.video
      ? `<iframe class="video" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(h.video.id)}?rel=0&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="${esc(h.video.title)}"></iframe>`
      : `<button class="btn ghost" data-act="video">▶ Watch the video</button>`;
    html += `<p class="note">${esc(h.video.title)} · ${esc(h.video.channel)}${h.video.note ? '<br>' + esc(h.video.note) : ''}</p>`;
  }
  if (e.goal) html += `<p class="note mt">Progress: ${esc(e.goal)}</p>`;
  return html;
}

/* ----- Food ----- */
function viewFood() {
  const k = S.date, d = day(k), plan = planFor(k), fast = plan.fastDay, pr = protein();
  const meals = fast ? P.food.meals.fast : P.food.meals.normal;
  const done = d.done || {};
  const water = d.water || 0, target = waterTarget(k);
  let html = `<div class="top"><div style="flex:1"><h1>Food</h1><div class="sub">${esc(short(k))}</div></div>
    <button class="arrow" data-act="day" data-n="-1">‹</button><button class="arrow" data-act="day" data-n="1">›</button></div>
    <div class="chips"><span class="chip ${fast ? 'acc' : ''}">${fast ? 'Fast day' : 'Normal day'}</span>
    <button class="chip" data-act="protein">${pr === 'beef' ? 'Beef week' : 'Chicken week'} ⇄</button></div>`;
  if (fast) html += `<div class="alert warn" style="color:var(--text2)">${esc(P.food.fastDayRule)}</div>`;
  html += `<div class="card"><div class="water"><div class="grow" style="flex:1"><div class="sub">Water</div><span class="num">${(water / 1000).toFixed(1)} L</span> <span class="muted">/ ${(target / 1000).toFixed(1)} L</span></div>
    <button class="btn ghost sm" data-act="water" data-n="-${P.food.water.tapMl}" aria-label="Undo">−</button>
    <button class="btn sm" data-act="water" data-n="${P.food.water.tapMl}">+ ${P.food.water.tapMl} ml</button></div>
    <div class="wbar"><i style="width:${Math.min(100, water / target * 100)}%"></i></div></div>`;
  ['shake', 'lunch', 'dinner'].forEach(m => {
    const meal = meals[m], items = meal.items || meal[pr] || [];
    const key = 'meal_' + m;
    html += `<div class="card meal"><div style="display:flex;align-items:center;gap:10px"><div style="flex:1"><h2>${esc(meal.name)}</h2><div class="sub">${esc(meal.time)}</div></div>
      <button class="tick ${done[key] ? 'on' : ''}" data-act="tick" data-k="${key}" aria-label="Eaten"></button></div>
      <div class="items">${items.map(([n, a]) => `<div class="it"><span>${esc(n)}</span><span>${esc(a)}</span></div>`).join('')}</div></div>`;
  });
  html += `<div class="card"><div style="display:flex;align-items:center;gap:10px"><div style="flex:1"><b>Creatine</b> <span class="muted">${esc(P.food.creatine)}</span></div>
    <button class="tick ${done.creatine ? 'on' : ''}" data-act="tick" data-k="creatine" aria-label="Taken"></button></div></div>`;
  const total = fast ? meals.dayTotal : meals.dayTotal[pr];
  html += `<p class="note" style="margin:0 2px 4px">Day: ${esc(total)}</p>`;
  html += `<div class="lbl">Ate something else?</div><textarea class="field" data-in="foodExtra" placeholder="What and roughly how much">${esc(d.foodExtra || '')}</textarea>${saveBtn('food')}`;

  const sh = P.food.shopping, bc = P.food.batchCook;
  const li = arr => (arr || []).map(x => Array.isArray(x) ? `<li>${esc(x[0])}${x[1] ? ` <span class="muted">× ${esc(x[1])}</span>` : ''}</li>` : `<li>${esc(x)}</li>`).join('');
  html += `<div class="lbl">This week · ${pr === 'beef' ? 'Beef' : 'Chicken'}</div>
    <details><summary>Shopping list</summary><div class="dd">
      <h3>Aldi</h3><ul class="plain">${li(sh.aldi.everyWeek)}${li(sh.aldi[pr])}</ul>
      <h3>Aldi, when low</h3><ul class="plain">${li(sh.aldi.whenLow)}</ul>
      <h3>Woolworths</h3><ul class="plain">${li(sh.woolworths.everyWeek)}</ul>
      <h3>Online</h3><ul class="plain">${li(sh.online)}</ul></div></details>
    <details><summary>Batch cook <span class="sub">· ${bc.minutes} min</span></summary><div class="dd">
      <h3>Rice</h3><ol class="plain">${li(bc.rice)}</ol>
      <h3>${pr === 'beef' ? 'Beef' : 'Chicken'}</h3><ol class="plain">${li(bc[pr])}</ol>
      <h3>Portioning</h3><ol class="plain">${li(bc.portioning)}</ol></div></details>
    <p class="note" style="margin:4px 2px">${esc(bc.nightly)}</p>`;
  return html;
}

/* ----- Body ----- */
function viewBody() {
  const k = today(), c = day(k).check || {};
  const g = P.guidelines;
  const appts = upcomingAppts();
  const next = appts[0];
  let html = `<div class="top"><h1>Body</h1></div>
    <button class="btn" data-act="sheet" data-s="export">Copy week for Claude</button><div style="height:14px"></div>`;
  html += `<details><summary>Next up ${next ? `<span class="chip acc" style="margin-left:4px">${esc(next.label)}</span>` : ''}</summary><div class="dd">
    ${appts.length ? appts.map(a => `<div class="ex"><div class="grow"><div class="name">${esc(a.what)}</div><div class="sub">${esc(a.label)}${a.time ? ' · ' + esc(a.time) : ''}${a.note ? '<br>' + esc(a.note) : ''}</div></div></div>`).join('') : '<p class="note">Nothing yet.</p>'}
    <div class="lbl" style="margin-top:12px">Add your own · one per line: date | time | what</div>
    <textarea class="field" data-in="appts" placeholder="2026-12-03 | 4:00 pm | Physio">${esc(settings().appts || '')}</textarea>${saveBtn('appts')}
    </div></details>`;
  const list = items => `<ul class="plain">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
  html += `<details class="stop"><summary>Stop and get seen if</summary><div class="dd" style="color:var(--text)">${list(g.kneeStop.items)}<p class="note">${esc(g.kneeStop.note)}</p></div></details>`;
  html += `<details><summary>Knee rules</summary><div class="dd">${list(g.kneeRules.items)}</div></details>`;
  const st = runStage(), fq = plyoFreq();
  html += `<details><summary>Physio plyos + run</summary><div class="dd">
    <div class="row"><div class="grow">Plyos</div><div class="seg">${P.blocks.plyo.frequencyOptions.map(o => `<button data-act="plyoFreq" data-val="${esc(o)}" class="${fq === o ? 'on' : ''}">${o === 'daily' ? 'Daily' : 'Every 2nd day'}</button>`).join('')}</div></div>
    <div class="row"><div class="grow">Run stage</div><div class="seg">${Object.keys(P.run.stages).map(s => `<button data-act="runStage" data-val="${s}" class="${st === s ? 'on' : ''}">${s}</button>`).join('')}</div></div>
    <p class="note"><b>Stage ${st}:</b> ${esc(P.run.stages[st].session)}. ${esc(P.run.note)}</p>
    <p class="note">Move on when: ${esc(P.run.stages[st].moveOn)}</p>
    <p class="note">${esc(P.run.nextMorningRule)}</p></div></details>`;
  const bp = c.backPain;
  html += `<details><summary>Lower back ${bp != null ? `<span class="sub ${painClass(bp)}">· ${bp}/10 today</span>` : ''}</summary><div class="dd">${list(g.back.items)}<p class="note">${esc(P.blocks.backRoutine.note)}</p></div></details>`;
  html += `<div class="lbl">Trends · last ${P.trends.days} days</div>${trends()}`;
  const th = settings().theme || P.appearance.default;
  html += `<div class="lbl">Appearance</div><div class="card"><div class="seg" style="display:flex">${P.appearance.options.map(o => `<button style="flex:1" data-act="theme" data-val="${o}" class="${th === o ? 'on' : ''}">${o[0].toUpperCase() + o.slice(1)}</button>`).join('')}</div></div>`;
  html += `<details><summary>Backup</summary><div class="dd"><p class="note" style="margin-top:0">Everything you log lives on this phone. Copy a backup now and then, and paste it back if the phone ever loses it.</p>
    <div style="display:flex;gap:8px" class="mt"><button class="btn ghost sm" data-act="backup">Copy backup</button><button class="btn ghost sm" data-act="sheet" data-s="restore">Restore</button></div></div></details>`;
  html += `<div class="card" style="display:flex;align-items:center;gap:10px"><div style="flex:1"><b>Version ${VERSION}</b><div class="sub">Your log is kept when you update.</div></div><button class="btn ghost sm" data-act="update">Update app</button></div>`;
  return html;
}

function upcomingAppts() {
  const t = today();
  const fromData = (P.appointments || []).map(a => ({ date: a.date, time: a.time || '', what: a.what, note: a.note || '' }));
  const extra = (settings().appts || '').split('\n').map(l => l.split('|').map(x => x.trim())).filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p[0]))
    .map(([date, time, what]) => ({ date, time: time || '', what: what || '' }));
  return fromData.concat(extra).map(a => ({ ...a, label: short(a.date) })).filter(a => a.date >= t).sort((a, b) => a.date.localeCompare(b.date));
}

function trends() {
  const n = P.trends.days, keys = Array.from({ length: n }, (_, i) => addDays(today(), i - n + 1));
  const checks = keys.map(k => day(k).check);
  // weight, 7-day rolling average
  const w = checks.map(c => c && c.weightKg ? +c.weightKg : null);
  const avg = w.map((_, i) => { const win = w.slice(Math.max(0, i - 6), i + 1).filter(v => v != null); return win.length ? win.reduce((a, b) => a + b, 0) / win.length : null; });
  const pts = avg.map((v, i) => v == null ? null : [i, v]).filter(Boolean);
  let spark = '<p class="note">Log your weight in the morning check to see this.</p>';
  if (pts.length) {
    const vs = pts.map(p => p[1]), lo = Math.min(...vs) - 0.3, hi = Math.max(...vs) + 0.3;
    const X = i => 4 + i * (292 / (n - 1)), Y = v => 64 - (v - lo) / (hi - lo) * 56;
    const raw = w.map((v, i) => v == null ? '' : `<circle cx="${X(i)}" cy="${Y(v)}" r="2.2" fill="var(--faint)"/>`).join('');
    spark = `<svg class="spark" viewBox="0 0 300 70" preserveAspectRatio="none">${raw}<polyline fill="none" stroke="var(--acc)" stroke-width="2.5" stroke-linejoin="round" points="${pts.map(p => `${X(p[0])},${Y(p[1])}`).join(' ')}"/></svg>
      <div class="sub">7-day average now <b class="num" style="color:var(--text)">${pts[pts.length - 1][1].toFixed(1)} kg</b></div>`;
  }
  const bars = checks.map(c => c ? `<i class="${painClass(c.backPain) || ''}" style="height:${Math.max(5, (c.backPain || 0) * 10)}%"></i>` : '<i class="none"></i>').join('');
  const logged = checks.filter(Boolean), clear = logged.filter(c => !kneeFlags(c).length).length;
  const dots = checks.map(c => `<i class="${c ? (kneeFlags(c).length ? 'bad' : 'ok') : ''}"></i>`).join('');
  return `<div class="card"><div class="sub">Weight</div>${spark}</div>
    <div class="card"><div class="sub" style="margin-bottom:6px">Morning back pain</div><div class="bars">${bars}</div></div>
    <div class="card"><div class="sub" style="margin-bottom:6px">Knee checks clear · ${clear} of ${logged.length} logged</div><div class="dots">${dots}</div></div>`;
}

/* ----- Sheets ----- */
function viewSheet() {
  const sh = S.sheet;
  if (sh.type === 'block') {
    const b = P.blocks[sh.b];
    return `<h2>${esc(b.name)}</h2><div class="sub">${esc(b.minutes)} min</div>${b.note ? `<p class="note">${esc(b.note)}</p>` : ''}
      <div class="mt">${b.items.map(exRow).join('')}</div>`;
  }
  if (sh.type === 'change') {
    const k = S.date, cur = sessionIdFor(k), sched = planFor(k).session;
    const warn = threeHardWarning(k);
    return `<h2>Change session</h2><div class="sub">${esc(short(k))}</div>${warn ? `<div class="alert warn mt">${warn}</div>` : ''}
      ${Object.entries(P.sessions).map(([id, s]) => `<button class="pick ${id === cur ? 'on' : ''}" data-act="pickSession" data-id="${id}">
        <div class="grow"><b>${esc(s.name)}</b><div class="sub">${s.minutes} min · ${esc(s.where || '')}${id === sched ? ' · scheduled' : ''}${s.hard ? ' · hard' : ''}</div></div></button>`).join('')}`;
  }
  if (sh.type === 'export') {
    return `<h2>Copy week for Claude</h2><div class="sub">Last 7 days. Paste it into the chat.</div><pre class="export" id="exportText">${esc(exportText())}</pre>
      <button class="btn" data-act="copyExport">Copy</button>`;
  }
  if (sh.type === 'restore') {
    return `<h2>Restore</h2><p class="note">Paste a backup. It replaces what's on this phone.</p><textarea class="field mt" id="restoreText"></textarea>
      <button class="btn mt" data-act="restore">Restore</button>`;
  }
  return '';
}

function threeHardWarning(k) {
  const hard = kk => { const d = day(kk); const s = P.sessions[d.session || planFor(kk).session]; return s && s.hard; };
  if (!P.sessionEnd.warnIfThreeHardDaysInARow) return '';
  if (hard(addDays(k, -1)) && hard(addDays(k, -2))) return 'The last two days were hard sessions. A third hard day in a row isn\'t in the plan; pick an easier one if you can.';
  return '';
}

/* ----- Export ----- */
function exportText() {
  const end = today(), start = addDays(end, -6);
  const lines = [`Training log ${short(start)} – ${short(end)} (block ${P.block.number}, week ${weekOf(end)})`,
    `Settings: plyos ${plyoFreq()}, run stage ${runStage()}, ${protein()} week`, ''];
  for (let i = 0; i < 7; i++) {
    const k = addDays(start, i), d = day(k), plan = planFor(k), sid = sessionIdFor(k), s = P.sessions[sid], loc = locFor(sid, k);
    const has = Object.keys(d).length > 0;
    lines.push(`${short(k)} · ${s.name}${loc ? ' (' + loc + ')' : ''}${d.session && d.session !== plan.session ? ' [changed from ' + P.sessions[plan.session].name + ']' : ''}${plan.fastDay ? ' · fast day' : ''}`);
    if (!has) { lines.push('  Nothing logged', ''); continue; }
    const c = d.check;
    if (c) {
      const f = kneeFlags(c);
      lines.push(`  Morning: woke ${c.wokeAt || '?'}${c.weightKg ? ' · ' + c.weightKg + ' kg' : ''} · back ${c.backPain ?? '?'}/10 · knee ${f.length ? 'FLAG: ' + f.join(', ') : 'clear'}${c.afterPlyos != null ? ' · after plyos/run: ' + (c.afterPlyos ? 'swelling or pain up' : 'fine') : ''}`);
    }
    const blocks = sessionBlocks(sid, k);
    const lifts = [];
    blocks.forEach(b => b.items.filter(it => it.log).forEach(item => {
      const slot = item.slot || item.ex;
      const swapped = item.orInstead && d.swap && d.swap[item.slot];
      const it = swapped ? { ...item, ...item.orInstead } : item;
      const sets = ((d.sets || {})[slot] || []).filter(v => v !== '' && v != null);
      const load = (d.loads || {})[slot];
      const pain = (d.pain || {})[slot];
      if (!sets.length && !pain && load == null) return;
      lines.push(`  ${item.slot ? item.slot + ' ' : ''}${exName(it.ex)}${load ? ' @ ' + load + ' kg' : ''}: ${sets.length ? sets.join(', ') + (it.log === 'seconds' ? ' s' : '') : 'no sets'} (target ${it.target})${pain ? ' · pain ' + (pain === 'red' ? '6+' : '3–5') : ''}`);
      lifts.push(1);
    }));
    if (d.end) {
      const e = d.end;
      lines.push(`  Session ${e.finished ? 'finished' : 'not finished'}${e.soreness ? ' · soreness ' + e.soreness + '/4' : ''}${e.performance ? ' · performance ' + e.performance + '/4' : ''}${e.sauna != null ? ' · sauna ' + (e.sauna ? 'yes' : 'no') : ''}`);
    }
    const dn = d.done || {};
    const bits = [];
    bits.push(`water ${((d.water || 0) / 1000).toFixed(1)}/${(waterTarget(k) / 1000).toFixed(1)} L`);
    const ate = ['shake', 'lunch', 'dinner'].filter(m => dn['meal_' + m]);
    bits.push(ate.length ? 'ate ' + ate.join(', ') : 'no meals ticked');
    if (dn.creatine) bits.push('creatine');
    if (dn.back) bits.push('back routine');
    if (dn.plyo) bits.push('plyos');
    if (dn.run) bits.push('run');
    lines.push('  ' + bits.join(' · '));
    if (d.foodExtra) lines.push('  Other food: ' + d.foodExtra.replace(/\s+/g, ' '));
    if (d.notes) lines.push('  Notes: ' + d.notes.replace(/\s+/g, ' '));
    lines.push('');
  }
  return lines.join('\n').trim();
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (_) { } ta.remove(); return ok;
  }
}

/* ---------- rest timer ---------- */
function startRest() { S.rest = Date.now() + REST_SECONDS * 1000; paintRest(); }
function paintRest() {
  const box = document.getElementById('restbox');
  if (!box) return;
  if (!S.rest) { box.innerHTML = ''; return; }
  const left = Math.round((S.rest - Date.now()) / 1000);
  const over = left <= 0, a = Math.abs(left);
  box.innerHTML = `<div class="rest ${over ? 'over' : ''}"><span>${over ? 'Rest done' : 'Rest'}</span><span class="num">${over ? '+' : ''}${Math.floor(a / 60)}:${pad(a % 60)}</span><button data-act="stopRest">Dismiss</button></div>`;
  if (over && !S.restBuzzed) { S.restBuzzed = true; if (navigator.vibrate) navigator.vibrate([200, 100, 200]); }
}
setInterval(() => { if (S.rest) paintRest(); }, 1000);

/* ---------- navigation ---------- */
function pushOverlay(entry) {
  const ov = $('#overlay'), top = S.stack[S.stack.length - 1];
  if (top) top.scroll = ov.scrollTop;
  S.stack.push(entry); history.pushState({ d: S.stack.length }, ''); render(); ov.scrollTop = 0;
}
function openSheet(sheet) { S.sheet = sheet; history.pushState({ s: 1 }, ''); render(); }
window.addEventListener('popstate', () => {
  const top = S.stack[S.stack.length - 1];
  if (top && top.fromSheet) S.stack.pop();
  else if (S.sheet) S.sheet = null;
  else if (S.stack.length) S.stack.pop();
  render();
});
const back = () => history.back();

/* ---------- actions ---------- */
const ACT = {
  tab(t) { S.view = t.dataset.v; render(); scrollTo(0, 0); },
  day(t) { S.date = addDays(S.date, +t.dataset.n); render(); },
  toToday() { S.date = today(); render(); },
  back,
  seg(t) {
    const g = t.parentElement;
    g.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === t));
    const raw = t.dataset.val, val = raw === 'true' ? true : raw === 'false' ? false : isNaN(+raw) ? raw : +raw;
    if (g.dataset.save) { upd(S.date, d => setPath(d, g.dataset.save, val)); markDirty('session'); }
  },
  saveCheck() {
    const c = {};
    document.querySelectorAll('#view [data-f]').forEach(el => {
      const f = el.dataset.f;
      if (el.classList.contains('seg')) c[f] = el.querySelector('.on').dataset.val === 'true';
      else if (el.type === 'range') c[f] = +el.value;
      else if (el.type === 'time') { const [h, m] = el.value.split(':'); c[f] = el.value ? `${+h}:${m}` : ''; }
      else c[f] = el.value === '' ? null : el.value;
    });
    upd(S.date, d => { d.check = c; delete d.editCheck; });
    render(); scrollTo(0, 0);
  },
  editCheck() { upd(S.date, d => { d.editCheck = true; }); render(); },
  cancelEdit() { upd(S.date, d => { delete d.editCheck; }); render(); },
  tick(t) { upd(S.date, d => { d.done = d.done || {}; d.done[t.dataset.k] = !d.done[t.dataset.k]; }); markDirty(S.view === 'food' ? 'food' : 'today'); render(); },
  saveSec(t) {
    const sec = t.dataset.sec;
    if (sec === 'appts') setSetting('apptsSaved', true);
    else upd(S.date, d => { d.saved = d.saved || {}; d.saved[sec] = true; });
    toast('Saved'); render();
  },
  openSession() { pushOverlay({ type: 'session' }); },
  howto(t) { pushOverlay({ type: 'howto', ex: t.dataset.ex, fromSheet: !!S.sheet }); },
  meal(t) { const key = S.date + ':' + t.dataset.m; S.mealOpen[key] = !S.mealOpen[key]; render(); },
  video() { S.stack[S.stack.length - 1].video = true; const ov = $('#overlay'); S.stack[S.stack.length - 1].scroll = ov.scrollTop; render(); },
  sheet(t) { openSheet({ type: t.dataset.s, b: t.dataset.b }); },
  pickSession(t) {
    const id = t.dataset.id;
    upd(S.date, d => { if (id === planFor(S.date).session) delete d.session; else d.session = id; });
    back();
  },
  loc(t) {
    const sid = sessionIdFor(S.date), v = t.dataset.val;
    upd(S.date, d => { d.loc = d.loc || {}; d.loc[sid] = v; });
    const s = settings(); s.loc = s.loc || {}; s.loc[sid] = v; LS.set('settings', s);
    const ov = $('#overlay'); S.stack[S.stack.length - 1].scroll = ov.scrollTop; render();
  },
  pain(t) {
    const slot = t.dataset.slot;
    upd(S.date, d => { d.pain = d.pain || {}; const c = d.pain[slot]; d.pain[slot] = !c ? 'amber' : c === 'amber' ? 'red' : null; if (!d.pain[slot]) delete d.pain[slot]; });
    markDirty('session');
    const ov = $('#overlay'); S.stack[S.stack.length - 1].scroll = ov.scrollTop; render();
  },
  swap(t) {
    upd(S.date, d => { d.swap = d.swap || {}; d.swap[t.dataset.slot] = !d.swap[t.dataset.slot]; });
    markDirty('session');
    const ov = $('#overlay'); S.stack[S.stack.length - 1].scroll = ov.scrollTop; render();
  },
  finish() {
    upd(S.date, d => { d.end = d.end || {}; d.end.finished = true; d.saved = d.saved || {}; d.saved.session = true; });
    S.rest = null; toast('Session saved'); back();
  },
  stopRest() { S.rest = null; S.restBuzzed = false; paintRest(); },
  water(t) { upd(S.date, d => { d.water = Math.max(0, (d.water || 0) + +t.dataset.n); }); markDirty('food'); render(); },
  protein() { setSetting('protein', protein() === 'beef' ? 'chicken' : 'beef'); render(); },
  plyoFreq(t) { setSetting('plyoFreq', t.dataset.val); render(); },
  runStage(t) { setSetting('runStage', t.dataset.val); render(); },
  theme(t) { setSetting('theme', t.dataset.val); applyTheme(); render(); },
  async update() {
    toast('Updating…');
    try {
      // fetch fresh copies past every cache, then drop the offline cache and reload
      await Promise.all(['./', 'index.html', 'app.css', 'app.js', 'sw.js', 'data/program.json', 'data/howto.json'].map(u => fetch(u, { cache: 'reload' }).catch(() => { })));
      if ('serviceWorker' in navigator) { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.unregister())); }
      if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); }
    } catch (e) { }
    location.reload();
  },
  async copyExport() { toast(await copyText(exportText()) ? 'Copied. Paste it into the chat.' : 'Select the text and copy it'); },
  async backup() {
    const all = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); all[k] = localStorage.getItem(k); }
    toast(await copyText(JSON.stringify(all)) ? 'Backup copied. Save it somewhere safe.' : 'Copy failed');
  },
  restore() {
    try {
      const all = JSON.parse($('#restoreText').value);
      Object.entries(all).forEach(([k, v]) => localStorage.setItem(k, v));
      toast('Restored'); back(); applyTheme();
    } catch (e) { toast("That doesn't look like a backup"); }
  }
};

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t || !ACT[t.dataset.act]) return;
  e.preventDefault();
  ACT[t.dataset.act](t, e);
});

document.addEventListener('input', e => {
  const t = e.target, kind = t.dataset.in;
  if (!kind) return;
  if (kind === 'painSlider') { const pv = $('#pv'); pv.textContent = t.value; pv.className = 'pain-val ' + painClass(+t.value); }
  if (kind === 'note') { upd(S.date, d => { d.notes = t.value; }); markDirty('today'); }
  if (kind === 'foodExtra') { upd(S.date, d => { d.foodExtra = t.value; }); markDirty('food'); }
  if (kind === 'appts') { setSetting('appts', t.value); markDirty('appts'); }
  if (kind === 'load') {
    upd(S.date, d => { d.loads = d.loads || {}; d.loads[t.dataset.slot] = t.value; });
    const s = settings(); s.loads = s.loads || {}; if (t.value) s.loads[t.dataset.ex] = t.value; LS.set('settings', s);
    markDirty('session');
  }
  if (kind === 'set') {
    upd(S.date, d => { d.sets = d.sets || {}; const a = d.sets[t.dataset.slot] = d.sets[t.dataset.slot] || []; a[+t.dataset.i] = t.value; });
    markDirty('session');
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.in === 'set' && t.value !== '') { S.restBuzzed = false; startRest(); }
});

/* ---------- start ---------- */
async function boot() {
  try {
    const [p, h] = await Promise.all([fetch('data/program.json').then(r => r.json()), fetch('data/howto.json').then(r => r.json())]);
    P = p; H = h;
  } catch (e) {
    $('#view').innerHTML = '<div class="alert">Couldn\'t load the program. Check your connection and reopen the app.</div>';
    return;
  }
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  // roll the date over if the app stays open past midnight
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.date < today() && !S.stack.length) { S.date = today(); render(); } });
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => { });
}
boot();
