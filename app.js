"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const localISO = date => {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};
const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = value => Number(value).toLocaleString("ja-JP", { maximumFractionDigits: 2 });
let selectedDate = localISO(new Date());
let selectedGoalBookId = null;
let toastTimer;
let longPressTimer;
let longPressStart;
let todoLongPressTimer;
let todoLongPressStart;
let calendarLongPressTimer;
let calendarLongPressStart;
let suppressCalendarClick = false;
let preparedBackupFile;
let preparedBackupText = "";
let preparedBackupUrl = "";
const GOAL_BOOK_COLORS = ["#78a9d4", "#e09a73", "#9a8fd1", "#69b6a5", "#d0a84f", "#df7e9d"];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  try {
    await LifeDB.open();
    bindUI();
    updateDateUI();
    await renderAll();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js");
  } catch (error) {
    showToast("データベースを開始できませんでした");
    console.error(error);
  }
}

function bindUI() {
  const now = new Date();
  $("#todayLabel").textContent = new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "short" }).format(now);
  $$(".nav-item").forEach(button => button.addEventListener("click", () => showPage(button.dataset.page)));
  $$("[data-open]").forEach(button => button.addEventListener("click", () => openModal(button.dataset.open)));
  $$("[data-close]").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));
  $$("dialog").forEach(dialog => dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  }));
  $("#settingsBtn").addEventListener("click", () => openModal("settingsModal"));
  $("#datePickerBtn").addEventListener("click", () => $("#selectedDate").showPicker?.() || $("#selectedDate").click());
  $("#selectedDate").addEventListener("change", event => changeDate(event.target.value));
  $("#prevDay").addEventListener("click", () => shiftMonth(-1));
  $("#nextDay").addEventListener("click", () => shiftMonth(1));
  $("#gaugeForm").addEventListener("submit", addGauge);
  $("#gaugeTodoLink").addEventListener("change", toggleGaugeTodoLink);
  $("#progressForm").addEventListener("submit", addProgress);
  $("#todoForm").addEventListener("submit", addTodo);
  $("#noteForm").addEventListener("submit", addNote);
  $("#goalBookForm").addEventListener("submit", addGoalBook);
  $$('input[name="range"]').forEach(input => input.addEventListener("change", () => $("#customRangeFields").classList.toggle("hidden", input.value !== "custom" || !input.checked)));
  $("#backupBtn").addEventListener("click", exportJSON);
  $("#backupShareBtn").addEventListener("click", shareBackup);
  $("#backupCopyBtn").addEventListener("click", copyBackupJSON);
  $("#restoreInput").addEventListener("change", importJSON);
  $("#csvBtn").addEventListener("click", exportCSV);
  $("#gaugeList").addEventListener("click", handleGaugeAction);
  $("#gaugeList").addEventListener("pointerdown", startGaugeLongPress);
  $("#gaugeList").addEventListener("pointermove", moveGaugeLongPress);
  ["pointerup", "pointercancel", "pointerleave"].forEach(type => $("#gaugeList").addEventListener(type, cancelGaugeLongPress));
  $("#gaugeList").addEventListener("contextmenu", event => {
    if (event.target.closest(".gauge-card")) event.preventDefault();
  });
  $("#historyList").addEventListener("click", saveHistoryEntry);
  $("#historyTargetSave").addEventListener("click", saveTrackerTarget);
  $("#historyModal").addEventListener("input", handleHistoryDirtyState);
  $("#todoList").addEventListener("click", handleTodoAction);
  $("#todoList").addEventListener("pointerdown", startTodoLongPress);
  $("#todoList").addEventListener("pointermove", moveTodoLongPress);
  ["pointerup", "pointercancel", "pointerleave"].forEach(type => $("#todoList").addEventListener(type, cancelTodoLongPress));
  $("#todoList").addEventListener("contextmenu", event => {
    if (event.target.closest(".todo-card")) event.preventDefault();
  });
  $("#todoMemoForm").addEventListener("submit", saveTodoMemo);
  $("#monthStrip").addEventListener("pointerdown", startCalendarLongPress);
  $("#monthStrip").addEventListener("pointermove", moveCalendarLongPress);
  ["pointerup", "pointercancel", "pointerleave"].forEach(type => $("#monthStrip").addEventListener(type, cancelCalendarLongPress));
  $("#monthStrip").addEventListener("contextmenu", event => {
    if (event.target.closest(".calendar-day")) event.preventDefault();
  });
  $("#deleteTodoDayBtn").addEventListener("click", () => deleteTodoSelection("day"));
  $("#deleteTodoBatchBtn").addEventListener("click", () => deleteTodoSelection("batch"));
  $("#noteList").addEventListener("click", handleNoteAction);
  $("#noteDeleteBtn").addEventListener("click", deleteEditingNote);
  $("#deleteGoalBookBtn").addEventListener("click", deleteGoalBook);
  $("#goalBookTabs").addEventListener("click", event => {
    const tab = event.target.closest("[data-book-id]");
    if (!tab) return;
    selectedGoalBookId = tab.dataset.bookId;
    renderNotes();
  });
}

