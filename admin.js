const SESSION_KEY = "faburicheng-admin-session";
const BOOTSTRAP_TOKEN_KEY = "faburicheng-admin-token";

const els = {
  loginForm: document.querySelector("#loginForm"),
  loginUsername: document.querySelector("#loginUsername"),
  loginPassword: document.querySelector("#loginPassword"),
  loginStatus: document.querySelector("#loginStatus"),
  sessionLine: document.querySelector("#sessionLine"),
  sessionName: document.querySelector("#sessionName"),
  logoutBtn: document.querySelector("#logoutBtn"),
  tokenInput: document.querySelector("#tokenInput"),
  tokenSave: document.querySelector("#tokenSave"),
  tokenStatus: document.querySelector("#tokenStatus"),
  createPanel: document.querySelector("#createPanel"),
  listPanel: document.querySelector("#listPanel"),
  createForm: document.querySelector("#createForm"),
  userList: document.querySelector("#userList"),
  toast: document.querySelector("#toast"),
};

let auth = loadAdminSession();
let bootstrapToken = localStorage.getItem(BOOTSTRAP_TOKEN_KEY) || "";

if (bootstrapToken) els.tokenInput.value = bootstrapToken;
setAuthed(false);
boot();

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = els.loginUsername.value.trim();
  const password = els.loginPassword.value;
  try {
    const data = await fetchJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    if (data.user?.role !== "admin") {
      await fetchJson("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${data.token}` },
      }).catch(() => {});
      throw new Error("这个账号不是管理员");
    }
    auth = { mode: "session", token: data.token, user: data.user };
    localStorage.setItem(SESSION_KEY, JSON.stringify(auth));
    els.loginPassword.value = "";
    setAuthed(true, `${data.user.displayName || data.user.username} · 管理员`);
    showToast("已进入后台");
    await loadUsers();
  } catch (error) {
    clearAdminSession();
    els.loginStatus.textContent = error.message || "登录失败";
    setAuthed(false);
  }
});

els.logoutBtn.addEventListener("click", async () => {
  if (auth?.mode === "session" && auth.token) {
    await fetchJson("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.token}` },
    }).catch(() => {});
  }
  clearAdminSession();
  setAuthed(false);
  showToast("已退出");
});

els.tokenSave.addEventListener("click", async () => {
  bootstrapToken = els.tokenInput.value.trim();
  localStorage.setItem(BOOTSTRAP_TOKEN_KEY, bootstrapToken);
  auth = bootstrapToken ? { mode: "bootstrap", token: bootstrapToken } : null;
  try {
    await loadUsers();
    els.tokenStatus.textContent = "令牌可用。先创建一个管理员账号。";
    setAuthed(true, "初始化令牌");
  } catch (error) {
    auth = null;
    els.tokenStatus.textContent = error.message || "令牌不可用";
    setAuthed(false);
  }
});

els.createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    await api("/api/admin/users", { method: "POST", body: JSON.stringify(data) });
    showToast(`已生成 ${data.username}`);
    form.reset();
    await loadUsers();
  } catch (error) {
    showToast(error.message || "创建失败");
  }
});

async function boot() {
  if (!auth?.token) return;
  if (auth.mode === "session") {
    try {
      const data = await api("/api/auth/me");
      if (data.user?.role !== "admin") throw new Error("这个账号不是管理员");
      auth.user = data.user;
      localStorage.setItem(SESSION_KEY, JSON.stringify(auth));
      setAuthed(true, `${data.user.displayName || data.user.username} · 管理员`);
      await loadUsers();
      return;
    } catch (error) {
      clearAdminSession();
      els.loginStatus.textContent = error.message || "请重新登录";
    }
  }
  setAuthed(false);
}

async function loadUsers() {
  const data = await api("/api/admin/users");
  renderUsers(data.users || []);
}

function renderUsers(users) {
  if (!users.length) {
    els.userList.innerHTML = `<div class="empty">还没账号。先生成一个管理员。</div>`;
    return;
  }
  els.userList.innerHTML = users
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))
    .map((user) => `
      <div class="user-row">
        <div>
          <strong>${escapeHtml(user.displayName || user.username)}${user.role === "admin" ? `<span class="role-chip">管理员</span>` : `<span class="role-chip">运营</span>`}</strong>
          <span>@${escapeHtml(user.username)} · ${new Date(user.createdAt).toLocaleString("zh-CN")}</span>
        </div>
        <div>
          <button class="ghost" type="button" data-role="${user.id}" data-next-role="${user.role === "admin" ? "member" : "admin"}">${user.role === "admin" ? "设运营" : "设管理员"}</button>
          <button class="ghost" type="button" data-reset="${user.id}">改密</button>
          <button class="danger" type="button" data-delete="${user.id}" data-name="${escapeHtml(user.username)}">删除</button>
        </div>
      </div>
    `).join("");
  els.userList.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(`确认删除 @${btn.dataset.name}？`)) return;
      try {
        await api(`/api/admin/users/${btn.dataset.delete}`, { method: "DELETE" });
        showToast("已删除");
        await loadUsers();
      } catch (error) {
        showToast(error.message || "删除失败");
      }
    });
  });
  els.userList.querySelectorAll("[data-reset]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const next = prompt("新密码，至少 6 位");
      if (!next) return;
      try {
        await api(`/api/admin/users/${btn.dataset.reset}`, { method: "PATCH", body: JSON.stringify({ password: next }) });
        showToast("密码已重置");
      } catch (error) {
        showToast(error.message || "重置失败");
      }
    });
  });
  els.userList.querySelectorAll("[data-role]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/api/admin/users/${btn.dataset.role}`, {
          method: "PATCH",
          body: JSON.stringify({ role: btn.dataset.nextRole }),
        });
        showToast("角色已更新");
        await loadUsers();
      } catch (error) {
        showToast(error.message || "更新失败");
      }
    });
  });
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (auth?.mode === "bootstrap") headers["X-Admin-Token"] = auth.token;
  if (auth?.mode === "session") headers.Authorization = `Bearer ${auth.token}`;
  return fetchJson(path, { ...options, headers });
}

async function fetchJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function setAuthed(isAuthed, label = "") {
  els.createPanel.hidden = !isAuthed;
  els.listPanel.hidden = !isAuthed;
  els.sessionLine.hidden = !isAuthed;
  els.loginForm.hidden = isAuthed;
  els.sessionName.textContent = label;
  els.loginStatus.textContent = isAuthed ? "可以生成和管理账号。" : "后台只认管理员账号。";
}

function loadAdminSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    return saved?.token ? saved : null;
  } catch {
    return null;
  }
}

function clearAdminSession() {
  auth = null;
  localStorage.removeItem(SESSION_KEY);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.remove("show"), 2000);
}
