const API_URL = "/api/tasks";
const PER_PAGE = 5;

const form = document.getElementById("task-form");
const input = document.getElementById("task-input");
const list = document.getElementById("task-list");
const filterBar = document.getElementById("filter-bar");
const pagination = document.getElementById("pagination");
const prevBtn = document.getElementById("prev-page");
const nextBtn = document.getElementById("next-page");
const pageInfo = document.getElementById("page-info");

let currentFilter = "all";
let currentPage = 1;
let totalPages = 1;

async function fetchTasks() {
  const params = new URLSearchParams({
    page: currentPage,
    per_page: PER_PAGE,
    status: currentFilter,
  });
  const res = await fetch(`${API_URL}?${params}`);
  const data = await res.json();

  totalPages = data.total_pages || 1;
  if (currentPage > totalPages) {
    currentPage = totalPages;
    if (currentPage >= 1) {
      await fetchTasks();
      return;
    }
  }

  renderTasks(data.tasks);
  renderPagination();
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
    empty.textContent = "할 일이 없습니다.";
    list.appendChild(empty);
    return;
  }

  tasks.forEach((task) => {
    const item = document.createElement("li");
    item.className = "task-item" + (task.is_done ? " done" : "");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.is_done;
    checkbox.addEventListener("change", () => toggleTask(task.id, checkbox.checked));

    const title = document.createElement("span");
    title.className = "task-title";
    title.textContent = task.title;

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.textContent = "✕";
    deleteBtn.addEventListener("click", () => deleteTask(task.id));

    item.appendChild(checkbox);
    item.appendChild(title);
    item.appendChild(deleteBtn);
    list.appendChild(item);
  });
}

async function addTask(title) {
  await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  currentPage = 1;
  await fetchTasks();
}

async function toggleTask(id, isDone) {
  await fetch(`${API_URL}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_done: isDone }),
  });
  await fetchTasks();
}

async function deleteTask(id) {
  await fetch(`${API_URL}/${id}`, { method: "DELETE" });
  await fetchTasks();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = input.value.trim();
  if (!title) return;
  input.value = "";
  await addTask(title);
});

filterBar.addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-btn");
  if (!btn) return;

  currentFilter = btn.dataset.filter;
  currentPage = 1;
  filterBar.querySelectorAll(".filter-btn").forEach((b) => b.classList.toggle("active", b === btn));
  fetchTasks();
});

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