function showPage(id) {
  $$(".page").forEach(page => page.classList.toggle("active", page.id === id));
  $$(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.page === id));
  $("#pageTitle").textContent = $(`#${id}`).dataset.title;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openModal(id) {
  const dialog = $(`#${id}`);
  const form = $("form", dialog);
  if (form && id !== "progressModal") {
    form.reset();
    $$(".form-error", form).forEach(el => el.classList.remove("visible"));
  }
  if (id === "todoModal") {
    $("#customRangeFields").classList.add("hidden");
    form.elements.startDate.value = selectedDate;
    form.elements.endDate.value = selectedDate;
  }
  if (id === "gaugeModal") {
    $("#gaugeTodoLink").checked = false;
    $("#gaugeTodoSelectField").classList.add("hidden");
    $("#gaugeUnit").readOnly = false;
    populateGaugeTodoOptions();
  }
  if (id === "noteModal") {
    form.elements.id.value = "";
    $("#noteDeleteBtn").classList.add("hidden");
    $(".modal-head h2", dialog).textContent = "Goalsを追加";
  }
  dialog.showModal();
}

function setError(form, message) {
  const el = $(".form-error", form);
  el.textContent = message;
  el.classList.toggle("visible", Boolean(message));
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}

async function renderAll() {
  await Promise.all([renderGauges(), renderTodos(), renderNotes()]);
}

async function addGauge(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const name = data.get("name").trim();
  const targetRaw = data.get("target");
  const linkTodo = data.get("linkTodo") === "on";
  const linkedTodoName = linkTodo ? data.get("linkedTodoName") : "";
  if (!name) return setError(form, "目標名を入力してください。");
  if (!targetRaw || Number(targetRaw) <= 0) return setError(form, "0より大きい目標を入力してください。");
  if (linkTodo && !linkedTodoName) return setError(form, "連携するToDoを選択してください。");
  const gauge = { id: uid(), name, unit: linkTodo ? "日" : data.get("unit").trim(), target: Number(targetRaw), deadline: data.get("deadline") || null, linkedTodoName: linkedTodoName || null, createdAt: new Date().toISOString() };
  await LifeDB.put("gauges", gauge);
  if (linkTodo) await syncExistingTodosToGauge(gauge);
  form.closest("dialog").close();
  await renderGauges();
  showToast("Trackerを追加しました");
}

