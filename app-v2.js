// 网页版本号：每次发布手动 +1，底部展示，方便确认线上跑的是哪个构建
const APP_VERSION = "0.9.5";

// DEBUG: 覆盖前端"今天" — 设为 "" 关闭，验证完请删
const __DEBUG_FAKE_TODAY__ = "";
if (__DEBUG_FAKE_TODAY__) {
  const RealDate = window.Date;
  const fixed = new RealDate(`${__DEBUG_FAKE_TODAY__}T12:00:00`);
  const offset = fixed.getTime() - RealDate.now();
  function FakeDate(...args) {
    if (args.length === 0) return new RealDate(RealDate.now() + offset);
    return new RealDate(...args);
  }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => RealDate.now() + offset;
  FakeDate.parse = RealDate.parse.bind(RealDate);
  FakeDate.UTC = RealDate.UTC.bind(RealDate);
  window.Date = FakeDate;
  console.warn(`[DEBUG] 前端今天被改为 ${__DEBUG_FAKE_TODAY__}`);
}

const STORAGE_KEY = "short-video-scheduler-v1";
const AUTH_KEY = "short-video-auth-v1";
const ORG_KEY = "short-video-orgs-v1";
const MAX_CHAT_HISTORY = 20;
const COLORS = ["#0f8f6a", "#2f6fbb", "#b66900", "#b33c4a", "#7654c7", "#16828f", "#9b5c1c", "#46636f"];

let auth = loadAuth();
let orgStore = loadOrgStore();
ensureOrgForCurrentUser();
let state = loadState();
let activeTab = "home";
let viewMode = "days";
let editingProfileClientId = "";
let lastShootSessionId = state.lastShootSessionId || "";
let chatHistory = Array.isArray(state.chatHistory) ? state.chatHistory.slice(-MAX_CHAT_HISTORY) : [];
let anchorDate = new Date();
let llmStatus = null;
let pendingResolution = null;
let inputMode = "text";
let recognition = null;
let mediaRecorder = null;
let mediaStream = null;
let recordedChunks = [];
let recordingStartedAt = 0;
let recordingCancelled = false;
let selectedClientId = null;
let selectedManageClientId = null;
let orgCreateExpanded = false;
let selectedScheduleDate = null;
let statsTab = "all";
let detailPlatform = null;
let pendingConfirms = [];
let pendingId = 0;
let meView = "main";
let resultTimer = 0;
let pendingFrequencyClientId = "";
const postsByAccount = {};
const accountProfileRefreshAt = {};
const ACCOUNT_STATS_REFRESH_MS = 24 * 60 * 60 * 1000;

const els = {
  pageKicker: document.querySelector("#pageKicker"),
  pageTitle: document.querySelector("#pageTitle"),
  backButton: document.querySelector("#backButton"),
  todayButton: document.querySelector("#todayButton"),
  homePage: document.querySelector("#homePage"),
  statsPage: document.querySelector("#statsPage"),
  statsOverview: document.querySelector("#statsOverview"),
  statsListPanel: document.querySelector("#statsListPanel"),
  mePage: document.querySelector("#mePage"),
  commandDock: document.querySelector("#commandDock"),
  commandBar: document.querySelector("#commandBar"),
  commandBall: document.querySelector("#commandBall"),
  homeSchedule: document.querySelector("#homeSchedule"),
  periodLabel: document.querySelector("#periodLabel"),
  prevPeriod: document.querySelector("#prevPeriod"),
  nextPeriod: document.querySelector("#nextPeriod"),
  publishAlertBanner: document.querySelector("#publishAlertBanner"),
  statsSummary: document.querySelector("#statsSummary"),
  statsList: document.querySelector("#statsList"),
  clientDetail: document.querySelector("#clientDetail"),
  loginPanel: document.querySelector("#loginPanel"),
  todoPanel: document.querySelector("#todoPanel"),
  managePanel: document.querySelector("#managePanel"),
  orgPanel: document.querySelector("#orgPanel"),
  llmPanel: document.querySelector("#llmPanel"),
  meTabBadge: document.querySelector("#meTabBadge"),
  clientCount: document.querySelector("#clientCount"),
  clientList: document.querySelector("#clientList"),
  clientForm: document.querySelector("#clientForm"),
  clientName: document.querySelector("#clientName"),
  clientDouyinUrl: document.querySelector("#clientDouyinUrl"),
  clientXhsUrl: document.querySelector("#clientXhsUrl"),
  clientChannelsName: document.querySelector("#clientChannelsName"),
  clientInterval: document.querySelector("#clientInterval"),
  clientTime: document.querySelector("#clientTime"),
  clientTypes: document.querySelector("#clientTypes"),
  llmOverall: document.querySelector("#llmOverall"),
  llmStatus: document.querySelector("#llmStatus"),
  commandInput: document.querySelector("#commandInput"),
  runCommand: document.querySelector("#runCommand"),
  inputModeButton: document.querySelector("#inputModeButton"),
  holdToTalk: document.querySelector("#holdToTalk"),
  commandResult: document.querySelector("#commandResult"),
  chatPanel: document.querySelector("#chatPanel"),
  chatPanelBody: document.querySelector("#chatPanelBody"),
  chatBackdrop: document.querySelector("#chatBackdrop"),
  chatToggleButton: document.querySelector("#chatToggleButton"),
};

let chatExpanded = false;
let chatManuallyCollapsed = false;
// 上次"打开/关闭"边界时的 user 消息数：判断是否多轮只看这之后的轮数，
// 这样用户点外部关闭后再回来，下一条按首轮（收起 + 气泡）对待。
let chatTurnBaseline = 0;
let chatSending = false; // 命令解析进行中
let commandBallMode = false; // 滚动轻量化：输入条是否已收成悬浮球
let editingDate = null; // 卡片"编辑"内联改日期：{ kind: "slot"|"shoot", id }
let _lastScrollY = 0;
let _scrollTicking = false;
let _runningUserText = ""; // 跨函数 hint：避免 executeToolCalls 再推一遍 user 消息
let pendingActionPrompt = null; // {kind: client-resolution|video-disambiguation|destructive-confirm|client-onboarding, ...}

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    activeTab = button.dataset.tab;
    selectedClientId = null;
    selectedManageClientId = null;
    orgCreateExpanded = false;
    meView = "main";
    render();
  });
});

els.backButton.addEventListener("click", () => {
  if (activeTab === "me" && meView === "complete-profile") meView = "todos";
  else if (activeTab === "me" && (meView === "account" || meView === "manage" || meView === "org")) {
    meView = "main";
    selectedManageClientId = null;
    orgCreateExpanded = false;
  }
  else if (activeTab === "me" && meView !== "main") meView = "main";
  else if (selectedScheduleDate) selectedScheduleDate = null;
  else selectedClientId = null;
  render();
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    viewMode = button.dataset.view;
    selectedScheduleDate = null;
    render();
  });
});

els.todayButton.addEventListener("click", () => {
  anchorDate = new Date();
  selectedScheduleDate = null;
  render();
});

document.addEventListener("click", (event) => {
  if (chatExpanded && !event.target.closest(".command-dock") && !event.target.closest("#chatBackdrop")) {
    collapseChatPanel();
  }
  const platformTab = event.target.closest("[data-detail-platform]");
  if (platformTab) {
    detailPlatform = platformTab.dataset.detailPlatform;
    render();
    refreshDetailPlatform();
    return;
  }
  const detailRefresh = event.target.closest("[data-detail-refresh]");
  if (detailRefresh) {
    refreshDetailPlatform({ force: true });
    return;
  }
  const accountCandidate = event.target.closest("[data-account-pick]");
  if (accountCandidate) {
    if (!requireEdit()) return;
    pickAccountCandidate(Number(accountCandidate.dataset.pid), accountCandidate.dataset.accountPick);
    return;
  }
  const confirmBtn = event.target.closest("[data-confirm-pending]");
  if (confirmBtn) {
    if (!requireEdit()) return;
    const pid = Number(confirmBtn.dataset.confirmPending);
    if (confirmBtn.dataset.action === "yes") confirmPending(pid);
    else cancelPending(pid);
    return;
  }
  const profileTodoSave = event.target.closest("[data-profile-todo-save]");
  if (profileTodoSave) {
    if (!requireEdit()) return;
    saveProfileTodo(profileTodoSave);
    return;
  }
  const completeShootPlanBtn = event.target.closest("[data-complete-shoot-plan]");
  if (completeShootPlanBtn) {
    if (!requireEdit()) return;
    const result = completeShootPlan(completeShootPlanBtn.dataset.completeShootPlan);
    setResult(result.message, result.ok ? "success" : "warning");
    render();
    return;
  }
  const postponeShootPlanBtn = event.target.closest("[data-postpone-shoot-plan]");
  if (postponeShootPlanBtn) {
    if (!requireEdit()) return;
    const result = postponeShootPlan(postponeShootPlanBtn.dataset.postponeShootPlan);
    setResult(result.message, result.ok ? "success" : "warning");
    render();
    return;
  }
  const cancelShootPlanBtn = event.target.closest("[data-cancel-shoot-plan]");
  if (cancelShootPlanBtn) {
    if (!requireEdit()) return;
    const result = cancelShootPlan(cancelShootPlanBtn.dataset.cancelShootPlan);
    setResult(result.message, result.ok ? "success" : "warning");
    render();
    return;
  }
  // 卡片"编辑"→切换内联日期选择器（首页 + 客户详情通用）
  const dateEditBtn = event.target.closest("[data-date-edit]");
  if (dateEditBtn) {
    if (!requireEdit()) return;
    editingDate = { kind: dateEditBtn.dataset.dateKind, id: dateEditBtn.dataset.dateId };
    render();
    return;
  }
  const dateCancelBtn = event.target.closest("[data-date-cancel]");
  if (dateCancelBtn) {
    editingDate = null;
    render();
    return;
  }
  const dateSaveBtn = event.target.closest("[data-date-save]");
  if (dateSaveBtn) {
    if (!requireEdit()) return;
    const box = dateSaveBtn.closest(".date-edit");
    const value = box?.querySelector("input")?.value || "";
    const result = applyDateChange(dateSaveBtn.dataset.dateKind, dateSaveBtn.dataset.dateId, value);
    if (result.ok) editingDate = null;
    setResult(result.message, result.ok ? "success" : "warning");
    render();
    return;
  }
  const dateDelBtn = event.target.closest("[data-date-del]");
  if (dateDelBtn) {
    if (!requireEdit()) return;
    const result = applyDateDelete(dateDelBtn.dataset.dateKind, dateDelBtn.dataset.dateId);
    editingDate = null;
    setResult(result.message, result.ok ? "success" : "warning");
    render();
    return;
  }
  const douyinPromptSearch = event.target.closest("[data-douyin-prompt-search]");
  if (douyinPromptSearch) {
    if (!requireEdit()) return;
    searchPromptDouyin(douyinPromptSearch);
    return;
  }
  const douyinPromptSkip = event.target.closest("[data-douyin-prompt-skip]");
  if (douyinPromptSkip) {
    if (!requireEdit()) return;
    showFrequencyPrompt(findClient(douyinPromptSkip.dataset.douyinPromptSkip));
    return;
  }
  const frequencyPick = event.target.closest("[data-frequency-pick]");
  if (frequencyPick) {
    if (!requireEdit()) return;
    setClientFrequency(frequencyPick.dataset.frequencyPick, Number(frequencyPick.dataset.days || 1));
    return;
  }
  const accountOpen = event.target.closest("[data-open-account]");
  if (accountOpen) {
    activeTab = "me";
    meView = "account";
    selectedClientId = null;
    selectedManageClientId = null;
    orgCreateExpanded = false;
    selectedScheduleDate = null;
    render();
    return;
  }
  const todoOpen = event.target.closest("[data-open-todos]");
  if (todoOpen) {
    if (todoOpen.disabled) return;
    activeTab = "me";
    meView = "todos";
    selectedClientId = null;
    selectedManageClientId = null;
    orgCreateExpanded = false;
    render();
    return;
  }
  const orgOpen = event.target.closest("[data-open-org]");
  if (orgOpen) {
    activeTab = "me";
    meView = "org";
    selectedClientId = null;
    selectedManageClientId = null;
    orgCreateExpanded = false;
    selectedScheduleDate = null;
    render();
    return;
  }
  const manageOpen = event.target.closest("[data-open-manage]");
  if (manageOpen) {
    openClientManage(manageOpen.dataset.openManage || "");
    return;
  }
  const manageClientOpen = event.target.closest("[data-open-client-manage]");
  if (manageClientOpen) {
    openClientManage(manageClientOpen.dataset.openClientManage || "");
    return;
  }
  const clientDetailOpen = event.target.closest("[data-open-client-detail]");
  if (clientDetailOpen) {
    openClientDetail(clientDetailOpen.dataset.openClientDetail);
    return;
  }
  const editClient = event.target.closest("[data-edit-client]");
  if (editClient) {
    selectedManageClientId = selectedManageClientId === editClient.dataset.editClient ? "" : editClient.dataset.editClient;
    render();
    return;
  }
  const addOrg = event.target.closest("[data-add-org]");
  if (addOrg) {
    orgCreateExpanded = !orgCreateExpanded;
    render();
    return;
  }
  const addClient = event.target.closest("[data-add-client]");
  if (addClient) {
    selectedManageClientId = selectedManageClientId === "__new__" ? "" : "__new__";
    render();
    return;
  }
  const saveClient = event.target.closest("[data-save-client]");
  if (saveClient) {
    saveManagedClient(saveClient.dataset.saveClient);
    return;
  }
  const toggleEditAccounts = event.target.closest("[data-toggle-edit-accounts]");
  if (toggleEditAccounts) {
    const id = toggleEditAccounts.dataset.toggleEditAccounts;
    editingProfileClientId = editingProfileClientId === id ? "" : id;
    render();
    return;
  }
  const deleteClientBtn = event.target.closest("[data-delete-client]");
  if (deleteClientBtn) {
    deleteManagedClient(deleteClientBtn.dataset.deleteClient);
    return;
  }
  const leaveOrgBtn = event.target.closest("[data-leave-org]");
  if (leaveOrgBtn) {
    leaveCurrentOrg();
    return;
  }
  const openProfileTodos = event.target.closest("[data-open-profile-todos]");
  if (openProfileTodos) {
    meView = "complete-profile";
    render();
    return;
  }
  const jumpDate = event.target.closest("[data-jump-to-date]");
  if (jumpDate) {
    const date = jumpDate.dataset.jumpToDate;
    if (date) {
      activeTab = "home";
      viewMode = "days";
      anchorDate = parseDate(date);
      selectedScheduleDate = null;
      meView = "main";
      selectedClientId = null;
      selectedManageClientId = null;
      orgCreateExpanded = false;
      render();
      requestAnimationFrame(() => {
        const firstCard = document.querySelector("#homeSchedule .day-card");
        firstCard?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    return;
  }
  const dayButton = event.target.closest("[data-schedule-date]");
  if (!dayButton) return;
  openScheduleDate(dayButton.dataset.scheduleDate);
});

els.prevPeriod.addEventListener("click", () => {
  anchorDate = addDays(anchorDate, viewMode === "month" ? -30 : viewMode === "week" ? -7 : -3);
  render();
});

els.nextPeriod.addEventListener("click", () => {
  anchorDate = addDays(anchorDate, viewMode === "month" ? 30 : viewMode === "week" ? 7 : 3);
  render();
});

if (els.clientForm) {
  els.clientForm.addEventListener("submit", handleClientFormSubmit);
}

els.runCommand.addEventListener("click", runNaturalCommand);
if (els.chatToggleButton) els.chatToggleButton.addEventListener("click", toggleChatPanel);
if (els.chatBackdrop) els.chatBackdrop.addEventListener("click", collapseChatPanel);
window.addEventListener("scroll", onPageScroll, { passive: true });
if (els.commandBall) els.commandBall.addEventListener("click", () => {
  setCommandBallMode(false);
  if (els.commandInput) els.commandInput.focus();
});
const _appVersionEl = document.querySelector("#appVersion");
if (_appVersionEl) _appVersionEl.textContent = `v${APP_VERSION}`;
if (els.chatPanelBody) els.chatPanelBody.addEventListener("click", handleChatPanelClick);
els.commandInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    runNaturalCommand();
  }
});

els.commandInput.addEventListener("input", () => {
  renderInputMode();
  autoGrowCommandInput();
});

function autoGrowCommandInput() {
  const el = els.commandInput;
  if (!el) return;
  el.style.height = "auto";
  const max = 220;
  el.style.height = Math.min(el.scrollHeight, max) + "px";
}
els.inputModeButton.addEventListener("click", toggleInputMode);

["mousedown", "touchstart"].forEach((eventName) => {
  els.holdToTalk.addEventListener(eventName, (event) => {
    event.preventDefault();
    startHoldSpeech();
  });
});

["mouseup", "mouseleave", "touchend", "touchcancel"].forEach((eventName) => {
  els.holdToTalk.addEventListener(eventName, (event) => {
    event.preventDefault();
    stopHoldSpeech();
  });
});

async function loadLlmStatus() {
  try {
    const response = await fetch("/api/status");
    const data = await response.json();
    llmStatus = data.ok ? data.providers : [];
  } catch {
    llmStatus = [];
  }
  renderLlmStatus();
}

function loadState() {
  if (!canViewOrg()) return emptyOrgData();
  const org = currentOrg();
  org.data = normalizeStateData(org.data || emptyOrgData());
  return org.data;
}

function createSeedState() {
  const today = new Date();
  const initial = {
    clients: [
      makeClient("星火娱乐", 1, "17:00", ["老板IP", "招聘", "公司日常", "案例"]),
      makeClient("张总装修设计", 2, "19:30", ["案例", "避坑", "施工现场", "审美"]),
      makeClient("南城餐饮", 1, "18:00", ["产品", "门店日常", "顾客反馈", "活动"]),
    ],
    shootSessions: [],
    videoItems: [],
    publishSlots: [],
  };
  seedShoot(initial, initial.clients[0], addDays(today, -2), [
    ["老板创业故事", "老板IP"],
    ["招聘主播标准", "招聘"],
    ["公司早会日常", "公司日常"],
  ]);
  seedShoot(initial, initial.clients[1], addDays(today, -1), [
    ["别墅地下室避坑", "避坑"],
    ["施工现场验收", "施工现场"],
  ]);
  seedShoot(initial, initial.clients[2], today, [
    ["新品套餐上架", "产品"],
    ["晚市门店日常", "门店日常"],
  ]);
  autoScheduleAll(initial);
  return initial;
}

function loadLegacyState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return createSeedState();
  try {
    return normalizeStateData(JSON.parse(saved));
  } catch {
    return createSeedState();
  }
}

function normalizeStateData(data = {}) {
  data.clients = (data.clients || []).map((client) => migrateClient({ aliases: [], active: true, ...client }));
  data.shootSessions = (data.shootSessions || []).map((session) => ({
    status: "completed",
    planned: false,
    items: [],
    ...session,
  }));
  data.videoItems = data.videoItems || [];
  data.publishSlots = data.publishSlots || [];
  data.cancelledDates = Array.isArray(data.cancelledDates) ? data.cancelledDates : [];
  data.chatHistory = Array.isArray(data.chatHistory) ? data.chatHistory.slice(-MAX_CHAT_HISTORY) : [];
  data.version = Number(data.version) || 0;
  data.clients.forEach(cleanClientAliasesInPlace);
  return data;
}

function emptyOrgData() {
  return { clients: [], shootSessions: [], videoItems: [], publishSlots: [], cancelledDates: [], chatHistory: [], version: 0 };
}

function loadAuth() {
  const loaded = JSON.parse(localStorage.getItem(AUTH_KEY) || '{"loggedIn":false,"name":""}');
  if (loaded.loggedIn && !loaded.userId) loaded.userId = userIdFromName(loaded.name);
  return loaded;
}

async function verifyAuthOnBoot() {
  if (!auth.loggedIn || !auth.token) return;
  try {
    const response = await fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      auth = { loggedIn: false, name: "", userId: "", token: "" };
      persistAuth();
      render();
      return;
    }
    if (data.user?.id) {
      auth.userId = data.user.id;
      auth.displayName = data.user.displayName || auth.displayName;
      persistAuth();
    }
    // 拉组织（含待处理邀请）+ 活跃组织数据
    if (await fetchOrgsFromServer()) {
      state = loadState();
      render();
      if (await pullStateFromServer()) render();
    }
  } catch {
    // 网络问题就先不动 auth，等用户操作时再说
  }
}

function loadOrgStore() {
  const fallback = { activeOrgId: "", orgs: [] };
  const saved = localStorage.getItem(ORG_KEY);
  let store = fallback;
  if (saved) {
    try {
      store = JSON.parse(saved);
    } catch {
      store = fallback;
    }
  }
  store.orgs = (store.orgs || []).map(normalizeOrg);
  if (!store.activeOrgId && store.orgs.length) store.activeOrgId = store.orgs[0].id;
  return store;
}

function normalizeOrg(org) {
  const members = (org.members || []).map((member) => ({
    userId: member.userId || userIdFromName(member.name),
    name: member.name || member.userId || "成员",
    role: ["owner", "editor", "viewer"].includes(member.role) ? member.role : "viewer",
  }));
  return {
    id: org.id || uid("org"),
    name: org.name || "未命名组织",
    ownerId: org.ownerId || members.find((member) => member.role === "owner")?.userId || "",
    members,
    data: normalizeStateData(org.data || emptyOrgData()),
  };
}

function makeOrg(name, data = emptyOrgData()) {
  return normalizeOrg({
    id: uid("org"),
    name,
    ownerId: auth.userId,
    members: [{ userId: auth.userId, name: auth.name || "我", role: "owner" }],
    data,
  });
}

function currentOrg() {
  return orgStore.orgs.find((org) => org.id === orgStore.activeOrgId) || null;
}

function currentMember() {
  const org = currentOrg();
  if (!auth.loggedIn || !org) return null;
  return org.members.find((member) => member.userId === auth.userId) || null;
}

function canViewOrg() {
  return Boolean(auth.loggedIn && currentMember());
}

function canEditOrg() {
  const role = currentMember()?.role;
  return role === "owner" || role === "editor";
}

function roleLabel(role) {
  return role === "owner" ? "拥有者" : role === "editor" ? "可编辑" : "只读";
}

function userIdFromName(name) {
  return String(name || "").trim().toLowerCase();
}

function orgHasUsefulData(org) {
  const data = org?.data || {};
  return (Array.isArray(data.clients) && data.clients.length > 0)
    || (Array.isArray(data.shootSessions) && data.shootSessions.length > 0)
    || (Array.isArray(data.videoItems) && data.videoItems.length > 0)
    || (Array.isArray(data.publishSlots) && data.publishSlots.length > 0);
}

function claimLocalOrgForCurrentUser() {
  if (!auth.loggedIn || !auth.userId || !orgStore.orgs.length) return false;
  const org = orgStore.orgs.find(orgHasUsefulData) || orgStore.orgs[0];
  if (!org) return false;
  const hasOwner = org.members.some((member) => member.role === "owner");
  const role = hasOwner ? "editor" : "owner";
  org.members.push({ userId: auth.userId, name: auth.name || auth.displayName || auth.userId, role });
  if (!org.ownerId || role === "owner") org.ownerId = auth.userId;
  orgStore.activeOrgId = org.id;
  return true;
}

function persist(targetState = state) {
  if (canViewOrg()) {
    targetState.clients = (targetState.clients || []).map(cleanClientAliasesInPlace);
    const org = currentOrg();
    org.data = targetState;
    persistOrgStore();
    // 推到服务器（防抖 600ms，避免高频写）
    scheduleStateSync();
  }
}

