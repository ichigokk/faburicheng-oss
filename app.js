const STORAGE_KEY = "short-video-scheduler-v1";

const state = loadState();
let currentMonth = startOfMonth(new Date());
let selectedDate = formatDate(new Date());
let llmStatus = null;
let pendingResolution = null;

const els = {
  todayLabel: document.querySelector("#todayLabel"),
  llmOverall: document.querySelector("#llmOverall"),
  llmStatus: document.querySelector("#llmStatus"),
  clientCount: document.querySelector("#clientCount"),
  clientList: document.querySelector("#clientList"),
  clientForm: document.querySelector("#clientForm"),
  clientName: document.querySelector("#clientName"),
  clientInterval: document.querySelector("#clientInterval"),
  clientTime: document.querySelector("#clientTime"),
  clientTypes: document.querySelector("#clientTypes"),
  reminderCount: document.querySelector("#reminderCount"),
  reminderList: document.querySelector("#reminderList"),
  monthTitle: document.querySelector("#monthTitle"),
  prevMonth: document.querySelector("#prevMonth"),
  nextMonth: document.querySelector("#nextMonth"),
  goToday: document.querySelector("#goToday"),
  calendarGrid: document.querySelector("#calendarGrid"),
  selectedDateTitle: document.querySelector("#selectedDateTitle"),
  publishList: document.querySelector("#publishList"),
  shootList: document.querySelector("#shootList"),
  commandInput: document.querySelector("#commandInput"),
  runCommand: document.querySelector("#runCommand"),
  voiceButton: document.querySelector("#voiceButton"),
  commandResult: document.querySelector("#commandResult"),
};

render();
loadLlmStatus();

els.clientForm.addEventListener("submit", (event) => {
  event.preventDefault();
  createClient({
    name: els.clientName.value.trim(),
    publishIntervalDays: Number(els.clientInterval.value),
    defaultPublishTime: els.clientTime.value || "20:00",
    contentTypes: splitTypes(els.clientTypes.value),
  });
  els.clientForm.reset();
  els.clientTime.value = "20:00";
  els.clientTypes.value = "案例、干货、老板IP、日常";
  setResult("客户已新增。", "success");
});

els.prevMonth.addEventListener("click", () => {
  currentMonth = addMonths(currentMonth, -1);
  render();
});

els.nextMonth.addEventListener("click", () => {
  currentMonth = addMonths(currentMonth, 1);
  render();
});

els.goToday.addEventListener("click", () => {
  currentMonth = startOfMonth(new Date());
  selectedDate = formatDate(new Date());
  render();
});

els.runCommand.addEventListener("click", runNaturalCommand);
els.commandInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    runNaturalCommand();
  }
});

els.voiceButton.addEventListener("click", () => {
  if (!("webkitSpeechRecognition" in window)) {
    setResult("当前浏览器不支持语音识别，可以先用文字输入。", "warning");
    return;
  }
  const recognition = new webkitSpeechRecognition();
  recognition.lang = "zh-CN";
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.onresult = (event) => {
    els.commandInput.value = event.results[0][0].transcript;
  };
  recognition.start();
});

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    return JSON.parse(saved);
  }

  const today = formatDate(new Date());
  const initial = {
    clients: [
      {
        id: uid("client"),
        name: "星火娱乐",
        aliases: [],
        publishIntervalDays: 1,
        defaultPublishTime: "20:00",
        contentTypes: ["老板IP", "招聘", "公司日常", "案例"],
        active: true,
      },
      {
        id: uid("client"),
        name: "张总装修设计",
        aliases: [],
        publishIntervalDays: 2,
        defaultPublishTime: "19:30",
        contentTypes: ["案例", "避坑", "施工现场", "审美"],
        active: true,
      },
      {
        id: uid("client"),
        name: "南城餐饮",
        aliases: [],
        publishIntervalDays: 1,
        defaultPublishTime: "18:00",
        contentTypes: ["产品", "门店日常", "顾客反馈", "活动"],
        active: true,
      },
    ],
    shootSessions: [],
    videoItems: [],
    publishSlots: [],
  };

  const [clientA, clientB, clientC] = initial.clients;
  seedShoot(initial, clientA, addDays(parseDate(today), -2), [
    ["老板创业故事", "老板IP"],
    ["招聘主播标准", "招聘"],
    ["公司早会日常", "公司日常"],
  ]);
  seedShoot(initial, clientB, addDays(parseDate(today), -1), [
    ["别墅地下室避坑", "避坑"],
    ["施工现场验收", "施工现场"],
  ]);
  seedShoot(initial, clientC, today, [
    ["新品套餐上架", "产品"],
    ["晚市门店日常", "门店日常"],
  ]);
  autoScheduleAll(initial);
  persist(initial);
  return initial;
}