async function populateGaugeTodoOptions() {
  const todos = await LifeDB.all("todos");
  const names = [...new Set(todos.map(todo => todo.name).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
  $("#gaugeTodoSelect").innerHTML = names.length
    ? '<option value="">選択してください</option>' + names.map(name => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join("")
    : '<option value="">連携できるToDoがありません</option>';
  $("#gaugeTodoLink").disabled = names.length === 0;
}

function toggleGaugeTodoLink() {
  const linked = $("#gaugeTodoLink").checked;
  $("#gaugeTodoSelectField").classList.toggle("hidden", !linked);
  $("#gaugeUnit").readOnly = linked;
  $("#gaugeUnit").value = linked ? "日" : "";
}

async function syncExistingTodosToGauge(gauge) {
  const todos = (await LifeDB.all("todos")).filter(todo => todo.name === gauge.linkedTodoName);
  const records = todos.map(todo => {
    const status = todo.status || (todo.completed ? "circle" : "none");
    const amount = status === "circle" ? 1 : status === "triangle" ? 0.5 : 0;
    return amount ? { id: uid(), gaugeId: gauge.id, amount, date: todo.date, sourceTodoId: todo.id, createdAt: new Date().toISOString() } : null;
  }).filter(Boolean);
  await Promise.all(records.map(record => LifeDB.put("progress", record)));
}

async function syncTodoTrackerProgress(todo) {
  const gauges = (await LifeDB.all("gauges")).filter(gauge => gauge.linkedTodoName === todo.name);
  if (!gauges.length) return;
  const progress = await LifeDB.all("progress");
  const status = todo.status || (todo.completed ? "circle" : "none");
  const amount = status === "circle" ? 1 : status === "triangle" ? 0.5 : 0;
  await Promise.all(gauges.map(gauge => {
    const existing = progress.find(record => record.gaugeId === gauge.id && record.sourceTodoId === todo.id);
    if (amount === 0) return existing ? LifeDB.remove("progress", existing.id) : Promise.resolve();
    return LifeDB.put("progress", existing
      ? { ...existing, amount, date: todo.date }
      : { id: uid(), gaugeId: gauge.id, amount, date: todo.date, sourceTodoId: todo.id, createdAt: new Date().toISOString() });
  }));
}

async function removeTodosAndLinkedProgress(todoIds) {
  const ids = new Set(todoIds);
  const progress = await LifeDB.all("progress");
  await Promise.all([
    ...todoIds.map(id => LifeDB.remove("todos", id)),
    ...progress.filter(record => ids.has(record.sourceTodoId)).map(record => LifeDB.remove("progress", record.id))
  ]);
}

async function renderGauges() {
  const [gauges, progress] = await Promise.all([LifeDB.all("gauges"), LifeDB.all("progress")]);
  gauges.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  $("#gaugeEmpty").classList.toggle("hidden", gauges.length > 0);
  const totals = Object.create(null);
  progress.forEach(item => totals[item.gaugeId] = (totals[item.gaugeId] || 0) + Number(item.amount));
  $("#gaugeList").innerHTML = gauges.map(gauge => {
    const value = totals[gauge.id] || 0;
    const percent = gauge.target ? Math.min(100, value / gauge.target * 100) : 0;
    const reached = Number(gauge.target) > 0 && value >= gauge.target;
    const overdue = gauge.deadline && localISO(new Date()) > gauge.deadline && !reached;
    const deadlineLabel = gauge.deadline ? new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(new Date(`${gauge.deadline}T12:00:00`)) : "";
    return `<article class="gauge-card ${reached ? "goal-reached" : overdue ? "goal-overdue" : ""}" data-gauge-id="${gauge.id}">
      <div class="gauge-head"><h3>${escapeHTML(gauge.name)}</h3><div class="gauge-value"><b>${fmt(value)}</b><span> ${escapeHTML(gauge.unit)}${gauge.target ? ` / ${fmt(gauge.target)}` : ""}</span></div></div>
      <div class="progress-track"><div class="progress-fill" style="width:${gauge.target ? percent : Math.min(100, value)}%"></div></div>
      <div class="card-actions"><small>${Math.round(percent)}% 達成</small><div class="mini-actions">${gauge.deadline ? `<time class="gauge-deadline" datetime="${gauge.deadline}">期限 ${deadlineLabel}</time>` : ""}<button class="mini-btn" data-add="${gauge.id}">＋ 記録</button><button class="delete-btn" data-delete="${gauge.id}" aria-label="削除">×</button></div></div>
    </article>`;
  }).join("");
}

async function handleGaugeAction(event) {
  const add = event.target.closest("[data-add]");
  const del = event.target.closest("[data-delete]");
  if (add) {
    const gauges = await LifeDB.all("gauges");
    const gauge = gauges.find(g => g.id === add.dataset.add);
    $("#progressForm").reset();
    $("#progressForm").elements.gaugeId.value = gauge.id;
    $("#progressTitle").textContent = `${gauge.name}を記録`;
    setError($("#progressForm"), "");
    $("#progressModal").showModal();
  }
  if (del && confirm("このゲージと記録を削除しますか？")) {
    const progress = await LifeDB.all("progress");
    await Promise.all([LifeDB.remove("gauges", del.dataset.delete), ...progress.filter(p => p.gaugeId === del.dataset.delete).map(p => LifeDB.remove("progress", p.id))]);
    await renderGauges();
  }
}

function startGaugeLongPress(event) {
  if (event.target.closest("button")) return;
  const card = event.target.closest(".gauge-card");
  if (!card) return;
  cancelGaugeLongPress();
  longPressStart = { x: event.clientX, y: event.clientY };
  longPressTimer = setTimeout(() => openGaugeHistory(card.dataset.gaugeId), 1000);
}

function moveGaugeLongPress(event) {
  if (!longPressTimer || !longPressStart) return;
  if (Math.hypot(event.clientX - longPressStart.x, event.clientY - longPressStart.y) > 8) cancelGaugeLongPress();
}

function cancelGaugeLongPress() {
  clearTimeout(longPressTimer);
  longPressTimer = null;
  longPressStart = null;
}

async function openGaugeHistory(gaugeId) {
  cancelGaugeLongPress();
  const [gauges, progress] = await Promise.all([LifeDB.all("gauges"), LifeDB.all("progress")]);
  const gauge = gauges.find(item => item.id === gaugeId);
  if (!gauge) return;
  $("#historyGaugeId").value = gauge.id;
  $("#historyTarget").value = gauge.target ?? "";
  $("#historyDeadline").value = gauge.deadline || "";
  $("#historyTarget").dataset.original = $("#historyTarget").value;
  $("#historyDeadline").dataset.original = $("#historyDeadline").value;
  $("#historyTargetSave").disabled = true;
  $("#historyError").classList.remove("visible");
  const entries = progress.filter(item => item.gaugeId === gaugeId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  $("#historyList").innerHTML = entries.length ? entries.map(item => `<div class="history-entry" data-progress-id="${item.id}">
    <label>日付<input type="date" data-history-date data-original="${item.date}" value="${item.date}"></label>
    <label>値${gauge.unit ? `（${escapeHTML(gauge.unit)}）` : ""}<input type="number" min="0" step="any" inputmode="decimal" data-history-amount data-original="${item.amount}" value="${item.amount}"></label>
    <button class="mini-btn" data-history-save disabled>保存</button>
    <label class="history-memo">メモ<input type="text" maxlength="500" data-history-memo data-original="${escapeHTML(item.memo || "")}" value="${escapeHTML(item.memo || "")}" placeholder="メモなし"></label>
  </div>`).join("") : `<p class="history-empty">まだ記録がありません。</p>`;
  $("#historyModal").showModal();
}

function handleHistoryDirtyState(event) {
  if (event.target.matches("#historyTarget, #historyDeadline")) {
    $("#historyTargetSave").disabled =
      $("#historyTarget").value === $("#historyTarget").dataset.original &&
      $("#historyDeadline").value === $("#historyDeadline").dataset.original;
    return;
  }
  const row = event.target.closest("[data-progress-id]");
  if (!row) return;
  const date = $("[data-history-date]", row);
  const amount = $("[data-history-amount]", row);
  const memo = $("[data-history-memo]", row);
  $("[data-history-save]", row).disabled =
    date.value === date.dataset.original &&
    amount.value === amount.dataset.original &&
    memo.value === memo.dataset.original;
}

async function saveTrackerTarget() {
  const target = Number($("#historyTarget").value);
  const error = $("#historyError");
  if (!Number.isFinite(target) || target <= 0) {
    error.textContent = "0より大きい目標を入力してください。";
    error.classList.add("visible");
    return;
  }
  const gauge = (await LifeDB.all("gauges")).find(item => item.id === $("#historyGaugeId").value);
  if (!gauge) return;
  gauge.target = target;
  gauge.deadline = $("#historyDeadline").value || null;
  await LifeDB.put("gauges", gauge);
  $("#historyTarget").dataset.original = $("#historyTarget").value;
  $("#historyDeadline").dataset.original = $("#historyDeadline").value;
  $("#historyTargetSave").disabled = true;
  error.classList.remove("visible");
  await renderGauges();
  showToast("目標を更新しました");
}

async function saveHistoryEntry(event) {
  const save = event.target.closest("[data-history-save]");
  if (!save) return;
  const row = save.closest("[data-progress-id]");
  const date = $("[data-history-date]", row).value;
  const amount = Number($("[data-history-amount]", row).value);
  const memo = $("[data-history-memo]", row).value.trim();
  const error = $("#historyError");
  if (!date || !Number.isFinite(amount) || amount < 0) {
    error.textContent = "正しい日付と0以上の値を入力してください。";
    error.classList.add("visible");
    return;
  }
  const entry = (await LifeDB.all("progress")).find(item => item.id === row.dataset.progressId);
  if (!entry) return;
  if (amount === 0) {
    await LifeDB.remove("progress", entry.id);
    row.remove();
    if (!$("#historyList").querySelector("[data-progress-id]")) {
      $("#historyList").innerHTML = '<p class="history-empty">まだ記録がありません。</p>';
    }
    error.classList.remove("visible");
    await renderGauges();
    showToast("記録を削除しました");
    return;
  }
  entry.date = date;
  entry.amount = amount;
  entry.memo = memo;
  await LifeDB.put("progress", entry);
  $("[data-history-date]", row).dataset.original = date;
  $("[data-history-amount]", row).value = String(amount);
  $("[data-history-amount]", row).dataset.original = String(amount);
  $("[data-history-memo]", row).value = memo;
  $("[data-history-memo]", row).dataset.original = memo;
  save.disabled = true;
  error.classList.remove("visible");
  await renderGauges();
  showToast("記録を更新しました");
}

async function addProgress(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const amount = Number(form.elements.amount.value);
  if (!Number.isFinite(amount) || amount <= 0) return setError(form, "0より大きい数を入力してください。");
  await LifeDB.put("progress", { id: uid(), gaugeId: form.elements.gaugeId.value, amount, memo: form.elements.memo.value.trim(), date: localISO(new Date()), createdAt: new Date().toISOString() });
  form.closest("dialog").close();
  await renderGauges();
  showToast("達成分を記録しました");
}

function updateDateUI() {
  const d = new Date(`${selectedDate}T12:00:00`);
  $("#selectedDate").value = selectedDate;
  $("#selectedDateLabel").textContent = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long" }).format(d);
  renderCalendar();
}

function shiftMonth(months) {
  const d = new Date(`${selectedDate}T12:00:00`);
  const targetMonth = new Date(d.getFullYear(), d.getMonth() + months, 1, 12);
  const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0, 12).getDate();
  targetMonth.setDate(Math.min(d.getDate(), lastDay));
  changeDate(localISO(targetMonth));
}

async function renderCalendar() {
  const current = new Date(`${selectedDate}T12:00:00`);
  const year = current.getFullYear();
  const month = current.getMonth();
  const firstDay = new Date(year, month, 1, 12).getDay();
  const daysInMonth = new Date(year, month + 1, 0, 12).getDate();
  const todos = await LifeDB.all("todos");
  const counts = Object.create(null);
  todos.forEach(todo => {
    if (!todo.date.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)) return;
    const status = todo.status || (todo.completed ? "circle" : "none");
    if (!counts[todo.date]) counts[todo.date] = { circle: 0, triangle: 0, cross: 0 };
    if (status !== "none") counts[todo.date][status]++;
  });
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"].map((day, index) => `<div class="calendar-weekday ${index === 0 ? "sunday" : index === 6 ? "saturday" : ""}">${day}</div>`).join("");
  const blanks = Array.from({ length: firstDay }, () => '<div class="calendar-blank"></div>').join("");
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const count = counts[iso] || { circle: 0, triangle: 0, cross: 0 };
    return `<button class="calendar-day ${iso === selectedDate ? "active" : ""}" data-date="${iso}">
      <b>${day}</b>
      <i class="calendar-count circle ${count.circle === 0 ? "zero" : ""}">${count.circle}</i>
      <i class="calendar-count triangle ${count.triangle === 0 ? "zero" : ""}">${count.triangle}</i>
      <i class="calendar-count cross ${count.cross === 0 ? "zero" : ""}">${count.cross}</i>
    </button>`;
  }).join("");
  $("#monthStrip").innerHTML = weekdays + blanks + days;
  $$(".calendar-day", $("#monthStrip")).forEach(button => button.addEventListener("click", () => {
    if (suppressCalendarClick) {
      suppressCalendarClick = false;
      return;
    }
    changeDate(button.dataset.date);
  }));
}

