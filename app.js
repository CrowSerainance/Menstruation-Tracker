const STORE_KEY = "luna.cycle.v1";
const SESSION_KEY = "luna.unlocked";
const BACKUP_FORMAT = "luna-cycle-backup";
const BACKUP_VERSION = 1;

const SYMPTOMS = [
  "Cramps", "Headache", "Bloating", "Fatigue", "Acne",
  "Back pain", "Tender breasts", "Nausea", "Insomnia", "Appetite"
];
const MOODS = ["Calm", "Happy", "Sensitive", "Anxious", "Irritable", "Low", "Energetic"];
const FLOWS = ["none", "spotting", "light", "medium", "heavy"];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const todayISO = () => toISO(new Date());
function toISO(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fromISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}
function diffDays(a, b) {
  return Math.round((fromISO(b) - fromISO(a)) / 86400000);
}
function formatLong(iso) {
  return fromISO(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function monthTitle(y, m) {
  return new Date(y, m, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function defaultState() {
  return {
    version: 1,
    onboarded: false,
    settings: {
      displayName: "",
      typicalCycle: 28,
      typicalPeriod: 5,
      lutealDays: 14,
      pinHash: "",
      weekStartsOn: 0
    },
    cycles: [],
    days: {}
  };
}

let state = load();
let view = { tab: "today", cal: new Date(), selected: todayISO(), logDate: todayISO() };
let pinBuffer = "";

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed, settings: { ...defaultState().settings, ...(parsed.settings || {}) } };
  } catch {
    return defaultState();
  }
}
function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function buildBackup() {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    app: "Luna",
    data: {
      version: 1,
      onboarded: Boolean(state.onboarded),
      settings: { ...state.settings },
      cycles: Array.isArray(state.cycles) ? state.cycles.map((c) => ({ ...c })) : [],
      days: { ...(state.days || {}) }
    }
  };
}

function backupToText() {
  return JSON.stringify(buildBackup(), null, 2);
}