function persistAuth() {
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

function persistOrgStore() {
  localStorage.setItem(ORG_KEY, JSON.stringify(orgStore));
}

// ===== 组织：服务端为准（跨账号共享 + 邀请通知）=====
async function orgApi(action, body) {
  const res = await fetch(`/api/org/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.ok, data, error: data.error || (res.ok ? "" : `HTTP ${res.status}`) };
}

// 从 /api/org/mine 重建本地 orgStore（active 组织进 orgs，待处理邀请进 invites）
async function fetchOrgsFromServer() {
  if (!auth.loggedIn || !auth.token) return false;
  try {
    const res = await fetch("/api/org/mine", { headers: { Authorization: `Bearer ${auth.token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return false;
    if (data.self?.id && auth.userId !== data.self.id) { auth.userId = data.self.id; persistAuth(); }
    const prevById = new Map(orgStore.orgs.map((o) => [o.id, o]));
    orgStore.orgs = (data.orgs || [])
      .filter((o) => (o.members || []).some((m) => m.userId === auth.userId && m.status === "active"))
      .map((o) => ({
        id: o.id,
        ownerId: o.ownerId,
        name: o.name,
        members: (o.members || [])
          .filter((m) => m.status === "active")
          .map((m) => ({ userId: m.userId, name: m.displayName || m.username || m.userId, role: m.role })),
        data: prevById.get(o.id)?.data || emptyOrgData(),
      }));
    orgStore.invites = (data.invites || []).map((o) => ({ id: o.id, ownerId: o.ownerId, name: o.name, ownerName: o.ownerName }));
    if (!orgStore.orgs.some((o) => o.id === orgStore.activeOrgId)) {
      orgStore.activeOrgId = orgStore.orgs.some((o) => o.id === auth.userId) ? auth.userId : (orgStore.orgs[0]?.id || "");
    }
    persistOrgStore();
    return true;
  } catch {
    return false;
  }
}

async function respondInvite(ownerId, accept) {
  const r = await orgApi("respond", { orgId: ownerId, accept: !!accept });
  if (!r.ok) { setResult(r.error || "操作失败", "warning"); return; }
  await fetchOrgsFromServer();
  if (accept) {
    orgStore.activeOrgId = ownerId;
    persistOrgStore();
    await pullStateFromServer();
    setResult("已加入，看到对方的日程了。", "success");
  } else {
    setResult("已拒绝邀请。", "success");
  }
  render();
}

// 活跃组织的数据键（= 拥有者 id），用于 /api/state?org=
function activeOrgParam() {
  const org = currentOrg();
  return org?.ownerId ? `?org=${encodeURIComponent(org.ownerId)}` : "";
}

// ===== 与服务器 /api/state 同步（让网页跟小程序看到同一份数据）=====
// 服务器侧 state 是按 user 存的，网页这边按 active org 存。
// 简化：把 active org 的 data 当成"这个 user 当前的 state"，双向同步。
let _stateSyncTimer = null;
let _stateSyncing = false;

function shouldSyncState() {
  return Boolean(auth?.loggedIn && auth.token && canViewOrg());
}

function scheduleStateSync(delayMs = 600) {
  if (!shouldSyncState()) return;
  if (_stateSyncTimer) clearTimeout(_stateSyncTimer);
  _stateSyncTimer = setTimeout(() => { syncStateToServer(); }, delayMs);
}

async function syncStateToServer() {
  if (!shouldSyncState() || _stateSyncing) return;
  _stateSyncing = true;
  try {
    state.clients = (state.clients || []).map(cleanClientAliasesInPlace);
    const snapshot = {
      clients: state.clients || [],
      shootSessions: state.shootSessions || [],
      videoItems: state.videoItems || [],
      publishSlots: state.publishSlots || [],
      cancelledDates: state.cancelledDates || [],
      chatHistory: (chatHistory || []).slice(-MAX_CHAT_HISTORY),
      lastShootSessionId: lastShootSessionId || "",
      version: Number(state.version) || 0,
    };
    const res = await fetch("/api/state" + activeOrgParam(), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({ state: snapshot }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data.state) {
      const serverState = normalizeStateData(data.state);
      const org = currentOrg();
      if (org) {
        org.data = serverState;
        persistOrgStore();
        state = serverState;
      }
      chatHistory = serverState.chatHistory || chatHistory;
      // 重新进来 = 一段新对话：把基线对齐到已有历史，先收起按首轮对待
      chatTurnBaseline = countChatUserTurns();
      lastShootSessionId = serverState.lastShootSessionId || lastShootSessionId;
      render();
      return;
    }
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (typeof data.version === "number") {
      state.version = data.version;
      const org = currentOrg();
      if (org) {
        org.data = state;
        persistOrgStore();
      }
    }
  } catch (err) {
    console.warn("state PUT failed:", err);
  } finally {
    _stateSyncing = false;
  }
}

async function pullStateFromServer() {
  if (!shouldSyncState()) return false;
  try {
    const res = await fetch("/api/state" + activeOrgParam(), {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data?.ok || !data.state) return false;
    const serverState = normalizeStateData(data.state);
    // 服务端是空的 → 不覆盖本地（首次同步本地数据是上行）
    const serverHasData = (serverState.clients || []).length > 0
      || (serverState.shootSessions || []).length > 0
      || (serverState.videoItems || []).length > 0;
    if (!serverHasData) {
      // 没数据时把本地的推上去（首次双端登录）
      await syncStateToServer();
      return false;
    }
    // 用服务端覆盖本地 active org
    const org = currentOrg();
    if (org) {
      org.data = serverState;
      persistOrgStore();
      state = serverState;
      scheduleStateSync(100);
    }
    chatHistory = Array.isArray(serverState.chatHistory) ? serverState.chatHistory : chatHistory;
    // 重新进来 = 一段新对话：把基线对齐到已有历史，先收起按首轮对待
    chatTurnBaseline = countChatUserTurns();
    lastShootSessionId = serverState.lastShootSessionId || lastShootSessionId;
    return true;
  } catch (err) {
    console.warn("state GET failed:", err);
    return false;
  }
}

function ensureOrgForCurrentUser() {
  if (!auth.loggedIn) return;
  if (!auth.userId) auth.userId = userIdFromName(auth.name);
  const joined = orgStore.orgs.filter((org) => org.members.some((member) => member.userId === auth.userId));
  if (!joined.length) {
    if (!claimLocalOrgForCurrentUser()) orgStore.activeOrgId = "";
  } else if (!joined.some((org) => org.id === orgStore.activeOrgId)) {
    orgStore.activeOrgId = joined[0].id;
  }
  persistOrgStore();
}

function makeClient(name, publishIntervalDays, defaultPublishTime, contentTypes) {
  return {
    id: uid("client"),
    name,
    aliases: [],
    publishIntervalDays,
    defaultPublishTime,
    contentTypes,
    active: true,
    accounts: [],
    needsProfileTodo: false,
  };
}

function migrateClient(client) {
  client.aliases = Array.isArray(client.aliases) ? client.aliases : [];
  client.active = client.active !== false;
  client.needsProfileTodo = client.needsProfileTodo === true;
  if (!Array.isArray(client.accounts)) {
    client.accounts = [];
    if (client.profileUrl || client.secUserId || client.nickname || client.avatarSmall) {
      client.accounts.push({
        id: uid("acct"),
        platform: "douyin",
        identifier: client.profileUrl || "",
        secUserId: client.secUserId || "",
        nickname: client.nickname || "",
        uniqueId: client.uniqueId || "",
        signature: client.signature || "",
        avatarSmall: client.avatarSmall || "",
        avatarLarge: client.avatarLarge || "",
        followerCount: client.followerCount || 0,
        postCount: client.awemeCount || 0,
        totalFavorited: client.totalFavorited || 0,
      });
    }
    delete client.profileUrl;
    delete client.secUserId;
    delete client.avatarSmall;
    delete client.avatarLarge;
    delete client.nickname;
    delete client.uniqueId;
    delete client.signature;
    delete client.followerCount;
    delete client.awemeCount;
    delete client.totalFavorited;
  }
  // 老数据迁移：未命名客户如果已绑抖音，按抖音昵称改名；把每个平台的昵称收为别名
  const douyin = client.accounts.find((a) => a.platform === "douyin");
  if (douyin?.nickname && (!client.name || client.name === "未命名客户")) {
    client.name = douyin.nickname;
  }
  for (const acc of client.accounts) {
    if (acc?.nickname) addAliasToClient(client, acc.nickname);
  }
  client.aliases = visibleClientAliases(client);
  return client;
}

const PLATFORM_META = {
  douyin: { name: "抖音", color: "#ff2b54", postLabel: "作品", emoji: "🎵" },
  xhs: { name: "小红书", color: "#ff2741", postLabel: "笔记", emoji: "📕" },
  channels: { name: "视频号", color: "#0eb579", postLabel: "视频", emoji: "📺" },
};

render();
loadLlmStatus();
scheduleMidnightStatsRefresh();
// 启动时如果已登录：verifyAuthOnBoot 会拉组织 + 活跃组织数据（含小程序写过的）
verifyAuthOnBoot();

function getAccount(client, platform) {
  return client.accounts?.find((a) => a.platform === platform) || null;
}

function primaryAccount(client) {
  return client.accounts?.[0] || null;
}

function douyinAccount(client) {
  return getAccount(client, "douyin");
}

function clientAvatarUrl(client, size = "sm") {
  const accounts = [douyinAccount(client), ...(client.accounts || []).filter((a) => a.platform !== "douyin")].filter(Boolean);
  for (const a of accounts) {
    if (a.avatarLarge || a.avatarSmall) {
      return size === "lg" ? (a.avatarLarge || a.avatarSmall) : (a.avatarSmall || a.avatarLarge);
    }
  }
  return "";
}

function clientAvatarMark(client, size = "sm", extraClass = "") {
  const color = clientColor(client?.id);
  const url = clientAvatarUrl(client, size === "lg" ? "lg" : "sm");
  const initial = (douyinAccount(client)?.nickname || client?.name || "?").trim().slice(0, 1);
  return `
    <span class="client-avatar-mark avatar-mark-${size} ${extraClass}" style="--ring:${color};--fallback:${color}">
      ${url ? `<img src="${escapeHtml(url)}" alt="" loading="lazy" />` : `<span>${escapeHtml(initial)}</span>`}
    </span>
  `;
}

function formatCount(value) {
  const n = Number(value) || 0;
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(n >= 1_000_000_000 ? 0 : 1)}亿`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(n >= 1_000_000 ? 0 : 1)}万`;
  return String(n);
}

function seedShoot(targetState, client, date, items) {
  const session = {
    id: uid("shoot"),
    clientId: client.id,
    shootDate: formatDate(date),
    shootCount: items.length,
    status: "completed",
    planned: false,
    items: items.map(([topic, contentType]) => ({ topic, contentType })),
    summary: items.map(([topic]) => topic).join("、"),
    note: "",
    createdAt: new Date().toISOString(),
  };
  targetState.shootSessions.push(session);
  for (const [topic, contentType] of items) {
    targetState.videoItems.push({
      id: uid("video"),
      clientId: client.id,
      shootSessionId: session.id,
      topic,
      contentType,
      status: "待发布",
      createdAt: new Date().toISOString(),
    });
  }
}

function render() {
  if (canEditOrg()) {
    cleanupPlannedShootPublishArtifacts(state);
    autoScheduleAll(state);
    persist();
  }
  if (canViewOrg()) {
    ensureVideoStats(state.clients);
  }
  renderShell();
  renderHome();
  renderStats();
  renderMe();
  renderLlmStatus();
  renderChatPanel();
}

// ===== 连续对话半屏浮窗 =====
function getChatMessagesForPanel() {
  const out = [];
  let idx = 0;
  for (const m of chatHistory) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const content = String(m.content || "").trim();
    if (!content) continue;
    out.push({ key: `msg-${idx++}`, role: m.role, content });
  }
  if (chatSending) {
    out.push({ key: `typing-${idx++}`, role: "assistant", content: "想一下…", typing: true });
  }
  if (pendingActionPrompt) {
    out.push({ key: `prompt-${idx}`, role: "prompt", prompt: pendingActionPrompt });
  }
  return out;
}

function shouldAutoExpandChat(msgs) {
  if (chatManuallyCollapsed) return false;
  // 有 pending 选项 → 强制展
  if (pendingActionPrompt) return true;
  // 只数"距上次打开以来"的轮数：本轮聊到第二句才升级成展开
  const userCount = msgs.filter((m) => m.role === "user").length;
  return userCount - chatTurnBaseline >= 2;
}

function renderChatPanel() {
  if (!els.chatPanel) return;
  const msgs = getChatMessagesForPanel();
  // 自动展开判定
  if (shouldAutoExpandChat(msgs)) chatExpanded = true;
  // 浮窗一展开就退出悬浮球态，别让球盖在对话上
  if (chatExpanded) setCommandBallMode(false);

  // 底部入口按钮
  if (msgs.length && !chatExpanded) {
    els.chatToggleButton.classList.remove("hidden");
    els.chatToggleButton.textContent = `对话 ${msgs.length} ›`;
  } else {
    els.chatToggleButton.classList.add("hidden");
  }
  // 浮窗
  els.chatPanel.classList.toggle("hidden", !chatExpanded);
  els.chatBackdrop.classList.toggle("hidden", !chatExpanded);
  if (!chatExpanded) return;

  els.chatPanelBody.innerHTML = msgs
    .map((m) => {
      if (m.role === "prompt") return renderActionPrompt(m.prompt);
      const typingClass = m.typing ? " typing" : "";
      return `<div class="chat-bubble ${m.role}${typingClass}"><span>${escapeHtml(m.content)}</span></div>`;
    })
    .join("");
  // 滚到底
  requestAnimationFrame(() => {
    els.chatPanelBody.scrollTop = els.chatPanelBody.scrollHeight;
  });
}

// ============ 主动选项交互框架 ============
// pendingActionPrompt 支持多种 kind，统一在聊天浮窗里渲染可点气泡：
//  - client-resolution：找不到客户 → 新客户 / 是某客户别名 / 算了
//  - video-disambiguation：一个关键词命中多条视频 → 列候选让用户点
//  - destructive-confirm：删客户/删拍摄/去重/重排 → 确认选项
//  - client-onboarding：新建客户后追问发布频率、默认时间
//  - shoot-count：拍摄没说几条 → 1/3/5/其它
//  - postpone-choice：延期没说时间 → 顺延 1/2/3 天 / 具体日期
//  - account-candidates：绑号搜到多个账号 → 列候选让用户点
function actionBubble(html, optionsHtml) {
  return `
    <div class="chat-bubble assistant action-bubble">
      <span>${html}</span>
      <div class="action-options">${optionsHtml}</div>
    </div>
  `;
}

function renderActionPrompt(p) {
  if (p.kind === "client-resolution") return renderClientResolutionPrompt(p);
  if (p.kind === "video-disambiguation") return renderVideoDisambiguationPrompt(p);
  if (p.kind === "destructive-confirm") return renderDestructiveConfirmPrompt(p);
  if (p.kind === "client-onboarding") return renderClientOnboardingPrompt(p);
  if (p.kind === "shoot-count") return renderShootCountPrompt(p);
  if (p.kind === "postpone-choice") return renderPostponeChoicePrompt(p);
  if (p.kind === "account-candidates") return renderAccountCandidatesPrompt(p);
  return "";
}

function renderShootCountPrompt(p) {
  const optionsHtml = [
    ...[1, 3, 5].map((n) => `<button class="action-option" type="button" data-action-prompt="set-count" data-count="${n}">${n} 条</button>`),
    `<button class="action-option ghost" type="button" data-action-prompt="count-other">其它（我直接说）</button>`,
  ].join("");
  const verb = p.planOnly ? "拍" : "拍了";
  return actionBubble(`${escapeHtml(p.clientName)} ${verb}几条？`, optionsHtml);
}

function renderPostponeChoicePrompt(p) {
  const optionsHtml = [
    ...[1, 2, 3].map((n) => `<button class="action-option" type="button" data-action-prompt="set-postpone" data-days="${n}">顺延 ${n} 天</button>`),
    `<button class="action-option ghost" type="button" data-action-prompt="postpone-other">改到具体日期（我说）</button>`,
  ].join("");
  return actionBubble(`${escapeHtml(p.clientName)} 的拍摄延到什么时候？`, optionsHtml);
}

function renderAccountCandidatesPrompt(p) {
  const platformName = PLATFORM_META[p.platform]?.name || p.platform;
  const optionsHtml = [
    ...p.candidates.map((cand, i) => {
      const meta = [cand.uniqueId ? `@${cand.uniqueId}` : "", cand.followerCount ? `${formatCount(cand.followerCount)}粉` : ""].filter(Boolean).join(" · ");
      const metaHtml = meta ? ` <span class="action-option-meta">${escapeHtml(meta)}</span>` : "";
      return `<button class="action-option" type="button" data-action-prompt="pick-account" data-cand-index="${i}">${escapeHtml(cand.nickname || cand.uniqueId || "未命名账号")}${metaHtml}</button>`;
    }),
    `<button class="action-option ghost" type="button" data-action-prompt="cancel">都不是</button>`,
  ].join("");
  return actionBubble(`${escapeHtml(p.clientName)} 的${platformName}搜到 ${p.candidates.length} 个账号，是哪个？`, optionsHtml);
}

function renderClientResolutionPrompt(p) {
  const optionsHtml = [
    `<button class="action-option primary" type="button" data-action-prompt="create">加新客户「${escapeHtml(p.rawName)}」</button>`,
    ...p.candidates.map(
      (c) =>
        `<button class="action-option" type="button" data-action-prompt="alias" data-client-id="${escapeHtml(c.id)}">是「${escapeHtml(c.name)}」的别名</button>`
    ),
    `<button class="action-option ghost" type="button" data-action-prompt="cancel">算了</button>`,
  ].join("");
  const detail = p.summary ? `<br/><em class="muted-text">${escapeHtml(p.summary)}</em>` : "";
  return actionBubble(`「${escapeHtml(p.rawName)}」我还没见过 —— 是新客户，还是已有客户的别名？${detail}`, optionsHtml);
}

function renderVideoDisambiguationPrompt(p) {
  const optionsHtml = [
    ...p.candidates.map((v) => {
      const client = findClient(v.clientId);
      const meta = [client?.name, v.contentType].filter(Boolean).join(" · ");
      const metaHtml = meta ? ` <span class="action-option-meta">${escapeHtml(meta)}</span>` : "";
      return `<button class="action-option" type="button" data-action-prompt="pick-video" data-video-id="${escapeHtml(v.id)}">${escapeHtml(v.topic || "未命名")}${metaHtml}</button>`;
    }),
    `<button class="action-option ghost" type="button" data-action-prompt="cancel">算了</button>`,
  ].join("");
  return actionBubble(`有 ${p.candidates.length} 条都对得上「${escapeHtml(p.hint)}」，你是说哪条？`, optionsHtml);
}

function renderDestructiveConfirmPrompt(p) {
  const optionsHtml = [
    ...(p.options || []).map(
      (o) => `<button class="action-option ${o.variant || ""}" type="button" data-action-prompt="confirm" data-confirm-key="${escapeHtml(o.key)}">${escapeHtml(o.label)}</button>`
    ),
    `<button class="action-option ghost" type="button" data-action-prompt="cancel">算了</button>`,
  ].join("");
  return actionBubble(escapeHtml(p.title), optionsHtml);
}

function renderClientOnboardingPrompt(p) {
  const client = findClient(p.clientId);
  if (!client) return "";
  if (p.step === "frequency") {
    const optionsHtml = [
      `<button class="action-option" type="button" data-action-prompt="set-frequency" data-days="1">每天 1 条</button>`,
      `<button class="action-option" type="button" data-action-prompt="set-frequency" data-days="2">隔天 1 条</button>`,
      `<button class="action-option" type="button" data-action-prompt="set-frequency" data-days="3">每 3 天 1 条</button>`,
      `<button class="action-option ghost" type="button" data-action-prompt="onboarding-skip">先按每天 1 条</button>`,
    ].join("");
    return actionBubble(`「${escapeHtml(client.name)}」加好了，多久发一条？`, optionsHtml);
  }
  if (p.step === "time") {
    const optionsHtml = [
      `<button class="action-option" type="button" data-action-prompt="set-time" data-time="17:00">17:00</button>`,
      `<button class="action-option" type="button" data-action-prompt="set-time" data-time="12:00">12:00</button>`,
      `<button class="action-option" type="button" data-action-prompt="set-time" data-time="20:00">20:00</button>`,
      `<button class="action-option ghost" type="button" data-action-prompt="onboarding-skip">用默认 17:00</button>`,
    ].join("");
    return actionBubble(`「${escapeHtml(client.name)}」默认几点发？`, optionsHtml);
  }
  return "";
}

function pushAssistant(content) {
  chatHistory.push({ role: "assistant", content });
  if (chatHistory.length > MAX_CHAT_HISTORY) chatHistory = chatHistory.slice(-MAX_CHAT_HISTORY);
}

// 用解析出的 client/video/确认参数重跑原始工具调用
function rerunCall(call, extraArgs = {}) {
  const handler = TOOL_HANDLERS[call.name];
  if (!handler) return { ok: false, message: `这个动作我还没学会：${call.name}` };
  try {
    return handler({ ...(call.args || {}), ...extraArgs }) || { ok: true, message: "" };
  } catch (err) {
    return { ok: false, message: `执行 ${call.name} 出错：${err.message}` };
  }
}

function startClientOnboarding(clientId) {
  pendingActionPrompt = { kind: "client-onboarding", clientId, step: "frequency" };
  chatExpanded = true;
  chatManuallyCollapsed = false;
}

function handleChatPanelClick(event) {
  const btn = event.target.closest("[data-action-prompt]");
  if (!btn) return;
  const action = btn.dataset.actionPrompt;
  const p = pendingActionPrompt;
  if (!p) return;

  if (action === "cancel") {
    pendingActionPrompt = null;
    pushAssistant("好，那这条先放着，需要再说一声。");
    renderChatPanel();
    return;
  }
  if (p.kind === "client-resolution") return handleClientResolutionClick(action, btn, p);
  if (p.kind === "video-disambiguation") return handleVideoDisambiguationClick(action, btn, p);
  if (p.kind === "destructive-confirm") return handleDestructiveConfirmClick(action, btn, p);
  if (p.kind === "client-onboarding") return handleClientOnboardingClick(action, btn, p);
  if (p.kind === "shoot-count") return handleShootCountClick(action, btn, p);
  if (p.kind === "postpone-choice") return handlePostponeChoiceClick(action, btn, p);
  if (p.kind === "account-candidates") return handleAccountCandidatesClick(action, btn, p);
}

function handleShootCountClick(action, btn, p) {
  if (action === "count-other") {
    pendingActionPrompt = null;
    pushAssistant(`行，你直接说个数，比如「${p.clientName}${p.planOnly ? "拍" : "拍了"}3条」。`);
    renderChatPanel();
    return;
  }
  if (action === "set-count") {
    const result = rerunCall(p.call, { shootCount: Number(btn.dataset.count) });
    pendingActionPrompt = null;
    pushAssistant(result.message || "");
    persist();
    render();
  }
}

function handlePostponeChoiceClick(action, btn, p) {
  if (action === "postpone-other") {
    pendingActionPrompt = null;
    pushAssistant("好，那你说个日期，比如「改到下周一」或「6月20号」。");
    renderChatPanel();
    return;
  }
  if (action === "set-postpone") {
    const result = rerunCall(p.call, { days: Number(btn.dataset.days), targetDate: "" });
    pendingActionPrompt = null;
    pushAssistant(result.message || "");
    persist();
    render();
  }
}

function handleAccountCandidatesClick(action, btn, p) {
  if (action !== "pick-account") return;
  const cand = p.candidates[Number(btn.dataset.candIndex)];
  const client = findClient(p.clientId);
  if (!cand || !client) {
    pendingActionPrompt = null;
    renderChatPanel();
    return;
  }
  pendingActionPrompt = null;
  // 用选中账号的精确 identifier 再抓一次，落到这个客户上（单个结果 → 走正常的确认卡片）
  fetchAccount(client.id, p.platform, { identifier: cand.identifier || cand.userName || cand.uniqueId || cand.secUserId || cand.userId });
  pushAssistant(`好，按「${cand.nickname || cand.uniqueId || "选中账号"}」抓 ${client.name} 的${PLATFORM_META[p.platform]?.name || p.platform}。`);
  renderChatPanel();
}

function handleClientResolutionClick(action, btn, p) {
  if (action === "create") {
    const client = createClient({
      name: p.rawName,
      publishIntervalDays: 1,
      defaultPublishTime: "17:00",
      contentTypes: uniqueValues(p.contentTypes || []),
      needsProfileTodo: true,
    });
    if (!client) {
      pendingActionPrompt = null;
      pushAssistant("加不进去：没权限或冲突。");
      renderChatPanel();
      return;
    }
    const result = rerunCall(p.call);
    pushAssistant(`加了新客户「${client.name}」，${result.message || ""}`);
    startClientOnboarding(client.id);
    persist();
    render();
    return;
  }
  if (action === "alias") {
    const client = findClient(btn.dataset.clientId);
    if (!client) {
      pendingActionPrompt = null;
      renderChatPanel();
      return;
    }
    addAliasToClient(client, p.rawName);
    const result = rerunCall(p.call);
    pendingActionPrompt = null;
    pushAssistant(`好，把「${p.rawName}」当 ${client.name} 的别名记下来。${result.message || ""}`);
    persist();
    render();
  }
}

function handleVideoDisambiguationClick(action, btn, p) {
  if (action !== "pick-video") return;
  const result = rerunCall(p.call, { videoId: btn.dataset.videoId });
  pendingActionPrompt = null;
  pushAssistant(result.message || "");
  persist();
  render();
}

function handleDestructiveConfirmClick(action, btn, p) {
  if (action !== "confirm") return;
  const key = btn.dataset.confirmKey;
  const result = rerunCall(p.call, { __confirmed: true, ...((p.confirmArgs || {})[key] || {}) });
  pendingActionPrompt = null;
  pushAssistant(result.message || "");
  persist();
  render();
}

function handleClientOnboardingClick(action, btn, p) {
  const client = findClient(p.clientId);
  if (!client) {
    pendingActionPrompt = null;
    renderChatPanel();
    return;
  }
  if (action === "set-frequency") {
    client.publishIntervalDays = Math.max(1, Number(btn.dataset.days) || 1);
    rebuildClientSchedule({ client, keepLocked: false });
    const label = client.publishIntervalDays === 1 ? "每天" : `每 ${client.publishIntervalDays} 天`;
    pushAssistant(`好，${client.name} 按${label} 1 条排。默认几点发？`);
    pendingActionPrompt = { kind: "client-onboarding", clientId: client.id, step: "time" };
    persist();
    render();
    return;
  }
  if (action === "set-time") {
    const time = btn.dataset.time || "17:00";
    updateClientSettings({ client, defaultPublishTime: time });
    pendingActionPrompt = null;
    pushAssistant(`好了，${client.name} 默认 ${time} 发。要绑抖音/小红书账号的话直接把链接发我。`);
    persist();
    render();
    return;
  }
  if (action === "onboarding-skip") {
    pendingActionPrompt = null;
    pushAssistant(`行，${client.name} 先这么排着，要改随时说。`);
    persist();
    render();
  }
}

function toggleChatPanel() {
  chatExpanded = !chatExpanded;
  chatManuallyCollapsed = !chatExpanded;
  // 主动收起时记下边界，回来按首轮对待
  if (!chatExpanded) chatTurnBaseline = countChatUserTurns();
  renderChatPanel();
}

function collapseChatPanel() {
  if (!chatExpanded) return;
  chatExpanded = false;
  chatManuallyCollapsed = true;
  // 点外部关闭 = 这段对话看完了，回来按首轮（收起 + 气泡）对待
  chatTurnBaseline = countChatUserTurns();
  renderChatPanel();
}

function clearChatPanel() {
  chatHistory = [];
  pendingActionPrompt = null;
  chatManuallyCollapsed = true;
  chatExpanded = false;
  chatTurnBaseline = 0;
  setResult("", "");
  renderChatPanel();
}

function countChatUserTurns() {
  return chatHistory.filter((m) => m.role === "user").length;
}

// 滚动轻量化：下滑把输入条收成右下角悬浮球，上滑/点球还原
function setCommandBallMode(on) {
  if (commandBallMode === on) return;
  commandBallMode = on;
  if (els.commandDock) els.commandDock.classList.toggle("dock-ball", on);
}

function onPageScroll() {
  if (_scrollTicking) return;
  _scrollTicking = true;
  requestAnimationFrame(() => {
    _scrollTicking = false;
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    // 浮窗展开 / 非首页 / 滚到顶部 → 始终保持输入条
    if (chatExpanded || activeTab !== "home" || y < 48) {
      setCommandBallMode(false);
      _lastScrollY = y;
      return;
    }
    const delta = y - _lastScrollY;
    if (delta > 6) setCommandBallMode(true);        // 下滑 → 收球
    else if (delta < -6) setCommandBallMode(false);  // 上滑 → 还原
    _lastScrollY = y;
  });
}

function prefillCommand(text) {
  els.commandInput.value = text;
  renderInputMode();
  autoGrowCommandInput();
  els.commandInput.focus();
}

function renderShell() {
  const titles = {
    home: ["今天", "发布日程"],
    stats: ["运营看板", "客户统计"],
    me: ["账号", "我的"],
  };
  const detailClient = activeTab === "stats" && selectedClientId ? findClient(selectedClientId) : null;
  const detailDateRaw = selectedScheduleDate ? parseDate(selectedScheduleDate) : null;
  const isInlineCalendarDay = activeTab === "home" && (viewMode === "week" || viewMode === "month") && !!detailDateRaw;
  const detailDate = isInlineCalendarDay ? null : detailDateRaw;
  const isMeAccount = activeTab === "me" && meView === "account";
  const isMeTodos = activeTab === "me" && meView === "todos";
  const isMeCompleteProfile = activeTab === "me" && meView === "complete-profile";
  const isMeManage = activeTab === "me" && meView === "manage";
  const isMeOrg = activeTab === "me" && meView === "org";
  const meSubView = isMeAccount || isMeTodos || isMeCompleteProfile || isMeManage || isMeOrg;
  const meKicker = isMeCompleteProfile ? "客户管理" : meSubView ? "我的" : null;
  const meTitle = isMeAccount ? "登录信息" : isMeCompleteProfile ? "完善客户信息" : isMeTodos ? "待办事项" : isMeManage ? "客户管理" : isMeOrg ? "组织管理" : null;
  els.pageKicker.textContent = detailClient
    ? "客户详情"
    : meKicker
      ? meKicker
    : detailDate
      ? `${formatShort(detailDate)} ${weekdayName(detailDate)}`
      : activeTab === "home"
        ? ""
        : titles[activeTab][0];
  els.pageKicker.classList.toggle("hidden", !els.pageKicker.textContent);
  els.pageTitle.textContent = detailClient ? detailClient.name : meTitle ? meTitle : detailDate ? "单日日程" : titles[activeTab][1];
  els.backButton.classList.toggle("hidden", !detailClient && !detailDate && !meSubView);
  els.todayButton.classList.toggle("hidden", activeTab !== "home" || detailClient || detailDate || meSubView || isPeriodOnToday());
  els.commandDock.classList.toggle("hidden", activeTab !== "home" || !canEditOrg());
  renderInputMode();
  [els.homePage, els.statsPage, els.mePage].forEach((page) => page.classList.remove("active"));
  document.querySelector(`#${activeTab}Page`).classList.add("active");
  document.querySelectorAll("[data-tab]").forEach((button) => button.classList.toggle("active", button.dataset.tab === activeTab));
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === viewMode));
  const badgeCount = getTodoCollections().total + (orgStore.invites || []).length;
  if (els.meTabBadge) {
    els.meTabBadge.hidden = badgeCount <= 0;
    els.meTabBadge.textContent = badgeCount > 99 ? "99+" : String(badgeCount);
  }
}

function openClientDetail(clientId) {
  if (!clientId || !findClient(clientId)) return;
  activeTab = "stats";
  selectedClientId = clientId;
  selectedManageClientId = null;
  selectedScheduleDate = null;
  meView = "main";
  detailPlatform = null;
  render();
  refreshClientAccounts(clientId);
}

function refreshClientAccounts(clientId) {
  const client = findClient(clientId);
  if (!client) return;
  const account = getAccount(client, detailPlatform) || client.accounts?.[0];
  if (!account) return;
  syncAccountData(client, account);
}

function refreshDetailPlatform({ force = false } = {}) {
  const client = findClient(selectedClientId);
  const account = client && getAccount(client, detailPlatform);
  if (!client || !account) return;
  syncAccountData(client, account, { force });
}