function startCalendarLongPress(event) {
  const day = event.target.closest(".calendar-day");
  if (!day) return;
  cancelCalendarLongPress();
  calendarLongPressStart = { x: event.clientX, y: event.clientY };
  calendarLongPressTimer = setTimeout(() => {
    suppressCalendarClick = true;
    setTimeout(() => { suppressCalendarClick = false; }, 800);
    openDailyTrackerRecords(day.dataset.date);
  }, 1000);
}

function moveCalendarLongPress(event) {
  if (!calendarLongPressTimer || !calendarLongPressStart) return;
  if (Math.hypot(event.clientX - calendarLongPressStart.x, event.clientY - calendarLongPressStart.y) > 8) cancelCalendarLongPress();
}

function cancelCalendarLongPress() {
  clearTimeout(calendarLongPressTimer);
  calendarLongPressTimer = null;
  calendarLongPressStart = null;
}

async function openDailyTrackerRecords(date) {
  cancelCalendarLongPress();
  const [gauges, progress] = await Promise.all([LifeDB.all("gauges"), LifeDB.all("progress")]);
  const gaugeMap = Object.fromEntries(gauges.map(gauge => [gauge.id, gauge]));
  const records = progress.filter(item => item.date === date).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const displayDate = new Date(`${date}T12:00:00`);
  $("#dailyTrackerTitle").textContent = `${displayDate.getMonth() + 1}/${displayDate.getDate()}の記録`;
  $("#dailyTrackerList").innerHTML = records.length ? records.map(record => {
    const gauge = gaugeMap[record.gaugeId];
    return `<div class="daily-tracker-entry"><div><strong>${escapeHTML(gauge?.name || "削除済みTracker")}</strong>${record.memo ? `<p>${escapeHTML(record.memo)}</p>` : ""}</div><span>${fmt(record.amount)} ${escapeHTML(gauge?.unit || "")}</span></div>`;
  }).join("") : '<p class="history-empty">この日のTracker記録はありません。</p>';
  $("#dailyTrackerModal").showModal();
}
function changeDate(value) {
  if (!value) return;
  selectedDate = value;
  updateDateUI();
  renderTodos();
}

