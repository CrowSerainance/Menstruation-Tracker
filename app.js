const STORE_KEY = "luna.cycle.v1";
const SESSION_KEY = "luna.unlocked";
const BACKUP_FORMAT = "luna-cycle-backup";
const BACKUP_VERSION = 1;

const SYMPTOMS = [
  "Cramps", "Headache", "Bloating", "Fatigue", "Acne",
  "Back pain", "Tender breasts", "Nausea", "Insomnia", "Appetite",
  "Dizziness", "Diarrhea"
];
const MOODS = ["Calm", "Happy", "Sensitive", "Anxious", "Irritable", "Low", "Energetic"];
const FLOWS = ["none", "spotting", "light", "medium", "heavy"];

const DEFAULT_BAG = [
  { id: "pads", label: "Pads / napkins", packed: false },
  { id: "liners", label: "Panty liners", packed: false },
  { id: "wipes", label: "Wipes / tissue", packed: false },
  { id: "meds", label: "Pain relief", packed: false },
  { id: "underwear", label: "Spare underwear", packed: false },
  { id: "bag", label: "Small disposal bag", packed: false },
  { id: "water", label: "Water bottle", packed: false }
];

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
function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function defaultBagItems() {
  return DEFAULT_BAG.map((item) => ({ ...item }));
}

function defaultState() {
  return {
    version: 1,
    onboarded: false,
    meta: { lastSavedAt: "", lastVerifiedAt: "" },
    settings: {
      displayName: "",
      typicalCycle: 28,
      typicalPeriod: 5,
      lutealDays: 14,
      pinHash: "",
      weekStartsOn: 0,
      remindersEnabled: false,
      remindDaysBefore: 2,
      lastReminderKey: ""
    },
    bag: defaultBagItems(),
    cycles: [],
    days: {}
  };
}

let state = load();
let view = { tab: "today", cal: new Date(), selected: todayISO(), logDate: todayISO() };
let pinBuffer = "";
let pendingImport = null;
let reminderTimer = null;

