/**
 * public/app.js
 *
 * Client-side application script for TaskRush (A3)
 * - Handles authenticated API requests
 * - Renders task list with bootstrap UI
 * - Supports create / update / delete for tasks
 * - Tracks additional client-side fields (notes, important, status) in localStorage
 *
 * Notes:
 * - The server returns basic task fields (id, title, priority, estimateHrs, deadline, urgencyScore, createdAt).
 *   Extra fields (notes, important, status) are stored client-side in localStorage and merged into the UI.
 */

const state = {
  tasks: [],
  lastSnapshot: [],
  meta: loadMeta(), // extra fields stored locally keyed by task id
  user: null,
};

function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  return fetch(path, opts).then(async (res) => {
    const text = await res.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch (e) {
      throw new Error("Bad JSON from server");
    }
    if (!res.ok) {
      throw new Error((parsed && parsed.error) || "Server error");
    }
    return parsed;
  });
}

function loadMeta() {
  try {
    const raw = localStorage.getItem("taskrush:meta");
    return raw ? JSON.parse(raw) : Object.create(null);
  } catch (e) {
    console.warn("Failed to load meta from localStorage", e);
    return Object.create(null);
  }
}

function saveMeta() {
  try {
    localStorage.setItem("taskrush:meta", JSON.stringify(state.meta));
  } catch (e) {
    console.warn("Failed to save meta to localStorage", e);
  }
}

function getMetaFor(id) {
  return state.meta[id] || { notes: "", important: false, status: "active" };
}

function setMetaFor(id, meta) {
  state.meta[id] = { notes: meta.notes || "", important: !!meta.important, status: meta.status || "active" };
  saveMeta();
}

async function fetchUser() {
  try {
    const data = await api("GET", "/auth/me");
    if (data && data.authenticated) {
      state.user = data.user;
      showAuthInfo(state.user);
      // make app visible
      document.getElementById("app-area").classList.remove("d-none");
      return true;
    } else {
      state.user = null;
      showAuthInfo(null);
      document.getElementById("app-area").classList.add("d-none");
      return false;
    }
  } catch (err) {
    console.error("auth/me failed", err);
    state.user = null;
    showAuthInfo(null);
    document.getElementById("app-area").classList.add("d-none");
    return false;
  }
}

function showAuthInfo(user) {
  const authUsername = document.getElementById("auth-username");
  const authInfo = document.getElementById("auth-info");
  if (!authUsername || !authInfo) return;
  if (user) {
    authUsername.textContent = `Signed in: ${user.username}`;
    authInfo.classList.remove("d-none");
  } else {
    authInfo.classList.add("d-none");
    authUsername.textContent = "";
  }
}

async function fetchTasks() {
  try {
    state.tasks = await api("GET", "/api/tasks");
    // merge meta fields retained in localStorage
    state.tasks = state.tasks.map((t) => {
      const meta = getMetaFor(t.id);
      return { ...t, notes: meta.notes, important: meta.important, status: meta.status };
    });
    renderTasks();
  } catch (err) {
    showError("Failed to load tasks: " + err.message);
  }
}