async function addTodo(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const name = data.get("name").trim();
  if (!name) return setError(form, "ToDo名を入力してください。");
  let start = selectedDate, end = selectedDate;
  if (data.get("range") === "custom") {
    start = data.get("startDate"); end = data.get("endDate");
    if (!start || !end || start > end) return setError(form, "正しい開始日と終了日を入力してください。");
  }
  const dates = [];
  for (let d = new Date(`${start}T12:00:00`), last = new Date(`${end}T12:00:00`); d <= last; d.setDate(d.getDate() + 1)) {
    dates.push(localISO(d));
    if (dates.length > 366) return setError(form, "一度に追加できる期間は366日までです。");
  }
  const batchId = dates.length > 1 ? uid() : null;
  await Promise.all(dates.map(date => LifeDB.put("todos", { id: uid(), batchId, name, type: "status", status: "none", completed: false, date, createdAt: new Date().toISOString() })));
  form.closest("dialog").close();
  await renderTodos();
  showToast(`${dates.length}日分のToDoを追加しました`);
}

async function renderTodos() {
  const todos = (await LifeDB.all("todos")).filter(item => item.date === selectedDate).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const displayDate = new Date(`${selectedDate}T12:00:00`);
  $("#todoSectionTitle").textContent = `${displayDate.getMonth() + 1}/${displayDate.getDate()}のToDo`;
  $("#todoEmpty").classList.toggle("hidden", todos.length > 0);
  $("#todoList").innerHTML = todos.map(todo => {
    const status = todo.status || (todo.completed ? "circle" : "none");
    return `<article class="todo-card status-${status}" data-todo-id="${todo.id}">
    <div class="todo-info"><h3>${escapeHTML(todo.name)}</h3>${todo.memo ? `<p class="todo-memo">${escapeHTML(todo.memo)}</p>` : ""}</div>
    <div class="todo-status" role="group" aria-label="${escapeHTML(todo.name)}の状態">
      <button class="${status === "circle" ? "active" : ""}" data-todo-status="circle" data-todo-id="${todo.id}" aria-label="〇">〇</button>
      <button class="${status === "triangle" ? "active" : ""}" data-todo-status="triangle" data-todo-id="${todo.id}" aria-label="△">△</button>
      <button class="${status === "cross" ? "active" : ""}" data-todo-status="cross" data-todo-id="${todo.id}" aria-label="×">×</button>
    </div>
    <button class="delete-btn" data-todo-delete="${todo.id}" aria-label="削除">×</button>
  </article>`;
  }).join("");
  await renderCalendar();
}