function migrateState(parsed) {
  const base = defaultState();
  const settings = { ...base.settings, ...(parsed.settings || {}) };
  settings.remindDaysBefore = clamp(Number(settings.remindDaysBefore) || 2, 1, 5);
  settings.remindersEnabled = Boolean(settings.remindersEnabled);
  settings.lastReminderKey = typeof settings.lastReminderKey === "string" ? settings.lastReminderKey : "";

  let bag = Array.isArray(parsed.bag) ? parsed.bag : defaultBagItems();
  bag = bag
    .filter((item) => item && typeof item.id === "string" && typeof item.label === "string")
    .map((item) => ({ id: item.id, label: item.label, packed: Boolean(item.packed) }));
  if (!bag.length) bag = defaultBagItems();

  const days = {};
  for (const [iso, day] of Object.entries(parsed.days || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !day || typeof day !== "object") continue;
    const painRaw = day.pain;
    const pain = painRaw === null || painRaw === undefined || painRaw === ""
      ? null
      : clamp(Number(painRaw), 0, 10);
    days[iso] = {
      flow: FLOWS.includes(day.flow) ? day.flow : "none",
      symptoms: Array.isArray(day.symptoms) ? day.symptoms.filter((s) => typeof s === "string") : [],
      mood: typeof day.mood === "string" ? day.mood : "",
      notes: typeof day.notes === "string" ? day.notes : "",
      pain: Number.isFinite(pain) ? pain : null
    };
  }

  return {
    ...base,
    version: 1,
    onboarded: Boolean(parsed.onboarded),
    meta: { ...base.meta, ...(parsed.meta || {}) },
    settings,
    bag,
    cycles: Array.isArray(parsed.cycles)
      ? parsed.cycles.filter((c) => c && typeof c.start === "string").map((c) => ({
        start: c.start,
        end: typeof c.end === "string" ? c.end : null
      }))
      : [],
    days
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    return migrateState(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

function save() {
  state.meta = state.meta || {};
  state.meta.lastSavedAt = new Date().toISOString();
  const text = JSON.stringify(state);
  localStorage.setItem(STORE_KEY, text);
  try {
    const readBack = localStorage.getItem(STORE_KEY);
    if (readBack !== text) throw new Error("read-back mismatch");
  } catch (err) {
    console.warn("Luna storage verify failed", err);
    toast("Saved, but storage verify failed");
  }
}

function storageStats() {
  const raw = localStorage.getItem(STORE_KEY) || "";
  const bytes = new Blob([raw]).size;
  return {
    bytes,
    pretty: bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`,
    days: Object.keys(state.days || {}).length,
    cycles: (state.cycles || []).length,
    lastSaved: state.meta?.lastSavedAt ? formatLong(state.meta.lastSavedAt.slice(0, 10)) + " · " + state.meta.lastSavedAt.slice(11, 16) : "—"
  };
}

function verifyStorage() {
  const probe = `luna.verify.${Date.now()}`;
  localStorage.setItem(probe, "ok");
  const ok = localStorage.getItem(probe) === "ok";
  localStorage.removeItem(probe);
  save();
  const read = load();
  const match = JSON.stringify(read.cycles) === JSON.stringify(state.cycles)
    && Object.keys(read.days).length === Object.keys(state.days).length;
  state.meta.lastVerifiedAt = new Date().toISOString();
  save();
  return ok && match;
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
      meta: { ...(state.meta || {}) },
      settings: { ...state.settings },
      bag: (state.bag || []).map((item) => ({ ...item })),
      cycles: Array.isArray(state.cycles) ? state.cycles.map((c) => ({ ...c })) : [],
      days: { ...(state.days || {}) }
    }
  };
}

function backupToText() {
  return JSON.stringify(buildBackup(), null, 2);
}

function readableBackup() {
  const p = predictions();
  const lines = [
    "Luna cycle backup (human-readable)",
    `Exported: ${new Date().toISOString()}`,
    `Name: ${state.settings.displayName || "(none)"}`,
    `Onboarded: ${state.onboarded}`,
    `Typical cycle: ${state.settings.typicalCycle}d · Period: ${state.settings.typicalPeriod}d · Luteal: ${state.settings.lutealDays}d`,
    `Reminders: ${state.settings.remindersEnabled ? "on" : "off"} · ${state.settings.remindDaysBefore} day(s) ahead`,
    `Cycles logged: ${state.cycles.length} · Days logged: ${Object.keys(state.days).length}`,
    `Next predicted period: ${p.nextStart || "—"}`,
    "",
    "## Bag checklist"
  ];
  for (const item of state.bag || []) {
    lines.push(`- [${item.packed ? "x" : " "}] ${item.label}`);
  }
  lines.push("", "## Cycles");
  const starts = state.cycles.map((c) => c.start).sort();
  if (!starts.length) lines.push("(none)");
  for (const start of starts) {
    const c = state.cycles.find((x) => x.start === start);
    lines.push(`- ${start} → ${c?.end || "open"}`);
  }
  lines.push("", "## Daily logs");
  const dates = Object.keys(state.days).sort();
  if (!dates.length) lines.push("(none)");
  for (const iso of dates) {
    const day = state.days[iso];
    lines.push(`### ${iso}`);
    lines.push(`Flow: ${day.flow || "none"} | Pain: ${day.pain === null || day.pain === undefined ? "—" : `${day.pain}/10`} | Mood: ${day.mood || "—"}`);
    if ((day.symptoms || []).length) lines.push(`Symptoms: ${day.symptoms.join(", ")}`);
    if (day.notes) lines.push(`Notes: ${day.notes}`);
    lines.push("");
  }
  lines.push("", "## Machine JSON", "Import the matching .json backup in Luna Settings for a full restore.");
  return lines.join("\n");
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
  return migrateState(payload);
}

function summarizeState(s) {
  const dates = Object.keys(s.days || {}).sort();
  const cycles = (s.cycles || []).map((c) => c.start).sort();
  return [
    `Cycles: ${cycles.length}`,
    `Days logged: ${dates.length}`,
    `First log: ${dates[0] || "—"}`,
    `Latest log: ${dates.at(-1) || "—"}`,
    `Latest period start: ${cycles.at(-1) || "—"}`,
    `Reminders: ${s.settings.remindersEnabled ? "on" : "off"} (${s.settings.remindDaysBefore}d)`,
    `Bag items: ${(s.bag || []).length}`,
    `PIN: ${s.settings.pinHash ? "yes" : "no"}`,
    `Name: ${s.settings.displayName || "(none)"}`
  ].join("\n");
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

function stageImport(text) {
  const parsed = JSON.parse(text);
  const next = normalizeImportedState(parsed);
  pendingImport = next;
  $("#import-preview").textContent = `Ready to import:\n${summarizeState(next)}\n\nTap “Confirm replace with import” to overwrite this device.`;
  $("#confirm-import").classList.remove("hidden");
}

function commitPendingImport() {
  if (!pendingImport) return;
  state = pendingImport;
  pendingImport = null;
  save();
  if (state.settings.pinHash) sessionStorage.removeItem(SESSION_KEY);
  else sessionStorage.setItem(SESSION_KEY, "1");
  $("#import-preview").textContent = "Import applied. Local storage updated.";
  $("#confirm-import").classList.add("hidden");
  toast("Backup imported");
  render();
  scheduleReminderChecks();
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

function daysUntilPeriod() {
  const p = predictions();
  if (!p.nextStart) return null;
  return diffDays(todayISO(), p.nextStart);
}

function periodAheadActive() {
  const n = daysUntilPeriod();
  if (n === null) return false;
  const lead = clamp(Number(state.settings.remindDaysBefore) || 2, 1, 5);
  return n >= 0 && n <= lead;
}

async function ensureNotificationPermission() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return Notification.requestPermission();
}

function notificationPayload(title, body, tag) {
  return {
    title,
    body,
    options: {
      body,
      icon: "./icons/icon.svg",
      badge: "./icons/icon.svg",
      tag: tag || "luna-period-ahead",
      renotify: true,
      requireInteraction: true,
      vibrate: [280, 120, 280, 120, 280, 120, 420],
      silent: false,
      data: { url: "./index.html", type: "period-ahead" }
    }
  };
}

async function showStrongNotification(title, body, tag) {
  const payload = notificationPayload(title, body, tag);
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.showNotification) {
      await reg.showNotification(payload.title, payload.options);
      return true;
    }
  } catch {
    /* fall through */
  }
  if ("Notification" in window && Notification.permission === "granted") {
    // eslint-disable-next-line no-new
    new Notification(payload.title, payload.options);
    return true;
  }
  return false;
}

async function checkPeriodReminders(force = false) {
  if (!state.onboarded) return;
  if (!state.settings.remindersEnabled && !force) return;
  const p = predictions();
  if (!p.nextStart) return;
  const n = diffDays(todayISO(), p.nextStart);
  const lead = clamp(Number(state.settings.remindDaysBefore) || 2, 1, 5);
  if (!force && (n < 0 || n > lead)) return;

  const key = `${p.nextStart}:${todayISO()}`;
  if (!force && state.settings.lastReminderKey === key) return;

  const title = n <= 0 ? "Period window — Luna" : `Period in ${n} day${n === 1 ? "" : "s"} — Luna`;
  const body = n <= 0
    ? "Your period may start today. Check your bag checklist in Luna."
    : `Predicted around ${formatLong(p.nextStart)}. Pack pads, meds, and spare underwear.`;

  const permission = await ensureNotificationPermission();
  if (permission !== "granted") {
    if (force) toast("Allow notifications to receive alerts");
    return;
  }
  const shown = await showStrongNotification(title, body, `luna-period-${p.nextStart}`);
  if (shown) {
    state.settings.lastReminderKey = key;
    save();
    if (force) toast("Test alert sent");
  }
}

function scheduleReminderChecks() {
  checkPeriodReminders(false);
  if (reminderTimer) clearInterval(reminderTimer);
  reminderTimer = setInterval(() => checkPeriodReminders(false), 30 * 60 * 1000);
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

function renderBag() {
  const list = $("#bag-list");
  if (!list) return;
  if (!Array.isArray(state.bag) || !state.bag.length) state.bag = defaultBagItems();
  list.innerHTML = state.bag.map((item) => `
    <label class="check-item ${item.packed ? "done" : ""}">
      <input type="checkbox" data-bag="${item.id}" ${item.packed ? "checked" : ""} />
      <span>${item.label}</span>
    </label>
  `).join("");
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
  $("#today-pain").textContent = day.pain === null || day.pain === undefined ? "Not logged" : `${day.pain}/10`;
  $("#today-symptoms").textContent = (day.symptoms || []).length ? day.symptoms.join(", ") : "No symptoms logged";

  const alert = $("#period-alert");
  const ahead = periodAheadActive();
  alert.classList.toggle("hidden", !ahead && phase !== "period");
  if (ahead || phase === "period") {
    const n = daysUntilPeriod();
    if (phase === "period") {
      $("#period-alert-title").textContent = "Period day";
      $("#period-alert-body").textContent = "Be kind to yourself today. Use the bag checklist if you are heading out.";
    } else if (n === 0) {
      $("#period-alert-title").textContent = "Period may start today";
      $("#period-alert-body").textContent = "Pack your bag now — pads, pain relief, spare underwear.";
    } else {
      $("#period-alert-title").textContent = `Period in ${n} day${n === 1 ? "" : "s"}`;
      $("#period-alert-body").textContent = `Predicted around ${formatLong(p.nextStart)}. Tick your bag checklist below.`;
    }
  }
  renderBag();
}

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
    const day = state.days[c.iso];
    const logged = Boolean(day && ((day.symptoms || []).length || day.notes || (day.flow && day.flow !== "none") || (day.pain !== null && day.pain !== undefined)));
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
  const day = state.days[iso] || { flow: "none", symptoms: [], mood: "", notes: "", pain: null };
  $$("[data-flow]").forEach((b) => b.classList.toggle("on", b.dataset.flow === (day.flow || "none")));
  const painWrap = $("#pain-chips");
  painWrap.innerHTML = Array.from({ length: 11 }, (_, i) =>
    `<button type="button" class="chip ${day.pain === i ? "on" : ""}" data-pain="${i}">${i}</button>`
  ).join("");
  $("#pain-value-label").textContent = day.pain === null || day.pain === undefined ? "Not set" : `${day.pain}/10`;
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
  $("#set-reminders").checked = Boolean(state.settings.remindersEnabled);
  $("#set-remind-days").value = state.settings.remindDaysBefore || 2;
  const perm = ("Notification" in window) ? Notification.permission : "unsupported";
  $("#notify-status").textContent = perm === "granted"
    ? "Notifications: allowed"
    : perm === "denied"
      ? "Notifications: blocked in browser settings"
      : perm === "unsupported"
        ? "Notifications: not supported here"
        : "Notifications: permission not granted yet";

  const stats = storageStats();
  $("#store-bytes").textContent = stats.pretty;
  $("#store-days").textContent = String(stats.days);
  $("#store-cycles").textContent = String(stats.cycles);
  $("#store-saved").textContent = stats.lastSaved;

  const shareBtn = $("#share-export");
  if (shareBtn) shareBtn.classList.toggle("hidden", typeof navigator.share !== "function");
}

function setTab(tab) {
  view.tab = tab;
  render();
}

function upsertDay(iso, patch) {
  state.days[iso] = {
    flow: "none",
    symptoms: [],
    mood: "",
    notes: "",
    pain: null,
    ...(state.days[iso] || {}),
    ...patch
  };
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
  $("#pain-chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pain]");
    if (!b) return;
    upsertDay(view.logDate, { pain: Number(b.dataset.pain) });
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

  $("#bag-list").addEventListener("change", (e) => {
    const input = e.target.closest("[data-bag]");
    if (!input) return;
    const item = state.bag.find((x) => x.id === input.dataset.bag);
    if (!item) return;
    item.packed = Boolean(input.checked);
    save();
    renderBag();
  });
  $("#bag-reset").addEventListener("click", () => {
    state.bag = defaultBagItems();
    save();
    toast("Bag checklist reset");
    renderBag();
  });

  $("#ob-go").addEventListener("click", () => {
    const last = $("#ob-last").value;
    state.settings.typicalCycle = clamp(Number($("#ob-cycle").value) || 28, 18, 60);
    state.settings.typicalPeriod = clamp(Number($("#ob-period").value) || 5, 1, 12);
    state.settings.displayName = $("#ob-name").value.trim();
    if (last) startPeriod(last);
    state.onboarded = true;
    save();
    render();
    scheduleReminderChecks();
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
  $("#set-reminders-save").addEventListener("click", async () => {
    state.settings.remindersEnabled = $("#set-reminders").checked;
    state.settings.remindDaysBefore = clamp(Number($("#set-remind-days").value) || 2, 1, 5);
    if (state.settings.remindersEnabled) {
      const perm = await ensureNotificationPermission();
      if (perm !== "granted") toast("Enable notifications in the browser prompt");
    }
    save();
    toast("Reminders saved");
    render();
    scheduleReminderChecks();
  });
  $("#test-notification").addEventListener("click", async () => {
    await checkPeriodReminders(true);
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

  $("#verify-storage").addEventListener("click", () => {
    const ok = verifyStorage();
    $("#store-verify").textContent = ok
      ? `Read/write OK · verified ${new Date().toLocaleTimeString()}`
      : "Storage check failed — export a backup now.";
    toast(ok ? "Storage verified" : "Storage problem");
    renderSettings();
  });

  $("#export-data").addEventListener("click", () => {
    downloadTextFile(`luna-backup-${todayISO()}.json`, backupToText());
    toast("JSON backup downloaded");
  });
  $("#export-readable").addEventListener("click", () => {
    downloadTextFile(`luna-summary-${todayISO()}.txt`, readableBackup(), "text/plain");
    toast("Readable summary downloaded");
  });
  $("#copy-export").addEventListener("click", async () => {
    const text = backupToText();
    try {
      await copyText(text);
      toast("Backup copied");
    } catch {
      window.prompt("Copy this Luna backup JSON:", text);
      toast("Select all and copy");
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
      stageImport(await file.text());
      toast("Preview ready — confirm import");
    } catch {
      toast("Invalid backup file");
      $("#import-preview").textContent = "Could not parse that file. Use a Luna JSON backup.";
      $("#confirm-import").classList.add("hidden");
      pendingImport = null;
    }
    e.target.value = "";
  });
  $("#paste-import").addEventListener("click", async () => {
    let text = "";
    try {
      if (navigator.clipboard?.readText) text = await navigator.clipboard.readText();
    } catch {
      /* fall through */
    }
    if (!text) text = window.prompt("Paste a Luna backup JSON here") || "";
    if (!text.trim()) return;
    try {
      stageImport(text);
      toast("Preview ready — confirm import");
    } catch {
      toast("Invalid backup JSON");
      $("#import-preview").textContent = "Could not parse pasted JSON.";
      $("#confirm-import").classList.add("hidden");
      pendingImport = null;
    }
  });
  $("#confirm-import").addEventListener("click", () => {
    if (!pendingImport) return;
    if (!confirm("Replace all Luna data on this device with the imported backup?")) return;
    commitPendingImport();
  });
  $("#wipe-data").addEventListener("click", () => {
    if (!confirm("Delete all cycle data on this device?")) return;
    state = defaultState();
    pendingImport = null;
    save();
    sessionStorage.removeItem(SESSION_KEY);
    toast("Data cleared");
    render();
  });

  $$("[data-digit]").forEach((b) => b.addEventListener("click", () => addPinDigit(b.dataset.digit)));
  $("#pin-del").addEventListener("click", () => { pinBuffer = pinBuffer.slice(0, -1); paintPin(); });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkPeriodReminders(false);
  });
}

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
      scheduleReminderChecks();
    } else {
      pinBuffer = "";
      paintPin();
      toast("Wrong PIN");
    }
  }
}

function boot() {
  state = migrateState(state);
  bind();
  render();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  scheduleReminderChecks();
}

document.addEventListener("DOMContentLoaded", boot);