function seedShoot(targetState, client, date, items) {
  const session = {
    id: uid("shoot"),
    clientId: client.id,
    shootDate: typeof date === "string" ? date : formatDate(date),
    shootCount: items.length,
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

function persist(targetState = state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(targetState));
}

function render() {
  autoScheduleAll(state);
  persist();
  renderHeader();
  renderLlmStatus();
  renderClients();
  renderCalendar();
  renderSelectedDay();
  renderReminders();
}

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

function renderHeader() {
  const today = new Date();
  els.todayLabel.textContent = `${formatDate(today)} ${weekdayName(today)}`;
  els.monthTitle.textContent = `${currentMonth.getFullYear()} 年 ${currentMonth.getMonth() + 1} 月`;
}

function renderLlmStatus() {
  if (!llmStatus) {
    els.llmOverall.textContent = "检查中";
    els.llmStatus.innerHTML = `<div class="empty-state">正在读取本地配置</div>`;
    return;
  }

  const configuredCount = llmStatus.filter((provider) => provider.configured).length;
  els.llmOverall.textContent = configuredCount ? `${configuredCount} 个可用` : "未配置";
  els.llmStatus.innerHTML = llmStatus.length
    ? llmStatus
        .map(
          (provider) => `
            <article class="llm-provider">
              <div>
                <strong>${provider.name === "deepseek" ? "DeepSeek" : "Qwen"}</strong>
                <div class="llm-meta">${provider.role} · ${escapeHtml(provider.model)}</div>
              </div>
              <span class="dot ${provider.configured ? "on" : "off"}" title="${provider.configured ? "已配置" : "未配置"}"></span>
            </article>
          `,
        )
        .join("")
    : `<div class="empty-state">无法读取 LLM 状态</div>`;
}

function renderClients() {
  els.clientCount.textContent = `${state.clients.length} 个`;
  els.clientList.innerHTML = state.clients
    .map((client) => {
      const stockCount = getClientStock(client.id).length;
      return `
        <article class="client-item">
          <div class="client-head">
            <strong>${escapeHtml(client.name)}</strong>
            <span class="status-pill">${stockCount} 条库存</span>
          </div>
          <div class="meta">每 ${client.publishIntervalDays} 天 1 条 · ${client.defaultPublishTime}</div>
          ${client.aliases?.length ? `<div class="meta">别称：${client.aliases.map(escapeHtml).join("、")}</div>` : ""}
          <div class="type-row">
            ${client.contentTypes.map((type) => `<span class="type-pill">${escapeHtml(type)}</span>`).join("")}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderCalendar() {
  const days = getCalendarDays(currentMonth);
  els.calendarGrid.innerHTML = "";
  for (const day of days) {
    const dateKey = formatDate(day);
    const publishes = getPublishSlots(dateKey);
    const shoots = getShootSessions(dateKey);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = [
      "day-cell",
      day.getMonth() !== currentMonth.getMonth() ? "muted" : "",
      dateKey === formatDate(new Date()) ? "today" : "",
      dateKey === selectedDate ? "selected" : "",
    ]
      .filter(Boolean)
      .join(" ");
    cell.innerHTML = `
      <span class="date-number">${day.getDate()}</span>
      <div class="chip-stack">
        ${publishes
          .slice(0, 2)
          .map((slot) => {
            const client = findClient(slot.clientId);
            const video = findVideo(slot.videoItemId);
            return `<span class="event-chip publish">${escapeHtml(client?.name || "")} · ${escapeHtml(video?.topic || "")}</span>`;
          })
          .join("")}
        ${shoots
          .slice(0, 1)
          .map((session) => {
            const client = findClient(session.clientId);
            return `<span class="event-chip shoot">${escapeHtml(client?.name || "")} · 拍 ${session.shootCount} 条</span>`;
          })
          .join("")}
        ${publishes.length + shoots.length > 3 ? `<span class="more-chip">还有 ${publishes.length + shoots.length - 3} 项</span>` : ""}
      </div>
    `;
    cell.addEventListener("click", () => {
      selectedDate = dateKey;
      currentMonth = startOfMonth(day);
      render();
    });
    els.calendarGrid.appendChild(cell);
  }
}

function renderSelectedDay() {
  const date = parseDate(selectedDate);
  els.selectedDateTitle.textContent = `${selectedDate} ${weekdayName(date)}`;

  const publishes = getPublishSlots(selectedDate);
  els.publishList.innerHTML = publishes.length
    ? publishes
        .map((slot) => {
          const client = findClient(slot.clientId);
          const video = findVideo(slot.videoItemId);
          return `
            <article class="event-item">
              <div class="event-row">
                <strong>${escapeHtml(client?.name || "")}</strong>
                <span class="status-pill publish">${slot.publishTime}</span>
              </div>
              <div>${escapeHtml(video?.topic || "")}</div>
              <div class="event-meta">${escapeHtml(video?.contentType || "")} · ${slot.locked ? "已锁定" : "自动排期"}</div>
            </article>
          `;
        })
        .join("")
    : `<div class="empty-state">暂无发布计划</div>`;

  const shoots = getShootSessions(selectedDate);
  els.shootList.innerHTML = shoots.length
    ? shoots
        .map((session) => {
          const client = findClient(session.clientId);
          return `
            <article class="event-item">
              <div class="event-row">
                <strong>${escapeHtml(client?.name || "")}</strong>
                <span class="status-pill shoot">拍摄 ${session.shootCount} 条</span>
              </div>
              <div>${escapeHtml(session.summary)}</div>
              <div class="event-meta">已同步到素材库和发布排期</div>
            </article>
          `;
        })
        .join("")
    : `<div class="empty-state">暂无拍摄记录</div>`;
}

function renderReminders() {
  const reminders = buildReminders();
  els.reminderCount.textContent = `${reminders.length} 条`;
  els.reminderList.innerHTML = reminders.length
    ? reminders
        .map(
          (reminder) => `
            <article class="reminder-item">
              <strong>${escapeHtml(reminder.clientName)}</strong>
              <div>${escapeHtml(reminder.message)}</div>
            </article>
          `,
        )
        .join("")
    : `<div class="empty-state">暂无提醒</div>`;
}

function createClient({ name, publishIntervalDays, defaultPublishTime, contentTypes }) {
  if (!name) return null;
  const existing = state.clients.find((client) => client.name === name);
  if (existing) {
    existing.publishIntervalDays = publishIntervalDays || existing.publishIntervalDays;
    existing.defaultPublishTime = defaultPublishTime || existing.defaultPublishTime;
    existing.contentTypes = contentTypes.length ? contentTypes : existing.contentTypes;
    existing.active = true;
    render();
    return existing;
  }
  const client = {
    id: uid("client"),
    name,
    aliases: [],
    publishIntervalDays: publishIntervalDays || 1,
    defaultPublishTime: defaultPublishTime || "20:00",
    contentTypes: contentTypes.length ? contentTypes : ["案例", "干货", "日常"],
    active: true,
  };
  state.clients.push(client);
  render();
  return client;
}

function recordShoot({ client, shootDate, items }) {
  if (!client || !items.length) {
    return { ok: false, message: "没有识别到客户或拍摄内容。" };
  }
  const session = {
    id: uid("shoot"),
    clientId: client.id,
    shootDate,
    shootCount: items.length,
    summary: items.map((item) => item.topic).join("、"),
    note: "",
    createdAt: new Date().toISOString(),
  };
  state.shootSessions.push(session);
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
  autoScheduleClient(state, client.id);
  selectedDate = shootDate;
  currentMonth = startOfMonth(parseDate(shootDate));
  render();
  return {
    ok: true,
    message: `${client.name} 已记录拍摄 ${items.length} 条，并同步生成发布排期。`,
  };
}

function autoScheduleAll(targetState) {
  for (const client of targetState.clients) {
    if (client.active) autoScheduleClient(targetState, client.id);
  }
}

function autoScheduleClient(targetState, clientId) {
  const client = targetState.clients.find((item) => item.id === clientId);
  if (!client) return;
  const scheduledIds = new Set(targetState.publishSlots.map((slot) => slot.videoItemId));
  const unscheduled = targetState.videoItems
    .filter((video) => video.clientId === clientId && video.status === "待发布" && !scheduledIds.has(video.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

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

function findBestPublishDate(targetState, client, video) {
  const start = addDays(new Date(), 1);
  const candidates = [];
  for (let i = 0; i < 120; i += 1) {
    const date = formatDate(addDays(start, i));
    if (targetState.publishSlots.some((slot) => slot.clientId === client.id && slot.publishDate === date)) continue;
    if (!matchesInterval(targetState, client, date)) continue;
    candidates.push({
      date,
      score: scoreDate(targetState, client, video, date),
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.date.localeCompare(b.date));
  return candidates[0]?.date || formatDate(start);
}

function matchesInterval(targetState, client, date) {
  const clientDates = targetState.publishSlots
    .filter((slot) => slot.clientId === client.id)
    .map((slot) => slot.publishDate)
    .sort();
  if (!clientDates.length) return true;
  const previous = clientDates.filter((item) => item < date).at(-1);
  const next = clientDates.find((item) => item > date);
  if (previous && diffDays(previous, date) < client.publishIntervalDays) return false;
  if (next && diffDays(date, next) < client.publishIntervalDays) return false;
  return true;
}

function scoreDate(targetState, client, video, date) {
  let score = 1000 - diffDays(formatDate(new Date()), date);
  const previousType = getNeighborType(targetState, client.id, date, "previous");
  const nextType = getNeighborType(targetState, client.id, date, "next");
  if (previousType === video.contentType) score -= 80;
  if (nextType === video.contentType) score -= 60;
  const sameDaySameType = targetState.publishSlots.filter((slot) => {
    const item = targetState.videoItems.find((videoItem) => videoItem.id === slot.videoItemId);
    return slot.publishDate === date && item?.contentType === video.contentType;
  }).length;
  score -= sameDaySameType * 20;
  return score;
}

function getNeighborType(targetState, clientId, date, direction) {
  const slots = targetState.publishSlots
    .filter((slot) => slot.clientId === clientId)
    .sort((a, b) => a.publishDate.localeCompare(b.publishDate));
  const neighbor =
    direction === "previous"
      ? slots.filter((slot) => slot.publishDate < date).at(-1)
      : slots.find((slot) => slot.publishDate > date);
  if (!neighbor) return "";
  return targetState.videoItems.find((video) => video.id === neighbor.videoItemId)?.contentType || "";
}

async function runNaturalCommand() {
  const text = els.commandInput.value.trim();
  if (!text) return;
  setResult("正在解析指令...", "");
  const parsed = await parseCommandWithFallback(text);
  if (!parsed.ok) {
    setResult(parsed.message, "warning");
    return;
  }
  if (parsed.intent === "resolve_client") {
    showClientResolution(parsed);
    els.commandInput.value = "";
    return;
  }
  if (parsed.intent === "create_client") {
    const client = createClient(parsed.client);
    if (parsed.items?.length) {
      const result = recordShoot({
        client,
        shootDate: parsed.shootDate || formatDate(new Date()),
        items: parsed.items,
      });
      setResult(withProvider(result.message, parsed), result.ok ? "success" : "warning");
    } else {
      setResult(withProvider(`客户 ${client.name} 已新增。`, parsed), "success");
    }
  }
  if (parsed.intent === "record_shoot") {
    const result = recordShoot(parsed);
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
  els.commandInput.value = "";
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
  const response = await fetch("/api/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      today: formatDate(new Date()),
      clients: state.clients,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return normalizeLlmCommand(data.command, data.provider, text);
}

function normalizeLlmCommand(command, provider, rawText = "") {
  const intent = command?.intent || "unknown";
  if (intent === "create_client") {
    const client = normalizeClient(command.client);
    if (!client.name) return { ok: false, message: "LLM 没有识别到客户名称。" };
    return {
      ok: true,
      intent,
      provider,
      client,
      shootDate: command.shootDate || command.shoot_date || formatDate(new Date()),
      items: normalizeItems(command.items, client.contentTypes),
    };
  }

  if (intent === "record_shoot") {
    const client = findClientByName(command.client);
    const items = normalizeItems(command.items);
    const spokenName = extractShootClientName(rawText);
    if (!client) {
      return {
        ok: true,
        intent: "resolve_client",
        provider,
        unmatchedName: extractCommandClientName(command.client) || spokenName,
        shootDate: command.shootDate || command.shoot_date || formatDate(new Date()),
        items,
      };
    }
    if (spokenName && spokenName !== "未命名客户" && !clientNameMatches(client, spokenName) && !clientMatchesText(client, rawText)) {
      return {
        ok: true,
        intent: "resolve_client",
        provider,
        unmatchedName: spokenName,
        shootDate: command.shootDate || command.shoot_date || formatDate(new Date()),
        items,
      };
    }
    return {
      ok: true,
      intent,
      provider,
      client,
      shootDate: command.shootDate || command.shoot_date || formatDate(new Date()),
      items: normalizeItems(command.items, client.contentTypes),
    };
  }

  if (intent === "move_publish") {
    const client = findClientByName(command.client);
    if (!client) return { ok: false, message: "LLM 识别了调整动作，但没有匹配到客户。" };
    return {
      ok: true,
      intent,
      provider,
      client,
      topicHint: command.topicHint || command.topic_hint || "",
      targetDate: command.targetDate || command.target_date,
    };
  }

  if (intent === "cancel_publish") {
    const client = findClientByName(command.client);
    if (!client) return { ok: false, message: "LLM 识别了取消动作，但没有匹配到客户。" };
    return {
      ok: true,
      intent,
      provider,
      client,
      topicHint: command.topicHint || command.topic_hint || "",
    };
  }

  return { ok: false, message: "LLM 没有识别到可执行指令。" };
}

function normalizeClient(client = {}) {
  return {
    name: client.name || "",
    publishIntervalDays: Number(client.publishIntervalDays || client.publish_interval_days || 1),
    defaultPublishTime: client.defaultPublishTime || client.default_publish_time || "20:00",
    contentTypes: Array.isArray(client.contentTypes)
      ? client.contentTypes
      : Array.isArray(client.content_types)
        ? client.content_types
        : splitTypes(client.contentTypes || client.content_types || ""),
  };
}

function normalizeItems(items = [], fallbackTypes = []) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index) => ({
      topic: item.topic || item.title || item.summary || "",
      contentType:
        item.contentType ||
        item.content_type ||
        item.type ||
        inferType(item.topic || "", fallbackTypes[index % Math.max(fallbackTypes.length, 1)] || "日常"),
    }))
    .filter((item) => item.topic);
}

function withProvider(message, parsed) {
  return parsed.provider && parsed.provider !== "本地规则" ? `${message}（${parsed.provider} 解析）` : message;
}

function showClientResolution(parsed) {
  pendingResolution = parsed;
  const name = parsed.unmatchedName || "这个客户";
  const summary = parsed.items?.map((item) => item.topic).join("、") || "未识别到具体主题";
  els.commandResult.className = "command-result warning";
  els.commandResult.innerHTML = `
    <div class="resolution-card">
      <div>
        <strong>没有匹配到客户：${escapeHtml(name)}</strong>
        <p>已先保留本次拍摄内容：${escapeHtml(summary)}。请选择这是新客户，还是现有客户的另一个称呼。</p>
      </div>
      <div class="resolution-actions">
        <button class="primary-button" type="button" data-resolution="create">新增为客户</button>
        <select data-resolution-client>
          ${state.clients.map((client) => `<option value="${client.id}">${escapeHtml(client.name)}</option>`).join("")}
        </select>
        <button class="secondary-button" type="button" data-resolution="alias">记为别称</button>
      </div>
    </div>
  `;

  els.commandResult.querySelector('[data-resolution="create"]').addEventListener("click", resolveAsNewClient);
  els.commandResult.querySelector('[data-resolution="alias"]').addEventListener("click", resolveAsAlias);
}

function resolveAsNewClient() {
  if (!pendingResolution) return;
  const contentTypes = uniqueValues(pendingResolution.items.map((item) => item.contentType).filter(Boolean));
  const client = createClient({
    name: pendingResolution.unmatchedName || `新客户 ${state.clients.length + 1}`,
    publishIntervalDays: 1,
    defaultPublishTime: "20:00",
    contentTypes: contentTypes.length ? contentTypes : ["日常"],
  });
  const result = recordShoot({
    client,
    shootDate: pendingResolution.shootDate || formatDate(new Date()),
    items: pendingResolution.items,
  });
  const provider = pendingResolution.provider;
  pendingResolution = null;
  setResult(withProvider(result.message, { provider }), result.ok ? "success" : "warning");
}

function resolveAsAlias() {
  if (!pendingResolution) return;
  const select = els.commandResult.querySelector("[data-resolution-client]");
  const client = findClient(select?.value);
  if (!client) return;
  addAliasToClient(client, pendingResolution.unmatchedName);
  const result = recordShoot({
    client,
    shootDate: pendingResolution.shootDate || formatDate(new Date()),
    items: pendingResolution.items,
  });
  const provider = pendingResolution.provider;
  const alias = pendingResolution.unmatchedName;
  pendingResolution = null;
  setResult(withProvider(`${alias} 已记为 ${client.name} 的别称。${result.message}`, { provider }), result.ok ? "success" : "warning");
}

function parseCommand(text) {
  if (/新增|新客户|加一个客户|加客户/.test(text)) {
    return parseCreateClient(text);
  }
  if (/挪到|移动到|改到|调到/.test(text)) {
    return parseMovePublish(text);
  }
  if (/取消|删掉|不发/.test(text)) {
    return parseCancelPublish(text);
  }
  if (/拍了|拍摄|录入/.test(text)) {
    return parseRecordShoot(text);
  }
  return { ok: false, message: "暂时只识别新增客户、记录拍摄、移动排期、取消发布。" };
}

function parseCreateClient(text) {
  const name =
    matchOne(text, /叫([^，。,.\s]+?)(?:，|,|。|每天|每|$)/) ||
    matchOne(text, /客户([^，。,.\s]+?)(?:，|,|。|每天|每|$)/);
  if (!name) return { ok: false, message: "没有识别到客户名称。" };
  const interval = /两天|2\s*天|每 2 天/.test(text) ? 2 : /三天|3\s*天/.test(text) ? 3 : 1;
  const time = parseTime(text) || "20:00";
  const typesText =
    matchOne(text, /主要(?:发|做)?([^。]+?)(?:默认|今天|拍了|$)/) ||
    matchOne(text, /内容类型(?:是|为)?([^。]+?)(?:默认|今天|拍了|$)/) ||
    "";
  const client = {
    name,
    publishIntervalDays: interval,
    defaultPublishTime: time,
    contentTypes: splitTypes(typesText),
  };
  const shoot = /拍了|拍摄/.test(text) ? parseItemsFromText(text, client.contentTypes) : [];
  return {
    ok: true,
    intent: "create_client",
    client,
    shootDate: parseDateWord(text),
    items: shoot,
  };
}

function parseRecordShoot(text) {
  const client = findMentionedClient(text);
  const items = parseItemsFromText(text, client?.contentTypes || []);
  if (!client) {
    return {
      ok: true,
      intent: "resolve_client",
      provider: "本地规则",
      unmatchedName: extractShootClientName(text),
      shootDate: parseDateWord(text),
      items,
    };
  }
  return {
    ok: true,
    intent: "record_shoot",
    client,
    shootDate: parseDateWord(text),
    items,
  };
}

function parseMovePublish(text) {
  const client = findMentionedClient(text);
  if (!client) return { ok: false, message: "没有匹配到客户。" };
  const targetDate = parseTargetDate(text);
  if (!targetDate) return { ok: false, message: "没有识别到新的发布日期。" };
  const topicHint = extractTopicHint(text, client);
  return { ok: true, intent: "move_publish", client, topicHint, targetDate };
}

function parseCancelPublish(text) {
  const client = findMentionedClient(text);
  if (!client) return { ok: false, message: "没有匹配到客户。" };
  const topicHint = extractTopicHint(text, client);
  return { ok: true, intent: "cancel_publish", client, topicHint };
}

function movePublish(parsed) {
  const slot = findSlotByClientAndHint(parsed.client.id, parsed.topicHint);
  if (!slot) return { ok: false, message: "没有找到可移动的发布计划。" };
  if (!parsed.targetDate) return { ok: false, message: "没有识别到新的发布日期。" };
  slot.publishDate = parsed.targetDate;
  slot.locked = true;
  slot.source = "ai_adjusted";
  selectedDate = parsed.targetDate;
  currentMonth = startOfMonth(parseDate(parsed.targetDate));
  return { ok: true, message: `${parsed.client.name} 的发布计划已移动到 ${parsed.targetDate}。` };
}

function cancelPublish({ client, topicHint }) {
  const slot = findSlotByClientAndHint(client.id, topicHint);
  if (!slot) return { ok: false, message: "没有找到可取消的发布计划。" };
  state.publishSlots = state.publishSlots.filter((item) => item.id !== slot.id);
  const video = findVideo(slot.videoItemId);
  if (video) video.status = "待发布";
  return { ok: true, message: `${client.name} 的发布计划已取消，素材回到待发布。` };
}

function parseItemsFromText(text, fallbackTypes = []) {
  const count = Number(matchOne(text, /拍(?:了|摄)?\s*(\d+)\s*条/)) || 0;
  const afterCount = text.split(/拍(?:了|摄)?\s*\d+\s*条[，,。]?/).at(-1) || text;
  let topics = afterCount
    .replace(/第一条|第二条|第三条|第四条|第五条|第六条|第七条|第八条|第九条|第十条/g, "")
    .split(/[、，,。；;]/)
    .map((item) => item.replace(/^(是|为|主题是|内容是)/, "").trim())
    .filter(Boolean)
    .filter((item) => !/默认|每天|两天|三天|主要发|内容类型/.test(item));

  if (count && topics.length > count) topics = topics.slice(0, count);
  if (count && topics.length < count) {
    for (let index = topics.length; index < count; index += 1) {
      topics.push(`未命名内容 ${index + 1}`);
    }
  }
  return topics.map((topic, index) => ({
    topic,
    contentType: inferType(topic, fallbackTypes[index % Math.max(fallbackTypes.length, 1)] || "日常"),
  }));
}

function inferType(topic, fallback) {
  if (/案例|客户|成交/.test(topic)) return "案例";
  if (/避坑|干货|方法|技巧/.test(topic)) return "干货";
  if (/老板|创业|个人|IP/i.test(topic)) return "老板IP";
  if (/招聘|主播|招人/.test(topic)) return "招聘";
  if (/日常|办公室|门店|公司/.test(topic)) return "日常";
  if (/产品|套餐|新品/.test(topic)) return "产品";
  if (/施工|现场|工地/.test(topic)) return "施工现场";
  return fallback;
}

function findMentionedClient(text) {
  return state.clients
    .slice()
    .sort((a, b) => b.name.length - a.name.length)
    .find((client) => clientMatchesText(client, text));
}

function findClientByName(value) {
  const name = typeof value === "string" ? value : value?.name;
  if (!name) return null;
  return state.clients
    .slice()
    .sort((a, b) => b.name.length - a.name.length)
    .find((client) => clientNameMatches(client, name));
}

function clientMatchesText(client, text) {
  return [client.name, ...(client.aliases || [])].some((name) => name && text.includes(name));
}

function clientNameMatches(client, name) {
  return [client.name, ...(client.aliases || [])].some(
    (item) => item && (item === name || name.includes(item) || item.includes(name)),
  );
}

function addAliasToClient(client, alias) {
  if (!alias || alias === client.name) return;
  client.aliases = client.aliases || [];
  if (!client.aliases.includes(alias)) client.aliases.push(alias);
  persist();
  render();
}

function extractCommandClientName(value) {
  if (typeof value === "string") return value;
  return value?.name || "";
}

function extractShootClientName(text) {
  return (
    matchOne(text, /给([^，。,.\s]+?)拍/) ||
    matchOne(text, /客户([^，。,.\s]+?)(?:拍|录入|，|,|。|$)/) ||
    "未命名客户"
  );
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function findSlotByClientAndHint(clientId, topicHint) {
  const slots = state.publishSlots
    .filter((slot) => slot.clientId === clientId)
    .sort((a, b) => a.publishDate.localeCompare(b.publishDate));
  if (!topicHint) return slots[0];
  return (
    slots.find((slot) => {
      const video = findVideo(slot.videoItemId);
      return video?.topic.includes(topicHint) || video?.contentType.includes(topicHint);
    }) || slots[0]
  );
}

function extractTopicHint(text, client) {
  const beforeVerb = text.split(/挪到|移动到|改到|调到|取消|不发/)[0] || text;
  const match = beforeVerb.match(/那条([^，,。]+)/);
  return (match?.[1] || beforeVerb)
    .replace(/^把/, "")
    .replace(client?.name || "", "")
    .replace(/周[一二三四五六日天]|下周|明天|后天|今天|这条|那条/g, "")
    .trim();
}

function parseDateWord(text) {
  if (/昨天/.test(text)) return formatDate(addDays(new Date(), -1));
  if (/明天/.test(text)) return formatDate(addDays(new Date(), 1));
  return formatDate(new Date());
}

function parseTargetDate(text) {
  const direct = text.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (direct) {
    return formatDate(new Date(Number(direct[1]), Number(direct[2]) - 1, Number(direct[3])));
  }
  if (/后天/.test(text)) return formatDate(addDays(new Date(), 2));
  if (/明天/.test(text)) return formatDate(addDays(new Date(), 1));
  const weekMatch = text.match(/(下周)?(?:周)?([一二三四五六日天])/);
  if (weekMatch) {
    return nextWeekday(weekMatch[2], Boolean(weekMatch[1]));
  }
  return null;
}

function parseTime(text) {
  const hour = matchOne(text, /(?:晚上|晚|下午)?\s*(\d{1,2})\s*点/);
  if (!hour) return null;
  let value = Number(hour);
  if (/晚上|晚|下午/.test(text) && value < 12) value += 12;
  return `${String(value).padStart(2, "0")}:00`;
}

function splitTypes(value) {
  return value
    .split(/[、，,\/\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildReminders() {
  const today = formatDate(new Date());
  const until = formatDate(addDays(new Date(), 2));
  return state.clients
    .filter((client) => client.active)
    .map((client) => {
      const futureSlots = state.publishSlots.filter(
        (slot) => slot.clientId === client.id && slot.publishDate >= today && slot.publishDate <= until,
      );
      const stock = getClientStock(client.id);
      if (futureSlots.length === 0 && stock.length === 0) {
        return {
          clientName: client.name,
          message: "未来 2 天没有可发内容，准备文案和拍摄。",
        };
      }
      if (futureSlots.length === 0) {
        return {
          clientName: client.name,
          message: `有 ${stock.length} 条库存未排入未来 2 天，检查发布节奏。`,
        };
      }
      return null;
    })
    .filter(Boolean);
}

function getClientStock(clientId) {
  const scheduledIds = new Set(state.publishSlots.map((slot) => slot.videoItemId));
  return state.videoItems.filter(
    (video) => video.clientId === clientId && video.status === "待发布" && !scheduledIds.has(video.id),
  );
}

function getPublishSlots(date) {
  return state.publishSlots
    .filter((slot) => slot.publishDate === date)
    .sort((a, b) => a.publishTime.localeCompare(b.publishTime));
}

function getShootSessions(date) {
  return state.shootSessions.filter((session) => session.shootDate === date);
}

function findClient(id) {
  return state.clients.find((client) => client.id === id);
}

function findVideo(id) {
  return state.videoItems.find((video) => video.id === id);
}

function getCalendarDays(monthDate) {
  const first = startOfMonth(monthDate);
  const offset = (first.getDay() + 6) % 7;
  const start = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
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

function weekdayName(date) {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
}

function nextWeekday(word, nextWeek) {
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
  const target = map[word];
  const today = new Date();
  let delta = target - today.getDay();
  if (delta <= 0) delta += 7;
  if (nextWeek) delta += 7;
  return formatDate(addDays(today, delta));
}

function matchOne(text, regex) {
  return text.match(regex)?.[1]?.trim() || "";
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function setResult(message, type) {
  els.commandResult.textContent = message;
  els.commandResult.className = `command-result ${type || ""}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