function startTodoLongPress(event) {
  if (event.target.closest("button")) return;
  const card = event.target.closest(".todo-card");
  if (!card) return;
  cancelTodoLongPress();
  todoLongPressStart = { x: event.clientX, y: event.clientY };
  todoLongPressTimer = setTimeout(() => openTodoMemo(card.dataset.todoId), 1000);
}

function moveTodoLongPress(event) {
  if (!todoLongPressTimer || !todoLongPressStart) return;
  if (Math.hypot(event.clientX - todoLongPressStart.x, event.clientY - todoLongPressStart.y) > 8) cancelTodoLongPress();
}

function cancelTodoLongPress() {
  clearTimeout(todoLongPressTimer);
  todoLongPressTimer = null;
  todoLongPressStart = null;
}

async function openTodoMemo(todoId) {
  cancelTodoLongPress();
  const todo = (await LifeDB.all("todos")).find(item => item.id === todoId);
  if (!todo) return;
  const form = $("#todoMemoForm");
  form.reset();
  form.elements.todoId.value = todo.id;
  form.elements.memo.value = todo.memo || "";
  $("#todoMemoTitle").textContent = todo.memo ? "メモを編集" : "メモを追加";
  setError(form, "");
  $("#todoMemoModal").showModal();
}

async function saveTodoMemo(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const todo = (await LifeDB.all("todos")).find(item => item.id === form.elements.todoId.value);
  if (!todo) return setError(form, "編集するToDoが見つかりません。");
  const hadMemo = Boolean(todo.memo);
  todo.memo = form.elements.memo.value.trim();
  await LifeDB.put("todos", todo);
  form.closest("dialog").close();
  await renderTodos();
  showToast(todo.memo ? (hadMemo ? "メモを更新しました" : "メモを追加しました") : "メモを削除しました");
}

async function handleTodoAction(event) {
  const statusButton = event.target.closest("[data-todo-status]");
  const del = event.target.closest("[data-todo-delete]");
  if (statusButton) {
    const todo = (await LifeDB.all("todos")).find(t => t.id === statusButton.dataset.todoId);
    const current = todo.status || (todo.completed ? "circle" : "none");
    todo.status = current === statusButton.dataset.todoStatus ? "none" : statusButton.dataset.todoStatus;
    todo.type = "status";
    todo.completed = todo.status === "circle";
    await LifeDB.put("todos", todo);
    await syncTodoTrackerProgress(todo);
    await Promise.all([renderTodos(), renderGauges()]);
  }
  if (del) {
    const allTodos = await LifeDB.all("todos");
    const todo = allTodos.find(item => item.id === del.dataset.todoDelete);
    if (!todo) return;
    const batchCount = relatedTodoBatch(todo, allTodos).length;
    if (batchCount > 1) {
      $("#todoDeleteId").value = todo.id;
      $("#todoDeleteMessage").textContent = `「${todo.name}」は一括追加されたToDoです。削除する範囲を選んでください。`;
      $("#deleteTodoBatchBtn").textContent = `まとめて削除（${batchCount}件）`;
      $("#todoDeleteModal").showModal();
    } else if (confirm("この日のToDoを削除しますか？")) {
      await removeTodosAndLinkedProgress([todo.id]);
      await Promise.all([renderTodos(), renderGauges()]);
    }
  }
}

function relatedTodoBatch(todo, allTodos) {
  if (todo.batchId) return allTodos.filter(item => item.batchId === todo.batchId);
  const createdAt = Date.parse(todo.createdAt);
  if (!Number.isFinite(createdAt)) return [todo];
  const legacyBatch = allTodos.filter(item =>
    !item.batchId &&
    item.name === todo.name &&
    Math.abs(Date.parse(item.createdAt) - createdAt) < 2000
  );
  return legacyBatch.length > 1 ? legacyBatch : [todo];
}