function isPlainObject(v) {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function normalizeImportedState(parsed) {
  if (!isPlainObject(parsed)) throw new Error("bad");

  let payload = parsed;
  if (parsed.format === BACKUP_FORMAT) {
    if (Number(parsed.version) !== BACKUP_VERSION) throw new Error("bad-version");
    if (!isPlainObject(parsed.data)) throw new Error("bad-data");
    payload = parsed.data;
  } else if (Number(parsed.version) !== 1) {
    throw new Error("bad-version");
  }

  if (!isPlainObject(payload.settings)) throw new Error("bad-settings");
  if (!Array.isArray(payload.cycles)) throw new Error("bad-cycles");
  if (!isPlainObject(payload.days)) throw new Error("bad-days");

  const cycles = payload.cycles
    .filter((c) => c && typeof c.start === "string")
    .map((c) => ({
      start: c.start,
      end: typeof c.end === "string" ? c.end : null
    }));

  const days = {};
  for (const [iso, day] of Object.entries(payload.days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !isPlainObject(day)) continue;
    days[iso] = {
      flow: FLOWS.includes(day.flow) ? day.flow : "none",
      symptoms: Array.isArray(day.symptoms) ? day.symptoms.filter((s) => typeof s === "string") : [],
      mood: typeof day.mood === "string" ? day.mood : "",
      notes: typeof day.notes === "string" ? day.notes : ""
    };
  }

  return {
    ...defaultState(),
    version: 1,
    onboarded: Boolean(payload.onboarded),
    settings: { ...defaultState().settings, ...payload.settings },
    cycles,
    days
  };
}

function downloadTextFile(filename, text, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

async function applyImportedText(text) {
  const parsed = JSON.parse(text);
  state = normalizeImportedState(parsed);
  save();
  if (state.settings.pinHash) sessionStorage.removeItem(SESSION_KEY);
  else sessionStorage.setItem(SESSION_KEY, "1");
  toast("Backup imported");
  render();
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function completeCycles() {
  const starts = state.cycles.map((c) => c.start).sort();
  const out = [];
  for (let i = 0; i < starts.length - 1; i++) {
    out.push({ start: starts[i], length: diffDays(starts[i], starts[i + 1]), end: cycleEnd(starts[i]) });
  }
  return out;
}
function cycleEnd(start) {
  const c = state.cycles.find((x) => x.start === start);
  if (c && c.end) return c.end;
  return addDays(start, (state.settings.typicalPeriod || 5) - 1);
}
function averageCycleLength() {
  const done = completeCycles();
  if (done.length >= 2) {
    const last = done.slice(-6);
    return Math.round(last.reduce((s, c) => s + c.length, 0) / last.length);
  }
  return Number(state.settings.typicalCycle) || 28;
}
function lastPeriodStart() {
  if (!state.cycles.length) return null;
  return state.cycles.map((c) => c.start).sort().at(-1);
}
function isPeriodDay(iso) {
  const day = state.days[iso];
  if (day && day.flow && day.flow !== "none") return true;
  return state.cycles.some((c) => {
    const end = c.end || addDays(c.start, (state.settings.typicalPeriod || 5) - 1);
    return iso >= c.start && iso <= end;
  });
}
function predictions() {
  const start = lastPeriodStart();
  const cycle = averageCycleLength();
  const luteal = Number(state.settings.lutealDays) || 14;
  const periodLen = Number(state.settings.typicalPeriod) || 5;
  if (!start) {
    return { cycle, periodLen, luteal, nextStart: null, ovulation: null, fertileStart: null, fertileEnd: null };
  }
  let cursor = start;
  const today = todayISO();
  while (addDays(cursor, cycle) <= today) cursor = addDays(cursor, cycle);
  const nextStart = addDays(cursor, cycle);
  const thisOvulation = addDays(nextStart, -luteal);
  const fertileStart = addDays(thisOvulation, -5);
  const fertileEnd = addDays(thisOvulation, 1);
  return { cycle, periodLen, luteal, lastStart: start, currentStart: cursor, nextStart, ovulation: thisOvulation, fertileStart, fertileEnd };
}
function phaseFor(iso) {
  if (isPeriodDay(iso)) return "period";
  const p = predictions();
  if (!p.nextStart) return "unknown";
  if (iso === p.ovulation) return "ovulation";
  if (p.fertileStart && iso >= p.fertileStart && iso <= p.fertileEnd) return "fertile";
  if (p.nextStart && iso >= p.nextStart && iso <= addDays(p.nextStart, p.periodLen - 1)) return "predicted";
  const start = p.currentStart || p.lastStart;
  if (start && iso >= start && iso < (p.ovulation || p.nextStart)) return "follicular";
  return "luteal";
}
function cycleDayNumber(iso) {
  const p = predictions();
  if (!p.currentStart) return null;
  let start = p.currentStart;
  if (iso < start) start = addDays(start, -p.cycle);
  return diffDays(start, iso) + 1;
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1800);
}

function render() {
  const locked = Boolean(state.settings.pinHash) && sessionStorage.getItem(SESSION_KEY) !== "1";
  $("#lock-screen").classList.toggle("hidden", !locked);
  $("#onboard-screen").classList.toggle("hidden", locked || state.onboarded);
  $("#app").classList.toggle("hidden", locked || !state.onboarded);
  if (locked) return;
  if (!state.onboarded) return renderOnboard();
  $$(".nav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === view.tab));
  $$(".tab").forEach((t) => t.classList.toggle("hidden", t.id !== `tab-${view.tab}`));
  if (view.tab === "today") renderToday();
  if (view.tab === "calendar") renderCalendar();
  if (view.tab === "log") renderLog();
  if (view.tab === "insights") renderInsights();
  if (view.tab === "settings") renderSettings();
}

function renderOnboard() {
  $("#ob-cycle").value = state.settings.typicalCycle;
  $("#ob-period").value = state.settings.typicalPeriod;
}

function renderToday() {
  const iso = todayISO();
  const p = predictions();
  const phase = phaseFor(iso);
  const dayNum = cycleDayNumber(iso);
  const labels = {
    period: "Period",
    fertile: "Fertile window",
    ovulation: "Estimated ovulation",
    predicted: "Predicted period",
    follicular: "Follicular phase",
    luteal: "Luteal phase",
    unknown: "Not enough data yet"
  };
  $("#today-phase").textContent = labels[phase] || phase;
  $("#today-dot").className = `dot ${phase === "predicted" ? "predicted" : phase === "ovulation" ? "ovulation" : phase === "fertile" ? "fertile" : phase === "period" ? "period" : "predicted"}`;
  $("#today-daynum").textContent = dayNum ? `Day ${dayNum}` : "—";
  $("#today-date").textContent = formatLong(iso);
  if (p.nextStart) {
    const n = diffDays(iso, p.nextStart);
    $("#today-next").textContent = n <= 0 ? "Period window" : `${n} day${n === 1 ? "" : "s"}`;
    $("#today-ovu").textContent = p.ovulation ? formatLong(p.ovulation) : "—";
    $("#today-avg").textContent = `${p.cycle}d`;
  } else {
    $("#today-next").textContent = "Add a period";
    $("#today-ovu").textContent = "—";
    $("#today-avg").textContent = `${state.settings.typicalCycle}d`;
  }
  const day = state.days[iso] || {};
  $("#today-flow").textContent = day.flow && day.flow !== "none" ? cap(day.flow) : "Not logged";
  $("#today-symptoms").textContent = (day.symptoms || []).length ? day.symptoms.join(", ") : "No symptoms logged";
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function renderCalendar() {
  const y = view.cal.getFullYear();
  const m = view.cal.getMonth();
  $("#cal-title").textContent = monthTitle(y, m);
  const first = new Date(y, m, 1);
  const startDow = first.getDay();
  const grid = $("#cal-grid");
  grid.innerHTML = ["S", "M", "T", "W", "T", "F", "S"].map((d) => `<div class="cal-dow">${d}</div>`).join("");
  const lead = startDow;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevDays = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i++) {
    const day = prevDays - lead + 1 + i;
    cells.push({ iso: toISO(new Date(y, m - 1, day)), num: day, out: true });
  }
  for (let d = 1; d <= daysInMonth; d++) cells.push({ iso: toISO(new Date(y, m, d)), num: d, out: false });
  while (cells.length % 7) {
    const extra = cells.length - (lead + daysInMonth) + 1;
    cells.push({ iso: toISO(new Date(y, m + 1, extra)), num: extra, out: true });
  }
  const today = todayISO();
  cells.forEach((c) => {
    const phase = phaseFor(c.iso);
    const logged = Boolean(state.days[c.iso] && ((state.days[c.iso].symptoms || []).length || state.days[c.iso].notes || (state.days[c.iso].flow && state.days[c.iso].flow !== "none")));
    const cls = [
      "day",
      c.out ? "out" : "",
      c.iso === today ? "today" : "",
      c.iso === view.selected ? "selected" : "",
      phase === "period" ? "period" : "",
      phase === "predicted" ? "predicted" : "",
      phase === "fertile" ? "fertile" : "",
      phase === "ovulation" ? "ovulation" : ""
    ].filter(Boolean).join(" ");
    grid.insertAdjacentHTML("beforeend", `<button class="${cls}" data-iso="${c.iso}">${c.num}${logged && !c.out ? '<i class="mark"></i>' : ""}</button>`);
  });
  const sel = view.selected;
  const phase = phaseFor(sel);
  $("#cal-detail").innerHTML = `<b>${formatLong(sel)}</b> · ${prettyPhase(phase)}`;
}

function prettyPhase(phase) {
  return ({
    period: "Period",
    predicted: "Predicted period",
    fertile: "Fertile window",
    ovulation: "Estimated ovulation",
    follicular: "Follicular phase",
    luteal: "Luteal phase",
    unknown: "Untracked"
  })[phase] || phase;
}

function renderLog() {
  const iso = view.logDate;
  $("#log-date").value = iso;
  $("#log-date-label").textContent = formatLong(iso);
  const day = state.days[iso] || { flow: "none", symptoms: [], mood: "", notes: "" };
  $$("[data-flow]").forEach((b) => b.classList.toggle("on", b.dataset.flow === (day.flow || "none")));
  const wrap = $("#symptom-chips");
  wrap.innerHTML = SYMPTOMS.map((s) => `<button type="button" class="chip ${(day.symptoms || []).includes(s) ? "on" : ""}" data-sym="${s}">${s}</button>`).join("");
  const moods = $("#mood-chips");
  moods.innerHTML = MOODS.map((s) => `<button type="button" class="chip ${day.mood === s ? "on" : ""}" data-mood="${s}">${s}</button>`).join("");
  $("#log-notes").value = day.notes || "";
  const onPeriod = isPeriodDay(iso);
  $("#period-toggle").textContent = onPeriod ? "Marked as period" : "Mark period start";
  $("#period-toggle").classList.toggle("primary", !onPeriod);
}

function renderInsights() {
  const done = completeCycles();
  const lens = done.map((c) => c.length);
  const avg = averageCycleLength();
  const min = lens.length ? Math.min(...lens) : avg;
  const max = lens.length ? Math.max(...lens) : avg;
  $("#ins-cycles").textContent = String(state.cycles.length);
  $("#ins-avg").textContent = `${avg} days`;
  $("#ins-range").textContent = lens.length ? `${min}–${max} days` : "Need 2+ cycles";
  const p = predictions();
  $("#ins-next").textContent = p.nextStart ? formatLong(p.nextStart) : "—";
  $("#ins-ovu").textContent = p.ovulation ? formatLong(p.ovulation) : "—";
  const list = $("#cycle-list");
  const starts = state.cycles.map((c) => c.start).sort().reverse();
  if (!starts.length) {
    list.innerHTML = `<p class="faint">Log your first period start to begin a history.</p>`;
    return;
  }
  list.innerHTML = starts.map((start, i) => {
    const next = i === 0 ? null : starts[i - 1];
    const length = next ? `${diffDays(start, next)}d cycle` : "current";
    const end = cycleEnd(start);
    return `<div class="row" style="padding:8px 0;border-bottom:1px solid var(--line)">
      <div><b>${formatLong(start)}</b><div class="faint">${formatLong(start)} – ${formatLong(end)}</div></div>
      <div class="faint">${length}</div>
    </div>`;
  }).join("");
}

function renderSettings() {
  $("#set-name").value = state.settings.displayName || "";
  $("#set-cycle").value = state.settings.typicalCycle;
  $("#set-period").value = state.settings.typicalPeriod;
  $("#set-luteal").value = state.settings.lutealDays;
  $("#set-pin-status").textContent = state.settings.pinHash ? "PIN is on" : "No PIN";
  const shareBtn = $("#share-export");
  if (shareBtn) shareBtn.classList.toggle("hidden", typeof navigator.share !== "function");
}

function setTab(tab) {
  view.tab = tab;
  render();
}

function upsertDay(iso, patch) {
  state.days[iso] = { flow: "none", symptoms: [], mood: "", notes: "", ...(state.days[iso] || {}), ...patch };
  save();
}

function startPeriod(iso) {
  if (state.cycles.some((c) => c.start === iso)) return;
  const open = state.cycles.find((c) => !c.end && c.start < iso);
  if (open) open.end = addDays(iso, -1);
  state.cycles.push({ start: iso, end: null });
  upsertDay(iso, { flow: state.days[iso]?.flow && state.days[iso].flow !== "none" ? state.days[iso].flow : "medium" });
  save();
}
function endPeriod(iso) {
  const open = [...state.cycles].sort((a, b) => a.start.localeCompare(b.start)).find((c) => c.start <= iso && !c.end);
  if (open) {
    open.end = iso;
    save();
  }
}
function removePeriodOn(iso) {
  state.cycles = state.cycles.filter((c) => c.start !== iso);
  if (state.days[iso]) state.days[iso].flow = "none";
  save();
}

function bind() {
  $$(".nav button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
  $("#cal-prev").addEventListener("click", () => { view.cal.setMonth(view.cal.getMonth() - 1); render(); });
  $("#cal-next").addEventListener("click", () => { view.cal.setMonth(view.cal.getMonth() + 1); render(); });
  $("#cal-grid").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-iso]");
    if (!btn) return;
    view.selected = btn.dataset.iso;
    view.logDate = btn.dataset.iso;
    render();
  });
  $("#cal-log").addEventListener("click", () => { view.logDate = view.selected; setTab("log"); });

  $("#log-date").addEventListener("change", (e) => { view.logDate = e.target.value; render(); });
  $("#flow-chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-flow]");
    if (!b) return;
    upsertDay(view.logDate, { flow: b.dataset.flow });
    if (b.dataset.flow !== "none" && !state.cycles.some((c) => view.logDate >= c.start && view.logDate <= cycleEnd(c.start))) {
      startPeriod(view.logDate);
    }
    render();
  });
  $("#symptom-chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sym]");
    if (!b) return;
    const day = state.days[view.logDate] || { symptoms: [] };
    const set = new Set(day.symptoms || []);
    set.has(b.dataset.sym) ? set.delete(b.dataset.sym) : set.add(b.dataset.sym);
    upsertDay(view.logDate, { symptoms: [...set] });
    render();
  });
  $("#mood-chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mood]");
    if (!b) return;
    const cur = state.days[view.logDate]?.mood;
    upsertDay(view.logDate, { mood: cur === b.dataset.mood ? "" : b.dataset.mood });
    render();
  });
  $("#log-notes").addEventListener("change", (e) => { upsertDay(view.logDate, { notes: e.target.value }); toast("Saved"); });
  $("#period-toggle").addEventListener("click", () => {
    const iso = view.logDate;
    if (state.cycles.some((c) => c.start === iso)) {
      removePeriodOn(iso);
      toast("Period start removed");
    } else {
      startPeriod(iso);
      toast("Period started");
    }
    render();
  });
  $("#period-end").addEventListener("click", () => { endPeriod(view.logDate); toast("Period ended"); render(); });

  $("#ob-go").addEventListener("click", () => {
    const last = $("#ob-last").value;
    state.settings.typicalCycle = clamp(Number($("#ob-cycle").value) || 28, 18, 60);
    state.settings.typicalPeriod = clamp(Number($("#ob-period").value) || 5, 1, 12);
    state.settings.displayName = $("#ob-name").value.trim();
    if (last) startPeriod(last);
    state.onboarded = true;
    save();
    render();
  });

  $("#set-save").addEventListener("click", () => {
    state.settings.displayName = $("#set-name").value.trim();
    state.settings.typicalCycle = clamp(Number($("#set-cycle").value) || 28, 18, 60);
    state.settings.typicalPeriod = clamp(Number($("#set-period").value) || 5, 1, 12);
    state.settings.lutealDays = clamp(Number($("#set-luteal").value) || 14, 10, 16);
    save();
    toast("Settings saved");
    render();
  });
  $("#set-pin").addEventListener("click", async () => {
    const a = $("#pin-new").value;
    const b = $("#pin-confirm").value;
    if (!/^\d{4}$/.test(a)) return toast("Use a 4-digit PIN");
    if (a !== b) return toast("PINs do not match");
    state.settings.pinHash = await sha256(a);
    $("#pin-new").value = $("#pin-confirm").value = "";
    save();
    sessionStorage.setItem(SESSION_KEY, "1");
    toast("PIN saved");
    render();
  });
  $("#set-pin-clear").addEventListener("click", () => {
    state.settings.pinHash = "";
    save();
    toast("PIN removed");
    render();
  });
  $("#export-data").addEventListener("click", () => {
    downloadTextFile(`luna-backup-${todayISO()}.json`, backupToText());
    toast("Backup downloaded");
  });
  $("#copy-export").addEventListener("click", async () => {
    try {
      await copyText(backupToText());
      toast("Backup copied");
    } catch {
      toast("Could not copy");
    }
  });
  $("#share-export").addEventListener("click", async () => {
    const text = backupToText();
    const filename = `luna-backup-${todayISO()}.json`;
    const file = new File([text], filename, { type: "application/json" });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "Luna backup",
          text: "Reusable Luna cycle backup — import this JSON in Settings on any device."
        });
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: "Luna backup", text });
        return;
      }
      toast("Share is not available here");
    } catch (err) {
      if (err && err.name === "AbortError") return;
      toast("Could not share");
    }
  });
  $("#import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await applyImportedText(await file.text());
    } catch {
      toast("Invalid backup file");
    }
    e.target.value = "";
  });
  $("#paste-import").addEventListener("click", async () => {
    let text = "";
    try {
      if (navigator.clipboard?.readText) text = await navigator.clipboard.readText();
    } catch {
      /* fall through to prompt */
    }
    if (!text) text = window.prompt("Paste a Luna backup JSON here") || "";
    if (!text.trim()) return;
    try {
      await applyImportedText(text);
    } catch {
      toast("Invalid backup JSON");
    }
  });
  $("#wipe-data").addEventListener("click", () => {
    if (!confirm("Delete all cycle data on this device?")) return;
    state = defaultState();
    save();
    sessionStorage.removeItem(SESSION_KEY);
    toast("Data cleared");
    render();
  });

  $$("[data-digit]").forEach((b) => b.addEventListener("click", () => addPinDigit(b.dataset.digit)));
  $("#pin-del").addEventListener("click", () => { pinBuffer = pinBuffer.slice(0, -1); paintPin(); });
}

function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }

function paintPin() {
  $$("#pin-dots i").forEach((el, i) => el.classList.toggle("filled", i < pinBuffer.length));
}
async function addPinDigit(d) {
  if (pinBuffer.length >= 4) return;
  pinBuffer += d;
  paintPin();
  if (pinBuffer.length === 4) {
    const hash = await sha256(pinBuffer);
    if (hash === state.settings.pinHash) {
      sessionStorage.setItem(SESSION_KEY, "1");
      pinBuffer = "";
      paintPin();
      render();
    } else {
      pinBuffer = "";
      paintPin();
      toast("Wrong PIN");
    }
  }
}

function boot() {
  bind();
  render();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

document.addEventListener("DOMContentLoaded", boot);