function renderTasks() {
  const tbody = document.getElementById("tasks-body");
  tbody.innerHTML = "";

  if (!state.tasks || state.tasks.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      '<td colspan="9" class="text-center py-4">No tasks yet. Add your first task above!</td>';
    tbody.appendChild(tr);
    return;
  }

  state.tasks.forEach((t) => {
    const tr = document.createElement("tr");
    tr.classList.add(`priority-${t.priority}`);
    const deadline = t.deadline || "No deadline";
    const notes = escapeHTML(t.notes || "");
    const important = t.important ? "Yes" : "No";
    const status = escapeHTML(t.status || "active");

    tr.innerHTML = `
      <td>${escapeHTML(t.title)}</td>
      <td><span class="badge bg-secondary text-uppercase">${escapeHTML(t.priority)}</span></td>
      <td>${t.estimateHrs}</td>
      <td>${deadline}</td>
      <td>${t.urgencyScore}</td>
      <td title="${notes}">${notes ? (notes.length > 50 ? notes.slice(0, 47) + "…" : notes) : ""}</td>
      <td>${important}</td>
      <td>${status}</td>
      <td class="actions-cell">
        <button class="btn btn-sm btn-outline-primary me-1" data-action="edit" data-id="${t.id}">Edit</button>
        <button class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${t.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

document.getElementById("tasks-body")?.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === "delete") handleDelete(id);
  if (btn.dataset.action === "edit") enterEditMode(id);
});

function enterEditMode(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  document.getElementById("title").value = task.title;
  document.getElementById("priority").value = task.priority;
  document.getElementById("estimateHrs").value = task.estimateHrs;
  document.getElementById("deadline").value = task.deadline || "";
  document.getElementById("notes").value = task.notes || "";
  document.getElementById("important").checked = !!task.important;
  // status radio buttons
  const status = task.status || "active";
  document.getElementById("status-active").checked = status === "active";
  document.getElementById("status-backlog").checked = status === "backlog";
  document.getElementById("status-done").checked = status === "done";

  document.getElementById("edit-id").value = task.id;
  document.getElementById("form-mode-label").textContent = "Edit Task";
  document.getElementById("submit-btn").textContent = "Save";
  document.getElementById("cancel-edit").classList.remove("d-none");

  // smooth scroll to form
  document.getElementById("entry-section").scrollIntoView({ behavior: "smooth" });
}

document.getElementById("cancel-edit")?.addEventListener("click", resetForm);

function resetForm() {
  document.getElementById("task-form").reset();
  document.getElementById("edit-id").value = "";
  document.getElementById("form-mode-label").textContent = "Add Task";
  document.getElementById("submit-btn").textContent = "Add";
  document.getElementById("cancel-edit").classList.add("d-none");
  // Ensure default status is selected
  document.getElementById("status-active").checked = true;
}

document.getElementById("task-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = {
    title: document.getElementById("title").value.trim(),
    priority: document.getElementById("priority").value,
    estimateHrs: Number(document.getElementById("estimateHrs").value),
    deadline: document.getElementById("deadline").value || null,
  };

  // extra client-side fields
  const notes = document.getElementById("notes")?.value || "";
  const important = !!document.getElementById("important")?.checked;
  const status = document.querySelector('input[name="status"]:checked')?.value || "active";

  const editingId = document.getElementById("edit-id").value;
  state.lastSnapshot = JSON.parse(JSON.stringify(state.tasks));

  try {
    hideError();
    if (editingId) {
      // include extra fields in body; server may ignore unknown fields, but we'll keep meta locally
      const res = await api("PUT", `/api/tasks/${editingId}`, { ...data, notes, important, status });
      // server returns full array of tasks (without our extras); merge with local meta
      state.tasks = res.map((t) => {
        const meta = getMetaFor(t.id);
        return { ...t, notes: meta.notes, important: meta.important, status: meta.status };
      });
      // update meta for this id from form inputs
      setMetaFor(editingId, { notes, important, status });
    } else {
      const res = await api("POST", "/api/tasks", { ...data, notes, important, status });
      // server returns tasks array; new task likely first (sorted by createdAt desc)
      state.tasks = res.map((t) => {
        const meta = getMetaFor(t.id);
        return { ...t, notes: meta.notes, important: meta.important, status: meta.status };
      });
      // Try to find the newly created task by comparing with the previous state
      // The new task should be the one that didn't exist before
      const previousIds = new Set(state.lastSnapshot.map(t => t.id));
      let newTask = state.tasks.find(t => !previousIds.has(t.id));
        
      if (newTask) {
        setMetaFor(newTask.id, { notes, important, status });
        // attach meta to the in-memory object
        newTask.notes = notes;
        newTask.important = important;
        newTask.status = status;
      } else if (state.tasks.length > 0) {
        // Fallback: if we can't identify the new task, use the first one
        // and update its metadata
        newTask = state.tasks[0];
        setMetaFor(newTask.id, { notes, important, status });
        newTask.notes = notes;
        newTask.important = important;
        newTask.status = status;
      }
    }

    resetForm();
    // Fetch fresh data from server to ensure consistency
    await fetchTasks();
    // Scroll to the tasks section to show the newly added task
    document.getElementById("results-section").scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    state.tasks = state.lastSnapshot;
    renderTasks();
    showError(err.message);
  }
});

async function handleDelete(id) {
  if (!confirm("Are you sure you want to delete this task?")) return;
  state.lastSnapshot = JSON.parse(JSON.stringify(state.tasks));
  try {
    hideError();
    await api("DELETE", `/api/tasks/${id}`);
    // remove meta for the deleted task
    if (state.meta[id]) {
      delete state.meta[id];
      saveMeta();
    }
    // refresh the list
    await fetchTasks();
  } catch (err) {
    state.tasks = state.lastSnapshot;
    renderTasks();
    showError(err.message);
  }
}

function escapeHTML(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function showError(msg) {
  const container = document.getElementById("error-container");
  container.innerHTML = `<div class="alert alert-danger" role="alert">${escapeHTML(msg)}</div>`;
  container.scrollIntoView({ behavior: "smooth" });
}

function hideError() {
  const container = document.getElementById("error-container");
  container.innerHTML = "";
}

// Logout handler (there's a logout button rendered by the header auth block)
document.getElementById("logout-btn")?.addEventListener("click", async (e) => {
  e.preventDefault();
  try {
    await api("POST", "/auth/logout");
  } catch (err) {
    // ignore
  } finally {
    window.location.reload();
  }
});

// Initialize app: ensure authenticated, then load tasks
(async function init() {
  // If the auth UI performed the auth flow, this will detect it; otherwise, request will return unauthenticated.
  const authed = await fetchUser();
  if (!authed) {
    // auth UI should be visible; do not proceed to fetch tasks
    return;
  }
  await fetchTasks();
})();