async function deleteTodoSelection(mode) {
  const todoId = $("#todoDeleteId").value;
  const allTodos = await LifeDB.all("todos");
  const todo = allTodos.find(item => item.id === todoId);
  if (!todo) {
    $("#todoDeleteModal").close();
    return;
  }
  if (mode === "batch") {
    const batch = relatedTodoBatch(todo, allTodos);
    await removeTodosAndLinkedProgress(batch.map(item => item.id));
    showToast(`${batch.length}件のToDoを削除しました`);
  } else {
    await removeTodosAndLinkedProgress([todo.id]);
    showToast("この日のToDoを削除しました");
  }
  $("#todoDeleteModal").close();
  await Promise.all([renderTodos(), renderGauges()]);
}

async function addNote(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const title = data.get("title").trim();
  const text = data.get("text").trim();
  if (!title) return setError(form, "目標を入力してください。");
  const noteId = data.get("id");
  if (noteId) {
    const current = (await LifeDB.all("notes")).find(note => note.id === noteId);
    if (!current) return setError(form, "編集する目標が見つかりません。");
    await LifeDB.put("notes", { ...current, title, text, starred: data.get("starred") === "on" });
  } else {
    await LifeDB.put("notes", { id: uid(), bookId: selectedGoalBookId, title, text, starred: data.get("starred") === "on", createdAt: new Date().toISOString() });
  }
  form.closest("dialog").close();
  await renderNotes();
  showToast(noteId ? "目標を更新しました" : "Goalsに追加しました");
}

async function renderNotes() {
  let books = await LifeDB.all("goalBooks");
  if (!books.length) {
    const firstBook = { id: uid(), name: "My Goals", color: GOAL_BOOK_COLORS[0], createdAt: new Date().toISOString() };
    await LifeDB.put("goalBooks", firstBook);
    books = [firstBook];
  }
  books.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!books.some(book => book.id === selectedGoalBookId)) selectedGoalBookId = books[0].id;
  const activeBook = books.find(book => book.id === selectedGoalBookId);
  $("#goalBookTabs").innerHTML = books.map(book => `<button class="goal-book-tab ${book.id === selectedGoalBookId ? "active" : ""}" data-book-id="${book.id}" style="--book-color:${book.color}">${escapeHTML(book.name)}</button>`).join("");
  $("#activeGoalBookName").textContent = activeBook.name;
  $(".goal-memo").style.setProperty("--book-color", activeBook.color);
  const allNotes = await LifeDB.all("notes");
  const notes = allNotes.filter(note => note.bookId ? note.bookId === selectedGoalBookId : selectedGoalBookId === books[0].id);
  notes.sort((a, b) => Number(Boolean(b.starred)) - Number(Boolean(a.starred)) || a.createdAt.localeCompare(b.createdAt));
  $("#noteEmpty").classList.toggle("hidden", notes.length > 0);
  $("#noteList").innerHTML = notes.map(note => `<div class="goal-line ${note.starred ? "starred" : ""}">
    <div class="goal-copy">
      <strong>${escapeHTML(note.title || note.text)}</strong>
      ${note.title && note.text ? `<p>${escapeHTML(note.text)}</p>` : ""}
    </div>
    <button class="edit-goal-btn" data-note-edit="${note.id}">編集</button>
  </div>`).join("");
}

async function addGoalBook(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const name = new FormData(form).get("name").trim();
  if (!name) return setError(form, "Index名を入力してください。");
  const books = await LifeDB.all("goalBooks");
  if (books.some(book => book.name.toLocaleLowerCase("ja") === name.toLocaleLowerCase("ja"))) return setError(form, "同じ名前のIndexがあります。");
  const book = {
    id: uid(),
    name,
    color: GOAL_BOOK_COLORS[books.length % GOAL_BOOK_COLORS.length],
    createdAt: new Date().toISOString()
  };
  await LifeDB.put("goalBooks", book);
  selectedGoalBookId = book.id;
  form.closest("dialog").close();
  await renderNotes();
  showToast(`${name}を追加しました`);
}

async function deleteGoalBook() {
  const books = await LifeDB.all("goalBooks");
  const book = books.find(item => item.id === selectedGoalBookId);
  if (!book || !confirm(`「${book.name}」を削除してよろしいですか？\nこのIndex内の目標もすべて削除されます。`)) return;
  const notes = await LifeDB.all("notes");
  await Promise.all([
    LifeDB.remove("goalBooks", book.id),
    ...notes.filter(note => note.bookId === book.id || (!note.bookId && book.id === books[0]?.id)).map(note => LifeDB.remove("notes", note.id))
  ]);
  selectedGoalBookId = null;
  await renderNotes();
  showToast(`${book.name}を削除しました`);
}
async function handleNoteAction(event) {
  const edit = event.target.closest("[data-note-edit]");
  if (!edit) return;
  const note = (await LifeDB.all("notes")).find(item => item.id === edit.dataset.noteEdit);
  if (!note) return;
  const form = $("#noteForm");
  form.reset();
  form.elements.id.value = note.id;
  form.elements.title.value = note.title || note.text;
  form.elements.text.value = note.title ? note.text : "";
  form.elements.starred.checked = Boolean(note.starred);
  setError(form, "");
  $("#noteDeleteBtn").classList.remove("hidden");
  $(".modal-head h2", $("#noteModal")).textContent = "目標を編集";
  $("#noteModal").showModal();
}

