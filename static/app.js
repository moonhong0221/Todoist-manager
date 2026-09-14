const API_URL = "/api/tasks";
const PER_PAGE = 5;

const form = document.getElementById("task-form");
const input = document.getElementById("task-input");
const priorityInput = document.getElementById("priority-input");
const dueDateInput = document.getElementById("due-date-input");
const list = document.getElementById("task-list");
const filterBar = document.getElementById("filter-bar");
const searchInput = document.getElementById("search-input");
const pagination = document.getElementById("pagination");
const prevBtn = document.getElementById("prev-page");
const nextBtn = document.getElementById("next-page");
const pageInfo = document.getElementById("page-info");
const clearCompletedBtn = document.getElementById("clear-completed");
const statsFraction = document.getElementById("stats-fraction");
const statsLabel = document.getElementById("stats-label");
const progressFill = document.getElementById("progress-fill");
const themeToggle = document.getElementById("theme-toggle");

let currentFilter = "all";
let currentPage = 1;
let totalPages = 1;
let searchQuery = "";
let searchDebounce = null;

// ---------------------------------------------------------------- theme

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("todo-theme", theme);
}

(function initTheme() {
  const saved = localStorage.getItem("todo-theme");
  const preferred = saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(preferred);
})();

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    applyTheme(current === "dark" ? "light" : "dark");
  });
}

// ----------------------------------------------------------------- data

async function fetchTasks() {
  const params = new URLSearchParams({
    page: currentPage,
    per_page: PER_PAGE,
    status: currentFilter,
  });
  if (searchQuery) params.set("q", searchQuery);

  const res = await fetch(`${API_URL}?${params}`);
  if (res.status === 401) {
    window.location.reload();
    return;
  }
  const data = await res.json();

  totalPages = data.total_pages || 1;
  if (currentPage > totalPages && totalPages >= 1) {
    currentPage = totalPages;
    await fetchTasks();
    return;
  }

  renderTasks(data.tasks);
  renderPagination();
  renderStats(data.counts);
}

function renderStats(counts) {
  if (!counts) return;
  const { all, done } = counts;
  statsFraction.textContent = `${done} / ${all}`;
  const pct = all > 0 ? Math.round((done / all) * 100) : 0;
  progressFill.style.width = `${pct}%`;

  if (all === 0) {
    statsLabel.textContent = "오늘의 할 일을 추가해보세요";
  } else if (done === all) {
    statsLabel.textContent = "오늘 할 일을 모두 끝냈어요";
  } else {
    statsLabel.textContent = "오늘도 하나씩 해봐요";
  }

  clearCompletedBtn.hidden = done === 0;
}

function formatDueBadge(dueDateStr, isDone) {
  if (!dueDateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr + "T00:00:00");
  const diffDays = Math.round((due - today) / 86400000);

  let text;
  if (diffDays === 0) text = "오늘 마감";
  else if (diffDays > 0) text = `D-${diffDays}`;
  else text = `${Math.abs(diffDays)}일 지남`;

  const overdue = diffDays < 0 && !isDone;
  return { text, overdue };
}

function renderPagination() {
  pageInfo.textContent = `${currentPage} / ${totalPages}`;
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
}

function renderTasks(tasks) {
  list.innerHTML = "";

  if (tasks.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-message";
    empty.textContent = searchQuery ? "검색 결과가 없습니다." : "할 일이 없습니다.";
    list.appendChild(empty);
    return;
  }

  tasks.forEach((task) => {
    const item = document.createElement("li");
    item.className = "task-item" + (task.is_done ? " done" : "");
    item.dataset.priority = task.priority || "medium";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "task-checkbox";
    checkbox.checked = task.is_done;
    checkbox.addEventListener("change", () => toggleTask(task.id, checkbox.checked));

    const body = document.createElement("div");
    body.className = "task-body";

    const title = document.createElement("span");
    title.className = "task-title";
    title.textContent = task.title;
    title.title = "더블클릭하여 수정";
    title.addEventListener("dblclick", () => startEditing(task, body, title));

    const meta = document.createElement("div");
    meta.className = "task-meta";
    const badge = formatDueBadge(task.due_date, task.is_done);
    if (badge) {
      const badgeEl = document.createElement("span");
      badgeEl.className = "due-badge" + (badge.overdue ? " overdue" : "");
      badgeEl.textContent = badge.text;
      meta.appendChild(badgeEl);
    }

    body.appendChild(title);
    if (badge) body.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "task-actions";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "icon-action";
    deleteBtn.textContent = "✕";
    deleteBtn.title = "삭제";
    deleteBtn.addEventListener("click", () => deleteTask(task.id));

    actions.appendChild(deleteBtn);

    item.appendChild(checkbox);
    item.appendChild(body);
    item.appendChild(actions);
    list.appendChild(item);
  });
}

function startEditing(task, body, titleEl) {
  const editInput = document.createElement("input");
  editInput.className = "task-title-input";
  editInput.value = task.title;
  body.replaceChild(editInput, titleEl);
  editInput.focus();
  editInput.setSelectionRange(editInput.value.length, editInput.value.length);

  const finish = async (commit) => {
    const newTitle = editInput.value.trim();
    if (commit && newTitle && newTitle !== task.title) {
      await updateTask(task.id, { title: newTitle });
    } else {
      await fetchTasks();
    }
  };

  editInput.addEventListener("blur", () => finish(true));
  editInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      editInput.blur();
    } else if (e.key === "Escape") {
      editInput.removeEventListener("blur", finish);
      fetchTasks();
    }
  });
}

async function addTask(title) {
  await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      priority: priorityInput.value,
      due_date: dueDateInput.value || null,
    }),
  });
  currentPage = 1;
  await fetchTasks();
}

async function updateTask(id, payload) {
  await fetch(`${API_URL}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await fetchTasks();
}

async function toggleTask(id, isDone) {
  await updateTask(id, { is_done: isDone });
}

async function deleteTask(id) {
  await fetch(`${API_URL}/${id}`, { method: "DELETE" });
  await fetchTasks();
}

async function clearCompleted() {
  await fetch(`${API_URL}/completed`, { method: "DELETE" });
  currentPage = 1;
  await fetchTasks();
}

// ---------------------------------------------------------------- events

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = input.value.trim();
  if (!title) return;
  input.value = "";
  const savedPriority = priorityInput.value;
  await addTask(title);
  priorityInput.value = savedPriority;
  dueDateInput.value = "";
  input.focus();
});

filterBar.addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-btn");
  if (!btn) return;

  currentFilter = btn.dataset.filter;
  currentPage = 1;
  filterBar.querySelectorAll(".filter-btn").forEach((b) => b.classList.toggle("active", b === btn));
  fetchTasks();
});

searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    searchQuery = searchInput.value.trim();
    currentPage = 1;
    fetchTasks();
  }, 250);
});

clearCompletedBtn.addEventListener("click", clearCompleted);

prevBtn.addEventListener("click", () => {
  if (currentPage <= 1) return;
  currentPage -= 1;
  fetchTasks();
});

nextBtn.addEventListener("click", () => {
  if (currentPage >= totalPages) return;
  currentPage += 1;
  fetchTasks();
});

fetchTasks();