function openClientManage(clientId = "") {
  activeTab = "me";
  meView = "manage";
  selectedClientId = null;
  selectedScheduleDate = null;
  selectedManageClientId = clientId && findClient(clientId) ? clientId : "";
  render();
  if (selectedManageClientId) {
    requestAnimationFrame(() => {
      document.querySelector(`[data-manage-client="${CSS.escape(selectedManageClientId)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

function toggleInputMode() {
  inputMode = inputMode === "text" ? "voice" : "text";
  renderInputMode();
}

function renderInputMode() {
  els.commandBar.classList.toggle("voice-mode", inputMode === "voice");
  els.commandBar.classList.toggle("text-mode", inputMode === "text");
  els.inputModeButton.classList.toggle("voice-mode-icon", inputMode === "text");
  els.inputModeButton.classList.toggle("keyboard-mode-icon", inputMode === "voice");
  els.inputModeButton.setAttribute("aria-label", inputMode === "text" ? "切换到语音" : "切换到文字");
  els.runCommand.classList.toggle("ready", Boolean(els.commandInput.value.trim()));
}

// 语音输入：用 MediaRecorder 录音 + 后端 STT。
// 相比 webkitSpeechRecognition，这条路在 iOS Safari 上也能用。
function pickAudioMime() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/mp4;codecs=mp4a.40.2", // iOS Safari 偏好
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

function uiResetHoldButton() {
  els.holdToTalk.classList.remove("recording");
  els.holdToTalk.textContent = "按住 说话";
}

async function startHoldSpeech() {
  if (mediaRecorder) return;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    setResult("此浏览器不支持录音，先打字。", "warning");
    return;
  }
  recordingCancelled = false;
  recordedChunks = [];
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    setResult("没权限录音：" + (err.message || err.name), "warning");
    return;
  }
  const mimeType = pickAudioMime();
  try {
    mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
  } catch (err) {
    cleanupMediaStream();
    setResult("无法启动录音：" + err.message, "warning");
    return;
  }
  mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) recordedChunks.push(e.data); };
  mediaRecorder.onerror = (e) => {
    uiResetHoldButton();
    cleanupMediaStream();
    mediaRecorder = null;
    setResult("录音出错：" + (e.error?.message || "未知"), "warning");
  };
  mediaRecorder.onstop = async () => {
    const usedMime = mediaRecorder?.mimeType || mimeType || "audio/webm";
    mediaRecorder = null;
    cleanupMediaStream();
    uiResetHoldButton();
    if (recordingCancelled) return;
    const blob = new Blob(recordedChunks, { type: usedMime });
    recordedChunks = [];
    if (blob.size < 1500) {
      setResult("太短啦，再说一遍。", "warning");
      return;
    }
    await transcribeAndRun(blob);
  };
  recordingStartedAt = Date.now();
  els.holdToTalk.classList.add("recording");
  els.holdToTalk.textContent = "松开 结束";
  setResult("我在听。", "");
  try {
    mediaRecorder.start();
  } catch (err) {
    uiResetHoldButton();
    cleanupMediaStream();
    mediaRecorder = null;
    setResult("启动录音失败：" + err.message, "warning");
  }
}

function stopHoldSpeech() {
  if (!mediaRecorder || mediaRecorder.state !== "recording") return;
  const tooShort = Date.now() - recordingStartedAt < 350;
  if (tooShort) {
    recordingCancelled = true;
    setResult("太短啦，再说一遍。", "warning");
  }
  try {
    mediaRecorder.stop();
  } catch {}
}

function cleanupMediaStream() {
  if (mediaStream) {
    try { mediaStream.getTracks().forEach((t) => t.stop()); } catch {}
    mediaStream = null;
  }
}

async function transcribeAndRun(blob) {
  setResult("识别中…", "");
  try {
    const headers = { "Content-Type": blob.type || "audio/webm" };
    if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
    const res = await fetch("/api/transcribe", { method: "POST", headers, body: blob });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      setResult("识别失败：" + (data.error || `HTTP ${res.status}`), "warning");
      return;
    }
    els.commandInput.value = data.text;
    renderInputMode();
    autoGrowCommandInput();
    await runNaturalCommand();
  } catch (err) {
    setResult("识别失败：" + err.message, "warning");
  }
}

function renderHome() {
  renderPublishAlertBanner();
  if (!canViewOrg()) {
    els.periodLabel.textContent = "";
    els.homeSchedule.innerHTML = `<section class="empty-state">${auth.loggedIn ? "你需要先创建/加入一个组织" : "先登录，再看日程。"}</section>`;
    return;
  }
  if (selectedScheduleDate && viewMode === "days") {
    renderScheduleDayDetail();
    return;
  }
  if (viewMode === "days") renderThreeDays();
  if (viewMode === "week") renderWeek();
  if (viewMode === "month") renderMonth();
}

function renderPublishAlertBanner() {
  if (!els.publishAlertBanner) return;
  if (!canViewOrg()) {
    els.publishAlertBanner.classList.add("hidden");
    els.publishAlertBanner.innerHTML = "";
    return;
  }
  const alerts = buildPublishVerificationAlerts().filter((a) => a.reason !== "客户未关联平台账号，无法自动验证");
  if (!alerts.length) {
    els.publishAlertBanner.classList.add("hidden");
    els.publishAlertBanner.innerHTML = "";
    return;
  }
  const top = alerts.slice(0, 3);
  els.publishAlertBanner.classList.remove("hidden");
  els.publishAlertBanner.innerHTML = `
    <div class="publish-alert-head">
      <div>
        <strong>${alerts.length} 条没对上</strong>
        <span class="muted-text">我没抓到作品</span>
      </div>
      <button class="publish-alert-cta" type="button" data-open-todos>看看 ›</button>
    </div>
    <ul class="publish-alert-list">
      ${top.map((a) => `<li data-jump-to-date="${escapeHtml(a.publishDate)}"><b>${escapeHtml(a.publishTime)}</b> · ${escapeHtml(a.clientName)} · ${escapeHtml(a.topic)}<span class="publish-alert-arrow">›</span></li>`).join("")}
      ${alerts.length > 3 ? `<li class="publish-alert-more">还有 ${alerts.length - 3} 条…</li>` : ""}
    </ul>
  `;
}

function renderScheduleDayDetail() {
  els.periodLabel.textContent = selectedScheduleDate;
  els.homeSchedule.innerHTML = `
    <section class="single-day-detail">
      ${renderDayCard(selectedScheduleDate)}
    </section>
  `;
}

function openScheduleDate(date) {
  const hadPriorSelection = !!selectedScheduleDate;
  let monthChanged = false;
  if (viewMode === "month") {
    const target = parseDate(date);
    const currentMonth = startOfMonth(anchorDate);
    if (target.getFullYear() !== currentMonth.getFullYear() || target.getMonth() !== currentMonth.getMonth()) {
      anchorDate = startOfMonth(target);
      monthChanged = true;
    }
  }
  selectedScheduleDate = date;
  render();
  // 只在第一次选中日期，或月份切换时滚一次；连续点同一周/月的不同日期不再触发滚动
  if ((viewMode === "week" || viewMode === "month") && (!hadPriorSelection || monthChanged)) {
    scrollInlineDayIntoView();
  }
}

function scrollInlineDayIntoView() {
  requestAnimationFrame(() => {
    const inline = document.querySelector(".week-inline-day");
    if (!inline) return;
    const rect = inline.getBoundingClientRect();
    const viewportH = window.innerHeight || document.documentElement.clientHeight;
    // 已经基本在可视区里就不滚了，避免频繁点击时连续 smooth-scroll
    if (rect.top >= 0 && rect.bottom <= viewportH) return;
    inline.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

function renderThreeDays() {
  const start = parseDate(formatDate(anchorDate));
  const days = [start, addDays(start, 1), addDays(start, 2)];
  els.periodLabel.textContent = `${formatShort(days[0])} - ${formatShort(days[2])}`;
  els.homeSchedule.innerHTML = days.map((day) => renderDayCard(formatDate(day))).join("");
}

function renderDayCard(date) {
  const publishes = getPublishSlots(date);
  const shoots = getShootSessions(date);
  const isToday = date === formatDate(new Date());
  return `
    <article class="day-card${isToday ? " is-today" : ""}">
      <header>
        <h2>${dayTitle(date)}</h2>
        <span>${formatShort(parseDate(date))} ${weekdayName(parseDate(date))}</span>
      </header>
      <div class="event-list">
        ${publishes.length ? publishes.map(renderPublishEvent).join("") : `<div class="empty-state">今天不发</div>`}
        ${shoots.map(renderShootEvent).join("")}
      </div>
    </article>
  `;
}

// 卡片行的"编辑/删除"操作。编辑切换成内联日期选择器（首页 + 客户详情通用）
function renderRowActions(kind, id, date, cls = "") {
  if (!canEditOrg()) return "";
  const editing = editingDate && editingDate.kind === kind && editingDate.id === id;
  if (editing) {
    return `<span class="date-edit">
      <input type="date" class="date-edit-input" value="${escapeHtml(date || "")}" />
      <button class="${cls}" type="button" data-date-save data-date-kind="${kind}" data-date-id="${escapeHtml(id)}">保存</button>
      <button class="${cls} ghost" type="button" data-date-cancel>取消</button>
    </span>`;
  }
  return `<button class="${cls}" type="button" data-date-edit data-date-kind="${kind}" data-date-id="${escapeHtml(id)}">编辑</button>
    <button class="${cls} danger" type="button" data-date-del data-date-kind="${kind}" data-date-id="${escapeHtml(id)}">删除</button>`;
}

// 应用卡片内联改日期
function applyDateChange(kind, id, date) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return { ok: false, message: "日期没选对。" };
  if (kind === "slot") {
    const slot = state.publishSlots.find((s) => s.id === id);
    if (!slot) return { ok: false, message: "没找到这条发布。" };
    slot.publishDate = date;
    slot.locked = true;
    slot.source = "ai_adjusted";
    anchorDate = parseDate(date);
    persist();
    return { ok: true, message: `发布改到 ${date}。` };
  }
  if (kind === "shoot") {
    const session = findShootSession(id);
    if (!session) return { ok: false, message: "没找到这条拍摄。" };
    session.shootDate = date;
    anchorDate = parseDate(date);
    persist();
    return { ok: true, message: `拍摄改到 ${date}。` };
  }
  return { ok: false, message: "" };
}

function applyDateDelete(kind, id) {
  if (kind === "slot") return deletePublishSlotById(id);
  if (kind === "shoot") {
    const session = findShootSession(id);
    return deleteShootSession({ client: session ? findClient(session.clientId) : null, sessionId: id });
  }
  return { ok: false, message: "" };
}

function renderPublishEvent(slot) {
  const client = findClient(slot.clientId);
  const video = findVideo(slot.videoItemId);
  return `
    <div class="event-row">
      ${clientAvatarMark(client, "sm", "event-avatar-mark")}
      <div class="event-main">
        <strong>发布视频：${escapeHtml(client?.name || "")} · ${escapeHtml(video?.topic || "")}</strong>
        <span>${escapeHtml(video?.contentType || "")} · ${slot.locked ? "已锁定" : "自动排期"}</span>
      </div>
      <div class="event-actions detail-event-actions">
        <span class="event-time">${slot.publishTime}</span>
        ${renderRowActions("slot", slot.id, slot.publishDate, "event-action")}
      </div>
    </div>
  `;
}

function renderShootEvent(session) {
  const client = findClient(session.clientId);
  const planned = isPlannedShoot(session);
  const label = planned ? "计划拍摄" : "拍摄";
  const summary = planned ? plannedShootSummary(session) : `${session.shootPeriod ? `${escapeHtml(session.shootPeriod)} · ` : ""}${escapeHtml(session.summary)}`;
  return `
    <div class="event-row shoot-row${planned ? " planned-shoot-row" : ""}">
      ${clientAvatarMark(client, "sm", "event-avatar-mark")}
      <div class="event-main">
        <strong>${escapeHtml(client?.name || "")} · ${label} ${session.shootCount} 条</strong>
        <span>${summary}</span>
      </div>
      ${planned && canEditOrg()
        ? `<div class="event-actions">
            <span class="event-time">${label}</span>
            <button class="event-action primary" type="button" data-complete-shoot-plan="${escapeHtml(session.id)}">完成</button>
            <button class="event-action" type="button" data-postpone-shoot-plan="${escapeHtml(session.id)}">改明天</button>
            <button class="event-action danger" type="button" data-cancel-shoot-plan="${escapeHtml(session.id)}">取消</button>
          </div>`
        : `<div class="event-actions detail-event-actions">
            <span class="event-time">${label}</span>
            ${renderRowActions("shoot", session.id, session.shootDate, "event-action")}
          </div>`}
    </div>
  `;
}

function plannedShootSummary(session) {
  const period = session.shootPeriod || "";
  const type = dominantShootContentType(session) || "内容";
  return `${escapeHtml(dayTitle(session.shootDate))}${period ? escapeHtml(period) : ""}拍摄 ${Number(session.shootCount) || session.items?.length || 1} 条${escapeHtml(type)}`;
}

function dominantShootContentType(session) {
  const types = (session.items || []).map((item) => item.contentType).filter(Boolean);
  if (!types.length) return "";
  const unique = uniqueValues(types);
  return unique.length === 1 ? unique[0] : "内容";
}

function renderWeek() {
  const start = startOfWeek(anchorDate);
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  els.periodLabel.textContent = `${formatShort(days[0])} - ${formatShort(days[6])}`;
  const inlineDate =
    selectedScheduleDate && days.some((d) => formatDate(d) === selectedScheduleDate)
      ? selectedScheduleDate
      : null;
  els.homeSchedule.innerHTML = `
    <section class="week-panel">
      <div class="week-grid">
        ${days.map((day) => renderCompactDay(day, "week")).join("")}
      </div>
      ${renderLegend(days)}
    </section>
    ${inlineDate ? `<section class="week-inline-day">${renderDayCard(inlineDate)}</section>` : ""}
  `;
}

function renderMonth() {
  const month = startOfMonth(anchorDate);
  const days = getCalendarDays(month);
  els.periodLabel.textContent = `${month.getFullYear()} 年 ${month.getMonth() + 1} 月`;
  const inlineDate =
    selectedScheduleDate && days.some((d) => formatDate(d) === selectedScheduleDate)
      ? selectedScheduleDate
      : null;
  els.homeSchedule.innerHTML = `
    <section class="month-panel">
      <div class="month-grid">
        ${["一", "二", "三", "四", "五", "六", "日"].map((day) => `<div class="weekday">${day}</div>`).join("")}
        ${days.map((day) => renderCompactDay(day, "month", month)).join("")}
      </div>
      ${renderLegend(days)}
    </section>
    ${inlineDate ? `<section class="week-inline-day">${renderDayCard(inlineDate)}</section>` : ""}
  `;
}

function renderCompactDay(day, mode, month = null) {
  const date = formatDate(day);
  const publishes = getPublishSlots(date);
  const shoots = getShootSessions(date);
  const clientIds = uniqueValues(publishes.map((slot) => slot.clientId));
  const dots = clientIds
    .slice(0, mode === "month" ? 4 : 8)
    .map((clientId) => clientAvatarMark(findClient(clientId), "dot", "calendar-client-mark"))
    .join("");
  const shoot = renderShootMarks(shoots, mode);
  const isToday = date === formatDate(new Date());
  const isSelected = (mode === "week" || mode === "month") && date === selectedScheduleDate;
  if (mode === "week") {
    return `
      <button class="week-day${isToday ? " is-today" : ""}${isSelected ? " is-selected" : ""}" type="button" data-schedule-date="${date}">
        <div class="week-date"><strong>${day.getDate()}</strong>${weekdayName(day).replace("周", "")}</div>
        <div class="dot-stack">${dots}${shoot}</div>
      </button>
    `;
  }
  return `
    <button class="month-day ${month && day.getMonth() !== month.getMonth() ? "muted" : ""}${isToday ? " is-today" : ""}${isSelected ? " is-selected" : ""}" type="button" data-schedule-date="${date}">
      <div class="month-date"><strong>${day.getDate()}</strong></div>
      <div class="dot-stack">${dots}${shoot}</div>
    </button>
  `;
}

function renderShootMarks(shoots, mode) {
  const grouped = [];
  const seen = new Set();
  for (const session of shoots) {
    const key = `${session.clientId}:${session.shootPeriod || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    grouped.push(session);
  }
  return grouped
    .slice(0, mode === "month" ? 3 : 7)
    .map((session) => {
      const client = findClient(session.clientId);
      const planned = isPlannedShoot(session);
      const title = `${client?.name || "客户"}${session.shootPeriod ? ` ${session.shootPeriod}` : ""} ${planned ? "计划拍摄" : "拍摄"}`;
      const extraClass = planned ? "calendar-client-mark shoot-calendar-mark shoot-calendar-mark-planned" : "calendar-client-mark shoot-calendar-mark";
      return `<span title="${escapeHtml(title)}">${clientAvatarMark(client, "dot", extraClass)}</span>`;
    })
    .join("");
}

function renderLegend(days) {
  // 只列出当前视图（这些天）里真有排期/拍摄的客户；没有就不显示图例
  const dateSet = new Set((days || []).map((d) => formatDate(d)));
  if (!dateSet.size) return "";
  const activeIds = new Set();
  for (const slot of state.publishSlots) if (dateSet.has(slot.publishDate)) activeIds.add(slot.clientId);
  for (const session of state.shootSessions) if (dateSet.has(session.shootDate)) activeIds.add(session.clientId);
  const clients = state.clients.filter((client) => activeIds.has(client.id)).slice(0, 8);
  if (!clients.length) return "";
  return `
    <div class="legend">
      ${clients.map((client) => `<span>${clientAvatarMark(client, "dot", "legend-avatar-mark")}${escapeHtml(client.name)}</span>`).join("")}
    </div>
  `;
}

function renderStats() {
  if (!canViewOrg()) {
    els.statsListPanel.classList.remove("hidden");
    els.statsOverview.classList.add("hidden");
    els.clientDetail.classList.add("hidden");
    els.statsSummary.textContent = "";
    els.statsList.innerHTML = `<div class="empty-state">${auth.loggedIn ? "你还没进这个组织。" : "先登录，再看客户。"}</div>`;
    return;
  }
  const rows = state.clients.map(buildClientStats);
  renderStatsOverview(rows);
  if (selectedClientId) {
    const row = rows.find((item) => item.client.id === selectedClientId);
    els.statsListPanel.classList.add("hidden");
    els.statsOverview.classList.add("hidden");
    els.clientDetail.classList.remove("hidden");
    els.clientDetail.innerHTML = row ? renderClientDetail(row) : `<div class="empty-state">我没找到这个客户</div>`;
    return;
  }
  els.statsListPanel.classList.remove("hidden");
  els.statsOverview.classList.remove("hidden");
  els.clientDetail.classList.add("hidden");
  els.statsSummary.textContent = `${rows.length} 个客户`;
  els.statsList.innerHTML = rows.map(renderStatCard).join("");
  els.statsList.querySelectorAll("[data-client-detail]").forEach((button) => {
    button.addEventListener("click", () => {
      openClientDetail(button.dataset.clientDetail);
    });
  });
}

function ensureVideoStats(clients) {
  const now = Date.now();
  for (const client of clients) {
    for (const account of client.accounts || []) {
      const id = account.id;
      const cached = postsByAccount[id];
      if (cached?.loading) continue;
      if (cached?.loadedAt && now - cached.loadedAt < ACCOUNT_STATS_REFRESH_MS) continue;
      // 每日刷新一次；视频号资料和作品复用同一份主页响应。
      syncAccountData(client, account);
    }
  }
}

async function syncAccountData(client, account, { force = false } = {}) {
  if (!client || !account || account._syncFetching) return;
  account._syncFetching = true;
  try {
    await refreshAccountStats(client, account, { force });
    await loadAccountPosts(client, account, { force: force && account.platform !== "channels" });
  } finally {
    account._syncFetching = false;
  }
}

function accountIdentifier(account) {
  return account.platform === "douyin" ? account.secUserId
    : account.platform === "xhs" ? (account.userId || account.identifier)
    : account.userName || account.identifier;
}

// 把"今天"的粉丝/获赞/近期播放快照写进持久化的 account.statsHistory（按天去重、合并更新）
function recordAccountSnapshot(account) {
  const today = formatDate(new Date());
  account.statsHistory = Array.isArray(account.statsHistory) ? account.statsHistory : [];
  let entry = account.statsHistory.find((e) => e.date === today);
  if (!entry) { entry = { date: today }; account.statsHistory.push(entry); }
  entry.at = Date.now();
  entry.followerCount = Number(account.followerCount) || 0;
  entry.totalFavorited = Number(account.totalFavorited) || 0;
  const recentPlay = sumRecentPlay(account.id);
  if (recentPlay > 0) entry.recentPlay = recentPlay; // 没拉到作品时别用 0 覆盖
  if (account.statsHistory.length > 90) account.statsHistory = account.statsHistory.slice(-90);
}

function sumRecentPlay(accountId) {
  const entry = postsByAccount[accountId];
  if (!entry?.items) return 0;
  return entry.items.reduce((sum, v) => sum + (Number(v.playCount) || 0), 0);
}

// 默认每天刷新一次主页 profile；只有用户点“立即同步”时才强制刷新。
async function refreshAccountStats(client, account, { force = false } = {}) {
  if (!account) return;
  const lastFetchedAt = Number(accountProfileRefreshAt[account.id]) || 0;
  if (!force && Date.now() - lastFetchedAt < ACCOUNT_STATS_REFRESH_MS) return;
  if (account._statsFetching) return;
  const identifier = accountIdentifier(account);
  if (!identifier) return;
  account._statsFetching = true;
  try {
    const params = new URLSearchParams({ platform: account.platform, identifier });
    if (force) params.set("refresh", "1");
    const resp = await fetch(`/api/profile?${params.toString()}`);
    const data = await resp.json();
    if (data && data.ok && !data.candidates) {
      if (data.followerCount !== undefined) account.followerCount = Number(data.followerCount) || account.followerCount || 0;
      if (data.totalFavorited !== undefined) account.totalFavorited = Number(data.totalFavorited) || account.totalFavorited || 0;
      if (data.postCount) account.postCount = Number(data.postCount) || account.postCount;
      accountProfileRefreshAt[account.id] = Date.now();
      recordAccountSnapshot(account);
      persist();
      if (["stats", "home", "me"].includes(activeTab)) render();
    }
  } catch (error) {
    /* 静默失败，下次再补 */
  } finally {
    account._statsFetching = false;
  }
}

function scheduleMidnightStatsRefresh() {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 3, 0);
  window.setTimeout(() => {
    for (const key of Object.keys(postsByAccount)) delete postsByAccount[key];
    if (canViewOrg()) ensureVideoStats(state.clients);
    render();
    scheduleMidnightStatsRefresh();
  }, Math.max(1000, next.getTime() - Date.now()));
}

async function loadAccountPosts(client, account, { force = false } = {}) {
  postsByAccount[account.id] = { loading: true };
  const identifier = account.platform === "douyin" ? account.secUserId
    : account.platform === "xhs" ? (account.userId || account.identifier)
    : account.userName || account.identifier;
  if (!identifier) {
    postsByAccount[account.id] = { error: "缺少账号标识", loadedAt: Date.now() };
    return;
  }
  try {
    const params = new URLSearchParams({ platform: account.platform, identifier, count: "20" });
    if (force) params.set("refresh", "1");
    const response = await fetch(`/api/post-stats?${params.toString()}`);
    const data = await response.json();
    if (!data.ok) {
      postsByAccount[account.id] = { error: data.error || "未知错误", loadedAt: Date.now() };
    } else {
      postsByAccount[account.id] = { items: data.posts || [], loadedAt: Date.now() };
      // 作品拉到后，把当天快照的"近期播放"补上（用于昨日新增播放）
      if (Array.isArray(account.statsHistory) && account.statsHistory.some((e) => e.date === formatDate(new Date()))) {
        recordAccountSnapshot(account);
        persist();
      }
    }
    if (["stats", "home", "me"].includes(activeTab)) render();
  } catch (error) {
    postsByAccount[account.id] = { error: error.message, loadedAt: Date.now() };
    if (["stats", "home", "me"].includes(activeTab)) render();
  }
}

function aggregateAccountPosts(accountId, sinceTimestamp) {
  const entry = postsByAccount[accountId];
  if (!entry?.items) return null;
  const items = entry.items.filter((v) => v.createTime * 1000 >= sinceTimestamp);
  return {
    count: items.length,
    playSum: items.reduce((sum, v) => sum + (v.playCount || 0), 0),
    diggSum: items.reduce((sum, v) => sum + (v.diggCount || 0), 0),
    shareSum: items.reduce((sum, v) => sum + (v.shareCount || 0), 0),
    commentSum: items.reduce((sum, v) => sum + (v.commentCount || 0), 0),
  };
}

function aggregateAccountPostsBetween(accountId, startTimestamp, endTimestamp) {
  const entry = postsByAccount[accountId];
  if (!entry?.items) return null;
  const items = entry.items.filter((v) => {
    const ts = Number(v.createTime || 0) * 1000;
    return ts >= startTimestamp && ts < endTimestamp;
  });
  return {
    count: items.length,
    playSum: items.reduce((sum, v) => sum + (v.playCount || 0), 0),
    diggSum: items.reduce((sum, v) => sum + (v.diggCount || 0), 0),
    shareSum: items.reduce((sum, v) => sum + (v.shareCount || 0), 0),
    commentSum: items.reduce((sum, v) => sum + (v.commentCount || 0), 0),
  };
}

function yesterdayRange() {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = addDays(end, -1);
  return { start: start.getTime(), end: end.getTime() };
}

function aggregateClientStats(client, platform, sinceTimestamp) {
  let count = 0, playSum = 0, diggSum = 0, shareSum = 0, commentSum = 0, hasData = false;
  for (const account of client.accounts || []) {
    if (platform && account.platform !== platform) continue;
    const a = aggregateAccountPosts(account.id, sinceTimestamp);
    if (!a) continue;
    hasData = true;
    count += a.count; playSum += a.playSum; diggSum += a.diggSum; shareSum += a.shareSum; commentSum += a.commentSum;
  }
  return hasData ? { count, playSum, diggSum, shareSum, commentSum } : null;
}

function renderStatsOverview(rows) {
  const totalUnposted = rows.reduce((sum, row) => sum + row.unposted, 0);
  const riskCount = rows.filter((row) => row.coverDays <= 2).length;
  const monthShoots = rows.reduce((sum, row) => sum + row.monthShoots, 0);

  els.statsOverview.innerHTML = `
    <section class="overview-card">
      <div>
        <span class="mini-label">本月拍摄</span>
        <strong>${monthShoots}</strong>
      </div>
      <div>
        <span class="mini-label">未发内容</span>
        <strong>${totalUnposted}</strong>
      </div>
      <div>
        <span class="mini-label">需关注</span>
        <strong>${riskCount}</strong>
      </div>
    </section>
  `;
}

function buildClientStats(client) {
  const today = formatDate(new Date());
  const monthStart = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`;
  const nextMonth = formatDate(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1));
  const slots = state.publishSlots.filter((slot) => slot.clientId === client.id);
  const videos = state.videoItems.filter((video) => video.clientId === client.id);
  const scheduledIds = new Set(slots.map((slot) => slot.videoItemId));
  const pendingVideos = videos.filter((video) => video.status !== "已发布");
  const stock = pendingVideos.filter((video) => !scheduledIds.has(video.id)).length;
  const unposted = pendingVideos.length;
  const monthShoots = state.shootSessions
    .filter((session) => session.clientId === client.id && !isPlannedShoot(session) && session.shootDate >= monthStart && session.shootDate < nextMonth)
    .reduce((sum, session) => sum + session.shootCount, 0);
  const monthPublished = slots.filter((slot) => slot.publishDate >= monthStart && slot.publishDate < nextMonth && slot.publishDate <= today).length;
  const futureDates = slots.filter((slot) => slot.publishDate >= today).map((slot) => slot.publishDate).sort();
  const lastScheduled = futureDates.at(-1) || "";
  const coverDays = lastScheduled ? Math.max(0, diffDays(today, lastScheduled) + 1) : 0;
  const shootBefore = lastScheduled ? formatDate(addDays(parseDate(lastScheduled), -2)) : today;
  const nextSlots = slots.filter((slot) => slot.publishDate >= today).sort((a, b) => a.publishDate.localeCompare(b.publishDate));
  const recentShoots = state.shootSessions
    .filter((session) => session.clientId === client.id && !isPlannedShoot(session))
    .sort((a, b) => b.shootDate.localeCompare(a.shootDate))
    .slice(0, 5);
  return { client, stock, unposted, monthShoots, monthPublished, coverDays, lastScheduled, shootBefore, nextSlots, recentShoots, videos };
}

function renderStatCard(row) {
  const progress = Math.min(100, Math.round((row.coverDays / 14) * 100));
  const status = row.coverDays <= 2 ? "缺片风险" : row.coverDays <= 5 ? "需要关注" : "库存健康";
  return `
    <button class="stat-card" type="button" data-client-detail="${row.client.id}">
      <div class="stat-head">
        ${clientAvatarHtml(row.client, "md")}
        <div class="stat-head-text">
          <h3>${escapeHtml(row.client.name)}</h3>
          <span class="muted-text">每 ${row.client.publishIntervalDays} 天 1 条 · ${row.client.defaultPublishTime}</span>
        </div>
        <span class="pill ${row.coverDays <= 2 ? "risk" : ""}">${status}</span>
      </div>
      ${renderClientPlatformColumns(row.client, { showPerformance: true })}
      <div class="stock-line">
        <div>
          <strong>${row.coverDays}</strong>
          <span>可发天数</span>
        </div>
        <div class="progress-track"><i style="width:${progress}%"></i></div>
      </div>
      <div class="stat-metrics">
        <div class="metric"><strong>${row.monthShoots}</strong><span>本月拍</span></div>
        <div class="metric"><strong>${row.monthPublished}</strong><span>本月发</span></div>
        <div class="metric"><strong>${row.unposted}</strong><span>未发</span></div>
      </div>
      <div class="deadline">
        <span>库存未排：${row.stock} 条</span>
        <strong>最晚 ${row.shootBefore} 拍摄</strong>
      </div>
    </button>
  `;
}

function renderDetailHero(row) {
  const client = row.client;
  const primary = primaryAccount(client);
  const color = clientColor(client.id);
  const avatarUrl = clientAvatarUrl(client, "lg");
  return `
    <section class="detail-hero">
      <div class="detail-avatar" style="--ring:${color}">
        ${avatarUrl
          ? `<img src="${escapeHtml(avatarUrl)}" alt="" />`
          : `<span class="avatar-fallback" style="background:${color}">${escapeHtml((primary?.nickname || client.name || "?").slice(0, 1))}</span>`}
      </div>
      <div>
        <h2>${escapeHtml(client.name)}</h2>
        ${primary?.nickname && primary.nickname !== client.name ? `<p class="muted-text">${escapeHtml(primary.nickname)}${primary.uniqueId ? ` · ${primary.platform === "douyin" ? "@" : ""}${escapeHtml(primary.uniqueId)}` : ""}</p>` : ""}
        <p><strong style="color:${color};font-size:18px;letter-spacing:-0.3px;">${row.coverDays}</strong> <span class="muted-text">天可发</span></p>
        <p>每 ${client.publishIntervalDays} 天 1 条 · 默认 ${client.defaultPublishTime}</p>
        <p>${client.contentTypes.map(escapeHtml).join("、")}</p>
      </div>
    </section>
  `;
}

function renderDetailPlatformSection(client) {
  if (!client.accounts?.length) {
    return `<section class="detail-section"><p class="muted-text">还没绑平台，我会先记着。</p></section>`;
  }
  const platforms = client.accounts.map((a) => a.platform);
  const active = detailPlatform && platforms.includes(detailPlatform) ? detailPlatform : platforms[0];
  const account = getAccount(client, active);
  const meta = PLATFORM_META[active] || {};
  const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const w = aggregateAccountPosts(account.id, weekStart);
  const m = aggregateAccountPosts(account.id, monthStart);
  const entry = postsByAccount[account.id];
  const hasPosts = Boolean(entry?.items?.length);
  return `
    <section class="detail-section">
      <div class="detail-platform-tabs">
        ${client.accounts.map((a) => {
          const am = PLATFORM_META[a.platform] || {};
          return `<button type="button" class="detail-platform-tab${a.platform === active ? " active" : ""}" data-detail-platform="${a.platform}">${am.emoji} ${escapeHtml(am.name || a.platform)}</button>`;
        }).join("")}
      </div>
      <div class="detail-grid">
        <div class="metric"><strong>${formatCount(account.followerCount)}</strong><span>${active === "channels" ? "—" : "粉丝"}</span></div>
        <div class="metric"><strong>${formatCount(account.postCount)}</strong><span>${escapeHtml(meta.postLabel || "作品")}</span></div>
        <div class="metric"><strong>${formatCount(account.totalFavorited)}</strong><span>获赞</span></div>
      </div>
      ${account.signature ? `<p class="muted-text" style="margin:10px 0 0;white-space:pre-line">${escapeHtml(account.signature)}</p>` : ""}
      <div class="detail-list platform-info-list">
        ${renderPlatformInfoRows(account)}
      </div>
    </section>
    <section class="detail-section">
      <div class="detail-section-heading">
        <h3>近期作品</h3>
        <button type="button" class="text-button" data-detail-refresh>立即同步</button>
      </div>
      ${w && w.count
        ? `<div class="perf-grid">
            <div class="perf-cell"><span class="perf-label">近 7 天</span><strong>${w.count}</strong><span class="perf-unit">条</span><p class="muted-text">${active === "channels" ? "" : `播放 ${formatCount(w.playSum)} · `}点赞 ${formatCount(w.diggSum)}</p></div>
            <div class="perf-cell"><span class="perf-label">本月</span><strong>${m?.count || 0}</strong><span class="perf-unit">条</span><p class="muted-text">${active === "channels" ? "" : `播放 ${formatCount(m?.playSum || 0)} · `}点赞 ${formatCount(m?.diggSum || 0)}</p></div>
          </div>`
        : entry?.loading
          ? `<p class="muted-text">我在拉作品…</p>`
          : entry?.error
          ? `<p class="muted-text">没拉到：${escapeHtml(entry.error)}</p>`
            : hasPosts ? "" : `<p class="muted-text">还没作品数据</p>`}
      ${hasPosts ? `<div class="detail-list recent-post-list">${entry.items.slice().sort((a, b) => Number(b.createTime || 0) - Number(a.createTime || 0)).slice(0, 5).map((post) => renderRecentPostRow(post, active)).join("")}</div>` : ""}
    </section>
  `;
}

function renderPlatformInfoRows(account) {
  const range = yesterdayRange();
  // 三项都基于持久化的每日快照算增量；攒够两天数据前显示"等明天再算"
  const playDelta = computeStatDeltaBetween(account, "recentPlay", range.start, range.end);
  const diggDelta = computeStatDeltaBetween(account, "totalFavorited", range.start, range.end);
  const followerDelta = computeStatDeltaBetween(account, "followerCount", range.start, range.end);
  const fmt = (v) => v === null || v === undefined ? "—" : (v > 0 ? "+" : "") + formatCount(v);
  const note = (v) => (v === null || v === undefined ? "等明天再算" : "");
  const rows = [
    ["昨日新增播放", fmt(playDelta), account.platform === "channels" ? "" : note(playDelta)],
    ["昨日新增粉丝", fmt(followerDelta), note(followerDelta)],
    ["昨日新增点赞", fmt(diggDelta), note(diggDelta)],
  ];
  return rows.map(([label, value, hint]) => `
    <article class="detail-row platform-info-row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}${hint ? `<em class="muted-text" style="font-weight:400;margin-left:6px;">${escapeHtml(hint)}</em>` : ""}</strong>
    </article>
  `).join("");
}

// 用 account.followerHistory 算最近区间粉丝增量；历史不足时返回 null
function computeFollowerDelta(account, sinceTimestamp) {
  const history = Array.isArray(account.followerHistory) ? account.followerHistory : [];
  if (history.length < 2) return null;
  const latest = history[history.length - 1];
  const older = history.find((h) => h.at >= sinceTimestamp) || history[0];
  if (!latest || !older || older === latest) return null;
  return Number(latest.count || 0) - Number(older.count || 0);
}

function computeFollowerDeltaBetween(account, startTimestamp, endTimestamp) {
  return computeStatDeltaBetween(account, "followerCount", startTimestamp, endTimestamp);
}

// 从持久化的 account.statsHistory 算某字段在 [start, end) 区间的增量；历史不足返回 null
function computeStatDeltaBetween(account, field, startTimestamp, endTimestamp) {
  const history = Array.isArray(account.statsHistory) ? account.statsHistory : [];
  if (history.length < 2) return null;
  const sorted = history.slice().sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
  const beforeStart = sorted.filter((h) => Number(h.at || 0) < startTimestamp && h[field] !== undefined).pop();
  const beforeEnd = sorted.filter((h) => Number(h.at || 0) < endTimestamp && h[field] !== undefined).pop();
  if (!beforeStart || !beforeEnd || beforeStart === beforeEnd) return null;
  return Number(beforeEnd[field] || 0) - Number(beforeStart[field] || 0);
}

function renderRecentPostRow(post, platform) {
  const date = post.createTime ? formatDate(new Date(post.createTime * 1000)) : "日期不明";
  return `
    <article class="detail-row">
      <span>${date}</span>
      <strong>${escapeHtml(post.desc || "没写标题")}</strong>
      <em>${platform === "channels" ? "" : `播放 ${formatCount(post.playCount || 0)} · `}赞 ${formatCount(post.diggCount || 0)}</em>
    </article>
  `;
}

function renderClientDetail(row) {
  return `
    ${renderDetailHero(row)}
    ${renderDetailPlatformSection(row.client)}
    <section class="detail-section">
      <h3>库存状态</h3>
      <div class="detail-grid">
        <div class="metric"><strong>${row.monthShoots}</strong><span>本月拍摄</span></div>
        <div class="metric"><strong>${row.monthPublished}</strong><span>本月已发</span></div>
        <div class="metric"><strong>${row.unposted}</strong><span>未发内容</span></div>
        <div class="metric"><strong>${row.stock}</strong><span>库存未排</span></div>
      </div>
      <div class="deadline detail-deadline">
        <span>最晚拍摄时间</span>
        <strong>${row.shootBefore}</strong>
      </div>
    </section>
    <section class="detail-section">
      <h3>近期发布</h3>
      <div class="detail-list">
        ${row.nextSlots.slice(0, 8).map(renderDetailSlot).join("") || `<div class="empty-state">后面还没排</div>`}
      </div>
    </section>
    <section class="detail-section">
      <h3>拍摄记录</h3>
      <div class="detail-list">
        ${row.recentShoots.map(renderDetailShoot).join("") || `<div class="empty-state">还没拍过</div>`}
      </div>
    </section>
    <section class="detail-section">
      <h3>客户信息</h3>
      <p class="muted-text">别称：${visibleClientAliases(row.client).length ? visibleClientAliases(row.client).map(escapeHtml).join("、") : "还没有"}</p>
    </section>
  `;
}

function renderDetailSlot(slot) {
  const video = findVideo(slot.videoItemId);
  const client = findClient(slot.clientId);
  return `
    <article class="detail-row detail-row-with-actions">
      <span>${slot.publishDate}</span>
      <strong>${escapeHtml(video?.topic || "")}</strong>
      <em>${slot.publishTime}</em>
      ${canEditOrg() ? `<div class="detail-row-actions">
        ${renderRowActions("slot", slot.id, slot.publishDate)}
      </div>` : ""}
    </article>
  `;
}

function renderDetailShoot(session) {
  const client = findClient(session.clientId);
  return `
    <article class="detail-row detail-row-with-actions">
      <span>${session.shootDate}</span>
      <strong>拍摄 ${session.shootCount} 条</strong>
      <em>${escapeHtml(session.summary)}</em>
      ${canEditOrg() ? `<div class="detail-row-actions">
        ${renderRowActions("shoot", session.id, session.shootDate)}
      </div>` : ""}
    </article>
  `;
}

function renderMe() {
  renderLoginPanel();
  renderOrgPanel();
  renderTodoPanel();
  renderManagePanel();
  if (els.llmPanel) els.llmPanel.classList.toggle("hidden", auth.loggedIn && meView !== "main");
}

function renderLoginPanel() {
  const shouldShow = meView === "main" || meView === "account";
  els.loginPanel.classList.toggle("hidden", !shouldShow);
  if (!shouldShow) {
    els.loginPanel.innerHTML = "";
    return;
  }
  if (auth.loggedIn) {
    if (meView === "main") {
      els.loginPanel.innerHTML = `
        <button class="profile-action-card" type="button" data-open-account>
          <div>
            <strong>${escapeHtml(auth.name || "已登录账号")}</strong>
            <span class="muted-text">登录信息</span>
          </div>
          <span class="profile-card-value">切换 ›</span>
        </button>
      `;
      return;
    }
    els.loginPanel.innerHTML = `
      <div class="section-head">
        <h2>${escapeHtml(auth.name || "已登录账号")}</h2>
        <span>已登录</span>
      </div>
      <p class="muted-text">换账号就重新进来。</p>
      <form id="switchLoginForm" class="login-form">
        <input name="name" placeholder="新账号" autocomplete="username" required />
        <input name="password" type="password" placeholder="密码" autocomplete="current-password" required />
        <button class="primary-button" type="submit">切换账号</button>
      </form>
      <button id="logoutButton" class="danger-button full-width-button" type="button">退出登录</button>
    `;
    document.querySelector("#logoutButton").addEventListener("click", async () => {
      const token = auth.token;
      auth = { loggedIn: false, name: "", userId: "", token: "" };
      persistAuth();
      state = loadState();
      meView = "main";
      render();
      if (token) {
        try {
          await fetch("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
        } catch {}
      }
    });
    bindLoginForm("#switchLoginForm");
    return;
  }

  els.loginPanel.innerHTML = `
    <div class="section-head">
      <h2>先登录</h2>
      <span>账号由管理员发放</span>
    </div>
    <form id="loginForm" class="login-form">
      <input name="username" placeholder="账号" autocomplete="username" required />
      <input name="password" type="password" placeholder="密码" autocomplete="current-password" required />
      <button class="primary-button" type="submit">登录</button>
      <p id="loginError" class="login-error muted-text" hidden></p>
    </form>
  `;
  bindLoginForm("#loginForm");
}

function bindLoginForm(selector) {
  const form = document.querySelector(selector);
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitBtn = form.querySelector("button[type=submit]");
    const errEl = form.querySelector(".login-error");
    if (errEl) errEl.hidden = true;
    const data = new FormData(form);
    const username = String(data.get("username") || data.get("name") || "").trim();
    const password = String(data.get("password") || "");
    if (!username || !password) return;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "登录中…"; }
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        if (errEl) {
          errEl.textContent = result.error || "登录失败，请重试";
          errEl.hidden = false;
        }
        return;
      }
      auth = {
        loggedIn: true,
        token: result.token,
        name: result.user.username,
        userId: result.user.id,
        displayName: result.user.displayName || result.user.username,
        role: result.user.role || "member",
      };
      persistAuth();
      await fetchOrgsFromServer();
      state = loadState();
      meView = "main";
      render();
      // 登录后拉一次活跃组织的数据
      pullStateFromServer().then((pulled) => {
        if (pulled) render();
      });
    } catch (error) {
      if (errEl) {
        errEl.textContent = `登录失败：${error.message}`;
        errEl.hidden = false;
      }
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "登录"; }
    }
  });
}

function renderOrgPanel() {
  if (!els.orgPanel) return;
  const shouldShow = meView === "main" || meView === "org";
  els.orgPanel.classList.toggle("hidden", !shouldShow);
  if (!shouldShow) {
    els.orgPanel.innerHTML = "";
    return;
  }
  if (!auth.loggedIn) {
    els.orgPanel.innerHTML = `
      <button class="profile-action-card" type="button" disabled>
        <div>
          <strong>组织</strong>
          <span class="muted-text">登录后再建</span>
        </div>
        <span class="profile-card-value">先登录</span>
      </button>
    `;
    return;
  }
  const joinedOrgs = orgStore.orgs.filter((org) => org.members.some((member) => member.userId === auth.userId));
  const org = currentOrg();
  const member = currentMember();
  const invites = orgStore.invites || [];
  if (meView === "main") {
    els.orgPanel.innerHTML = renderInvitesBlock() + `
      <button class="profile-action-card" type="button" data-open-org>
        <div>
          <strong>组织</strong>
          <span class="muted-text">${org && member ? `${escapeHtml(org.name)} · ${roleLabel(member.role)}` : "加载中…"}</span>
        </div>
        <span class="profile-card-value">${org && member ? `${org.members.length} 人 ›` : "›"}</span>
      </button>
    `;
    if (invites.length) bindOrgPanelActions();
    return;
  }
  els.loginPanel.classList.add("hidden");
  if (!org || !member) {
    els.orgPanel.innerHTML = renderInvitesBlock() + `
      <section class="org-card">
        <div class="section-head">
          <h2>组织</h2>
          <span>加载中</span>
        </div>
        <p class="muted-text">正在拉取你的工作区…</p>
      </section>
    `;
    bindOrgPanelActions();
    return;
  }
  const canInvite = member.role === "owner" || member.role === "editor";
  const isOwner = member.role === "owner";
  els.orgPanel.innerHTML = renderInvitesBlock() + `
    <section class="org-card">
      <div class="section-head">
        <h2>${escapeHtml(org.name)}</h2>
        <span>${roleLabel(member.role)}</span>
      </div>
      <section class="org-subsection org-current-card">
        <div class="todo-head">
          <div>
            <strong>当前组织</strong>
            <span class="muted-text">${escapeHtml(org.members.length)} 位成员 · 日程和客户只给成员看</span>
          </div>
          <button class="text-button danger-text" type="button" data-leave-org>退出组织</button>
        </div>
        ${joinedOrgs.length > 1 ? `
        <div class="org-switcher">
          ${joinedOrgs.map((item) => `<button class="${item.id === org.id ? "active" : ""}" type="button" data-switch-org="${escapeHtml(item.id)}">${escapeHtml(item.name)}</button>`).join("")}
        </div>
      ` : ""}
        ${canInvite ? `
        <section class="org-subsection">
          <div class="todo-head">
            <div>
              <strong>邀请成员</strong>
              <span class="muted-text">可编辑或只读。</span>
            </div>
          </div>
        <form id="orgInviteForm" class="client-form org-form compact">
          <input name="memberName" placeholder="成员账号" autocomplete="off" required />
          <select name="memberRole">
            <option value="editor">可编辑</option>
            <option value="viewer">只读</option>
          </select>
          <button class="primary-button" type="submit">邀请</button>
        </form>
        </section>
      ` : `<p class="muted-text">你是只读，我不让你改。</p>`}
        <div class="org-member-list">
          ${org.members.map((item) => `
            <article class="org-member">
              <div>
                <strong>${escapeHtml(item.name)}</strong>
                <span class="muted-text">${roleLabel(item.role)}</span>
              </div>
              ${isOwner && item.role !== "owner"
                ? `<button class="text-button danger-text" type="button" data-remove-member="${escapeHtml(item.userId)}">移除</button>`
                : `<span>${item.role === "owner" ? "拥有者" : ""}</span>`}
            </article>
          `).join("")}
        </div>
      </section>
      ${isOwner ? `
      <section class="org-subsection">
        <button class="profile-action-card manage-add-entry" type="button" data-add-org>
          <div>
            <strong>改组织名</strong>
            <span class="muted-text">${orgCreateExpanded ? "给工作区起个名字" : "改个名字"}</span>
          </div>
          <span class="profile-card-value">${orgCreateExpanded ? "收起" : "改名 ›"}</span>
        </button>
        ${orgCreateExpanded ? `
        <form id="orgRenameForm" class="client-form org-form compact create-org-form">
          <input name="orgName" placeholder="新组织名" value="${escapeHtml(org.name)}" autocomplete="off" required />
          <button class="primary-button" type="submit">保存</button>
        </form>
        ` : ""}
      </section>` : ""}
    </section>
  `;
  bindOrgPanelActions();
}

// 待处理邀请的通知卡片（主视图 + 组织视图都用）
function renderInvitesBlock() {
  const invites = orgStore.invites || [];
  if (!invites.length) return "";
  return `<section class="org-invites">
    ${invites.map((iv) => `
      <article class="org-invite-card">
        <div>
          <strong>${escapeHtml(iv.ownerName || "有人")} 邀请你加入</strong>
          <span class="muted-text">${escapeHtml(iv.name)}</span>
        </div>
        <div class="org-invite-actions">
          <button class="primary-button" type="button" data-respond-invite="${escapeHtml(iv.ownerId)}" data-accept="1">接受</button>
          <button class="text-button" type="button" data-respond-invite="${escapeHtml(iv.ownerId)}" data-accept="0">拒绝</button>
        </div>
      </article>
    `).join("")}
  </section>`;
}

function bindOrgPanelActions() {
  // 邀请成员（按用户名，服务端解析）
  els.orgPanel.querySelector("#orgInviteForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!canEditOrg()) return;
    const form = new FormData(event.currentTarget);
    const username = String(form.get("memberName") || "").trim();
    const role = form.get("memberRole") === "viewer" ? "viewer" : "editor";
    if (!username) return;
    const r = await orgApi("invite", { orgId: currentOrg()?.ownerId, username, role });
    if (!r.ok) { setResult(r.error || "邀请失败", "warning"); return; }
    await fetchOrgsFromServer();
    setResult(r.data.already ? `${username} 已经是成员了。` : `已邀请 ${username}，等 TA 接受。`, "success");
    render();
  });
  // 改组织名（仅自己的工作区）
  els.orgPanel.querySelector("#orgRenameForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("orgName") || "").trim();
    if (!name) return;
    const r = await orgApi("rename", { name });
    if (!r.ok) { setResult(r.error || "改名失败", "warning"); return; }
    await fetchOrgsFromServer();
    orgCreateExpanded = false;
    setResult("组织名改好了。", "success");
    render();
  });
  // 切换活跃工作区
  els.orgPanel.querySelectorAll("[data-switch-org]").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetOrg = orgStore.orgs.find((org) => org.id === button.dataset.switchOrg);
      if (!targetOrg) return;
      persist();
      orgStore.activeOrgId = targetOrg.id;
      state = loadState();
      selectedClientId = null;
      selectedManageClientId = null;
      selectedScheduleDate = null;
      orgCreateExpanded = false;
      persistOrgStore();
      render();
      if (await pullStateFromServer()) render();
    });
  });
  // 接受/拒绝邀请
  els.orgPanel.querySelectorAll("[data-respond-invite]").forEach((button) => {
    button.addEventListener("click", () => respondInvite(button.dataset.respondInvite, button.dataset.accept === "1"));
  });
  // 移除成员（仅拥有者）
  els.orgPanel.querySelectorAll("[data-remove-member]").forEach((button) => {
    button.addEventListener("click", async () => {
      const r = await orgApi("member", { orgId: currentOrg()?.ownerId, userId: button.dataset.removeMember, role: "remove" });
      if (!r.ok) { setResult(r.error || "移除失败", "warning"); return; }
      await fetchOrgsFromServer();
      setResult("成员已移除。", "success");
      render();
    });
  });
}

async function leaveCurrentOrg() {
  const org = currentOrg();
  if (!org) return;
  if (org.ownerId === auth.userId) { setResult("这是你自己的工作区，不能退出。", "warning"); return; }
  if (!window.confirm(`退出 ${org.name}？`)) return;
  const r = await orgApi("leave", { orgId: org.ownerId });
  if (!r.ok) { setResult(r.error || "退出失败", "warning"); return; }
  await fetchOrgsFromServer();
  orgStore.activeOrgId = auth.userId; // 回到自己的工作区
  persistOrgStore();
  state = loadState();
  selectedClientId = null;
  selectedManageClientId = null;
  selectedScheduleDate = null;
  meView = "main";
  render();
  if (await pullStateFromServer()) render();
}

function renderClients() {
  // 客户列表已从我的页移除，客户在统计页里可看；这里保留空函数避免老调用报错。
}

function getTodoCollections() {
  if (!canViewOrg()) return { rows: [], shootTodos: [], profileTodos: [], publishTodos: [], confirmTodos: [], total: 0 };
  const rows = state.clients.map(buildClientStats);
  const shootPlanTodos = buildShootPlanTodos();
  const shootTodos = [...shootPlanTodos, ...buildShootReminderTodos(rows)];
  const profileTodos = state.clients.filter((client) => client.needsProfileTodo);
  const publishTodos = buildPublishVerificationAlerts();
  const confirmTodos = pendingConfirms;
  return {
    rows,
    shootTodos,
    profileTodos,
    publishTodos,
    confirmTodos,
    total: shootTodos.length + profileTodos.length + publishTodos.length + confirmTodos.length,
  };
}

function renderTodoPanel() {
  if (!auth.loggedIn || !canViewOrg()) {
    const shouldShow = meView === "main";
    els.todoPanel.classList.toggle("hidden", !shouldShow);
    if (!shouldShow) {
      els.todoPanel.innerHTML = "";
      return;
    }
    els.todoPanel.classList.remove("hidden");
    els.todoPanel.innerHTML = `
      <button class="profile-action-card todo-entry" type="button" disabled>
        <div>
          <strong>待办事项</strong>
          <span class="muted-text">${auth.loggedIn ? "先加入组织" : "登录后我提醒你"}</span>
        </div>
        <span class="profile-card-value">${auth.loggedIn ? "没权限" : "先登录"}</span>
      </button>
    `;
    els.loginPanel.classList.remove("hidden");
    return;
  }
  const { shootTodos, profileTodos, publishTodos, confirmTodos, total: todoCount } = getTodoCollections();
  const shouldShow = meView === "main" || meView === "todos" || meView === "complete-profile";
  els.todoPanel.classList.toggle("hidden", !shouldShow);
  if (!shouldShow) {
    els.todoPanel.innerHTML = "";
    return;
  }
  if (meView === "complete-profile") {
    els.loginPanel.classList.add("hidden");
    els.todoPanel.innerHTML = `
      <div class="section-head">
        <h2>完善客户信息</h2>
        <span>${profileTodos.length} 个</span>
      </div>
      <p class="muted-text" style="margin:-4px 0 6px">补上账号，我来核发布。</p>
      ${profileTodos.length
        ? profileTodos.map(renderProfileTodo).join("")
        : `<div class="empty-state">客户都齐了</div>`}
    `;
    return;
  }
  if (meView === "todos") {
    els.loginPanel.classList.add("hidden");
    els.todoPanel.innerHTML = `
      <div class="section-head">
        <h2>待办事项</h2>
        <span>${todoCount} 项</span>
      </div>
      ${shootTodos.length ? renderShootTodos(shootTodos) : ""}
      ${publishTodos.length ? renderPublishVerificationTodos(publishTodos) : ""}
      ${confirmTodos.length ? renderConfirmTodos(confirmTodos) : ""}
      ${profileTodos.length ? renderProfileManageTodos(profileTodos) : ""}
      ${todoCount === 0 ? `<div class="empty-state">现在没事</div>` : ""}
    `;
    return;
  }
  els.loginPanel.classList.remove("hidden");
  els.todoPanel.innerHTML = `
    <button class="profile-action-card todo-entry" type="button" ${todoCount ? "data-open-todos" : "disabled"}>
      <div>
        <strong>待办事项</strong>
        <span class="muted-text">${renderTodoEntrySummary(shootTodos.length, profileTodos.length, publishTodos.length, confirmTodos.length)}</span>
      </div>
      <span class="${todoCount ? "notification-badge" : "profile-card-value"}">${todoCount ? todoCount : "空"}</span>
    </button>
  `;
}

function renderTodoEntrySummary(shootCount, profileCount, publishCount, confirmCount) {
  const parts = [];
  if (shootCount) parts.push(`${shootCount} 个该拍了`);
  if (publishCount) parts.push(`${publishCount} 条要看`);
  if (confirmCount) parts.push(`${confirmCount} 个号待认`);
  if (profileCount) parts.push(`${profileCount} 个待补`);
  return parts.join("，") || "我这边没事";
}

function renderConfirmTodos(confirms) {
  return `
    <section class="profile-todos">
      <div class="todo-head">
        <div>
          <strong>认一下账号</strong>
          <span class="muted-text">我找到了，帮我选准。</span>
        </div>
        <span>${confirms.length} 项</span>
      </div>
      ${confirms.map(renderPendingConfirm).join("")}
    </section>
  `;
}

function renderShootTodos(items) {
  return `
    <section class="profile-todos">
      <div class="todo-head">
        <div>
          <strong>拍摄要跟上</strong>
          <span class="muted-text">到点了，我带你处理。</span>
        </div>
        <span>${items.length} 项</span>
      </div>
      ${items.map((item) => `
        <button type="button" class="publish-todo publish-todo-button" ${item.type === "shoot_plan_due" ? `data-jump-to-date="${escapeHtml(item.shootDate)}"` : `data-open-client-detail="${escapeHtml(item.clientId)}"`}>
          <div>
            <strong>${escapeHtml(item.clientName)} · ${item.type === "shoot_plan_due" ? "该收尾了" : "该拍了"}</strong>
            <span class="muted-text">${escapeHtml(item.reason)}${item.type === "shoot_plan_due" ? ` · ${escapeHtml(item.shootDate)}` : ` · 最晚 ${escapeHtml(item.shootBefore)} 拍摄`}</span>
          </div>
          <span class="todo-cta">${item.type === "shoot_plan_due" ? "去收尾 ›" : "看客户 ›"}</span>
        </button>
      `).join("")}
    </section>
  `;
}

function renderPublishVerificationTodos(items) {
  return `
    <section class="profile-todos publish-todos">
      <div class="todo-head">
        <div>
          <strong>发布我没对上</strong>
          <span class="muted-text">要么补账号，要么看客户。</span>
        </div>
        <span>${items.length} 项</span>
      </div>
      ${items.map((item) => `
        <button type="button" class="publish-todo publish-todo-button" ${item.status === "unlinked" ? `data-open-client-manage="${escapeHtml(item.clientId)}"` : `data-open-client-detail="${escapeHtml(item.clientId)}"`}>
          <div>
            <strong>${escapeHtml(item.clientName)} · ${escapeHtml(item.topic)}</strong>
            <span class="muted-text">${escapeHtml(item.publishDate)} ${escapeHtml(item.publishTime)} · ${escapeHtml(item.reason)}</span>
          </div>
          <span class="todo-cta">${item.status === "unlinked" ? "去绑定 ›" : "看客户 ›"}</span>
        </button>
      `).join("")}
    </section>
  `;
}

function renderProfileManageTodos(clients) {
  return `
    <section class="profile-todos">
      <div class="todo-head">
        <div>
          <strong>客户资料差一点</strong>
          <span class="muted-text">补上账号，我来盯发布。</span>
        </div>
        <span>${clients.length} 项</span>
      </div>
      ${clients.map((client) => `
        <button type="button" class="publish-todo publish-todo-button" data-open-client-manage="${escapeHtml(client.id)}">
          <div>
            <strong>${escapeHtml(client.name)} · 还差资料</strong>
            <span class="muted-text">去绑平台账号。</span>
          </div>
          <span class="todo-cta">去补 ›</span>
        </button>
      `).join("")}
    </section>
  `;
}

function renderProfileTodo(client) {
  const douyin = client.accounts?.find((account) => account.platform === "douyin");
  const xhs = client.accounts?.find((account) => account.platform === "xhs");
  const channels = client.accounts?.find((account) => account.platform === "channels");
  return `
    <article class="profile-todo" data-profile-todo="${client.id}">
      <div class="todo-title">
        ${clientAvatarHtml(client, "md")}
        <div>
          <strong>${escapeHtml(client.name)}</strong>
          <span class="muted-text">先把平台补上。</span>
        </div>
      </div>
      <div class="todo-fields">
        <input data-profile-field="douyin" placeholder="抖音主页链接或抖音号" value="${escapeHtml(douyin?.uniqueId || douyin?.nickname || douyin?.identifier || "")}" autocomplete="off" ${canEditOrg() ? "" : "disabled"} />
        <input data-profile-field="channels" placeholder="视频号名字" value="${escapeHtml(channels?.nickname || channels?.userName || "")}" autocomplete="off" ${canEditOrg() ? "" : "disabled"} />
        <input data-profile-field="xhs" placeholder="小红书主页链接（可选）" value="${escapeHtml(xhs?.identifier || "")}" autocomplete="off" ${canEditOrg() ? "" : "disabled"} />
      </div>
      ${canEditOrg() ? `<button class="primary-button" type="button" data-profile-todo-save="${client.id}">我来抓</button>` : ""}
    </article>
  `;
}

function renderManagePanel() {
  if (!els.managePanel) return;
  if (!auth.loggedIn || !canViewOrg()) {
    const shouldShow = meView === "main";
    els.managePanel.classList.toggle("hidden", !shouldShow);
    if (!shouldShow) {
      els.managePanel.innerHTML = "";
      return;
    }
    els.managePanel.classList.remove("split-panel");
    els.managePanel.classList.remove("hidden");
    els.managePanel.innerHTML = `
      <button class="profile-action-card" type="button" disabled>
        <div>
          <strong>客户管理</strong>
          <span class="muted-text">${auth.loggedIn ? "先加入组织" : "登录后我帮你管"}</span>
        </div>
        <span class="profile-card-value">${auth.loggedIn ? "没权限" : "先登录"}</span>
      </button>
    `;
    return;
  }
  if (meView === "main") {
    els.managePanel.classList.remove("split-panel");
    els.managePanel.classList.remove("hidden");
    els.managePanel.innerHTML = `
      <button class="profile-action-card" type="button" data-open-manage>
        <div>
          <strong>客户管理</strong>
          <span class="muted-text">${canEditOrg() ? "客户和账号都放这" : "你可以看，不能改"}</span>
        </div>
        <span class="profile-card-value">${state.clients.length} 个 ›</span>
      </button>
    `;
    return;
  }
  if (meView !== "manage") {
    els.managePanel.classList.remove("split-panel");
    els.managePanel.classList.add("hidden");
    els.managePanel.innerHTML = "";
    return;
  }
  els.loginPanel.classList.add("hidden");
  const isAddingClient = selectedManageClientId === "__new__";
  const selectedManageClient = findClient(selectedManageClientId);
  const orderedClients = selectedManageClient
    ? [selectedManageClient, ...state.clients.filter((client) => client.id !== selectedManageClientId)]
    : state.clients;
  els.managePanel.classList.add("split-panel");
  els.managePanel.classList.remove("hidden");
  els.managePanel.innerHTML = `
    <section class="manage-block">
      <div class="section-head">
        <h2>客户管理</h2>
        <span>${canEditOrg() ? `${state.clients.length} 个客户` : "只读"}</span>
      </div>
      ${canEditOrg() ? `
        <button class="profile-action-card manage-add-entry" type="button" data-add-client>
          <div>
            <strong>新增客户</strong>
            <span class="muted-text">${isAddingClient ? "先建档，再绑账号。" : "点这里新建客户"}</span>
          </div>
          <span class="profile-card-value">${isAddingClient ? "收起" : "新增 ›"}</span>
        </button>
        ${isAddingClient ? `
        <form id="clientForm" class="client-form manage-client-form">
        <input id="clientName" name="clientName" placeholder="客户名" autocomplete="off" required />
        <div class="form-grid">
          <input id="clientInterval" name="clientInterval" type="number" min="1" value="1" placeholder="几天一发" />
          <input id="clientTime" name="clientTime" type="time" value="17:00" />
        </div>
        <input id="clientTypes" name="clientTypes" value="案例、干货、老板IP、日常" placeholder="内容类型" autocomplete="off" />
        <input id="clientDouyinUrl" name="clientDouyinUrl" placeholder="抖音，可不填" autocomplete="off" />
        <input id="clientXhsUrl" name="clientXhsUrl" placeholder="小红书，可不填" autocomplete="off" />
        <input id="clientChannelsName" name="clientChannelsName" placeholder="视频号，可不填" autocomplete="off" />
        <button class="primary-button" type="submit">加客户</button>
        </form>
        ` : ""}
      ` : `<div class="empty-state">只读模式，我不改资料。</div>`}
    </section>
    <section class="manage-block">
      <div class="section-head">
        <h2>客户列表</h2>
        <span>${state.clients.length} 个</span>
      </div>
      <p class="muted-text manage-list-hint">点编辑再改资料。</p>
      <div class="manage-client-list">
        ${orderedClients.map(renderManageClientCard).join("") || `<div class="empty-state">还没客户</div>`}
      </div>
    </section>
  `;
  els.managePanel.querySelector("#clientForm")?.addEventListener("submit", handleClientFormSubmit);
}

function renderManageClientCard(client) {
  const douyin = client.accounts?.find((account) => account.platform === "douyin");
  const xhs = client.accounts?.find((account) => account.platform === "xhs");
  const channels = client.accounts?.find((account) => account.platform === "channels");
  const highlighted = client.id === selectedManageClientId;
  return `
    <article class="manage-client-card${highlighted ? " highlighted" : ""}" data-manage-client="${escapeHtml(client.id)}" data-profile-todo="${escapeHtml(client.id)}">
      <div class="manage-client-summary">
        <div class="todo-title">
          ${clientAvatarHtml(client, "sm")}
          <div>
            <strong>${escapeHtml(client.name)}</strong>
            <span class="muted-text">每 ${client.publishIntervalDays} 天 1 条 · ${client.defaultPublishTime}</span>
          </div>
        </div>
        <div class="manage-inline-actions">
          ${canEditOrg() ? `<button class="text-button" type="button" data-edit-client="${escapeHtml(client.id)}">${highlighted ? "收起" : "编辑"}</button>` : ""}
          ${canEditOrg() ? `<button class="danger-button" type="button" data-delete-client="${escapeHtml(client.id)}">删除</button>` : ""}
        </div>
      </div>
      ${highlighted && canEditOrg() ? `
      ${renderClientPlatformColumns(client)}
      <div class="client-edit-fields">
        <input data-client-edit-field="name" placeholder="客户名" value="${escapeHtml(client.name)}" autocomplete="off" />
        <div class="form-grid">
          <input data-client-edit-field="interval" type="number" min="1" placeholder="几天一发" value="${escapeHtml(client.publishIntervalDays)}" />
          <input data-client-edit-field="time" type="time" value="${escapeHtml(client.defaultPublishTime)}" />
        </div>
        <input data-client-edit-field="types" placeholder="内容类型" value="${escapeHtml((client.contentTypes || []).join("、"))}" autocomplete="off" />
      </div>` : ""}
      ${highlighted ? (() => {
        const isEditingAccounts = editingProfileClientId === client.id;
        const lockDouyin = !!douyin && !isEditingAccounts;
        const lockChannels = !!channels && !isEditingAccounts;
        const lockXhs = !!xhs && !isEditingAccounts;
        const anyBound = !!(douyin || channels || xhs);
        const baseAttr = canEditOrg() ? "" : "disabled";
        const lockedAttr = "readonly";
        return `<div class="todo-fields">
        <input data-profile-field="douyin" placeholder="抖音主页链接或抖音号" value="${escapeHtml(douyin?.uniqueId || douyin?.nickname || douyin?.identifier || "")}" autocomplete="off" ${baseAttr} ${lockDouyin ? lockedAttr : ""} />
        <input data-profile-field="channels" placeholder="视频号" value="${escapeHtml(channels?.nickname || channels?.userName || "")}" autocomplete="off" ${baseAttr} ${lockChannels ? lockedAttr : ""} />
        <input data-profile-field="xhs" placeholder="小红书" value="${escapeHtml(xhs?.identifier || "")}" autocomplete="off" ${baseAttr} ${lockXhs ? lockedAttr : ""} />
      </div>
      <div class="manage-card-actions">
        ${canEditOrg() ? `<button class="primary-button" type="button" data-save-client="${escapeHtml(client.id)}">保存</button>` : ""}
        ${canEditOrg() ? `<button class="text-button" type="button" data-profile-todo-save="${escapeHtml(client.id)}">抓账号</button>` : ""}
        ${canEditOrg() && anyBound ? `<button class="text-button" type="button" data-toggle-edit-accounts="${escapeHtml(client.id)}">${isEditingAccounts ? "锁定账号" : "改账号"}</button>` : ""}
      </div>`;
      })() : ""}
      ${highlighted ? renderClientPendingConfirms(client.id) : ""}
    </article>
  `;
}

function renderClientPendingConfirms(clientId) {
  const entries = pendingConfirms.filter((entry) => entry.clientId === clientId);
  if (!entries.length) return "";
  return `<div class="manage-pending-confirms">${entries.map(renderPendingConfirm).join("")}</div>`;
}

function renderClientPlatformLine(client) {
  if (!client.accounts?.length) return `<span class="muted-text">还没绑账号</span>`;
  return `<div class="platform-chips">${client.accounts.map((a) => `
    <span class="platform-chip" data-p="${a.platform}">${PLATFORM_META[a.platform]?.emoji || ""} ${escapeHtml(a.nickname || PLATFORM_META[a.platform]?.name || "")}</span>
  `).join("")}</div>`;
}

function renderClientPlatformColumns(client, options = {}) {
  return `
    <div class="client-platform-grid">
      ${["douyin", "xhs", "channels"].map((platform) => renderClientPlatformCell(client, platform, options)).join("")}
    </div>
  `;
}

function renderClientPlatformCell(client, platform, options = {}) {
  const meta = PLATFORM_META[platform] || { name: platform, emoji: "" };
  const account = getAccount(client, platform);
  if (!account) {
    return `
      <div class="client-platform-cell empty" data-p="${platform}">
        <span>${meta.emoji} ${escapeHtml(meta.name)}</span>
        <strong>没绑</strong>
        <em>空着</em>
      </div>
    `;
  }
  const week = aggregateAccountPosts(account.id, Date.now() - 7 * 24 * 60 * 60 * 1000);
  const loading = postsByAccount[account.id]?.loading;
  const performance = options.showPerformance
    ? loading
      ? "我在抓"
      : week
        ? `7日 ${week.count} 条 · ${formatCount(week.playSum)} 播放`
        : `${formatCount(account.followerCount)} 粉`
    : `${formatCount(account.followerCount)} 粉 · ${formatCount(account.postCount)} ${meta.postLabel}`;
  return `
    <div class="client-platform-cell" data-p="${platform}">
      <span>${meta.emoji} ${escapeHtml(meta.name)}</span>
      <strong>${escapeHtml(account.nickname || account.uniqueId || "绑好了")}</strong>
      <em>${escapeHtml(performance)}</em>
    </div>
  `;
}

function renderPendingConfirm(entry) {
  const meta = PLATFORM_META[entry.platform] || { name: entry.platform, emoji: "" };
  const header = `<div class="avatar-confirm-platform">${meta.emoji} ${escapeHtml(meta.name)}</div>`;
  if (entry.loading) {
    return `<article class="avatar-confirm"><div class="avatar-confirm-body">${header}<p class="muted-text">我在找…</p></div></article>`;
  }
  if (entry.error) {
    return `<article class="avatar-confirm avatar-confirm-error">
      <div class="avatar-confirm-body">${header}
        <p class="muted-text avatar-confirm-error-text">没找到：${escapeHtml(entry.error)}${entry.platform === "douyin" ? "。主页分享链接最稳，也可以填抖音号。" : ""}</p>
        <div class="avatar-confirm-actions">
          <button class="text-button" type="button" data-confirm-pending="${entry.pid}" data-action="no">知道了</button>
        </div>
      </div>
    </article>`;
  }
  if (entry.candidates) {
    return `<article class="avatar-confirm avatar-confirm-list">
      <div class="avatar-confirm-body" style="grid-column:1/-1">${header}
        <strong>哪个${meta.name}是 TA？</strong>
        <div class="account-candidates">
          ${entry.candidates.map((c) => `
            <button type="button" class="account-candidate" data-pid="${entry.pid}" data-account-pick="${escapeHtml(c.identifier || c.userName || "")}">
              <span class="client-avatar avatar-md">${c.avatar ? `<img src="${escapeHtml(c.avatar)}" alt="" />` : `<span class="avatar-fallback" style="background:${meta.color}">${escapeHtml((c.nickname || "?").slice(0,1))}</span>`}</span>
              <div class="account-candidate-body">
                <strong>${escapeHtml(c.nickname)}</strong>
                <span class="muted-text">${[c.uniqueId ? `${entry.platform === "douyin" ? "@" : ""}${c.uniqueId}` : "", c.followerCount ? `${formatCount(c.followerCount)} 粉` : "", c.authInfo || ""].filter(Boolean).map(escapeHtml).join(" · ")}</span>
                ${c.desc ? `<span class="muted-text account-candidate-desc">${escapeHtml(c.desc)}</span>` : ""}
              </div>
            </button>
          `).join("")}
          ${entry.candidates.length === 0 ? `<p class="muted-text">${entry.platform === "douyin" ? "我没搜到。试试粘贴抖音主页分享链接，或者填抖音号。" : "我没搜到"}</p>` : ""}
        </div>
        <div class="avatar-confirm-actions">
          <button class="text-button" type="button" data-confirm-pending="${entry.pid}" data-action="no">先不选</button>
        </div>
      </div>
    </article>`;
  }
  const a = entry.account;
  if (!a) return "";
  const initial = (a.nickname || "?").slice(0, 1);
  const avatar = a.avatarLarge
    ? `<img src="${escapeHtml(a.avatarLarge)}" alt="" />`
    : `<span class="avatar-fallback" style="background:${meta.color}">${escapeHtml(initial)}</span>`;
  return `
    <article class="avatar-confirm">
      <div class="avatar-confirm-preview">${avatar}</div>
      <div class="avatar-confirm-body">${header}
        <strong>是这个号吗？</strong>
        <p class="avatar-confirm-name">${escapeHtml(a.nickname || "（无昵称）")}${a.uniqueId ? ` <span class="muted-text">${a.platform === "douyin" ? "@" : ""}${escapeHtml(a.uniqueId)}</span>` : ""}</p>
        <p class="muted-text">${a.followerCount ? `粉丝 ${formatCount(a.followerCount)} · ` : ""}${a.postCount ? `${meta.postLabel} ${formatCount(a.postCount)} · ` : ""}获赞 ${formatCount(a.totalFavorited)}</p>
        ${a.signature ? `<p class="muted-text avatar-confirm-sig">${escapeHtml(a.signature.split("\n")[0])}</p>` : ""}
        <div class="avatar-confirm-actions">
          <button class="primary-button" type="button" data-confirm-pending="${entry.pid}" data-action="yes">就是它</button>
          <button class="text-button" type="button" data-confirm-pending="${entry.pid}" data-action="no">不是</button>
        </div>
      </div>
    </article>
  `;
}

function renderLlmStatus() {
  if (!llmStatus) {
    els.llmOverall.textContent = "我看看";
    els.llmStatus.innerHTML = `<div class="empty-state">我在看配置</div>`;
    return;
  }
  const configured = llmStatus.filter((provider) => provider.configured).length;
  els.llmOverall.textContent = configured ? `${configured} 个能用` : "还没配";
  els.llmStatus.innerHTML = llmStatus
    .map(
      (provider) => `
        <article class="llm-provider">
          <div>
            <strong>${provider.name === "deepseek" ? "DeepSeek" : "Qwen"}</strong>
            <div class="muted-text">${provider.role} · ${escapeHtml(provider.model)}</div>
          </div>
          <span class="dot ${provider.configured ? "on" : ""}"></span>
        </article>
      `,
    )
    .join("");
}

async function runNaturalCommand() {
  if (!requireEdit()) return;
  const text = els.commandInput.value.trim();
  if (!text) return;
  // 仅在多轮时自动展浮窗；单轮就内联反馈。
  // "多轮"只看距上次打开以来的轮数：关闭后回来发的第一条仍按首轮（收起 + 气泡）。
  // 但若还有没回答的追问选项，回来要重新展开，别把它藏掉。
  const existingUserCount = chatHistory.filter((m) => m.role === "user").length;
  const isMultiTurn = existingUserCount - chatTurnBaseline >= 1;
  chatHistory.push({ role: "user", content: text });
  _runningUserText = text;
  chatSending = true;
  if (isMultiTurn || pendingActionPrompt) {
    chatManuallyCollapsed = false;
    chatExpanded = true;
  }
  els.commandInput.value = "";
  autoGrowCommandInput();
  renderChatPanel();
  setResult("想一下…", "");
  const parsed = await parseCommandWithFallback(text);
  chatSending = false;
  if (!parsed.ok) {
    setResult(parsed.message, "warning");
    return;
  }
  // 新路径：LLM 返回 toolCalls 数组（function calling）
  if (Array.isArray(parsed.toolCalls)) {
    await executeToolCalls(text, parsed);
    return;
  }
  // 老路径：本地规则 fallback 或还没改造的 intent；下面是旧分发逻辑
  if (parsed.intent === "resolve_client") {
    showClientResolution(parsed);
    els.commandInput.value = "";
    autoGrowCommandInput();
    return;
  }
  if (parsed.intent === "create_client") {
    const client = createClient({ ...parsed.client, needsProfileTodo: Boolean(parsed.items?.length) });
    // 用户说了 planOnly 但没说几条 → 客户建好，但不要自动塞 1 条占位
    if (parsed.planOnly && !parsed.items?.length) {
      setResult(`${client.name} 加好了。这次拍几条？告诉我数字，比如"3 条"。`, "success");
      showDouyinPrompt(client);
    } else if (parsed.items?.length) {
      const result = parsed.planOnly
        ? planShoot({ client, shootDate: parsed.shootDate || formatDate(new Date()), items: parsed.items })
        : recordShoot({ client, shootDate: parsed.shootDate || formatDate(new Date()), items: parsed.items });
      if (result.ok) showDouyinPrompt(client);
      else setResult(withProvider(result.message, parsed), "warning");
    } else {
      setResult(withProvider(`${client.name} 我记下了。`, parsed), "success");
    }
  }
  if (parsed.intent === "record_shoot") {
    const result = recordShoot(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "plan_shoot") {
    if (!parsed.items?.length) {
      setResult(`${parsed.client?.name || "这个客户"} 拍几条？告诉我个数字，比如"3 条"。`, "warning");
      els.commandInput.value = "";
      autoGrowCommandInput();
      return;
    }
    const result = planShoot(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "move_shoot_plan") {
    const result = moveShootPlan(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "cancel_shoot_plan") {
    const result = cancelShootPlan(parsed.sessionId || findNextShootPlan(parsed.client?.id)?.id);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "move_publish") {
    const result = movePublish(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "cancel_publish") {
    const result = cancelPublish(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "update_shoot_topics") {
    const result = applyTopicUpdates(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "rename_video") {
    const result = renameVideo(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "rename_client") {
    const result = renameClient(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "add_client_alias") {
    const result = addClientAliasViaCommand(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "remove_client_alias") {
    const result = removeClientAliasViaCommand(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "update_client_settings") {
    const result = updateClientSettings(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "update_client_types") {
    const result = updateClientTypes(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "delete_client") {
    const result = deleteClientViaCommand(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "bind_account") {
    const result = bindAccountViaCommand(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "append_to_shoot") {
    const result = appendToShoot(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "retype_video") {
    const result = retypeVideo(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "delete_video") {
    const result = deleteVideoViaCommand(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "mark_published") {
    const result = markPublished(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "reschedule_time") {
    const result = rescheduleTime(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "shift_day") {
    const result = shiftDay(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "skip_day") {
    const result = skipDay(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "shift_all") {
    const result = shiftAllForClient(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "query_today") {
    const result = queryToday(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "query_date") {
    const result = queryDate(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "query_stats") {
    const result = queryStats(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "search_videos") {
    const result = searchVideos(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "query_video_shoot") {
    const result = queryVideoShoot(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "update_shoot_count") {
    const result = updateShootCount(parsed);
    setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
  }
  if (parsed.intent === "help") {
    setResult(buildHelpText(), "success");
  }
  els.commandInput.value = "";
  autoGrowCommandInput();
  persist();
  render();
}

async function parseCommandWithFallback(text) {
  try {
    const llmParsed = await parseCommandWithLlm(text);
    if (llmParsed.ok) return llmParsed;
  } catch (error) {
    console.info("LLM parse failed, using local parser:", error.message);
  }
  return { ...parseCommand(text), provider: "本地规则" };
}

async function parseCommandWithLlm(text) {
  const existingTopics = state.videoItems
    .map((v) => v.topic)
    .filter((t) => t && !isPlaceholderTopic(t));
  const today = formatDate(new Date());
  const lower = formatDate(addDays(new Date(), -14));
  const upper = formatDate(addDays(new Date(), 30));
  const recentShoots = state.shootSessions
    .filter((s) => s.shootDate >= lower && s.shootDate <= upper)
    .sort((a, b) => b.shootDate.localeCompare(a.shootDate))
    .slice(0, 30)
    .map((s) => ({
      sessionId: s.id,
      client: findClient(s.clientId)?.name || "",
      shootDate: s.shootDate,
      status: s.status,
      shootCount: s.shootCount,
    }));
  const response = await fetch("/api/parse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
    },
    body: JSON.stringify({
      text,
      today,
      clients: state.clients,
      existingTopics: [...new Set(existingTopics)],
      recentShoots,
      scheduleContext: buildScheduleContext(today),
      chatHistory: chatHistory.slice(-MAX_CHAT_HISTORY),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return {
    ok: true,
    provider: data.provider,
    toolCalls: Array.isArray(data.toolCalls) ? data.toolCalls : [],
    assistantMessage: typeof data.assistantMessage === "string" ? data.assistantMessage : "",
  };
}

function buildScheduleContext(today = formatDate(new Date())) {
  const clientName = (clientId) => findClient(clientId)?.name || "";
  const videoTopic = (videoItemId) => findVideo(videoItemId)?.topic || "";
  return {
    futureSlots: state.publishSlots
      .filter((slot) => slot.publishDate >= today)
      .sort((a, b) => a.publishDate.localeCompare(b.publishDate) || (a.publishTime || "").localeCompare(b.publishTime || ""))
      .slice(0, 100)
      .map((slot) => ({
        client: clientName(slot.clientId),
        topic: videoTopic(slot.videoItemId),
        publishDate: slot.publishDate,
        publishTime: slot.publishTime,
        locked: Boolean(slot.locked),
      })),
    pendingVideos: state.videoItems
      .filter((video) => video.status === "待发布")
      .slice(0, 100)
      .map((video) => ({
        client: clientName(video.clientId),
        topic: video.topic,
        scheduled: state.publishSlots.some((slot) => slot.videoItemId === video.id),
      })),
    recentCancelledDates: (state.cancelledDates || []).slice(-30).map((entry) => ({
      client: clientName(entry.clientId),
      date: entry.date,
    })),
  };
}

async function executeToolCalls(rawText, parsed) {
  const calls = parsed.toolCalls || [];
  const actionResults = [];
  const toolMessages = []; // 给 LLM 看的 tool 消息（含执行结果）
  let finalReply = parsed.assistantMessage || "";
  // 给每个 call 提前生成稳定的 ID（后端没传就本地生成），同时用于 assistant.tool_calls 和 tool 消息
  for (let i = 0; i < calls.length; i += 1) {
    if (calls[i] && !calls[i].id) calls[i].id = `call_${Date.now()}_${i}`;
  }
  for (let i = 0; i < calls.length; i += 1) {
    const call = calls[i];
    if (!call?.name) continue;
    const callId = call.id;
    if (call.name === "reply_only") {
      const msg = String(call.args?.message || "").trim();
      if (msg) finalReply = msg;
      toolMessages.push({ role: "tool", tool_call_id: callId, name: "reply_only", content: "ok" });
      continue;
    }
    const handler = TOOL_HANDLERS[call.name];
    if (!handler) {
      const r = { ok: false, message: `这个动作我还没学会：${call.name}` };
      actionResults.push(r);
      toolMessages.push({ role: "tool", tool_call_id: callId, name: call.name, content: r.message });
      continue;
    }
    try {
      const result = await handler(call.args || {});
      const r = result || { ok: true, message: "" };
      actionResults.push(r);
      toolMessages.push({ role: "tool", tool_call_id: callId, name: call.name, content: `${r.ok ? "成功" : "失败"}: ${r.message || ""}` });
    } catch (err) {
      const r = { ok: false, message: `执行 ${call.name} 出错：${err.message}` };
      actionResults.push(r);
      toolMessages.push({ role: "tool", tool_call_id: callId, name: call.name, content: r.message });
    }
  }
  // 失败的工具消息单独抽出来，避免被 LLM 乐观的 assistantMessage 吞掉
  const failures = actionResults.filter((r) => !r.ok && r.message);

  // 扫一遍执行结果，按优先级挑出需要主动追问/确认的交互（一次只展一个）
  const interactivePrompt = buildInteractivePrompt(actionResults, calls, parsed);
  if (interactivePrompt) {
    pendingActionPrompt = interactivePrompt;
    // 强制展开浮窗，让用户看见选项
    chatExpanded = true;
    chatManuallyCollapsed = false;
  }

  let summary = buildExecutionSummary(actionResults, finalReply);
  if (!summary && calls.length === 0) summary = "我没听明白，再说一遍试试？";
  // 失败也由 buildExecutionSummary 统一展示，避免盖住真实执行结果或重复报错。
  const allOk = actionResults.every((r) => r.ok) && (calls.length || finalReply);
  // 触发了主动选项气泡时，主动收起 commandResult，让浮窗里气泡承担提示职责
  if (!interactivePrompt) {
    setResult(withProvider(summary || "好的。", parsed), allOk ? "success" : "warning");
  } else {
    setResult("", "");
  }
  // 按 OpenAI 协议存对话历史：assistant 带 tool_calls + 每个工具的 tool 消息
  // 如果 runNaturalCommand 已经推过这条 user 消息（避免重复气泡）就跳过
  if (_runningUserText !== rawText) {
    chatHistory.push({ role: "user", content: rawText });
  } else {
    _runningUserText = "";
  }
  const assistantToolCalls = calls
    .filter((c) => c?.name && c.id)
    .map((c) => ({
      id: c.id,
      type: "function",
      function: { name: c.name, arguments: JSON.stringify(c.args || {}) },
    }));
  // 触发了主动选项气泡时，助手消息别再重复执行结果（气泡自己会说）
  const assistantContent = interactivePrompt ? "" : (summary || "");
  chatHistory.push({
    role: "assistant",
    content: assistantContent,
    tool_calls: assistantToolCalls.length ? assistantToolCalls : undefined,
  });
  for (const m of toolMessages) chatHistory.push(m);
  if (chatHistory.length > MAX_CHAT_HISTORY) chatHistory = chatHistory.slice(-MAX_CHAT_HISTORY);
  els.commandInput.value = "";
  autoGrowCommandInput();
  persist();
  render();
}

// 按优先级（找不到客户 > 视频指代多条 > 危险操作确认 > 新建客户追问）
// 从执行结果里挑出第一个需要主动追问/确认的交互。
function buildInteractivePrompt(actionResults, calls, parsed) {
  for (let i = 0; i < actionResults.length; i += 1) {
    const r = actionResults[i];
    const call = calls[i];
    if (!r || r.ok || !call) continue;
    // #1 找不到客户 → 新客户 / 别名（适用于所有带客户名的工具）
    if (/没找到客户/.test(r.message || "") && call.args?.client) {
      const rawName = String(call.args.client);
      const candidates = state.clients
        .map((c) => ({ client: c, score: fuzzyClientScore(rawName, c) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((x) => x.client);
      const contentTypes = Array.isArray(call.args?.items)
        ? uniqueValues(call.args.items.map((it) => it?.contentType).filter(Boolean))
        : call.args?.contentType
          ? [call.args.contentType]
          : [];
      return {
        kind: "client-resolution",
        rawName,
        candidates,
        contentTypes,
        summary: summarizeCall(call),
        call: { name: call.name, args: call.args },
        provider: parsed.provider,
      };
    }
    // #2 一个关键词命中多条视频 → 列候选
    if (r.ambiguous && Array.isArray(r.candidates) && r.candidates.length) {
      return {
        kind: "video-disambiguation",
        hint: r.hint || "",
        candidates: r.candidates.slice(0, 6),
        call: { name: call.name, args: call.args },
        provider: parsed.provider,
      };
    }
    // #3 危险操作 → 确认
    if (r.needsConfirm) {
      return {
        kind: "destructive-confirm",
        title: r.confirmTitle || "确认执行？",
        options: r.confirmOptions || [{ key: "ok", label: "确认", variant: "primary" }],
        confirmArgs: r.confirmArgs || {},
        call: { name: call.name, args: call.args },
        provider: parsed.provider,
      };
    }
    // #5 拍摄没说数量 → 1/3/5/其它
    if (r.needsCount) {
      return {
        kind: "shoot-count",
        clientName: r.clientName || "",
        planOnly: !!r.planOnly,
        call: { name: call.name, args: call.args },
        provider: parsed.provider,
      };
    }
    // #6 延期没说时间 → 顺延 1/2/3 天 / 具体日期
    if (r.needsPostponeChoice) {
      return {
        kind: "postpone-choice",
        clientName: r.clientName || "",
        call: { name: call.name, args: call.args },
        provider: parsed.provider,
      };
    }
  }
  // #4 刚新建客户且没有其它待确认 → 追问发布频率/时间
  const onboard = actionResults.find((r) => r && r.ok && r.onboardClientId);
  if (onboard) {
    return { kind: "client-onboarding", clientId: onboard.onboardClientId, step: "frequency" };
  }
  return null;
}

function summarizeCall(call) {
  if (call.name === "plan_shoot" || call.name === "record_shoot") {
    const items = Array.isArray(call.args?.items)
      ? call.args.items.map((it) => it?.topic || it?.contentType).filter(Boolean)
      : [];
    const label = call.name === "plan_shoot" ? "计划拍" : "记录拍摄";
    return items.length ? `${label}：${items.join("、")}` : label;
  }
  return "";
}

function isVagueAssistantReply(message) {
  const text = String(message || "").trim();
  if (!text) return true;
  return /^(好嘞|好的|行|嗯|我)?(先|来)?(看一下|看看|查一下|查查|确认一下|处理一下|整理一下)/.test(text)
    || /我(先|来)?(看一下|看看|查一下|查查|确认一下|处理一下|整理一下)/.test(text);
}

function buildExecutionSummary(actionResults, finalReply = "") {
  const resultLines = (actionResults || [])
    .map((result) => {
      const message = String(result?.message || "").trim();
      if (!message) return result?.ok ? "✅ 已执行。" : "⚠️ 执行失败。";
      return `${result.ok ? "✅" : "⚠️"} ${message}`;
    })
    .filter(Boolean);
  const reply = String(finalReply || "").trim();
  if (!resultLines.length) return reply;
  if (reply && !isVagueAssistantReply(reply)) return `${resultLines.join("\n")}\n${reply}`;
  return resultLines.join("\n");
}

// 危险操作：返回待确认结果，由 buildInteractivePrompt 转成确认气泡
function confirmPrompt(title, options, confirmArgs) {
  return { ok: false, needsConfirm: true, confirmTitle: title, confirmOptions: options, confirmArgs };
}

// ============ Tool 调度表 ============
// 每个 wrapper 接收 LLM 返回的 args，调用已有 handler，返回 {ok, message}
const TOOL_HANDLERS = {
  create_client: (args) => {
    const client = createClient({
      name: args.name,
      publishIntervalDays: args.publishIntervalDays || 1,
      defaultPublishTime: args.defaultPublishTime || "17:00",
      contentTypes: Array.isArray(args.contentTypes) ? args.contentTypes : ["日常"],
    });
    if (!client) return { ok: false, message: "没权限改组织。" };
    // 用户没明确说频率时，加完追问发布频率/时间
    const onboardClientId = args.publishIntervalDays ? undefined : client.id;
    return { ok: true, message: `${client.name} 加好了。`, onboardClientId };
  },
  rename_client: (args) => {
    const client = findClientByName(args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return renameClient({ client, newName: String(args.newName || "").trim() });
  },
  add_client_alias: (args) => {
    const client = findClientByName(args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return addClientAliasViaCommand({ client, alias: String(args.alias || "").trim() });
  },
  remove_client_alias: (args) => {
    const client = findClientByName(args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return removeClientAliasViaCommand({ client, alias: String(args.alias || "").trim() });
  },
  update_client_settings: (args) => {
    const client = findClientByName(args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return updateClientSettings({
      client,
      publishIntervalDays: args.publishIntervalDays || null,
      defaultPublishTime: args.defaultPublishTime || null,
    });
  },
  update_client_types: (args) => {
    const client = findClientByName(args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return updateClientTypes({ client, contentTypes: Array.isArray(args.contentTypes) ? args.contentTypes : [] });
  },
  delete_client: (args) => {
    const client = findClientByName(args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    if (!args.__confirmed) {
      return confirmPrompt(`确定删除「${client.name}」？相关日程、素材、发布都会一起移除。`, [
        { key: "ok", label: `删除「${client.name}」`, variant: "danger" },
      ]);
    }
    return deleteClientViaCommand({ client });
  },
  bind_account: (args) => {
    const client = findClientByName(args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return bindAccountViaCommand({ client, platform: args.platform, identifier: args.identifier });
  },
  plan_shoot: (args) => {
    const client = findClientByName(args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    const shootDate = args.shootDate || formatDate(new Date());
    let items = [];
    if (Array.isArray(args.items) && args.items.length) {
      const fbType = args.contentType || client.contentTypes?.[0] || "日常";
      items = args.items.map((it, i) => ({
        topic: it.topic || fallbackShootTopic(shootDate, it.contentType || fbType, i),
        contentType: it.contentType || fbType,
        shootPeriod: "",
      }));
    } else if (args.shootCount) {
      const fbType = args.contentType || client.contentTypes?.[0] || "日常";
      const safeCount = Math.max(1, Math.min(Number(args.shootCount), 20));
      items = Array.from({ length: safeCount }, (_, i) => ({
        topic: fallbackShootTopic(shootDate, fbType, i),
        contentType: fbType,
        shootPeriod: "",
      }));
    } else {
      return { ok: false, needsCount: true, planOnly: true, clientName: client.name, message: `${client.name} 拍几条？` };
    }
    return planShoot({ client, shootDate, items });
  },
  record_shoot: (args) => {
    const client = findClientByName(args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    const shootDate = args.shootDate || formatDate(new Date());
    let items = [];
    if (Array.isArray(args.items) && args.items.length) {
      const fbType = args.contentType || client.contentTypes?.[0] || "日常";
      items = args.items.map((it, i) => ({
        topic: it.topic || fallbackShootTopic(shootDate, it.contentType || fbType, i),
        contentType: it.contentType || fbType,
        shootPeriod: "",
      }));
    } else if (args.shootCount) {
      const fbType = args.contentType || client.contentTypes?.[0] || "日常";
      const safeCount = Math.max(1, Math.min(Number(args.shootCount), 20));
      items = Array.from({ length: safeCount }, (_, i) => ({
        topic: fallbackShootTopic(shootDate, fbType, i),
        contentType: fbType,
        shootPeriod: "",
      }));
    } else {
      return { ok: false, needsCount: true, planOnly: false, clientName: client.name, message: `${client.name} 拍了几条？` };
    }
    return recordShoot({ client, shootDate, items });
  },
  append_to_shoot: (args) => {
    const client = args.client ? findClientByName(args.client) : null;
    return appendToShoot({ client, count: Number(args.count || 0), contentType: args.contentType || "" });
  },
  update_shoot_count: (args) => {
    const client = args.client ? findClientByName(args.client) : null;
    const session = args.sessionId
      ? findShootSession(args.sessionId)
      : state.shootSessions
          .filter((item) => (!client || item.clientId === client.id) && (!args.shootDate || item.shootDate === args.shootDate))
          .sort((a, b) => (b.completedAt || b.createdAt || "").localeCompare(a.completedAt || a.createdAt || ""))[0];
    const oldCount = session ? state.videoItems.filter((video) => video.shootSessionId === session.id).length || Number(session.shootCount || 0) : 0;
    if (!args.__confirmed && oldCount > 0 && Number(args.newCount || 0) < oldCount) {
      return confirmPrompt(`把这次拍摄从 ${oldCount} 条改成 ${args.newCount} 条？多出的 ${oldCount - Number(args.newCount || 0)} 条素材和发布会删除。`, [
        { key: "ok", label: "确认减少", variant: "danger" },
      ]);
    }
    return updateShootCount({ client, newCount: Number(args.newCount || 0), shootDate: args.shootDate || "", sessionId: args.sessionId || "" });
  },
  move_shoot_plan: (args) => {
    const client = findClientByName(args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return moveShootPlan({ client, targetDate: args.targetDate });
  },
  postpone_shoot_plan: (args) => {
    const client = findClientByName(args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    // 用户没说延几天也没给日期 → 弹"顺延 1/2/3 天 / 具体日期"
    if (!args.days && !args.targetDate) {
      return { ok: false, needsPostponeChoice: true, clientName: client.name, message: `${client.name} 延到什么时候？` };
    }
    return postponeShootPlanForClient({ client, targetDate: args.targetDate || "", days: Number(args.days || 1) });
  },
  cancel_shoot_plan: (args) => {
    const client = findClientByName(args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return cancelShootPlan(findNextShootPlan(client.id)?.id);
  },
  delete_shoot_session: (args) => {
    const client = args.client ? findClientByName(args.client) : null;
    const base = {
      client,
      shootDate: args.shootDate || args.date || "",
      sessionId: args.sessionId || "",
      allOnDate: args.allOnDate === true,
    };
    if (!args.__confirmed) {
      const probe = deleteShootSession({ ...base, dryRun: true });
      if (!probe.ok) return probe; // 没找到要删的
      return confirmPrompt(`确定删除这 ${probe.count} 条拍摄记录？对应素材和发布会一起删。`, [
        { key: "ok", label: "删除", variant: "danger" },
      ]);
    }
    return deleteShootSession(base);
  },
  dedupe_client_data: (args) => {
    const client = findClientByName(args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    if (!args.__confirmed) {
      return confirmPrompt(`要清理「${client.name}」的重复拍摄/素材/发布并重排吗？`, [
        { key: "ok", label: "清理并重排", variant: "primary" },
      ]);
    }
    return dedupeClientData({ client });
  },
  rebuild_client_schedule: (args) => {
    const client = findClientByName(args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    if (!args.__confirmed) {
      return confirmPrompt(
        `重排「${client.name}」未来的发布排期，怎么排？`,
        [
          { key: "keep", label: "只重排没锁定的", variant: "primary" },
          { key: "all", label: "全部重排（含锁定）" },
        ],
        { keep: { keepLocked: true }, all: { keepLocked: false } }
      );
    }
    return rebuildClientSchedule({ client, keepLocked: args.keepLocked !== false });
  },
  set_client_publish_schedule: (args) => {
    const client = findClientByName(args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    const count = state.videoItems.filter((video) => video.clientId === client.id && video.status === "待发布" && isVideoReadyForPublish(state, video)).length;
    const preview = Array.isArray(args.dates) && args.dates.length ? args.dates.join("、") : `从 ${args.startDate || "指定日期"} 开始`;
    if (!args.__confirmed) {
      return confirmPrompt(`要把「${client.name}」的 ${count} 条待发布整体改成：${preview}？`, [
        { key: "ok", label: "确认重排", variant: "primary" },
      ]);
    }
    return setClientPublishSchedule({ client, startDate: args.startDate || "", dates: args.dates });
  },
  update_shoot_topics: (args) => {
    const client = args.client ? findClientByName(args.client) : null;
    const items = Array.isArray(args.items)
      ? args.items.map((it, i) => ({
          index: Number(it.index ?? i + 1),
          topic: String(it.topic || "").trim(),
          contentType: String(it.contentType || "").trim(),
        })).filter((it) => it.topic)
      : [];
    return applyTopicUpdates({ client, items });
  },
  rename_video: (args) => {
    const client = args.client ? findClientByName(args.client) : null;
    return renameVideo({ client, oldTopicHint: String(args.oldTopicHint || "").trim(), newTopic: String(args.newTopic || "").trim(), videoId: args.videoId });
  },
  retype_video: (args) => {
    const client = args.client ? findClientByName(args.client) : null;
    return retypeVideo({ client, topicHint: String(args.topicHint || "").trim(), contentType: String(args.contentType || "").trim(), videoId: args.videoId });
  },
  delete_video: (args) => {
    const client = args.client ? findClientByName(args.client) : null;
    const matches = resolveVideoTargets(client, String(args.topicHint || "").trim(), args.videoId);
    if (matches.length > 1) return ambiguousVideos(matches, String(args.topicHint || "").trim());
    if (!matches.length) return { ok: false, message: `没找到含 ${args.topicHint || ""} 的视频。` };
    if (!args.__confirmed) {
      return confirmPrompt(`确定删除「${matches[0].topic}」？对应发布排期也会删除。`, [
        { key: "ok", label: "删除素材", variant: "danger" },
      ], { ok: { videoId: matches[0].id } });
    }
    return deleteVideoViaCommand({ client, topicHint: String(args.topicHint || "").trim(), videoId: args.videoId });
  },
  mark_published: (args) => {
    const client = args.client ? findClientByName(args.client) : null;
    return markPublished({ client, topicHint: String(args.topicHint || "").trim(), videoId: args.videoId });
  },
  move_publish: (args) => {
    const client = findClientByName(args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return movePublish({ client, topicHint: args.topicHint || "", targetDate: args.targetDate, videoId: args.videoId });
  },
  cancel_publish: (args) => {
    const client = findClientByName(args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return cancelPublish({ client, topicHint: args.topicHint || "", date: args.date || "", videoId: args.videoId });
  },
  reschedule_time: (args) => {
    const client = args.client ? findClientByName(args.client) : null;
    return rescheduleTime({ client, topicHint: args.topicHint, targetTime: args.targetTime, videoId: args.videoId });
  },
  shift_day: (args) => {
    const client = args.client ? findClientByName(args.client) : null;
    return shiftDay({ sourceDate: args.sourceDate, days: Number(args.days || 1), client });
  },
  skip_day: (args) => {
    const client = args.client ? findClientByName(args.client) : null;
    return skipDay({ sourceDate: args.sourceDate, client });
  },
  shift_all: (args) => {
    const client = findClientByName(args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    const today = formatDate(new Date());
    const count = state.publishSlots.filter((slot) => slot.clientId === client.id && slot.publishDate >= today).length;
    if (!args.__confirmed) {
      return confirmPrompt(`要把「${client.name}」后面 ${count} 条发布整体推 ${Number(args.days || 1)} 天？`, [
        { key: "ok", label: "确认整体顺延", variant: "primary" },
      ]);
    }
    return shiftAllForClient({ client, days: Number(args.days || 1) });
  },
  query_today: (args) => {
    const client = args.client ? findClientByName(args.client) : null;
    return queryToday({ client });
  },
  query_date: (args) => {
    const client = args.client ? findClientByName(args.client) : null;
    return queryDate({ date: args.date, client });
  },
  query_client_schedule: (args) => {
    const client = findClientByName(args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return queryClientSchedule({ client, limit: Number(args.limit || 20) });
  },
  query_stats: (args) => {
    const client = findClientByName(args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return queryStats({ client, scope: args.scope || "month" });
  },
  search_videos: (args) => {
    const client = args.client ? findClientByName(args.client) : null;
    return searchVideos({ keyword: args.keyword || "", client });
  },
  query_video_shoot: (args) => {
    const client = args.client ? findClientByName(args.client) : null;
    return queryVideoShoot({ topicHint: args.topicHint || "", client });
  },
  help: () => ({ ok: true, message: buildHelpText() }),
};

function normalizeLlmCommand(command, provider, rawText = "") {
  const intent = command?.intent || "unknown";
  if (intent === "create_client") {
    const client = normalizeClient(command.client);
    if (!client.name) {
      const spokenName = extractShootClientName(rawText);
      client.name = spokenName !== "未命名客户" ? spokenName : extractCommandClientName(command.client);
    }
    const planOnly = command.planOnly === true || command.plan_only === true || isShootPlanText(rawText);
    const items = normalizeItems(command.items, client.contentTypes);
    const fallbackItems = items.length ? items : (/拍了|拍摄|拍片|补拍/.test(rawText) ? parseItemsFromText(rawText, client.contentTypes) : []);
    return { ok: true, intent, provider, client, shootDate: (planOnly ? parseTargetDate(rawText) : null) || command.shootDate || formatDate(new Date()), items: fallbackItems, planOnly };
  }
  if (intent === "record_shoot") {
    const client = findClientByName(command.client);
    const planOnly = isShootPlanText(rawText);
    const items = normalizeShootItems(command, client?.contentTypes || [], rawText);
    const spokenName = resolveSpokenName(command, rawText);
    const shootDate = (planOnly ? parseTargetDate(rawText) : null) || command.shootDate || formatDate(new Date());
    if (!client || (spokenName && !clientNameMatches(client, spokenName) && !clientMatchesText(client, rawText))) {
      return { ok: true, intent: "resolve_client", provider, unmatchedName: spokenName, shootDate, items, planOnly };
    }
    return { ok: true, intent: planOnly ? "plan_shoot" : intent, provider, client, shootDate, items };
  }
  if (intent === "plan_shoot") {
    const client = findClientByName(command.client);
    const items = normalizeShootItems(command, client?.contentTypes || [], rawText, { requireExplicitCount: true });
    const spokenName = resolveSpokenName(command, rawText);
    if (!client || (spokenName && !clientNameMatches(client, spokenName) && !clientMatchesText(client, rawText))) {
      return { ok: true, intent: "resolve_client", provider, unmatchedName: spokenName, shootDate: command.shootDate || formatDate(new Date()), items, planOnly: true };
    }
    return { ok: true, intent, provider, client, shootDate: parseTargetDate(rawText) || command.shootDate || command.planDate || formatDate(new Date()), items };
  }
  if (intent === "move_shoot_plan") {
    const client = findClientByName(command.client);
    if (!client) return { ok: false, message: "我没找到这个客户。" };
    return { ok: true, intent, provider, client, targetDate: command.targetDate || command.target_date || command.shootDate || command.shoot_date || parseTargetDate(rawText) };
  }
  if (intent === "cancel_shoot_plan") {
    const client = findClientByName(command.client);
    if (!client) return { ok: false, message: "我没找到这个客户。" };
    return { ok: true, intent, provider, client };
  }
  if (intent === "delete_shoot_session") {
    const client = findClientByName(command.client);
    const shootDate = (command.shootDate || command.shoot_date || command.date || "").trim();
    const sessionId = (command.sessionId || command.session_id || "").trim();
    if (!client && !sessionId) return { ok: false, message: "删哪个客户的拍摄记录我没听清。" };
    if (!shootDate && !sessionId) return { ok: false, message: "删哪天的拍摄记录？" };
    return { ok: true, intent, provider, client, shootDate, sessionId, allOnDate: command.allOnDate === true || command.all_on_date === true };
  }
  if (intent === "dedupe_client_data") {
    const client = findClientByName(command.client);
    if (!client) return { ok: false, message: "我没找到这个客户。" };
    return { ok: true, intent, provider, client };
  }
  if (intent === "rebuild_client_schedule") {
    const client = findClientByName(command.client);
    if (!client) return { ok: false, message: "我没找到这个客户。" };
    return { ok: true, intent, provider, client, keepLocked: command.keepLocked !== false && command.keep_locked !== false };
  }
  if (intent === "move_publish") {
    const client = findClientByName(command.client);
    if (!client) return { ok: false, message: "我没找到这个客户。" };
    return { ok: true, intent, provider, client, topicHint: command.topicHint || command.topic_hint || "", targetDate: command.targetDate || command.target_date };
  }
  if (intent === "cancel_publish") {
    const client = findClientByName(command.client);
    if (!client) return { ok: false, message: "我没找到这个客户。" };
    return { ok: true, intent, provider, client, topicHint: command.topicHint || command.topic_hint || "" };
  }
  if (intent === "update_shoot_topics") {
    const client = findClientByName(command.client);
    const items = Array.isArray(command.items) ? command.items : [];
    const normalized = items
      .map((it, idx) => ({
        index: Number(it.index ?? it.idx ?? idx + 1),
        topic: (it.topic || it.title || "").trim(),
        contentType: (it.contentType || it.content_type || it.type || "").trim(),
      }))
      .filter((it) => it.topic);
    return { ok: true, intent, provider, client, items: normalized };
  }
  if (intent === "rename_video") {
    const client = findClientByName(command.client);
    const oldTopicHint = (command.oldTopicHint || command.old_topic_hint || command.topicHint || command.from || "").trim();
    const newTopic = (command.newTopic || command.new_topic || command.to || "").trim();
    if (!oldTopicHint || !newTopic) return { ok: false, message: "你要改的视频/新简称我没听清。" };
    return { ok: true, intent, provider, client, oldTopicHint, newTopic };
  }
  if (intent === "rename_client") {
    const client = findClientByName(command.client);
    const newName = (command.newName || command.new_name || command.to || "").trim();
    if (!client) return { ok: false, message: "我没找到这个客户。" };
    if (!newName) return { ok: false, message: "新名字我没听清。" };
    return { ok: true, intent, provider, client, newName };
  }
  if (intent === "add_client_alias" || intent === "remove_client_alias") {
    const client = findClientByName(command.client);
    const alias = (command.alias || command.aliasName || "").trim();
    if (!client) return { ok: false, message: "我没找到这个客户。" };
    if (!alias) return { ok: false, message: "别名我没听清。" };
    return { ok: true, intent, provider, client, alias };
  }
  if (intent === "update_client_settings") {
    const client = findClientByName(command.client);
    if (!client) return { ok: false, message: "我没找到这个客户。" };
    const days = Number(command.publishIntervalDays || command.publish_interval_days || 0);
    const time = (command.defaultPublishTime || command.default_publish_time || "").trim();
    if (!days && !time) return { ok: false, message: "你要改什么我没听清。" };
    return { ok: true, intent, provider, client, publishIntervalDays: days || null, defaultPublishTime: time || null };
  }
  if (intent === "update_client_types") {
    const client = findClientByName(command.client);
    if (!client) return { ok: false, message: "我没找到这个客户。" };
    const types = Array.isArray(command.contentTypes || command.content_types)
      ? (command.contentTypes || command.content_types).map((t) => String(t).trim()).filter(Boolean)
      : [];
    if (!types.length) return { ok: false, message: "新的内容类型我没听清。" };
    return { ok: true, intent, provider, client, contentTypes: types };
  }
  if (intent === "delete_client") {
    const client = findClientByName(command.client);
    if (!client) return { ok: false, message: "我没找到这个客户。" };
    return { ok: true, intent, provider, client };
  }
  if (intent === "bind_account") {
    const client = findClientByName(command.client);
    if (!client) return { ok: false, message: "我没找到这个客户。" };
    const platform = (command.platform || "").trim().toLowerCase();
    const identifier = (command.identifier || command.url || "").trim();
    if (!["douyin", "xhs", "channels"].includes(platform)) return { ok: false, message: "平台我没听清。" };
    if (!identifier) return { ok: false, message: "账号链接/号码我没听清。" };
    return { ok: true, intent, provider, client, platform, identifier };
  }
  if (intent === "append_to_shoot") {
    const client = findClientByName(command.client);
    const count = Math.max(1, Math.min(Number(command.count || command.shootCount || 1), 20));
    const contentType = (command.contentType || command.content_type || "").trim();
    return { ok: true, intent, provider, client, count, contentType };
  }
  if (intent === "retype_video") {
    const client = findClientByName(command.client);
    const topicHint = (command.topicHint || command.topic_hint || "").trim();
    const contentType = (command.contentType || command.content_type || "").trim();
    if (!topicHint || !contentType) return { ok: false, message: "视频或新类型我没听清。" };
    return { ok: true, intent, provider, client, topicHint, contentType };
  }
  if (intent === "delete_video" || intent === "mark_published") {
    const client = findClientByName(command.client);
    const topicHint = (command.topicHint || command.topic_hint || "").trim();
    if (!topicHint) return { ok: false, message: "哪条视频我没听清。" };
    return { ok: true, intent, provider, client, topicHint };
  }
  if (intent === "reschedule_time") {
    const client = findClientByName(command.client);
    const topicHint = (command.topicHint || command.topic_hint || "").trim();
    const targetTime = (command.targetTime || command.target_time || command.time || "").trim();
    if (!topicHint || !targetTime) return { ok: false, message: "视频或新时间我没听清。" };
    return { ok: true, intent, provider, client, topicHint, targetTime };
  }
  if (intent === "shift_day") {
    const sourceDate = (command.sourceDate || command.source_date || command.date || "").trim();
    const days = Number(command.days || 1);
    const client = findClientByName(command.client);
    if (!sourceDate) return { ok: false, message: "哪一天我没听清。" };
    return { ok: true, intent, provider, sourceDate, days, client };
  }
  if (intent === "skip_day") {
    const sourceDate = (command.sourceDate || command.source_date || command.date || "").trim();
    const client = findClientByName(command.client);
    if (!sourceDate) return { ok: false, message: "哪一天我没听清。" };
    return { ok: true, intent, provider, sourceDate, client };
  }
  if (intent === "shift_all") {
    const client = findClientByName(command.client);
    const days = Number(command.days || 0);
    if (!client) return { ok: false, message: "我没找到这个客户。" };
    if (!days) return { ok: false, message: "推几天我没听清。" };
    return { ok: true, intent, provider, client, days };
  }
  if (intent === "query_today") {
    const client = findClientByName(command.client);
    return { ok: true, intent, provider, client };
  }
  if (intent === "query_date") {
    const date = (command.date || command.targetDate || "").trim();
    const client = findClientByName(command.client);
    if (!date) return { ok: false, message: "哪一天我没听清。" };
    return { ok: true, intent, provider, date, client };
  }
  if (intent === "query_stats") {
    const client = findClientByName(command.client);
    const scope = (command.scope || "month").trim();
    if (!client) return { ok: false, message: "我没找到这个客户。" };
    return { ok: true, intent, provider, client, scope };
  }
  if (intent === "search_videos") {
    const keyword = (command.keyword || command.topicHint || "").trim();
    const client = findClientByName(command.client);
    if (!keyword) return { ok: false, message: "关键词我没听清。" };
    return { ok: true, intent, provider, keyword, client };
  }
  if (intent === "query_video_shoot") {
    const topicHint = (command.topicHint || command.topic_hint || command.keyword || "").trim();
    const client = findClientByName(command.client);
    if (!topicHint) return { ok: false, message: "哪条视频我没听清。" };
    return { ok: true, intent, provider, topicHint, client };
  }
  if (intent === "update_shoot_count") {
    const client = findClientByName(command.client);
    const newCount = Math.max(0, Math.min(Number(command.newCount || command.new_count || command.shootCount || 0), 20));
    const shootDate = (command.shootDate || command.shoot_date || "").trim();
    const sessionId = (command.sessionId || command.session_id || "").trim();
    if (!client && !sessionId) return { ok: false, message: "改哪个客户的拍摄我没听清。" };
    if (!newCount) return { ok: false, message: "新的条数我没听清。" };
    return { ok: true, intent, provider, client, newCount, shootDate, sessionId };
  }
  if (intent === "help") {
    return { ok: true, intent, provider };
  }
  return { ok: false, message: "这句我还不会办。" };
}

function parseCommand(text) {
  if (/新增|新客户|加一个客户|加客户/.test(text)) return parseCreateClient(text);
  if (/重复|去重|排重|越排越多/.test(text)) return parseDedupeClient(text);
  if (/重排|重新排|修改排期|穿插着发/.test(text)) return parseRebuildSchedule(text);
  if (/拍摄记录|拍摄/.test(text) && /删除|删掉|删/.test(text)) return parseDeleteShootSession(text);
  if (/拍摄计划|计划拍摄|拍片计划/.test(text) && /挪到|移动到|改到|调到/.test(text)) return parseMoveShootPlan(text);
  if (/拍摄计划|计划拍摄|拍片计划/.test(text) && /取消|删掉|不拍/.test(text)) return parseCancelShootPlan(text);
  if (/挪到|移动到|改到|调到/.test(text)) return parseMovePublish(text);
  if (/取消|删掉|不发/.test(text)) return parseCancelPublish(text);
  if (isShootPlanText(text)) return parsePlanShoot(text);
  if (/拍了|拍摄|拍完|拍好|完成拍摄|录入/.test(text)) return parseRecordShoot(text);
  return { ok: false, message: "我还没听懂，换个说法试试。" };
}

function parseDedupeClient(text) {
  const client = findMentionedClient(text);
  if (!client) return { ok: false, message: "我没找到这个客户。" };
  return { ok: true, intent: "dedupe_client_data", client };
}

function parseRebuildSchedule(text) {
  const client = findMentionedClient(text);
  if (!client) return { ok: false, message: "我没找到这个客户。" };
  return { ok: true, intent: "rebuild_client_schedule", client, keepLocked: !/全部|锁住|彻底|重新/.test(text) };
}

function parseDeleteShootSession(text) {
  const client = findMentionedClient(text);
  if (!client) return { ok: false, message: "我没找到这个客户。" };
  const shootDate = parseTargetDate(text) || parseDateWord(text);
  if (!shootDate) return { ok: false, message: "删哪天的拍摄记录？" };
  return { ok: true, intent: "delete_shoot_session", client, shootDate, allOnDate: /所有|全部|当天/.test(text) };
}

function parseCreateClient(text) {
  const name = matchOne(text, /叫([^，。,.\s]+?)(?:，|,|。|每天|每|$)/) || matchOne(text, /客户([^，。,.\s]+?)(?:，|,|。|每天|每|$)/);
  if (!name) return { ok: false, message: "客户名我没听出来。" };
  const client = {
    name,
    publishIntervalDays: /两天|2\s*天|每 2 天/.test(text) ? 2 : /三天|3\s*天/.test(text) ? 3 : 1,
    defaultPublishTime: parseTime(text) || "17:00",
    contentTypes: splitTypes(matchOne(text, /主要(?:发|做)?([^。]+?)(?:默认|今天|拍了|$)/) || ""),
  };
  const planOnly = isShootPlanText(text);
  return { ok: true, intent: "create_client", client, shootDate: parseTargetDate(text) || parseDateWord(text), items: /拍了|拍摄|拍片|补拍/.test(text) ? parseItemsFromText(text, client.contentTypes) : [], planOnly };
}

function parseRecordShoot(text) {
  const client = findMentionedClient(text);
  const items = parseItemsFromText(text, client?.contentTypes || []);
  if (!client) return { ok: true, intent: "resolve_client", provider: "本地规则", unmatchedName: extractShootClientName(text), shootDate: parseDateWord(text), items };
  return { ok: true, intent: "record_shoot", client, shootDate: parseDateWord(text), items };
}

function parsePlanShoot(text) {
  const client = findMentionedClient(text);
  const items = parseItemsFromText(text, client?.contentTypes || []);
  const shootDate = parseTargetDate(text) || parseDateWord(text);
  if (!client) return { ok: true, intent: "resolve_client", provider: "本地规则", unmatchedName: extractShootClientName(text), shootDate, items, planOnly: true };
  return { ok: true, intent: "plan_shoot", client, shootDate, items };
}

function parseMoveShootPlan(text) {
  const client = findMentionedClient(text);
  if (!client) return { ok: false, message: "我没找到这个客户。" };
  const targetDate = parseTargetDate(text);
  if (!targetDate) return { ok: false, message: "日期我没听清。" };
  return { ok: true, intent: "move_shoot_plan", client, targetDate };
}

function parseCancelShootPlan(text) {
  const client = findMentionedClient(text);
  if (!client) return { ok: false, message: "我没找到这个客户。" };
  return { ok: true, intent: "cancel_shoot_plan", client };
}

function parseMovePublish(text) {
  const client = findMentionedClient(text);
  if (!client) return { ok: false, message: "我没找到这个客户。" };
  const targetDate = parseTargetDate(text);
  if (!targetDate) return { ok: false, message: "日期我没听清。" };
  return { ok: true, intent: "move_publish", client, topicHint: extractTopicHint(text, client), targetDate };
}

function parseCancelPublish(text) {
  const client = findMentionedClient(text);
  if (!client) return { ok: false, message: "我没找到这个客户。" };
  return { ok: true, intent: "cancel_publish", client, topicHint: extractTopicHint(text, client) };
}

function handleClientFormSubmit(event) {
  event.preventDefault();
  if (!requireEdit()) return;
  const form = event.currentTarget;
  const douyinUrl = form.querySelector("#clientDouyinUrl")?.value.trim() || "";
  const xhsUrl = form.querySelector("#clientXhsUrl")?.value.trim() || "";
  const channelsName = form.querySelector("#clientChannelsName")?.value.trim() || "";
  const client = createClient({
    name: form.querySelector("#clientName")?.value.trim(),
    publishIntervalDays: Number(form.querySelector("#clientInterval")?.value || 1),
    defaultPublishTime: form.querySelector("#clientTime")?.value || "17:00",
    contentTypes: splitTypes(form.querySelector("#clientTypes")?.value || ""),
  });
  if (!client) return;
  form.reset();
  const timeInput = form.querySelector("#clientTime");
  const typesInput = form.querySelector("#clientTypes");
  if (timeInput) timeInput.value = "17:00";
  if (typesInput) typesInput.value = "案例、干货、老板IP、日常";
  selectedManageClientId = client.id;
  const platforms = [];
  if (douyinUrl) {
    fetchAccount(client.id, "douyin", normalizePlatformInput("douyin", douyinUrl));
    platforms.push("抖音");
  }
  if (xhsUrl) { fetchAccount(client.id, "xhs", normalizePlatformInput("xhs", xhsUrl)); platforms.push("小红书"); }
  if (channelsName) { fetchAccount(client.id, "channels", { search: channelsName }); platforms.push("视频号"); }
  setResult(platforms.length ? `客户加好了，我去抓${platforms.join("/")}。` : "客户加好了。", "success");
}

function saveManagedClient(clientId) {
  if (!requireEdit()) return;
  const card = document.querySelector(`[data-manage-client="${CSS.escape(clientId)}"]`);
  const client = findClient(clientId);
  if (!card || !client) return;
  const name = card.querySelector('[data-client-edit-field="name"]')?.value.trim();
  const interval = Number(card.querySelector('[data-client-edit-field="interval"]')?.value || client.publishIntervalDays);
  const time = card.querySelector('[data-client-edit-field="time"]')?.value || client.defaultPublishTime;
  const types = splitTypes(card.querySelector('[data-client-edit-field="types"]')?.value || "");
  if (!name) {
    setResult("客户名得留着。", "warning");
    return;
  }
  client.name = name;
  client.publishIntervalDays = Math.max(1, interval || 1);
  client.defaultPublishTime = time;
  client.contentTypes = types.length ? types : client.contentTypes;
  persist();
  const platforms = fetchAccountsFromCard(client, card);
  if (editingProfileClientId === clientId) editingProfileClientId = "";
  setResult(platforms.length ? `${client.name} 改好了，我去找${platforms.join("/")}。` : `${client.name} 改好了。`, "success");
  render();
}

function deleteManagedClient(clientId) {
  if (!requireEdit()) return;
  const client = findClient(clientId);
  if (!client) return;
  if (!window.confirm(`删除 ${client.name}？相关日程和素材也会移除。`)) return;
  const clientVideoIds = new Set(state.videoItems.filter((video) => video.clientId === clientId).map((video) => video.id));
  state.clients = state.clients.filter((item) => item.id !== clientId);
  state.shootSessions = state.shootSessions.filter((session) => session.clientId !== clientId);
  state.videoItems = state.videoItems.filter((video) => video.clientId !== clientId);
  state.publishSlots = state.publishSlots.filter((slot) => slot.clientId !== clientId && !clientVideoIds.has(slot.videoItemId));
  pendingConfirms = pendingConfirms.filter((entry) => entry.clientId !== clientId);
  selectedManageClientId = "";
  selectedClientId = selectedClientId === clientId ? null : selectedClientId;
  persist();
  setResult(`${client.name} 删掉了。`, "success");
  render();
}

function createClient({ name, publishIntervalDays, defaultPublishTime, contentTypes, needsProfileTodo = false }) {
  if (!canEditOrg()) return null;
  const cleanName = name || `新客户 ${state.clients.length + 1}`;
  const existing = findClientByName(cleanName);
  if (existing) {
    if (needsProfileTodo) existing.needsProfileTodo = true;
    return existing;
  }
  const client = makeClient(
    cleanName,
    publishIntervalDays || 1,
    defaultPublishTime || "17:00",
    contentTypes?.length ? contentTypes : ["日常"],
  );
  client.needsProfileTodo = Boolean(needsProfileTodo);
  state.clients.push(client);
  render();
  return client;
}

function saveProfileTodo(button) {
  if (!canEditOrg()) return;
  const card = button.closest("[data-profile-todo]");
  const client = findClient(button.dataset.profileTodoSave);
  if (!card || !client) return;
  const platforms = fetchAccountsFromCard(client, card);
  if (!platforms.length) {
    setResult(`先给 ${client.name} 填个账号。`, "warning");
    return;
  }
  if (editingProfileClientId === client.id) editingProfileClientId = "";
  setResult(`我去找 ${client.name} 的${platforms.join("/")}。`, "success");
  render();
}

function fetchAccountsFromCard(client, card) {
  const douyinInput = card.querySelector('[data-profile-field="douyin"]')?.value.trim() || "";
  const channelsName = card.querySelector('[data-profile-field="channels"]')?.value.trim() || "";
  const xhsUrl = card.querySelector('[data-profile-field="xhs"]')?.value.trim() || "";
  const douyin = getAccount(client, "douyin");
  const channels = getAccount(client, "channels");
  const xhs = getAccount(client, "xhs");
  const douyinPrefilled = douyin?.uniqueId || douyin?.nickname || douyin?.identifier || "";
  const channelsPrefilled = channels?.nickname || channels?.userName || "";
  const xhsPrefilled = xhs?.identifier || "";
  const platforms = [];
  if (douyinInput && !(douyin && douyinInput === douyinPrefilled)) {
    const normalized = normalizePlatformInput("douyin", douyinInput);
    fetchAccount(client.id, "douyin", normalized);
    platforms.push("抖音");
  }
  if (channelsName && !(channels && channelsName === channelsPrefilled)) {
    fetchAccount(client.id, "channels", { search: channelsName });
    platforms.push("视频号");
  }
  if (xhsUrl && !(xhs && xhsUrl === xhsPrefilled)) {
    fetchAccount(client.id, "xhs", normalizePlatformInput("xhs", xhsUrl));
    platforms.push("小红书");
  }
  return platforms;
}

function showDouyinPrompt(client) {
  pendingFrequencyClientId = client?.id || "";
  clearResultTimer();
  els.commandResult.className = "command-result success";
  els.commandResult.innerHTML = `
    <div class="douyin-prompt" data-douyin-prompt="${client.id}">
      <div>
        <strong>顺手绑抖音？</strong>
        <span class="muted-text">给我主页链接或抖音号。</span>
      </div>
      <div class="douyin-prompt-row">
        <input data-douyin-prompt-input placeholder="主页链接最稳，抖音号也行" autocomplete="off" />
        <button class="primary-button" type="button" data-douyin-prompt-search="${client.id}">我来找</button>
      </div>
      <button class="text-button" type="button" data-douyin-prompt-skip="${client.id}">先跳过</button>
    </div>
  `;
}

function showFrequencyPrompt(client) {
  if (!client) return;
  pendingFrequencyClientId = client.id;
  clearResultTimer();
  els.commandResult.className = "command-result success";
  els.commandResult.innerHTML = `
    <div class="douyin-prompt frequency-prompt" data-frequency-prompt="${client.id}">
      <div>
        <strong>多久发一条？</strong>
        <span class="muted-text">我先按 1 天 1 条排，你点一下就改。</span>
      </div>
      <div class="frequency-prompt-row">
        <button class="text-button${client.publishIntervalDays === 1 ? " active" : ""}" type="button" data-frequency-pick="${client.id}" data-days="1">每天</button>
        <button class="text-button${client.publishIntervalDays === 2 ? " active" : ""}" type="button" data-frequency-pick="${client.id}" data-days="2">2 天</button>
        <button class="text-button${client.publishIntervalDays === 3 ? " active" : ""}" type="button" data-frequency-pick="${client.id}" data-days="3">3 天</button>
      </div>
    </div>
  `;
}

function searchPromptDouyin(button) {
  if (!canEditOrg()) return;
  const card = button.closest("[data-douyin-prompt]");
  const client = findClient(button.dataset.douyinPromptSearch);
  const keyword = card?.querySelector("[data-douyin-prompt-input]")?.value.trim() || "";
  if (!client || !keyword) {
    setResult("先给我主页链接或抖音号。", "warning");
    return;
  }
  fetchAccount(client.id, "douyin", normalizePlatformInput("douyin", keyword));
  showFrequencyPrompt(client);
}

function setClientFrequency(clientId, days) {
  const client = findClient(clientId);
  if (!client) return;
  client.publishIntervalDays = Math.max(1, days || 1);
  rebuildClientSchedule({ client, keepLocked: false });
  persist();
  pendingFrequencyClientId = "";
  setResult("", "");
  render();
}

function rescheduleClient(clientId) {
  const client = findClient(clientId);
  if (client) rebuildClientSchedule({ client, keepLocked: true });
}

async function fetchAccount(clientId, platform, { url, search, identifier, viaChat } = {}) {
  if (!canEditOrg()) return;
  const pid = ++pendingId;
  pendingConfirms.push({ pid, clientId, platform, loading: true });
  render();
  try {
    const params = new URLSearchParams({ platform });
    if (url) params.set("url", url);
    if (search) params.set("search", search);
    if (identifier) params.set("identifier", identifier);
    const response = await fetch(`/api/profile?${params.toString()}`);
    const data = await response.json();
    const entry = pendingConfirms.find((p) => p.pid === pid);
    if (!entry) return;
    if (!data.ok) {
      entry.loading = false;
      entry.error = data.error || "未知错误";
    } else if (data.candidates && viaChat) {
      // #7 从对话里绑号搜到多个账号 → 候选用聊天气泡呈现，不出卡片
      pendingConfirms = pendingConfirms.filter((p) => p.pid !== pid);
      if (data.candidates.length) {
        pendingActionPrompt = {
          kind: "account-candidates",
          clientId,
          platform,
          clientName: findClient(clientId)?.name || "",
          candidates: data.candidates,
        };
        chatExpanded = true;
        chatManuallyCollapsed = false;
      } else {
        pushAssistant(`没搜到${PLATFORM_META[platform]?.name || platform}账号，发个主页链接或账号给我吧。`);
      }
    } else if (data.candidates) {
      entry.loading = false;
      entry.candidates = data.candidates;
    } else {
      entry.loading = false;
      entry.account = sanitizeAccount(data);
    }
    render();
  } catch (error) {
    const entry = pendingConfirms.find((p) => p.pid === pid);
    if (entry) { entry.loading = false; entry.error = error.message; }
    render();
  }
}

function sanitizeAccount(data) {
  return {
    id: uid("acct"),
    platform: data.platform,
    identifier: data.identifier || "",
    secUserId: data.secUserId || "",
    userId: data.userId || "",
    userName: data.userName || "",
    nickname: data.nickname || "",
    uniqueId: data.uniqueId || "",
    signature: data.signature || "",
    avatarSmall: data.avatarSmall || "",
    avatarLarge: data.avatarLarge || "",
    followerCount: data.followerCount || 0,
    postCount: data.postCount || 0,
    totalFavorited: data.totalFavorited || 0,
  };
}

function confirmPending(pid) {
  if (!canEditOrg()) return;
  const idx = pendingConfirms.findIndex((p) => p.pid === pid);
  if (idx < 0) return;
  const entry = pendingConfirms[idx];
  const client = findClient(entry.clientId);
  if (client && entry.account) {
    const existing = client.accounts.findIndex((a) => a.platform === entry.account.platform);
    if (existing >= 0) client.accounts[existing] = entry.account;
    else client.accounts.push(entry.account);
    client.needsProfileTodo = false;
    applyAccountAliases(client, entry.account);
    persist();
  }
  pendingConfirms.splice(idx, 1);
  if (pendingFrequencyClientId && client?.id === pendingFrequencyClientId) showFrequencyPrompt(client);
  else setResult("", "");
  render();
}

function cancelPending(pid) {
  if (!canEditOrg()) return;
  const idx = pendingConfirms.findIndex((p) => p.pid === pid);
  if (idx < 0) return;
  const client = findClient(pendingConfirms[idx].clientId);
  pendingConfirms.splice(idx, 1);
  if (pendingFrequencyClientId && client?.id === pendingFrequencyClientId) showFrequencyPrompt(client);
  else setResult("", "");
  render();
}

function pickAccountCandidate(pid, identifier) {
  if (!canEditOrg()) return;
  const entry = pendingConfirms.find((p) => p.pid === pid);
  if (!entry || !identifier) return;
  entry.candidates = null;
  entry.loading = true;
  render();
  fetch(`/api/profile?platform=${encodeURIComponent(entry.platform)}&identifier=${encodeURIComponent(identifier)}`)
    .then((r) => r.json())
    .then((data) => {
      const e = pendingConfirms.find((p) => p.pid === pid);
      if (!e) return;
      e.loading = false;
      if (data.ok) e.account = sanitizeAccount(data);
      else e.error = data.error || "拉取失败";
      render();
    });
}

function normalizeShootItemList(client, shootDate, items = []) {
  const fallbackType = client?.contentTypes?.[0] || "日常";
  return (Array.isArray(items) ? items : [])
    .map((item, index) => {
      const contentType = item.contentType || item.content_type || item.type || fallbackType;
      return {
        topic: String(item.topic || item.title || item.summary || "").trim() || fallbackShootTopic(shootDate, contentType, index),
        contentType,
        shootPeriod: item.shootPeriod || item.shoot_period || item.period || "",
      };
    })
    .filter((item) => item.topic);
}

function shootDuplicateKey(shootDate, items = []) {
  const types = items.map((item) => item.contentType || "").join("|");
  return `${shootDate}|${items.length}|${types}`;
}

function findDuplicateShootSession(clientId, shootDate, items = []) {
  const key = shootDuplicateKey(shootDate, items);
  return state.shootSessions
    .filter((session) => session.clientId === clientId && session.shootDate === shootDate && session.status === "completed")
    .find((session) => {
      const sessionItems = Array.isArray(session.items) && session.items.length
        ? session.items
        : state.videoItems.filter((video) => video.shootSessionId === session.id);
      return shootDuplicateKey(session.shootDate, sessionItems) === key;
    }) || null;
}

function sessionQualityScore(targetState, session) {
  const sessionItems = Array.isArray(session.items) && session.items.length
    ? session.items
    : targetState.videoItems.filter((video) => video.shootSessionId === session.id);
  return sessionItems.reduce((score, item) => {
    const topic = String(item.topic || "").trim();
    if (!topic) return score - 2;
    return score + (isPlaceholderTopic(topic) ? 1 : 3);
  }, 0);
}

function recordShoot({ client, shootDate, items }) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  if (!client || !items?.length) return { ok: false, message: "客户或内容我没听全。" };
  const normalizedItems = normalizeShootItemList(client, shootDate, items);
  const matchedPlan = findMatchingShootPlan(client.id, shootDate);
  if (matchedPlan) return completeShootPlan(matchedPlan.id, normalizedItems);
  const duplicate = findDuplicateShootSession(client.id, shootDate, normalizedItems);
  if (duplicate) {
    lastShootSessionId = duplicate.id;
    return { ok: true, message: `${client.name} ${shootDate} 已经有 ${normalizedItems.length} 条拍摄记录了，我没重复新增。` };
  }
  const session = {
    id: uid("shoot"),
    clientId: client.id,
    shootDate,
    shootPeriod: inferShootPeriod(normalizedItems),
    shootCount: normalizedItems.length,
    status: "completed",
    planned: false,
    items: normalizedItems,
    summary: normalizedItems.map((item) => item.topic).join("、"),
    note: "",
    createdAt: new Date().toISOString(),
  };
  state.shootSessions.push(session);
  for (const item of normalizedItems) {
    state.videoItems.push({
      id: uid("video"),
      clientId: client.id,
      shootSessionId: session.id,
      topic: item.topic,
      contentType: item.contentType,
      status: "待发布",
      createdAt: new Date().toISOString(),
    });
  }
  if (shootDate < formatDate(new Date())) rebuildClientSchedule({ client, keepLocked: false });
  autoScheduleClient(state, client.id);
  anchorDate = parseDate(shootDate);
  lastShootSessionId = session.id;
  return { ok: true, message: `${client.name} 拍摄记好了，排期也给你排上。` };
}

function planShoot({ client, shootDate, items }) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  if (!client) return { ok: false, message: "我没找到这个客户。" };
  const useDate = shootDate || formatDate(new Date());
  const plannedItems = normalizeShootItemList(client, useDate, ensurePlannedShootItems(items, client.contentTypes, useDate));
  const session = {
    id: uid("shoot"),
    clientId: client.id,
    shootDate: useDate,
    shootPeriod: inferShootPeriod(plannedItems),
    shootCount: plannedItems.length,
    status: "planned",
    planned: true,
    items: plannedItems,
    summary: plannedItems.map((item) => item.topic).join("、"),
    note: "",
    createdAt: new Date().toISOString(),
  };
  state.shootSessions.push(session);
  anchorDate = parseDate(session.shootDate);
  selectedScheduleDate = null;
  lastShootSessionId = session.id;
  return { ok: true, message: `${client.name} 的拍摄我排到 ${session.shootDate} 了。` };
}

function completeShootPlan(sessionId, overrideItems = null) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  const session = findShootSession(sessionId);
  if (!session || !isPlannedShoot(session)) return { ok: false, message: "我没找到这条拍摄计划。" };
  const client = findClient(session.clientId);
  if (!client) return { ok: false, message: "客户不见了。" };
  const items = ensurePlannedShootItems(overrideItems?.length ? overrideItems : session.items, client.contentTypes, session.shootDate);
  session.status = "completed";
  session.planned = false;
  session.completedAt = new Date().toISOString();
  session.items = items;
  session.shootCount = items.length;
  session.shootPeriod = inferShootPeriod(items);
  session.summary = items.map((item) => item.topic).join("、");
  const existingVideo = state.videoItems.some((video) => video.shootSessionId === session.id);
  if (!existingVideo) {
    for (const item of items) {
      state.videoItems.push({
        id: uid("video"),
        clientId: client.id,
        shootSessionId: session.id,
        topic: item.topic,
        contentType: item.contentType,
        status: "待发布",
        createdAt: new Date().toISOString(),
      });
    }
  }
  autoScheduleClient(state, client.id);
  anchorDate = parseDate(session.shootDate);
  lastShootSessionId = session.id;
  return { ok: true, message: `${client.name} 拍完了，我已生成素材并排期。` };
}

// 用提炼出的主题覆盖最近一次拍摄会话里 placeholder 占位的视频 topic
function applyTopicUpdates({ client, items }) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  if (!items?.length) return { ok: false, message: "我没读出文案对应的主题。" };
  let session = null;
  if (client) {
    const sessions = state.shootSessions
      .filter((s) => s.clientId === client.id)
      .sort((a, b) => (b.completedAt || b.createdAt || "").localeCompare(a.completedAt || a.createdAt || ""));
    session = sessions[0] || null;
  }
  if (!session && lastShootSessionId) session = findShootSession(lastShootSessionId);
  if (!session) return { ok: false, message: "我不知道这些文案对应哪次拍摄，先告诉我客户。" };
  const targetClient = findClient(session.clientId);
  const videos = state.videoItems
    .filter((v) => v.shootSessionId === session.id)
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  if (!videos.length) return { ok: false, message: "这次拍摄还没生成素材。" };
  const taken = new Set(
    state.videoItems
      .filter((v) => v.shootSessionId !== session.id && v.topic && !isPlaceholderTopic(v.topic))
      .map((v) => v.topic),
  );
  let updated = 0;
  for (const item of items) {
    const idx = (item.index || 1) - 1;
    const video = videos[idx];
    if (!video) continue;
    if (isPlaceholderTopic(video.topic) || !video.topic) {
      video.topic = makeUniqueTopic(item.topic, taken);
      taken.add(video.topic);
      if (item.contentType) video.contentType = item.contentType;
      updated += 1;
    }
    if (session.items?.[idx] && (isPlaceholderTopic(session.items[idx].topic) || !session.items[idx].topic)) {
      session.items[idx].topic = video.topic;
      if (item.contentType) session.items[idx].contentType = item.contentType;
    }
  }
  if (session.items) session.summary = session.items.map((it) => it.topic).join("、");
  persist();
  if (!updated) return { ok: true, message: `这次的文案主题我都已经识别过了，没新东西要改。` };
  return { ok: true, message: `${targetClient?.name || "客户"} ${updated} 条文案主题写好了。` };
}

// 限定 6 字以内 + 去重：如果撞名，加 2/3/... 后缀
function makeUniqueTopic(rawTopic, takenSet) {
  const base = trimToMaxChars(rawTopic, 6);
  if (!takenSet.has(base)) return base;
  for (let suffix = 2; suffix < 20; suffix += 1) {
    const candidate = trimToMaxChars(base, 6 - String(suffix).length) + suffix;
    if (!takenSet.has(candidate)) return candidate;
  }
  return base + Date.now().toString().slice(-2);
}

function trimToMaxChars(str, max) {
  const arr = Array.from(String(str || "").trim());
  return arr.slice(0, max).join("");
}

// ============ 客户类自然语言指令 ============

function renameClient({ client, newName }) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  const trimmed = newName.trim();
  if (!trimmed) return { ok: false, message: "新名字不能空。" };
  if (state.clients.some((c) => c.id !== client.id && c.name === trimmed)) {
    return { ok: false, message: `已经有个客户叫 ${trimmed} 了。` };
  }
  const oldName = client.name;
  client.name = trimmed;
  if (oldName && oldName !== trimmed) addAliasToClient(client, oldName);
  persist();
  return { ok: true, message: `${oldName} 改名为 ${trimmed}。` };
}

function addClientAliasViaCommand({ client, alias }) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  if (!alias) return { ok: false, message: "别名我没听清。" };
  if (alias === client.name) return { ok: false, message: "别名跟正名一样，不用加。" };
  if ((client.aliases || []).includes(alias)) return { ok: true, message: `${client.name} 已经有 ${alias} 这个别名了。` };
  addAliasToClient(client, alias);
  persist();
  return { ok: true, message: `${client.name} 加了别名 ${alias}。` };
}

function removeClientAliasViaCommand({ client, alias }) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  if (!Array.isArray(client.aliases) || !client.aliases.includes(alias)) {
    return { ok: false, message: `${client.name} 没有 ${alias} 这个别名。` };
  }
  client.aliases = client.aliases.filter((a) => a !== alias);
  persist();
  return { ok: true, message: `${client.name} 去掉了 ${alias}。` };
}

function updateClientSettings({ client, publishIntervalDays, defaultPublishTime }) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  const changes = [];
  let reflowedCount = 0;
  if (publishIntervalDays) {
    const newInterval = Math.max(1, Math.min(Number(publishIntervalDays), 30));
    const changed = newInterval !== client.publishIntervalDays;
    client.publishIntervalDays = newInterval;
    changes.push(`每 ${client.publishIntervalDays} 天 1 条`);
    if (changed) {
      // 间隔变了 → 删掉今天之后未锁的 slot，让 autoScheduleClient 按新间隔重排
      reflowedCount = reflowFutureSlots(state, client.id);
    }
  }
  let updatedSlots = 0;
  if (defaultPublishTime && /^\d{1,2}:\d{2}$/.test(defaultPublishTime)) {
    const normalizedTime = defaultPublishTime.length === 4 ? "0" + defaultPublishTime : defaultPublishTime;
    client.defaultPublishTime = normalizedTime;
    changes.push(`默认 ${normalizedTime} 发`);
    const today = formatDate(new Date());
    // 默认时间只影响未来未锁的自动排期，避免覆盖用户手动锁定/历史日程。
    for (const slot of state.publishSlots) {
      if (slot.clientId === client.id && !slot.locked && slot.publishDate > today && slot.publishTime !== normalizedTime) {
        slot.publishTime = normalizedTime;
        updatedSlots += 1;
      }
    }
  }
  if (!changes.length) return { ok: false, message: "没看到要改的内容。" };
  autoScheduleClient(state, client.id);
  persist();
  const parts = [];
  if (reflowedCount > 0) parts.push(`${reflowedCount} 条日程按新节奏重排了`);
  if (updatedSlots > 0) parts.push(`${updatedSlots} 条发布时间跟着改了`);
  const tail = parts.length ? `，${parts.join("，")}。` : "。";
  return { ok: true, message: `${client.name} 改成${changes.join("、")}${tail}` };
}

// 删今天之后、未锁的 publishSlot，让 autoScheduleClient 按新设置重排
function reflowFutureSlots(targetState, clientId) {
  const today = formatDate(new Date());
  let removed = 0;
  const removedVideoIds = new Set();
  targetState.publishSlots = targetState.publishSlots.filter((slot) => {
    if (slot.clientId !== clientId) return true;
    if (slot.locked) return true;            // 用户手动锁的留着
    if (slot.publishDate <= today) return true; // 今天和过去的留着
    removed += 1;
    removedVideoIds.add(slot.videoItemId);
    return false;
  });
  for (const video of targetState.videoItems) {
    if (removedVideoIds.has(video.id) && video.status !== "已发布") video.status = "待发布";
  }
  return removed;
}

function removeFutureSlotsForClient(targetState, clientId, { keepLocked = true } = {}) {
  const today = formatDate(new Date());
  const removedVideoIds = new Set();
  let removed = 0;
  targetState.publishSlots = targetState.publishSlots.filter((slot) => {
    if (slot.clientId !== clientId) return true;
    if (slot.publishDate <= today) return true;
    if (keepLocked && slot.locked) return true;
    removed += 1;
    removedVideoIds.add(slot.videoItemId);
    return false;
  });
  for (const video of targetState.videoItems) {
    if (removedVideoIds.has(video.id) && video.status !== "已发布") video.status = "待发布";
  }
  return removed;
}

function rebuildClientSchedule({ client, keepLocked = true } = {}) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  if (!client) return { ok: false, message: "我没找到这个客户。" };
  const removed = removeFutureSlotsForClient(state, client.id, { keepLocked });
  autoScheduleClient(state, client.id);
  persist();
  return { ok: true, message: `${client.name} 未来排期已重排${keepLocked ? "，手动锁定的保留了" : "，包括原来锁住的也重新排了"}（清理 ${removed} 条）。` };
}

function setClientPublishSchedule({ client, startDate = "", dates = [] } = {}) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  if (!client) return { ok: false, message: "我没找到这个客户。" };
  const today = formatDate(new Date());
  const videos = orderVideosForScheduling(state, state.videoItems.filter((video) =>
    video.clientId === client.id && video.status === "待发布" && isVideoReadyForPublish(state, video)
  ));
  if (!videos.length) return { ok: false, message: `${client.name} 没有待发布素材。` };
  let targetDates = (Array.isArray(dates) ? dates : [])
    .map((date) => String(date || "").trim())
    .filter(Boolean);
  if (targetDates.length) {
    if (targetDates.length !== videos.length) {
      return { ok: false, message: `${client.name} 有 ${videos.length} 条待发布素材，但你给了 ${targetDates.length} 个日期。请补齐或减少日期。` };
    }
  } else {
    const firstDate = String(startDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDate)) return { ok: false, message: "从哪天开始发？给我一个日期。" };
    targetDates = videos.map((_, index) => formatDate(addDays(parseDate(firstDate), index * client.publishIntervalDays)));
  }
  if (targetDates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date))) return { ok: false, message: "发布日期格式没看懂。" };
  if (targetDates.some((date) => date < today)) return { ok: false, message: "指定日期里有已经过去的日期。" };
  if (new Set(targetDates).size !== targetDates.length) return { ok: false, message: "指定日期有重复，同一个客户一天只能发一条。" };

  const videoIds = new Set(videos.map((video) => video.id));
  state.publishSlots = state.publishSlots.filter((slot) => !videoIds.has(slot.videoItemId));
  state.cancelledDates = (state.cancelledDates || []).filter((entry) => !(entry.clientId === client.id && videoIds.has(entry.videoItemId)));
  videos.forEach((video, index) => {
    state.publishSlots.push({
      id: uid("slot"),
      clientId: client.id,
      videoItemId: video.id,
      publishDate: targetDates[index],
      publishTime: client.defaultPublishTime,
      status: "计划发布",
      locked: true,
      source: "ai_adjusted",
    });
  });
  persist();
  anchorDate = parseDate(targetDates[0]);
  return { ok: true, message: `${client.name} 的 ${videos.length} 条待发布已改成：${targetDates.join("、")}。` };
}

function deleteShootSession({ client, shootDate, sessionId, allOnDate = false, dryRun = false } = {}) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  let sessions = [];
  if (sessionId) {
    const session = findShootSession(sessionId);
    if (session) sessions = [session];
  } else if (client && shootDate) {
    sessions = state.shootSessions.filter((session) => session.clientId === client.id && session.shootDate === shootDate);
    if (!allOnDate && sessions.length > 1) {
      sessions = sessions.sort((a, b) => (b.completedAt || b.createdAt || "").localeCompare(a.completedAt || a.createdAt || "")).slice(0, 1);
    }
  }
  if (!sessions.length) return { ok: false, message: "没找到要删的拍摄记录。" };
  if (dryRun) return { ok: true, dryRun: true, count: sessions.length };
  const sessionIds = new Set(sessions.map((session) => session.id));
  const videoIds = new Set(state.videoItems.filter((video) => sessionIds.has(video.shootSessionId)).map((video) => video.id));
  state.shootSessions = state.shootSessions.filter((session) => !sessionIds.has(session.id));
  state.videoItems = state.videoItems.filter((video) => !videoIds.has(video.id));
  state.publishSlots = state.publishSlots.filter((slot) => !videoIds.has(slot.videoItemId));
  pendingConfirms = pendingConfirms.filter((entry) => !sessionIds.has(entry.sessionId));
  if (lastShootSessionId && sessionIds.has(lastShootSessionId)) lastShootSessionId = "";
  if (client) autoScheduleClient(state, client.id);
  persist();
  return { ok: true, message: `已删除 ${sessions.length} 条拍摄记录和对应素材/发布。` };
}

function dedupeClientData({ client } = {}) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  if (!client) return { ok: false, message: "我没找到这个客户。" };
  const keepByKey = new Map();
  const removeSessionIds = new Set();
  const sessions = state.shootSessions
    .filter((session) => session.clientId === client.id && session.status === "completed")
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  for (const session of sessions) {
    const sessionItems = Array.isArray(session.items) && session.items.length
      ? session.items
      : state.videoItems.filter((video) => video.shootSessionId === session.id);
    const key = shootDuplicateKey(session.shootDate, sessionItems);
    const keptId = keepByKey.get(key);
    if (!keptId) {
      keepByKey.set(key, session.id);
      continue;
    }
    const kept = state.shootSessions.find((item) => item.id === keptId);
    if (sessionQualityScore(state, session) > sessionQualityScore(state, kept)) {
      removeSessionIds.add(keptId);
      keepByKey.set(key, session.id);
    } else {
      removeSessionIds.add(session.id);
    }
  }
  const seenVideoSlot = new Set();
  const removeSlotIds = new Set();
  for (const slot of state.publishSlots.filter((item) => item.clientId === client.id)) {
    if (seenVideoSlot.has(slot.videoItemId)) removeSlotIds.add(slot.id);
    else seenVideoSlot.add(slot.videoItemId);
  }
  const removeVideoIds = new Set(state.videoItems.filter((video) => removeSessionIds.has(video.shootSessionId)).map((video) => video.id));
  const removedSessions = removeSessionIds.size;
  const removedSlots = removeSlotIds.size + state.publishSlots.filter((slot) => removeVideoIds.has(slot.videoItemId)).length;
  state.shootSessions = state.shootSessions.filter((session) => !removeSessionIds.has(session.id));
  state.videoItems = state.videoItems.filter((video) => !removeVideoIds.has(video.id));
  state.publishSlots = state.publishSlots.filter((slot) => !removeSlotIds.has(slot.id) && !removeVideoIds.has(slot.videoItemId));
  rebuildClientSchedule({ client, keepLocked: false });
  return { ok: true, message: `${client.name} 去重完成：删了 ${removedSessions} 条重复拍摄、${removeVideoIds.size} 条重复素材、${removedSlots} 条重复发布，并已重排。` };
}

function updateClientTypes({ client, contentTypes }) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  const cleaned = uniqueValues(contentTypes.map((t) => String(t).trim())).filter(Boolean);
  if (!cleaned.length) return { ok: false, message: "新的内容类型我没看清。" };
  client.contentTypes = cleaned;
  persist();
  return { ok: true, message: `${client.name} 的内容类型改成：${cleaned.join("、")}。` };
}

function deleteClientViaCommand({ client }) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  const clientVideoIds = new Set(state.videoItems.filter((v) => v.clientId === client.id).map((v) => v.id));
  state.clients = state.clients.filter((c) => c.id !== client.id);
  state.shootSessions = state.shootSessions.filter((s) => s.clientId !== client.id);
  state.videoItems = state.videoItems.filter((v) => v.clientId !== client.id);
  state.publishSlots = state.publishSlots.filter((slot) => slot.clientId !== client.id && !clientVideoIds.has(slot.videoItemId));
  pendingConfirms = pendingConfirms.filter((entry) => entry.clientId !== client.id);
  if (selectedManageClientId === client.id) selectedManageClientId = "";
  if (selectedClientId === client.id) selectedClientId = null;
  persist();
  return { ok: true, message: `${client.name} 已删除。` };
}

function bindAccountViaCommand({ client, platform, identifier }) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  const normalized = normalizePlatformInput(platform, identifier);
  // 标记来自对话：搜到多个账号时用聊天气泡列候选，而不是出卡片
  fetchAccount(client.id, platform, { ...normalized, viaChat: true });
  const pretty = PLATFORM_META[platform]?.name || platform;
  return { ok: true, message: `我去抓 ${client.name} 的${pretty}账号。` };
}

// ============ 拍摄会话扩展 ============

function appendToShoot({ client, count, contentType }) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  let session = null;
  if (client) {
    const sessions = state.shootSessions
      .filter((s) => s.clientId === client.id)
      .sort((a, b) => (b.completedAt || b.createdAt || "").localeCompare(a.completedAt || a.createdAt || ""));
    session = sessions[0] || null;
  }
  if (!session && lastShootSessionId) session = findShootSession(lastShootSessionId);
  if (!session) return { ok: false, message: "我不知道追加到哪次拍摄，先告诉我客户。" };
  const targetClient = findClient(session.clientId);
  if (!targetClient) return { ok: false, message: "客户找不到了。" };
  const startIndex = state.videoItems.filter((v) => v.shootSessionId === session.id).length;
  const fallbackType = contentType || targetClient.contentTypes?.[0] || "日常";
  for (let i = 0; i < count; i += 1) {
    const newItem = {
      topic: fallbackShootTopic(session.shootDate, fallbackType, startIndex + i),
      contentType: fallbackType,
      shootPeriod: "",
    };
    session.items = session.items || [];
    session.items.push(newItem);
    state.videoItems.push({
      id: uid("video"),
      clientId: targetClient.id,
      shootSessionId: session.id,
      topic: newItem.topic,
      contentType: newItem.contentType,
      status: "待发布",
      createdAt: new Date().toISOString(),
    });
  }
  session.shootCount = session.items.length;
  session.summary = session.items.map((it) => it.topic).join("、");
  autoScheduleClient(state, targetClient.id);
  persist();
  return { ok: true, message: `${targetClient.name} 拍摄追加了 ${count} 条 ${fallbackType}。` };
}

// ============ 视频条目操作 ============

function findVideosByHint(client, topicHint) {
  return state.videoItems.filter((v) => {
    if (client && v.clientId !== client.id) return false;
    const hay = String(v.topic || "");
    return hay.includes(topicHint) || topicHint.includes(hay);
  });
}

// 指定了 videoId 就只锁定那一条，否则按关键词模糊匹配
function resolveVideoTargets(client, topicHint, videoId) {
  if (videoId) {
    const video = findVideo(videoId);
    return video ? [video] : [];
  }
  return findVideosByHint(client, topicHint);
}

// 一个关键词命中多条 → 返回带候选的歧义结果，触发选项气泡
function ambiguousVideos(matches, hint) {
  return {
    ok: false,
    ambiguous: true,
    hint,
    candidates: matches.slice(0, 6),
    message: `有 ${matches.length} 条都含"${hint}"，需要你点一下是哪条。`,
  };
}

function findSlotsByClientAndHint(clientId, topicHint) {
  const slots = state.publishSlots
    .filter((slot) => slot.clientId === clientId)
    .sort((a, b) => a.publishDate.localeCompare(b.publishDate));
  if (!topicHint) return slots;
  return slots.filter((slot) => {
    const video = findVideo(slot.videoItemId);
    return video?.topic.includes(topicHint) || video?.contentType.includes(topicHint);
  });
}

function retypeVideo({ client, topicHint, contentType, videoId }) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  const matches = resolveVideoTargets(client, topicHint, videoId);
  if (!matches.length) return { ok: false, message: `没找到含"${topicHint}"的视频。` };
  if (matches.length > 1) return ambiguousVideos(matches, topicHint);
  matches[0].contentType = contentType;
  const session = findShootSession(matches[0].shootSessionId);
  if (session?.items) {
    for (const it of session.items) {
      if (it.topic === matches[0].topic) it.contentType = contentType;
    }
  }
  persist();
  return { ok: true, message: `"${matches[0].topic}" 归到 ${contentType} 类了。` };
}

function deleteVideoViaCommand({ client, topicHint, videoId }) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  const matches = resolveVideoTargets(client, topicHint, videoId);
  if (!matches.length) return { ok: false, message: `没找到含"${topicHint}"的视频。` };
  if (matches.length > 1) return ambiguousVideos(matches, topicHint);
  const target = matches[0];
  state.videoItems = state.videoItems.filter((v) => v.id !== target.id);
  state.publishSlots = state.publishSlots.filter((slot) => slot.videoItemId !== target.id);
  const session = findShootSession(target.shootSessionId);
  if (session?.items) {
    session.items = session.items.filter((it) => it.topic !== target.topic);
    session.shootCount = session.items.length;
    session.summary = session.items.map((it) => it.topic).join("、");
  }
  autoScheduleClient(state, target.clientId);
  persist();
  return { ok: true, message: `"${target.topic}" 删掉了。` };
}

function markPublished({ client, topicHint, videoId }) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  const matches = resolveVideoTargets(client, topicHint, videoId);
  if (!matches.length) return { ok: false, message: `没找到含"${topicHint}"的视频。` };
  if (matches.length > 1) return ambiguousVideos(matches, topicHint);
  matches[0].status = "已发布";
  matches[0].publishedAt = new Date().toISOString();
  // 把 publishSlots 里对应那条标完成
  const slot = state.publishSlots.find((s) => s.videoItemId === matches[0].id);
  if (slot) slot.status = "已发布";
  persist();
  return { ok: true, message: `"${matches[0].topic}" 标为已发。` };
}

// ============ 发布日程 ============

function rescheduleTime({ client, topicHint, targetTime, videoId }) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  if (!/^\d{1,2}:\d{2}$/.test(targetTime)) return { ok: false, message: "时间格式我没看懂。" };
  const matches = resolveVideoTargets(client, topicHint, videoId);
  if (!matches.length) return { ok: false, message: `没找到含"${topicHint}"的视频。` };
  if (matches.length > 1) return ambiguousVideos(matches, topicHint);
  const slot = state.publishSlots.find((s) => s.videoItemId === matches[0].id);
  if (!slot) return { ok: false, message: `"${matches[0].topic}" 还没排进发布日程。` };
  const time = targetTime.length === 4 ? "0" + targetTime : targetTime;
  slot.publishTime = time;
  slot.locked = true;
  slot.source = "ai_adjusted";
  persist();
  return { ok: true, message: `"${matches[0].topic}" 发布时间改成 ${time}。` };
}

function shiftDay({ sourceDate, days, client }) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  const targets = state.publishSlots.filter((slot) => {
    if (slot.publishDate !== sourceDate) return false;
    if (client && slot.clientId !== client.id) return false;
    return true;
  });
  if (!targets.length) return { ok: false, message: `${sourceDate} 没有匹配的发布。` };
  for (const slot of targets) {
    slot.publishDate = formatDate(addDays(parseDate(slot.publishDate), days));
    slot.locked = true;
    slot.source = "ai_adjusted";
  }
  persist();
  return { ok: true, message: `${sourceDate} 上 ${targets.length} 条发布顺延 ${days} 天。` };
}

function skipDay({ sourceDate, client }) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  const targets = state.publishSlots.filter((slot) => {
    if (slot.publishDate !== sourceDate) return false;
    if (client && slot.clientId !== client.id) return false;
    return true;
  });
  if (!targets.length) return { ok: false, message: `${sourceDate} 没有匹配的发布要跳。` };
  const ids = new Set(targets.map((s) => s.id));
  state.publishSlots = state.publishSlots.filter((s) => !ids.has(s.id));
  for (const slot of targets) {
    const video = findVideo(slot.videoItemId);
    if (video && video.status !== "已发布") video.status = "待发布";
  }
  persist();
  return { ok: true, message: `${sourceDate} ${targets.length} 条发布跳过了。` };
}

function shiftAllForClient({ client, days }) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  const today = formatDate(new Date());
  const slots = state.publishSlots.filter((slot) => slot.clientId === client.id && slot.publishDate >= today);
  if (!slots.length) return { ok: false, message: `${client.name} 没有未来未发布的发布计划。` };
  for (const slot of slots) {
    slot.publishDate = formatDate(addDays(parseDate(slot.publishDate), days));
    slot.locked = true;
    slot.source = "ai_adjusted";
  }
  persist();
  return { ok: true, message: `${client.name} 的 ${slots.length} 条未来发布整体推 ${days} 天。` };
}

// ============ 查询 ============

function summarizeSlotsForDate(date, client) {
  const slots = state.publishSlots
    .filter((slot) => slot.publishDate === date && (!client || slot.clientId === client.id))
    .sort((a, b) => (a.publishTime || "").localeCompare(b.publishTime || ""));
  if (!slots.length) return null;
  return slots.map((slot) => {
    const c = findClient(slot.clientId);
    const v = findVideo(slot.videoItemId);
    return `${slot.publishTime || "时间未定"} · ${c?.name || "?"} · ${v?.topic || "?"}`;
  });
}

function queryToday({ client }) {
  const today = formatDate(new Date());
  const lines = summarizeSlotsForDate(today, client);
  if (!lines) return { ok: true, message: client ? `${client.name} 今天没安排发布。` : "今天没安排发布。" };
  return { ok: true, message: `今天 (${today})：\n${lines.join("\n")}` };
}

function queryDate({ date, client }) {
  const lines = summarizeSlotsForDate(date, client);
  if (!lines) return { ok: true, message: client ? `${client.name} ${date} 没安排发布。` : `${date} 没安排发布。` };
  return { ok: true, message: `${date}：\n${lines.join("\n")}` };
}

function queryClientSchedule({ client, limit = 20 }) {
  const today = formatDate(new Date());
  const slots = state.publishSlots
    .filter((slot) => slot.clientId === client.id && slot.publishDate >= today)
    .sort((a, b) => a.publishDate.localeCompare(b.publishDate) || (a.publishTime || "").localeCompare(b.publishTime || ""));
  if (!slots.length) return { ok: true, message: `${client.name} 后面还没安排发布。` };
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 30));
  const lines = slots.slice(0, safeLimit).map((slot) => {
    const video = findVideo(slot.videoItemId);
    return `· ${slot.publishDate} ${slot.publishTime || "时间未定"} | ${video?.topic || "未命名"}${slot.locked ? " | 已锁定" : ""}`;
  });
  const tail = slots.length > safeLimit ? `\n还有 ${slots.length - safeLimit} 条没展开。` : "";
  return { ok: true, message: `${client.name} 后面共 ${slots.length} 条：\n${lines.join("\n")}${tail}` };
}

function queryStats({ client, scope }) {
  const today = formatDate(new Date());
  const allSlots = state.publishSlots.filter((s) => s.clientId === client.id);
  const allVideos = state.videoItems.filter((v) => v.clientId === client.id);
  let scopeStart = "";
  let scopeLabel = "全部";
  if (scope === "month") {
    const now = new Date();
    scopeStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    scopeLabel = "本月";
  } else if (scope === "week") {
    scopeStart = formatDate(addDays(new Date(), -7));
    scopeLabel = "近 7 天";
  }
  const filtered = scopeStart ? allSlots.filter((s) => s.publishDate >= scopeStart) : allSlots;
  const published = filtered.filter((s) => s.publishDate <= today).length;
  const upcoming = filtered.filter((s) => s.publishDate > today).length;
  const douyin = client.accounts?.find((a) => a.platform === "douyin");
  const followers = douyin?.followerCount ? `抖音 ${douyin.followerCount} 粉` : "";
  return {
    ok: true,
    message: `${client.name} ${scopeLabel}：素材 ${allVideos.length} 条，已发 ${published} 条，待发 ${upcoming} 条${followers ? "，" + followers : ""}。`,
  };
}

function searchVideos({ keyword, client }) {
  const matches = state.videoItems.filter((v) => {
    if (client && v.clientId !== client.id) return false;
    return String(v.topic || "").includes(keyword);
  });
  if (!matches.length) return { ok: true, message: `没找到含"${keyword}"的视频。` };
  const lines = matches.slice(0, 10).map((v) => {
    const c = findClient(v.clientId);
    const slot = state.publishSlots.find((s) => s.videoItemId === v.id);
    const schedule = slot ? `${slot.publishDate} ${slot.publishTime}` : "未排期";
    return `· ${c?.name || "?"} | ${v.topic} | ${v.status} | ${schedule}`;
  });
  return { ok: true, message: `找到 ${matches.length} 条：\n${lines.join("\n")}` };
}

function updateShootCount({ client, newCount, shootDate, sessionId }) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  if (!Number.isFinite(newCount) || newCount < 1) return { ok: false, message: "条数我没听清。" };
  let session = sessionId ? findShootSession(sessionId) : null;
  if (!session && client) {
    const sessions = state.shootSessions
      .filter((s) => s.clientId === client.id && (!shootDate || s.shootDate === shootDate))
      .sort((a, b) => (b.completedAt || b.createdAt || "").localeCompare(a.completedAt || a.createdAt || ""));
    session = sessions[0] || null;
  }
  if (!session) return { ok: false, message: "没找到要修正的拍摄。" };
  const targetClient = findClient(session.clientId);
  if (isPlannedShoot(session)) {
    const fallbackType = session.items?.[0]?.contentType || targetClient?.contentTypes?.[0] || "日常";
    const nextItems = Array.from({ length: newCount }, (_, i) => {
      const existing = session.items?.[i];
      return existing || {
        topic: fallbackShootTopic(session.shootDate, fallbackType, i),
        contentType: fallbackType,
        shootPeriod: session.shootPeriod || "",
      };
    });
    const oldCount = Number(session.shootCount) || session.items?.length || 0;
    session.items = nextItems;
    session.shootCount = newCount;
    session.summary = nextItems.map((it) => it.topic).join("、");
    persist();
    return { ok: true, message: `${targetClient?.name || "客户"} ${session.shootDate} 的拍摄计划改成 ${newCount} 条了（原 ${oldCount} 条）。` };
  }
  const existing = state.videoItems
    .filter((v) => v.shootSessionId === session.id)
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  const oldCount = existing.length;
  if (newCount === oldCount) return { ok: true, message: `${targetClient?.name || "客户"} ${session.shootDate} 已经是 ${oldCount} 条了，没改动。` };
  if (newCount > oldCount) {
    // 加 stub
    const fallbackType = session.items?.[0]?.contentType || targetClient?.contentTypes?.[0] || "日常";
    for (let i = oldCount; i < newCount; i += 1) {
      const newItem = {
        topic: fallbackShootTopic(session.shootDate, fallbackType, i),
        contentType: fallbackType,
        shootPeriod: session.shootPeriod || "",
      };
      session.items = session.items || [];
      session.items.push(newItem);
      state.videoItems.push({
        id: uid("video"),
        clientId: session.clientId,
        shootSessionId: session.id,
        topic: newItem.topic,
        contentType: newItem.contentType,
        status: "待发布",
        createdAt: new Date().toISOString(),
      });
    }
  } else {
    // 删多余的（从最后一条往前删，保留用户自定义过的）
    const toRemove = existing.slice(newCount);
    const removedIds = new Set(toRemove.map((v) => v.id));
    state.videoItems = state.videoItems.filter((v) => !removedIds.has(v.id));
    state.publishSlots = state.publishSlots.filter((slot) => !removedIds.has(slot.videoItemId));
    if (session.items) session.items = session.items.slice(0, newCount);
  }
  session.shootCount = newCount;
  if (session.items) session.summary = session.items.map((it) => it.topic).join("、");
  autoScheduleClient(state, session.clientId);
  persist();
  return { ok: true, message: `${targetClient?.name || "客户"} ${session.shootDate} 的拍摄改成 ${newCount} 条了（原 ${oldCount} 条）。` };
}

function queryVideoShoot({ topicHint, client }) {
  const matches = findVideosByHint(client, topicHint);
  if (!matches.length) return { ok: true, message: `没找到含"${topicHint}"的视频。` };
  const lines = matches.slice(0, 5).map((v) => {
    const c = findClient(v.clientId);
    const session = findShootSession(v.shootSessionId);
    if (!session) return `· ${c?.name || "?"} | ${v.topic} | 没找到对应拍摄记录`;
    const period = session.shootPeriod ? `${session.shootPeriod}` : "";
    const sameSession = state.videoItems.filter((x) => x.shootSessionId === session.id);
    const seq = sameSession.findIndex((x) => x.id === v.id) + 1;
    return `· ${c?.name || "?"} | ${v.topic} | ${session.shootDate}${period ? " " + period : ""} 第 ${seq}/${sameSession.length} 条`;
  });
  return { ok: true, message: matches.length === 1 ? lines[0].replace(/^· /, "") : `找到 ${matches.length} 条：\n${lines.join("\n")}` };
}

function buildHelpText() {
  return [
    "我能这样帮你：",
    "· 客户：加客户/改名/加别名/改频率/改时间/改内容类型/绑账号/删客户",
    "· 拍摄：计划拍摄/今天拍了 N 条/再补拍 N 条/取消/挪到X日",
    "· 文案：粘 1. 2. 3. 文案 → 自动提炼主题；'把X改成Y'重命名；'把X归到Y类'改类型；'X删掉'/'X已发'",
    "· 发布：'X挪到周三'/'X不发了'/'X改成19点发'/'今天发布顺延一天'/'周末别发'/'未来发布推3天'",
    "· 查询：'今天发什么'/'下周一谁要发'/'X本月发了多少'/'含X的视频'/'X是哪天拍的'",
  ].join("\n");
}

function renameVideo({ client, oldTopicHint, newTopic, videoId }) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  if (!newTopic) return { ok: false, message: "你要改的视频/新简称我没听清。" };
  if (!videoId && !oldTopicHint) return { ok: false, message: "你要改的视频/新简称我没听清。" };
  const candidates = resolveVideoTargets(client, oldTopicHint, videoId);
  if (!candidates.length) return { ok: false, message: `没找到含 ${oldTopicHint} 的视频。` };
  if (candidates.length > 1) return ambiguousVideos(candidates, oldTopicHint);
  const taken = new Set(
    state.videoItems
      .filter((v) => v.id !== candidates[0].id && v.topic && !isPlaceholderTopic(v.topic))
      .map((v) => v.topic),
  );
  const trimmedNew = trimToMaxChars(newTopic, 6);
  if (taken.has(trimmedNew)) return { ok: false, message: `${trimmedNew} 已经被别的视频用了，换一个。` };
  const oldTopic = candidates[0].topic;
  candidates[0].topic = trimmedNew;
  // 同步 session.items
  const session = findShootSession(candidates[0].shootSessionId);
  if (session?.items) {
    for (const it of session.items) {
      if (it.topic === oldTopic) it.topic = trimmedNew;
    }
    session.summary = session.items.map((it) => it.topic).join("、");
  }
  persist();
  return { ok: true, message: `已经把"${oldTopic}"改成"${trimmedNew}"。` };
}

function postponeShootPlan(sessionId) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  const session = findShootSession(sessionId);
  if (!session || !isPlannedShoot(session)) return { ok: false, message: "我没找到可改的计划。" };
  session.shootDate = formatDate(addDays(parseDate(session.shootDate), 1));
  anchorDate = parseDate(session.shootDate);
  persist();
  return { ok: true, message: `改到 ${session.shootDate} 了。` };
}

function postponeShootPlanForClient({ client, targetDate, days = 1 }) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  const session = findNextShootPlan(client?.id);
  if (!session) return { ok: false, message: "我没找到可延期的计划。" };
  const safeDays = Math.max(1, Math.min(Number(days) || 1, 30));
  const nextDate = targetDate || formatDate(addDays(parseDate(session.shootDate), safeDays));
  session.shootDate = nextDate;
  session.items = ensurePlannedShootItems(session.items, client.contentTypes, nextDate);
  session.summary = session.items.map((item) => item.topic).join("、");
  anchorDate = parseDate(nextDate);
  persist();
  return { ok: true, message: `${client.name} 的拍摄延期到 ${nextDate}。` };
}

function moveShootPlan({ client, targetDate }) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  if (!targetDate) return { ok: false, message: "新日期我没听清。" };
  const session = findNextShootPlan(client?.id);
  if (!session) return { ok: false, message: "我没找到可改的计划。" };
  session.shootDate = targetDate;
  anchorDate = parseDate(targetDate);
  persist();
  return { ok: true, message: `${client.name} 改到 ${targetDate} 了。` };
}

function cancelShootPlan(sessionId) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  const session = findShootSession(sessionId);
  if (!session || !isPlannedShoot(session)) return { ok: false, message: "我没找到可取消的计划。" };
  const client = findClient(session.clientId);
  state.shootSessions = state.shootSessions.filter((item) => item.id !== session.id);
  persist();
  return { ok: true, message: `${client?.name || "客户"} 的拍摄我取消了。` };
}

function movePublish({ client, topicHint, targetDate, videoId }) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  let slot = null;
  if (videoId) {
    slot = state.publishSlots.find((s) => s.clientId === client.id && s.videoItemId === videoId);
  } else {
    const slots = findSlotsByClientAndHint(client.id, topicHint);
    if (topicHint && slots.length > 1) {
      return ambiguousVideos(slots.map((s) => findVideo(s.videoItemId)).filter(Boolean), topicHint);
    }
    slot = slots[0];
  }
  if (!slot) return { ok: false, message: "我没找到可移动的发布。" };
  slot.publishDate = targetDate;
  slot.locked = true;
  slot.source = "ai_adjusted";
  anchorDate = parseDate(targetDate);
  return { ok: true, message: `${client.name} 的发布改到 ${targetDate} 了。` };
}

function cancelPublish({ client, topicHint, date, videoId }) {
  if (!canEditOrg()) return { ok: false, message: "你现在是只读。" };
  let slot = null;
  if (date) {
    // 按日期精准取消
    slot = state.publishSlots.find((s) => s.clientId === client.id && s.publishDate === date);
    if (!slot) return { ok: false, message: `${date} 没看到 ${client.name} 的发布。` };
  } else if (videoId) {
    slot = state.publishSlots.find((s) => s.clientId === client.id && s.videoItemId === videoId);
    if (!slot) return { ok: false, message: "我没找到可取消的发布。" };
  } else {
    const slots = findSlotsByClientAndHint(client.id, topicHint);
    if (topicHint && slots.length > 1) {
      return ambiguousVideos(slots.map((s) => findVideo(s.videoItemId)).filter(Boolean), topicHint);
    }
    slot = slots[0];
    if (!slot) return { ok: false, message: "我没找到可取消的发布。" };
  }
  const cancelledDate = slot.publishDate;
  state.publishSlots = state.publishSlots.filter((item) => item.id !== slot.id);
  const video = findVideo(slot.videoItemId);
  if (video) video.status = "待发布";
  // 墓碑：避免 autoScheduleClient 又把同一 video 排回同一日期
  state.cancelledDates = Array.isArray(state.cancelledDates) ? state.cancelledDates : [];
  state.cancelledDates.push({ clientId: client.id, videoItemId: slot.videoItemId, date: cancelledDate, ts: new Date().toISOString() });
  return { ok: true, message: `${client.name} ${cancelledDate} 的发布取消了，素材还在。` };
}

function deletePublishSlotById(slotId) {
  const slot = state.publishSlots.find((item) => item.id === slotId);
  if (!slot) return { ok: false, message: "没找到这条发布排期。" };
  const client = findClient(slot.clientId);
  const cancelledDate = slot.publishDate;
  state.publishSlots = state.publishSlots.filter((item) => item.id !== slot.id);
  const video = findVideo(slot.videoItemId);
  if (video && video.status !== "已发布") video.status = "待发布";
  state.cancelledDates = Array.isArray(state.cancelledDates) ? state.cancelledDates : [];
  state.cancelledDates.push({ clientId: slot.clientId, videoItemId: slot.videoItemId, date: cancelledDate, ts: new Date().toISOString() });
  persist();
  return { ok: true, message: `${client?.name || "这个客户"} ${cancelledDate} 的发布排期删掉了，素材还在。` };
}

function showClientResolution(parsed) {
  clearResultTimer();
  pendingResolution = parsed;
  const rawName = parsed.unmatchedName && parsed.unmatchedName !== "未命名客户" ? parsed.unmatchedName : "";
  const title = rawName ? `我没认出：${escapeHtml(rawName)}` : "我没听清是哪个客户";
  const summary = parsed.items?.map((item) => item.topic).join("、") || "内容还没听清";
  const actionName = parsed.planOnly ? "拍摄计划" : "拍摄内容";
  const sortedClients = state.clients
    .slice()
    .sort((a, b) => fuzzyClientScore(rawName, b) - fuzzyClientScore(rawName, a));
  els.commandResult.className = "command-result warning";
  els.commandResult.innerHTML = `
    <div class="resolution-card">
      <div>
        <strong>${title}</strong>
        <p>${actionName}我先留着：${escapeHtml(summary)}。</p>
      </div>
      <div class="resolution-actions">
        <input data-resolution-name placeholder="客户名" value="${escapeHtml(rawName)}" autocomplete="off" />
        <button class="primary-button" type="button" data-resolution="create">加新客户</button>
        ${sortedClients.length ? `
          <select data-resolution-client>${sortedClients.map((client) => `<option value="${client.id}">${escapeHtml(client.name)}</option>`).join("")}</select>
          <button class="text-button" type="button" data-resolution="alias">当别名</button>
        ` : ""}
      </div>
    </div>
  `;
  els.commandResult.querySelector('[data-resolution="create"]').addEventListener("click", resolveAsNewClient);
  els.commandResult.querySelector('[data-resolution="alias"]')?.addEventListener("click", resolveAsAlias);
}

function fuzzyClientScore(query, client) {
  if (!query || !client) return 0;
  const candidates = [client.name, ...(client.aliases || [])].filter(Boolean);
  let best = 0;
  for (const candidate of candidates) {
    let shared = 0;
    for (const ch of query) if (candidate.includes(ch)) shared += 1;
    if (candidate === query) shared += 10;
    else if (candidate.includes(query) || query.includes(candidate)) shared += 5;
    best = Math.max(best, shared);
  }
  return best;
}

function createResolvedClientAndApply(parsed) {
  const client = createClient({
    name: parsed.unmatchedName,
    publishIntervalDays: 1,
    defaultPublishTime: "17:00",
    contentTypes: uniqueValues((parsed.items || []).map((item) => item.contentType)),
    needsProfileTodo: true,
  });
  const provider = parsed.provider;
  const result = parsed.planOnly
    ? planShoot({ client, shootDate: parsed.shootDate || formatDate(new Date()), items: parsed.items })
    : recordShoot({ client, shootDate: parsed.shootDate || formatDate(new Date()), items: parsed.items });
  if (result.ok) showFrequencyPrompt(client);
  else setResult(withProvider(result.message, { provider }), "warning");
}

function resolveAsNewClient() {
  if (!canEditOrg()) return;
  if (!pendingResolution) return;
  const typedName = els.commandResult.querySelector("[data-resolution-name]")?.value.trim() || "";
  if (!typedName) {
    setResult("客户名留个吧。", "warning");
    return;
  }
  createResolvedClientAndApply({ ...pendingResolution, unmatchedName: typedName });
  pendingResolution = null;
  render();
}

function resolveAsAlias() {
  if (!canEditOrg()) return;
  if (!pendingResolution) return;
  const client = findClient(els.commandResult.querySelector("[data-resolution-client]")?.value);
  if (!client) return;
  addAliasToClient(client, pendingResolution.unmatchedName);
  const provider = pendingResolution.provider;
  const alias = pendingResolution.unmatchedName;
  const result = pendingResolution.planOnly
    ? planShoot({ client, shootDate: pendingResolution.shootDate || formatDate(new Date()), items: pendingResolution.items })
    : recordShoot({ client, shootDate: pendingResolution.shootDate || formatDate(new Date()), items: pendingResolution.items });
  pendingResolution = null;
  setResult(withProvider(`${alias} 我记成 ${client.name} 了。${result.message}`, { provider }), result.ok ? "success" : "warning");
  render();
}

function autoScheduleAll(targetState) {
  for (const client of targetState.clients) if (client.active) autoScheduleClient(targetState, client.id);
}

function autoScheduleClient(targetState, clientId) {
  const client = targetState.clients.find((item) => item.id === clientId);
  if (!client) return;
  const scheduledIds = new Set(targetState.publishSlots.map((slot) => slot.videoItemId));
  const unscheduled = orderVideosForScheduling(targetState, targetState.videoItems
    .filter((video) => video.clientId === clientId && video.status === "待发布" && !scheduledIds.has(video.id) && isVideoReadyForPublish(targetState, video))
  );
  for (const video of unscheduled) {
    const date = findBestPublishDate(targetState, client, video);
    targetState.publishSlots.push({
      id: uid("slot"),
      clientId,
      videoItemId: video.id,
      publishDate: date,
      publishTime: client.defaultPublishTime,
      status: "计划发布",
      locked: false,
      source: "auto",
    });
  }
}

function orderVideosForScheduling(targetState, videos) {
  const groups = new Map();
  for (const video of videos) {
    const session = targetState.shootSessions.find((item) => item.id === video.shootSessionId);
    const key = video.shootSessionId || video.id;
    if (!groups.has(key)) groups.set(key, { session, videos: [] });
    groups.get(key).videos.push(video);
  }
  const orderedGroups = Array.from(groups.values())
    .map((group) => ({
      ...group,
      shootDate: group.session?.shootDate || "9999-12-31",
      createdAt: group.session?.createdAt || group.videos[0]?.createdAt || "",
      videos: group.videos.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || "")),
    }))
    .sort((a, b) => a.shootDate.localeCompare(b.shootDate) || a.createdAt.localeCompare(b.createdAt));
  const result = [];
  let index = 0;
  while (orderedGroups.some((group) => index < group.videos.length)) {
    for (const group of orderedGroups) {
      if (group.videos[index]) result.push(group.videos[index]);
    }
    index += 1;
  }
  return result;
}

function cleanupPlannedShootPublishArtifacts(targetState) {
  const plannedSessionIds = new Set(targetState.shootSessions.filter(isPlannedShoot).map((session) => session.id));
  if (!plannedSessionIds.size) return;
  const plannedVideoIds = new Set(targetState.videoItems.filter((video) => plannedSessionIds.has(video.shootSessionId)).map((video) => video.id));
  if (!plannedVideoIds.size) return;
  targetState.publishSlots = targetState.publishSlots.filter((slot) => !plannedVideoIds.has(slot.videoItemId));
  targetState.videoItems = targetState.videoItems.filter((video) => !plannedSessionIds.has(video.shootSessionId));
}

function isVideoReadyForPublish(targetState, video) {
  if (!video?.shootSessionId) return true;
  const session = targetState.shootSessions.find((item) => item.id === video.shootSessionId);
  return Boolean(session && !isPlannedShoot(session) && session.status === "completed");
}

function findBestPublishDate(targetState, client, video) {
  const start = addDays(new Date(), 1);
  const cancelled = new Set(
    (targetState.cancelledDates || [])
      .filter((c) => c.clientId === client.id && (!c.videoItemId || c.videoItemId === video.id))
      .map((c) => c.date)
  );
  let fallback = "";
  const candidates = [];
  for (let i = 0; i < 120; i += 1) {
    const date = formatDate(addDays(start, i));
    if (cancelled.has(date)) continue; // 墓碑：取消过的日期跳过
    if (targetState.publishSlots.some((slot) => slot.clientId === client.id && slot.publishDate === date)) continue;
    if (!fallback) fallback = date;
    if (!matchesInterval(targetState, client, date)) continue;
    candidates.push({ date, score: scoreDate(targetState, client, video, date) });
  }
  candidates.sort((a, b) => b.score - a.score || a.date.localeCompare(b.date));
  return candidates[0]?.date || fallback || formatDate(start);
}

function matchesInterval(targetState, client, date) {
  const dates = targetState.publishSlots.filter((slot) => slot.clientId === client.id).map((slot) => slot.publishDate).sort();
  const previous = dates.filter((item) => item < date).at(-1);
  const next = dates.find((item) => item > date);
  if (previous && diffDays(previous, date) < client.publishIntervalDays) return false;
  if (next && diffDays(date, next) < client.publishIntervalDays) return false;
  return true;
}

function scoreDate(targetState, client, video, date) {
  let score = 1000 - diffDays(formatDate(new Date()), date);
  const previous = getNeighborType(targetState, client.id, date, "previous");
  const next = getNeighborType(targetState, client.id, date, "next");
  if (previous === video.contentType) score -= 80;
  if (next === video.contentType) score -= 60;
  return score;
}

function getNeighborType(targetState, clientId, date, direction) {
  const slots = targetState.publishSlots.filter((slot) => slot.clientId === clientId).sort((a, b) => a.publishDate.localeCompare(b.publishDate));
  const neighbor = direction === "previous" ? slots.filter((slot) => slot.publishDate < date).at(-1) : slots.find((slot) => slot.publishDate > date);
  return targetState.videoItems.find((video) => video.id === neighbor?.videoItemId)?.contentType || "";
}

function buildPublishVerificationAlerts() {
  return getPublishVerificationResults()
    .filter((item) => item.status === "missing" || item.status === "unlinked")
    .map((item) => ({
      clientId: item.client?.id || "",
      clientName: item.client?.name || "客户",
      topic: item.video?.topic || "未命名内容",
      publishDate: item.slot.publishDate,
      publishTime: item.slot.publishTime,
      status: item.status,
      reason: item.status === "unlinked" ? "还没绑平台" : "我没看到作品",
    }));
}

function buildShootPlanTodos() {
  const today = formatDate(new Date());
  return state.shootSessions
    .filter((session) => isPlannedShoot(session) && session.shootDate <= today)
    .sort((a, b) => a.shootDate.localeCompare(b.shootDate))
    .map((session) => {
      const client = findClient(session.clientId);
      return {
        type: "shoot_plan_due",
        sessionId: session.id,
        clientId: session.clientId,
        clientName: client?.name || "客户",
        shootDate: session.shootDate,
        reason: session.shootDate < today ? `原定 ${session.shootDate}，还没收尾` : "今天该拍，拍完我来排",
      };
    });
}

function buildShootReminderTodos(rows) {
  const today = formatDate(new Date());
  return rows
    .filter((row) => row.client.active && row.coverDays <= 2 && row.shootBefore <= today)
    .sort((a, b) => a.coverDays - b.coverDays || a.shootBefore.localeCompare(b.shootBefore))
    .map((row) => ({
      clientId: row.client.id,
      clientName: row.client.name,
      coverDays: row.coverDays,
      shootBefore: row.shootBefore,
      reason: row.coverDays === 0 ? "后面没内容了" : `库存还够 ${row.coverDays} 天`,
    }));
}

function getPublishVerificationResults() {
  const now = new Date();
  const results = [];
  for (const slot of state.publishSlots) {
    if (publishDateTime(slot) > now) continue;
    const client = findClient(slot.clientId);
    const video = findVideo(slot.videoItemId);
    if (!client || !video) continue;
    const accounts = client.accounts || [];
    if (!accounts.length) {
      results.push({ status: "unlinked", slot, client, video });
      continue;
    }
    let loading = false;
    let hasLoadedAccount = false;
    let matched = null;
    for (const account of accounts) {
      const entry = postsByAccount[account.id];
      if (entry?.loading || !entry) {
        loading = true;
        continue;
      }
      if (!entry.items) continue;
      hasLoadedAccount = true;
      matched = entry.items.find((post) => postMatchesVideo(post, video, slot));
      if (matched) break;
    }
    if (matched) {
      if (canEditOrg()) {
        video.status = "已发布";
        slot.verifiedAt = slot.verifiedAt || new Date().toISOString();
        slot.verifiedPostId = slot.verifiedPostId || matched.id || "";
      }
      results.push({ status: "published", slot, client, video, post: matched });
    } else if (loading && !hasLoadedAccount) {
      results.push({ status: "loading", slot, client, video });
    } else {
      results.push({ status: "missing", slot, client, video });
    }
  }
  return results;
}

function publishDateTime(slot) {
  return new Date(`${slot.publishDate}T${slot.publishTime || "00:00"}:00`);
}

function postMatchesVideo(post, video, slot) {
  const desc = normalizeText(post.desc || post.title || "");
  const topic = normalizeText(video.topic || "");
  if (!desc || !topic) return false;
  const postTime = Number(post.createTime || 0) * 1000;
  const publishTime = publishDateTime(slot).getTime();
  if (postTime && postTime < publishTime - 2 * 60 * 60 * 1000) return false;
  return desc.includes(topic) || topic.includes(desc) || topicTokens(topic).some((token) => token.length >= 3 && desc.includes(token));
}

function normalizeText(value) {
  return String(value || "").replace(/[^\p{Script=Han}\p{Letter}\p{Number}]/gu, "").toLowerCase();
}

function topicTokens(value) {
  if (!value) return [];
  const tokens = [];
  for (let size = Math.min(6, value.length); size >= 3; size -= 1) {
    for (let index = 0; index <= value.length - size; index += 1) tokens.push(value.slice(index, index + size));
  }
  return uniqueValues(tokens);
}

function getClientStock(clientId) {
  const scheduledIds = new Set(state.publishSlots.map((slot) => slot.videoItemId));
  return state.videoItems.filter((video) => video.clientId === clientId && video.status === "待发布" && !scheduledIds.has(video.id) && isVideoReadyForPublish(state, video));
}

function getPublishSlots(date) {
  return state.publishSlots.filter((slot) => slot.publishDate === date).sort((a, b) => a.publishTime.localeCompare(b.publishTime));
}

function getShootSessions(date) {
  return state.shootSessions.filter((session) => session.shootDate === date);
}

function findShootSession(id) {
  return state.shootSessions.find((session) => session.id === id);
}

function findMatchingShootPlan(clientId, shootDate) {
  const targetDate = shootDate || formatDate(new Date());
  return state.shootSessions
    .filter((session) => session.clientId === clientId && isPlannedShoot(session) && session.shootDate <= targetDate)
    .sort((a, b) => b.shootDate.localeCompare(a.shootDate))[0];
}

function findNextShootPlan(clientId) {
  if (!clientId) return null;
  return state.shootSessions
    .filter((session) => session.clientId === clientId && isPlannedShoot(session))
    .sort((a, b) => a.shootDate.localeCompare(b.shootDate))[0];
}

function findClient(id) {
  return state.clients.find((client) => client.id === id);
}

function findVideo(id) {
  return state.videoItems.find((video) => video.id === id);
}

function findMentionedClient(text) {
  return state.clients.slice().sort((a, b) => b.name.length - a.name.length).find((client) => clientMatchesText(client, text));
}

function findClientByName(value) {
  const name = typeof value === "string" ? value : value?.name;
  if (!name) return null;
  return state.clients.slice().sort((a, b) => b.name.length - a.name.length).find((client) => clientNameMatches(client, name));
}

function findSlotByClientAndHint(clientId, topicHint) {
  const slots = state.publishSlots.filter((slot) => slot.clientId === clientId).sort((a, b) => a.publishDate.localeCompare(b.publishDate));
  if (!topicHint) return slots[0];
  return slots.find((slot) => {
    const video = findVideo(slot.videoItemId);
    return video?.topic.includes(topicHint) || video?.contentType.includes(topicHint);
  }) || slots[0];
}

function clientMatchesText(client, text) {
  return [client.name, ...(client.aliases || [])].some((name) => name && text.includes(name));
}

function clientNameMatches(client, name) {
  return [client.name, ...(client.aliases || [])].some((item) => item && (item === name || name.includes(item) || item.includes(name)));
}

function addAliasToClient(client, alias) {
  if (!alias || alias === client.name || isSystemAlias(client, alias)) return;
  client.aliases = client.aliases || [];
  if (!client.aliases.includes(alias)) client.aliases.push(alias);
}

function isSystemAlias(client, alias) {
  const value = String(alias || "").trim();
  if (!value || value.startsWith("search:")) return true;
  if (/^\d{5,}$/.test(value)) return true;
  return (client.accounts || []).some((account) =>
    [account.uniqueId, account.userName, account.identifier, account.secUserId, account.userId]
      .filter(Boolean)
      .map((item) => String(item).trim())
      .includes(value)
  );
}

function cleanClientAliasesInPlace(client) {
  client.aliases = visibleClientAliases(client);
  return client;
}

function visibleClientAliases(client) {
  const seen = new Set();
  return (client.aliases || [])
    .map((alias) => String(alias || "").trim())
    .filter((alias) => alias && alias !== client.name && !isSystemAlias(client, alias))
    .filter((alias) => {
      if (seen.has(alias)) return false;
      seen.add(alias);
      return true;
    });
}

// 客户名以抖音为准：抖音昵称变成正式名，原名收为别名；不再把平台号/搜索词写进别名
function applyAccountAliases(client, account) {
  if (!client || !account) return;
  if (account.platform === "douyin" && account.nickname) {
    const newName = account.nickname;
    const oldName = client.name;
    client.name = newName;
    if (oldName && oldName !== newName && oldName !== "未命名客户") {
      addAliasToClient(client, oldName);
    }
  }
  if (account.nickname) addAliasToClient(client, account.nickname);
  client.aliases = visibleClientAliases(client);
}

function normalizeClient(client = {}) {
  return {
    name: client.name || "",
    publishIntervalDays: Number(client.publishIntervalDays || client.publish_interval_days || 1),
    defaultPublishTime: client.defaultPublishTime || client.default_publish_time || "17:00",
    contentTypes: Array.isArray(client.contentTypes) ? client.contentTypes : Array.isArray(client.content_types) ? client.content_types : splitTypes(client.contentTypes || client.content_types || ""),
  };
}

function normalizeItems(items = [], fallbackTypes = []) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index) => ({
      topic: item.topic || item.title || item.summary || "",
      contentType: item.contentType || item.content_type || item.type || inferType(item.topic || "", fallbackTypes[index % Math.max(fallbackTypes.length, 1)] || "日常"),
      shootPeriod: item.shootPeriod || item.shoot_period || item.period || "",
    }))
    .filter((item) => item.topic);
}

function normalizePlannedShootItems(command = {}, fallbackTypes = [], rawText = "") {
  return normalizeShootItems(command, fallbackTypes, rawText);
}

// 统一处理拍摄 items：LLM 有具体 topic 用 LLM 的；没 topic 就按 count×类型 生成占位主题；
// 数量优先级：shootCount → items 数组长度 → 1
function normalizeShootItems(command = {}, fallbackTypes = [], rawText = "", { requireExplicitCount = false } = {}) {
  const commandType = command.contentType || command.content_type || command.type || "";
  const itemType = Array.isArray(command.items)
    ? command.items.map((it) => it?.contentType || it?.content_type || it?.type).find(Boolean) || ""
    : "";
  const textType = rawText ? inferContentTypeFromText(rawText, []) : "";
  const baseType = commandType || itemType || textType;
  const typeFallbacks = baseType ? [baseType, ...fallbackTypes] : fallbackTypes;
  const realTopicItems = Array.isArray(command.items)
    ? command.items.filter((it) => (it?.topic || it?.title || it?.summary || "").trim())
    : [];
  if (realTopicItems.length) return normalizeItems(realTopicItems, typeFallbacks);
  const itemsCount = Array.isArray(command.items) ? command.items.length : 0;
  const declaredCount = Number(command.shootCount || command.shoot_count || command.count || 0);
  // plan_shoot：用户没说明确数字时，stub items 不算 count，让前端去追问。
  // record_shoot：用户说"拍了"必然有数量，stub items 数量也算。
  const explicitCount = requireExplicitCount ? declaredCount : (declaredCount || itemsCount);
  if (!explicitCount) return [];
  const safeCount = Math.max(1, Math.min(explicitCount, 20));
  const shootDate = command.shootDate || command.shoot_date || formatDate(new Date());
  const fallbackType = typeFallbacks[0] || "内容";
  return Array.from({ length: safeCount }, (_, index) => ({
    topic: fallbackShootTopic(shootDate, fallbackType, index),
    contentType: typeFallbacks[index % Math.max(typeFallbacks.length, 1)] || "日常",
    shootPeriod: command.shootPeriod || command.shoot_period || command.period || "",
  }));
}

function parseItemsFromText(text, fallbackTypes = []) {
  const count = Number(matchOne(text, /(?:拍(?:了|摄|完|好)?|完成拍摄)\s*(\d+)\s*条/) || matchOne(text, /(\d+)\s*条(?:片|视频|内容)?/)) || 0;
  const explicitType = inferContentTypeFromText(text, fallbackTypes);
  const shootDate = parseTargetDate(text) || parseDateWord(text);
  const countParts = text.split(/(?:拍(?:了|摄|完|好)?|完成拍摄)\s*\d+\s*条[，,。]?/);
  const afterCount = countParts.length > 1 ? countParts.at(-1) : text;
  let topics = afterCount
    .replace(/第一条|第二条|第三条|第四条|第五条|第六条|第七条|第八条|第九条|第十条/g, "")
    .split(/[、，,。；;：:]/)
    .map((item) => item.replace(/^(是|为|主题是|内容是)/, "").trim())
    .filter(Boolean)
    .filter((item) => !/默认|每天|两天|三天|主要发|内容类型|安排|计划|预约|提醒|准备|需要|明天|后天|下周|拍摄|拍片/.test(item));
  if (topics.length === 1 && explicitType && normalizeText(topics[0]) === normalizeText(explicitType)) topics = [];
  if (count && topics.length > count) topics = topics.slice(0, count);
  if (count && topics.length < count) {
    for (let index = topics.length; index < count; index += 1) topics.push(fallbackShootTopic(shootDate, explicitType || fallbackTypes[0] || "内容", index));
  }
  const shootPeriod = parseShootPeriod(text);
  return topics.map((topic, index) => ({ topic, contentType: explicitType || inferType(topic, fallbackTypes[index % Math.max(fallbackTypes.length, 1)] || "日常"), shootPeriod }));
}

function ensurePlannedShootItems(items = [], fallbackTypes = [], shootDate = formatDate(new Date())) {
  const normalized = normalizeItems(items, fallbackTypes);
  if (normalized.length) {
    return normalized.map((item, index) => {
      const contentType = item.contentType || fallbackTypes[index % Math.max(fallbackTypes.length, 1)] || "内容";
      return {
        ...item,
        contentType,
        topic: isPlaceholderTopic(item.topic) ? fallbackShootTopic(shootDate, contentType, index) : item.topic,
      };
    });
  }
  return [{ topic: fallbackShootTopic(shootDate, fallbackTypes[0] || "内容", 0), contentType: fallbackTypes[0] || "日常", shootPeriod: "" }];
}

function inferContentTypeFromText(text = "", fallbackTypes = []) {
  if (/口播|口述|讲述/.test(text)) return "口播";
  if (/探店|到店/.test(text)) return "探店";
  if (/图文|笔记/.test(text)) return "图文";
  if (/直播/.test(text)) return "直播";
  if (/干货|方法|技巧|避坑/.test(text)) return "干货";
  if (/案例|客户|成交/.test(text)) return "案例";
  if (/老板|创业|IP/i.test(text)) return "老板IP";
  if (/招聘|招人|主播/.test(text)) return "招聘";
  if (/产品|新品|套餐/.test(text)) return "产品";
  if (/施工|工地|现场/.test(text)) return "施工现场";
  if (/日常|办公|门店|公司/.test(text)) return "日常";
  return fallbackTypes[0] || "";
}

function fallbackShootTopic(shootDate, contentType, index) {
  return `${shootDate || formatDate(new Date())} ${contentType || "内容"} ${index + 1}`;
}

function isPlaceholderTopic(topic = "") {
  const trimmed = String(topic).trim();
  if (!trimmed) return true;
  if (/^(未命名内容|待定拍摄内容)(?:\s*\d+)?$/.test(trimmed)) return true;
  if (/^\d{4}-\d{2}-\d{2}\s+\S+\s+\d+$/.test(trimmed)) return true;
  return false;
}

function isShootPlanText(text = "") {
  const hasShoot = /拍摄|拍\s*\d*\s*[条次]|拍[一二三四五六七八九十两几]\s*[条次]|补拍|拍片|再拍|要拍|得拍|准备拍|拍\S{0,4}(?:口播|案例|干货|图文|直播|笔记|探店|讲述|口述)/.test(text);
  if (!hasShoot) return false;
  if (/拍了|已拍|拍完|录入|完成拍摄/.test(text)) return false;
  const planCue = /计划|安排|预约|提醒|准备|需要|要|待拍|该拍|补拍|再拍/.test(text);
  const dateCue = /明天|后天|下周|周[一二三四五六日天]|\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/.test(text);
  return planCue || dateCue;
}

function isPlannedShoot(session) {
  return session?.planned === true || session?.status === "planned";
}

function inferType(topic, fallback) {
  if (/口播|口述|讲述/.test(topic)) return "口播";
  if (/案例|客户|成交/.test(topic)) return "案例";
  if (/避坑|干货|方法|技巧/.test(topic)) return "干货";
  if (/老板|创业|个人|IP/i.test(topic)) return "老板IP";
  if (/招聘|主播|招人/.test(topic)) return "招聘";
  if (/日常|办公室|门店|公司/.test(topic)) return "日常";
  if (/产品|套餐|新品/.test(topic)) return "产品";
  if (/施工|现场|工地/.test(topic)) return "施工现场";
  return fallback;
}

function extractShootClientName(text) {
  return matchOne(text, /给\s*([^，。,.\s]+?)\s*拍/) || matchOne(text, /客户\s*([^，。,.\s]+?)(?:拍|录入|，|,|。|$)/) || "未命名客户";
}

function extractCommandClientName(value) {
  return typeof value === "string" ? value.trim() : (value?.name || "").trim();
}

// 客户名兜底：优先用 LLM 抽到的 command.client（自然语言识别），再回退到本地正则
function resolveSpokenName(command, rawText) {
  const llmName = extractCommandClientName(command?.client);
  if (llmName && llmName !== "未命名客户") return llmName;
  const local = extractShootClientName(rawText);
  return local && local !== "未命名客户" ? local : "";
}

function extractTopicHint(text, client) {
  const beforeVerb = text.split(/挪到|移动到|改到|调到|取消|不发/)[0] || text;
  return beforeVerb.replace(/^把/, "").replace(client?.name || "", "").replace(/周[一二三四五六日天]|下周|明天|后天|今天|这条|那条/g, "").trim();
}

function parseDateWord(text) {
  if (/昨天/.test(text)) return formatDate(addDays(new Date(), -1));
  if (/明天/.test(text)) return formatDate(addDays(new Date(), 1));
  return formatDate(new Date());
}

function parseShootPeriod(text = "") {
  if (/上午|早上|早晨|上午场/.test(text)) return "上午";
  if (/中午|午间/.test(text)) return "中午";
  if (/下午|午后/.test(text)) return "下午";
  if (/晚上|晚间|夜里|夜间/.test(text)) return "晚上";
  return "";
}

function inferShootPeriod(items = []) {
  return items.map((item) => item.shootPeriod).find(Boolean) || "";
}

function parseTargetDate(text) {
  const direct = text.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (direct) return formatDate(new Date(Number(direct[1]), Number(direct[2]) - 1, Number(direct[3])));
  if (/今天/.test(text)) return formatDate(new Date());
  if (/后天/.test(text)) return formatDate(addDays(new Date(), 2));
  if (/明天/.test(text)) return formatDate(addDays(new Date(), 1));
  const weekMatch = text.match(/(下周)?(?:周)?([一二三四五六日天])/);
  if (weekMatch) return nextWeekday(weekMatch[2], Boolean(weekMatch[1]));
  return null;
}

function parseTime(text) {
  const hour = matchOne(text, /(?:晚上|晚|下午)?\s*(\d{1,2})\s*点/);
  if (!hour) return null;
  let value = Number(hour);
  if (/晚上|晚|下午/.test(text) && value < 12) value += 12;
  return `${String(value).padStart(2, "0")}:00`;
}

function getCalendarDays(monthDate) {
  const first = startOfMonth(monthDate);
  const offset = (first.getDay() + 6) % 7;
  const start = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function startOfWeek(date) {
  return addDays(parseDate(formatDate(date)), -((date.getDay() + 6) % 7));
}

function isPeriodOnToday() {
  const today = new Date();
  const todayStr = formatDate(today);
  if (viewMode === "month") {
    return anchorDate.getFullYear() === today.getFullYear() && anchorDate.getMonth() === today.getMonth();
  }
  const start = viewMode === "week" ? startOfWeek(anchorDate) : parseDate(formatDate(anchorDate));
  const span = viewMode === "week" ? 7 : 3;
  for (let i = 0; i < span; i += 1) {
    if (formatDate(addDays(start, i)) === todayStr) return true;
  }
  return false;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function diffDays(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

function parseDate(value) {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(date) {
  const value = parseDate(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function formatShort(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function weekdayName(date) {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
}

function dayTitle(date) {
  const diff = diffDays(formatDate(new Date()), date);
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  if (diff === 2) return "后天";
  return date;
}

function nextWeekday(word, nextWeek) {
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
  let delta = map[word] - new Date().getDay();
  if (delta <= 0) delta += 7;
  if (nextWeek) delta += 7;
  return formatDate(addDays(new Date(), delta));
}

function clientColor(clientId) {
  const index = Math.max(0, state.clients.findIndex((client) => client.id === clientId));
  return COLORS[index % COLORS.length];
}

function splitTypes(value = "") {
  return value.split(/[、，,\/\s]+/).map((item) => item.trim()).filter(Boolean);
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(value) || /douyin\.com|xiaohongshu\.com|xhslink\.com/i.test(value);
}

function normalizePlatformInput(platform, value) {
  const raw = String(value || "").trim();
  const url = extractFirstUrl(raw);
  if (platform === "xhs") {
    const id = raw.match(/\/user\/profile\/([a-f0-9]{16,32})/i)?.[1] || raw.match(/\b([a-f0-9]{20,32})\b/i)?.[1];
    if (id) return { identifier: id };
    const search = extractXhsSearchTerm(raw);
    return { ...(url ? { url } : {}), ...(search ? { search } : {}) };
  }
  if (url) return { url };
  return looksLikeUrl(raw) ? { url: raw } : { search: raw.replace(/^@/, "").trim() };
}

function extractFirstUrl(value) {
  return String(value || "").match(/https?:\/\/[^\s，。]+/i)?.[0] || "";
}

function extractXhsSearchTerm(value) {
  return String(value || "")
    .replace(/https?:\/\/[^\s，。]+/ig, "")
    .replace(/在小红书.*$/g, "")
    .replace(/查看Ta的主页.*/g, "")
    .replace(/^@/, "")
    .trim();
}

function matchOne(text, regex) {
  return text.match(regex)?.[1]?.trim() || "";
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function withProvider(message, parsed) {
  // 不再向用户暴露 LLM provider 标记（"(deepseek 解析)" 之类）
  return message;
}

function requireEdit() {
  if (canEditOrg()) return true;
  setResult(auth.loggedIn ? "你现在是只读。" : "先登录。", "warning");
  return false;
}

function setResult(message, type) {
  clearResultTimer();
  els.commandResult.textContent = message;
  els.commandResult.className = `command-result ${type || ""}`;
  if (!message || (type !== "success" && type !== "warning")) return;
  const snapshot = { message, className: els.commandResult.className };
  resultTimer = window.setTimeout(() => {
    if (els.commandResult.textContent === snapshot.message && els.commandResult.className === snapshot.className) {
      els.commandResult.textContent = "";
      els.commandResult.className = "command-result";
    }
  }, type === "success" ? 2400 : 3200);
}

function clearResultTimer() {
  if (!resultTimer) return;
  window.clearTimeout(resultTimer);
  resultTimer = 0;
}

function clientAvatarHtml(client, size = "md") {
  const color = clientColor(client?.id);
  const url = clientAvatarUrl(client, size === "lg" ? "lg" : "sm");
  const primary = primaryAccount(client);
  const initial = (primary?.nickname || client?.name || "?").trim().slice(0, 1);
  if (url) {
    return `<span class="client-avatar avatar-${size}" style="--ring:${color}"><img src="${escapeHtml(url)}" alt="" loading="lazy" /></span>`;
  }
  return `<span class="client-avatar avatar-${size} avatar-fallback" style="background:${color}">${escapeHtml(initial)}</span>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