async function deleteEditingNote() {
  const noteId = $("#noteForm").elements.id.value;
  if (!noteId || !confirm("この目標を削除しますか？")) return;
  await LifeDB.remove("notes", noteId);
  $("#noteModal").close();
  await renderNotes();
  showToast("目標を削除しました");
}

function download(content, filename, type) {
  const blob = new Blob(["\ufeff", content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportJSON() {
  const data = { app: "Life Compass", version: 1, exportedAt: new Date().toISOString() };
  for (const store of LifeDB.STORES) data[store] = await LifeDB.all(store);
  preparedBackupText = JSON.stringify(data, null, 2);
  const filename = `life-compass-${localISO(new Date())}.json`;
  preparedBackupFile = new File([preparedBackupText], filename, { type: "application/json" });
  if (preparedBackupUrl) URL.revokeObjectURL(preparedBackupUrl);
  preparedBackupUrl = URL.createObjectURL(preparedBackupFile);
  const link = $("#backupDownloadLink");
  link.href = preparedBackupUrl;
  link.download = filename;
  let canShare = false;
  try {
    canShare = Boolean(navigator.share && navigator.canShare?.({ files: [preparedBackupFile] }));
  } catch {
    canShare = false;
  }
  $("#backupShareBtn").classList.toggle("hidden", !canShare);
  $("#backupError").classList.remove("visible");
  $("#settingsModal").close();
  $("#backupModal").showModal();
}

async function shareBackup() {
  try {
    await navigator.share({
      files: [preparedBackupFile],
      title: "Life Compass バックアップ"
    });
    showToast("共有先を選択しました");
  } catch (error) {
    if (error.name === "AbortError") return;
    const el = $("#backupError");
    el.textContent = "共有できませんでした。「ファイルとして保存」をお試しください。";
    el.classList.add("visible");
  }
}

async function copyBackupJSON() {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(preparedBackupText);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = preparedBackupText;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      if (!document.execCommand("copy")) throw new Error("copy failed");
      textarea.remove();
    }
    showToast("JSONをコピーしました");
  } catch {
    const el = $("#backupError");
    el.textContent = "コピーできませんでした。「共有して保存」または「ファイルとして保存」をお試しください。";
    el.classList.add("visible");
  }
}

async function importJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const requiredStores = ["gauges", "progress", "todos", "notes"];
    if (data.app !== "Life Compass" || data.version !== 1 || !requiredStores.every(store => Array.isArray(data[store]))) throw new Error("形式が違います");
    if (!Array.isArray(data.goalBooks)) data.goalBooks = [];
    if (!confirm("現在のデータをバックアップ内容で置き換えますか？")) return;
    await LifeDB.replaceAll(data);
    $("#settingsModal").close();
    await renderAll();
    showToast("バックアップを復元しました");
  } catch (error) {
    $("#settingsError").textContent = "復元できませんでした。Life Compassの正しいJSONファイルを選んでください。";
    $("#settingsError").classList.add("visible");
  } finally {
    event.target.value = "";
  }
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}
async function exportCSV() {
  const [gauges, progress, todos, notes] = await Promise.all(LifeDB.STORES.map(LifeDB.all));
  const rows = [["種別","日付","名前","値","単位","目標","完了","内容"]];
  const gaugeMap = Object.fromEntries(gauges.map(g => [g.id, g]));
  progress.forEach(p => rows.push(["ゲージ記録", p.date, gaugeMap[p.gaugeId]?.name || "", p.amount, gaugeMap[p.gaugeId]?.unit || "", gaugeMap[p.gaugeId]?.target || "", "", p.memo || ""]));
  gauges.filter(g => !progress.some(p => p.gaugeId === g.id)).forEach(g => rows.push(["ゲージ", g.createdAt.slice(0,10), g.name, 0, g.unit, g.target || "", "", ""]));
  todos.forEach(t => rows.push(["TODO", t.date, t.name, t.type === "number" ? t.value : "", t.unit, t.target || "", t.completed ? "はい" : "いいえ", t.memo || ""]));
  notes.forEach(n => rows.push(["Goals", n.createdAt.slice(0,10), "", "", "", "", "", n.text]));
  download(rows.map(row => row.map(csvCell).join(",")).join("\r\n"), `life-compass-${localISO(new Date())}.csv`, "text/csv;charset=utf-8");
  showToast("CSVを書き出しました");
}
