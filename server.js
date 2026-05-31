const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

loadEnvFile();

const PORT = Number(process.env.PORT || 5173);
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

const PROVIDERS = [
  {
    name: "deepseek",
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  },
  {
    name: "qwen",
    apiKey: process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY,
    baseUrl: process.env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: process.env.QWEN_MODEL || "qwen-plus",
  },
];

const server = http.createServer(async (req, res) => {
  try {
    // 云托管 healthcheck 探活端点
    if (req.method === "GET" && (req.url === "/healthz" || req.url === "/ping")) {
      sendJson(res, 200, { ok: true, ts: Date.now() });
      return;
    }
    if (req.method === "GET" && req.url === "/api/status") {
      handleStatus(res);
      return;
    }

    if (req.url.startsWith("/api/auth/")) {
      await handleAuth(req, res);
      return;
    }

    if (req.url.startsWith("/api/org/")) {
      await handleOrg(req, res);
      return;
    }

    if (req.url.startsWith("/api/admin/")) {
      await handleAdmin(req, res);
      return;
    }

    if (req.method === "POST" && req.url === "/api/parse") {
      await handleParse(req, res);
      return;
    }

    if (req.method === "POST" && req.url === "/api/transcribe") {
      await handleTranscribe(req, res);
      return;
    }

    if (req.url.startsWith("/api/state")) {
      await handleState(req, res);
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/avatar")) {
      await handleAvatar(req, res);
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/video-stats")) {
      await handleVideoStats(req, res);
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/profile")) {
      await handleProfile(req, res);
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/post-stats")) {
      await handlePostStats(req, res);
      return;
    }

    if (req.method === "GET") {
      serveStatic(req, res);
      return;
    }

    sendJson(res, 405, { ok: false, error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
});

// 容器里必须监听 0.0.0.0，否则平台 healthcheck 进不来
const HOST = process.env.HOST || "0.0.0.0";
server.listen(PORT, HOST, () => {
  console.log(`短视频排期助手 running at http://${HOST}:${PORT}`);
  bootstrapAdminIfEmpty();
});

// ============ State 存储（per-user）============
// 注意：DATA_DIR 在文件后段声明，所以这里用函数延迟求值
function getStateFile() { return path.join(DATA_DIR, "states.json"); }
let statesCache = null;

function loadStates() {
  if (statesCache) return statesCache;
  ensureDataDir();
  const file = getStateFile();
  if (!fs.existsSync(file)) {
    statesCache = {};
    return statesCache;
  }
  try {
    statesCache = JSON.parse(fs.readFileSync(file, "utf8")) || {};
  } catch {
    statesCache = {};
  }
  return statesCache;
}

function saveStates() {
  ensureDataDir();
  fs.writeFileSync(getStateFile(), JSON.stringify(statesCache || {}, null, 2));
}

function emptyState() {
  return {
    clients: [],
    shootSessions: [],
    videoItems: [],
    publishSlots: [],
    chatHistory: [],
    cancelledDates: [],
    lastShootSessionId: "",
    version: 0,
    updatedAt: new Date().toISOString(),
  };
}

async function handleState(req, res) {
  const session = userFromToken(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: "未登录" });
    return;
  }
  const self = session.user;
  ensurePersonalOrg(self);
  // 数据按"组织拥有者"存：states[ownerId]。默认是自己的工作区，可通过 ?org=<ownerId> 指定。
  const url = new URL(req.url, `http://${req.headers.host}`);
  const dataOwner = String(url.searchParams.get("org") || self.id);
  const org = loadOrgs()[dataOwner];
  if (!org || !isActiveMember(org, self.id)) {
    sendJson(res, 403, { ok: false, error: "你不是该组织成员" });
    return;
  }
  // 只读成员不能写
  if (req.method === "PUT" && memberEntry(org, self.id)?.role === "viewer") {
    sendJson(res, 403, { ok: false, error: "只读成员不能修改数据" });
    return;
  }
  const uid = dataOwner;
  const states = loadStates();

  if (req.method === "GET") {
    const state = normalizeStoredState(states[uid] || emptyState());
    states[uid] = state;
    saveStates();
    sendJson(res, 200, { ok: true, state });
    return;
  }
  if (req.method === "PUT") {
    const body = await readJson(req);
    const incoming = body?.state;
    if (!incoming || typeof incoming !== "object") {
      sendJson(res, 400, { ok: false, error: "缺少 state 字段" });
      return;
    }
    const current = normalizeStoredState(states[uid] || emptyState());
    const currentVersion = Number(current.version) || 0;
    const incomingVersion = Number(incoming.version) || 0;
    if (incomingVersion !== currentVersion) {
      sendJson(res, 409, { ok: false, error: "state 版本冲突，请先拉取最新数据", state: current });
      return;
    }
    // 只接受已知字段，防止脏数据
    const sanitized = {
      clients: sanitizeClients(Array.isArray(incoming.clients) ? incoming.clients : []),
      shootSessions: Array.isArray(incoming.shootSessions) ? incoming.shootSessions : [],
      videoItems: Array.isArray(incoming.videoItems) ? incoming.videoItems : [],
      publishSlots: Array.isArray(incoming.publishSlots) ? incoming.publishSlots : [],
      chatHistory: Array.isArray(incoming.chatHistory) ? incoming.chatHistory.slice(-20) : [],
      cancelledDates: Array.isArray(incoming.cancelledDates) ? incoming.cancelledDates.slice(-500) : [],
      lastShootSessionId: typeof incoming.lastShootSessionId === "string" ? incoming.lastShootSessionId : "",
      version: currentVersion + 1,
      updatedAt: new Date().toISOString(),
    };
    states[uid] = sanitized;
    saveStates();
    sendJson(res, 200, { ok: true, updatedAt: sanitized.updatedAt, version: sanitized.version });
    return;
  }
  sendJson(res, 405, { ok: false, error: "method not allowed" });
}

function normalizeStoredState(state) {
  const data = state && typeof state === "object" ? state : {};
  return {
    clients: sanitizeClients(Array.isArray(data.clients) ? data.clients : []),
    shootSessions: Array.isArray(data.shootSessions) ? data.shootSessions : [],
    videoItems: Array.isArray(data.videoItems) ? data.videoItems : [],
    publishSlots: Array.isArray(data.publishSlots) ? data.publishSlots : [],
    chatHistory: Array.isArray(data.chatHistory) ? data.chatHistory.slice(-20) : [],
    cancelledDates: Array.isArray(data.cancelledDates) ? data.cancelledDates.slice(-500) : [],
    lastShootSessionId: typeof data.lastShootSessionId === "string" ? data.lastShootSessionId : "",
    version: Number(data.version) || 0,
    updatedAt: data.updatedAt || new Date().toISOString(),
  };
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

function sanitizeClients(clients) {
  return clients.map((client) => {
    if (!client || typeof client !== "object") return client;
    const seen = new Set();
    client.aliases = (Array.isArray(client.aliases) ? client.aliases : [])
      .map((alias) => String(alias || "").trim())
      .filter((alias) => alias && alias !== client.name && !isSystemAlias(client, alias))
      .filter((alias) => {
        if (seen.has(alias)) return false;
        seen.add(alias);
        return true;
      });
    return client;
  });
}

// 容器首次启动时如果用户库还是空的，按环境变量建一个 admin
function bootstrapAdminIfEmpty() {
  try {
    const users = loadUsers();
    if (users.length > 0) return;
    const username = (process.env.BOOTSTRAP_ADMIN_USERNAME || "").trim().toLowerCase();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || "";
    if (!username || password.length < 6) {
      console.warn("[BOOTSTRAP] 用户库为空，但未配置 BOOTSTRAP_ADMIN_USERNAME / BOOTSTRAP_ADMIN_PASSWORD，跳过");
      return;
    }
    const { salt, hash } = hashPassword(password);
    users.push({
      id: `u_bootstrap_${Date.now().toString(36)}`,
      username,
      displayName: process.env.BOOTSTRAP_ADMIN_DISPLAY || username,
      role: "admin",
      salt,
      hash,
      createdAt: new Date().toISOString(),
    });
    saveUsers();
    console.log(`[BOOTSTRAP] 创建首位管理员 ${username}`);
  } catch (err) {
    console.warn("[BOOTSTRAP] 失败:", err.message);
  }
}

function handleStatus(res) {
  sendJson(res, 200, {
    ok: true,
    providers: PROVIDERS.map((provider, index) => ({
      name: provider.name,
      role: index === 0 ? "主模型" : "备用模型",
      configured: Boolean(provider.apiKey),
      baseUrl: provider.baseUrl,
      model: provider.model,
    })),
  });
}

// ============ 速率限制（防止刷 LLM/STT 钱）============
// 简单滑动窗口：per (user, ip) 两道桶。重启即清空，单进程够用；多进程需要 Redis。
const RATE_LIMITS = {
  parse:      { perMinute: 30, perHour: 200 },
  transcribe: { perMinute: 15, perHour: 120 },
};
const _rateBuckets = new Map(); // key → [{ts}, ...] 时间戳数组

function clientIp(req) {
  return (req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
}

function checkRateLimit(key, limits) {
  const now = Date.now();
  const arr = _rateBuckets.get(key) || [];
  // 只保留 1 小时内的
  const oneHourAgo = now - 3600_000;
  const oneMinAgo = now - 60_000;
  let fresh = arr.filter((ts) => ts >= oneHourAgo);
  const lastMin = fresh.filter((ts) => ts >= oneMinAgo).length;
  if (lastMin >= limits.perMinute) {
    _rateBuckets.set(key, fresh);
    return { ok: false, retryAfter: 60 - Math.floor((now - fresh.filter((ts) => ts >= oneMinAgo)[0]) / 1000) };
  }
  if (fresh.length >= limits.perHour) {
    _rateBuckets.set(key, fresh);
    return { ok: false, retryAfter: Math.max(60, Math.ceil((fresh[0] + 3600_000 - now) / 1000)) };
  }
  fresh.push(now);
  _rateBuckets.set(key, fresh);
  // 顺便清理过期 key（每 1000 次调用扫一次）
  if (_rateBuckets.size > 1000 && Math.random() < 0.01) {
    for (const [k, v] of _rateBuckets) {
      const f = v.filter((ts) => ts >= oneHourAgo);
      if (f.length === 0) _rateBuckets.delete(k);
      else if (f.length !== v.length) _rateBuckets.set(k, f);
    }
  }
  return { ok: true };
}

function checkRequestRate(kind, session, req) {
  const limits = RATE_LIMITS[kind];
  const ip = clientIp(req) || "unknown";
  const checks = [
    checkRateLimit(`${kind}:user:${session.user.id}`, limits),
    checkRateLimit(`${kind}:ip:${ip}`, limits),
  ];
  return checks.find((item) => !item.ok) || { ok: true };
}

async function handleParse(req, res) {
  // 强制登录 + 限速，防止匿名刷模型
  const session = userFromToken(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: "未登录" });
    return;
  }
  const rate = checkRequestRate("parse", session, req);
  if (!rate.ok) {
    sendJson(res, 429, { ok: false, error: `调用太频繁，${rate.retryAfter}s 后再试` });
    return;
  }
  const body = await readJson(req);
  const providers = PROVIDERS.filter((provider) => provider.apiKey);
  if (!providers.length) {
    sendJson(res, 200, {
      ok: false,
      error: "Missing DEEPSEEK_API_KEY and DASHSCOPE_API_KEY",
    });
    return;
  }

  const errors = [];
  for (const provider of providers) {
    try {
      const result = postProcessToolCalls(body, await callProvider(provider, body));
      sendJson(res, 200, { ok: true, provider: provider.name, toolCalls: result.toolCalls, assistantMessage: result.assistantMessage });
      return;
    } catch (error) {
      errors.push(`${provider.name}: ${error.message}`);
    }
  }

  sendJson(res, 200, {
    ok: false,
    error: "All LLM providers failed",
    details: errors,
  });
}

function postProcessToolCalls(payload, result) {
  const text = String(payload?.text || "");
  let toolCalls = Array.isArray(result.toolCalls) ? result.toolCalls.slice() : [];
  const setScheduleCall = inferSetClientPublishSchedule(payload, text);
  if (setScheduleCall && !toolCalls.some((call) => call.name === "set_client_publish_schedule")) {
    toolCalls = toolCalls.filter((call) => !["query_today", "query_date"].includes(call.name));
    toolCalls.unshift(setScheduleCall);
  }
  const hasRealTool = toolCalls.some((call) => call?.name && call.name !== "reply_only");
  if (!hasRealTool) {
    const queryCall = inferQueryToolCall(payload, text);
    if (queryCall) toolCalls.unshift(queryCall);
  }
  if (/穿插|重新排|重排|修改排期|排乱/.test(text) && !toolCalls.some((call) => ["rebuild_client_schedule", "set_client_publish_schedule"].includes(call.name))) {
    const callWithClient = toolCalls.find((call) => call.args?.client);
    const client = callWithClient?.args?.client || inferClientNameFromPayload(payload, text);
    if (client) {
      toolCalls.push({
        id: `call_${Date.now()}_rebuild`,
        name: "rebuild_client_schedule",
        args: { client, keepLocked: false },
      });
    }
  }
  return { ...result, toolCalls };
}

function inferSetClientPublishSchedule(payload, text) {
  const raw = String(text || "");
  const client = inferClientNameFromPayload(payload, raw);
  if (!client) return null;
  const imperative = /(从(今天|明天|后天|20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}|\d{1,2}[月/-]\d{1,2})开始发|发布.{0,8}(改成|排成|调整为)|排期.{0,8}(改成|排成|调整为)|拍摄计划.{0,8}(改成|排成|调整为))/.test(raw);
  if (!imperative) return null;
  const dates = extractScheduleDates(payload?.today, raw);
  const args = { client };
  if (dates.length > 1) args.dates = dates;
  else if (dates.length === 1) args.startDate = dates[0];
  else if (/从今天开始发/.test(raw)) args.startDate = payload?.today;
  else return null;
  return { id: `call_${Date.now()}_set_schedule`, name: "set_client_publish_schedule", args };
}

function extractScheduleDates(today, text) {
  const raw = String(text || "");
  const tokens = raw.match(/今天|明天|后天|20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}[日号]?|\d{1,2}[月/-]\d{1,2}[日号]?/g) || [];
  const dates = tokens.map((token) => {
    if (token === "今天") return addDaysYmd(today, 0);
    if (token === "明天") return addDaysYmd(today, 1);
    if (token === "后天") return addDaysYmd(today, 2);
    const match = token.match(/^20\d{2}[-/.年](\d{1,2})[-/.月](\d{1,2})/) || token.match(/^(\d{1,2})[月/-](\d{1,2})/);
    return normalizeQueryDate(today, match);
  }).filter(Boolean);
  return [...new Set(dates)];
}

function inferQueryToolCall(payload, text) {
  const raw = String(text || "");
  const client = inferClientNameFromPayload(payload, raw);
  if (client && /(为什么|怎么会|怎么排|排到|排期|后面发什么|未来发布|空档)/.test(raw) && !/(改|调整|重排|重新排|顺延|推迟|取消|删除)/.test(raw)) {
    return { id: `call_${Date.now()}_query_schedule`, name: "query_client_schedule", args: { client, limit: 20 } };
  }
  if (/统计|数据|播放|点赞|粉丝|表现|效果/.test(raw) && client) {
    return {
      id: `call_${Date.now()}_query_stats`,
      name: "query_stats",
      args: { client, scope: /周|7\s*天|七天/.test(raw) ? "week" : "month" },
    };
  }
  if (!/(发什么|发布|排期|日程|查一下|查查|看看|看一下|有没有|哪天|今天|明天|后天)/.test(raw)) return null;
  const explicitDate = raw.match(/20\d{2}[-/.年](\d{1,2})[-/.月](\d{1,2})/) || raw.match(/(\d{1,2})[月/-](\d{1,2})[日号]?/);
  let date = "";
  if (/明天/.test(raw)) date = addDaysYmd(payload?.today, 1);
  else if (/后天/.test(raw)) date = addDaysYmd(payload?.today, 2);
  else if (/昨天/.test(raw)) date = addDaysYmd(payload?.today, -1);
  else if (explicitDate) date = normalizeQueryDate(payload?.today, explicitDate);
  if (date && date !== payload?.today) {
    return { id: `call_${Date.now()}_query_date`, name: "query_date", args: { date, ...(client ? { client } : {}) } };
  }
  return { id: `call_${Date.now()}_query_today`, name: "query_today", args: client ? { client } : {} };
}

function addDaysYmd(today, days) {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(String(today || "")) ? new Date(`${today}T00:00:00+08:00`) : new Date();
  base.setDate(base.getDate() + Number(days || 0));
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, "0");
  const d = String(base.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeQueryDate(today, match) {
  if (!match) return "";
  if (/^20\d{2}/.test(match[0])) {
    const parts = match[0].replace(/[年月/.]/g, "-").replace(/日|号/g, "").split("-").filter(Boolean);
    return `${parts[0]}-${String(parts[1]).padStart(2, "0")}-${String(parts[2]).padStart(2, "0")}`;
  }
  const year = /^\d{4}-/.test(String(today || "")) ? String(today).slice(0, 4) : String(new Date().getFullYear());
  return `${year}-${String(match[1]).padStart(2, "0")}-${String(match[2]).padStart(2, "0")}`;
}

function inferClientNameFromPayload(payload, text) {
  const clients = Array.isArray(payload?.clients) ? payload.clients : [];
  const matched = clients.find((client) => {
    const names = [client?.name, ...(Array.isArray(client?.aliases) ? client.aliases : [])].filter(Boolean);
    return names.some((name) => text.includes(name));
  });
  return matched?.name || "";
}

// ============ 语音转文字（STT）============
// 前端通过 MediaRecorder（web）或 wx.getRecorderManager（mp）录音，
// Content-Type 标音频 MIME，body 是原始字节。
// 走 DashScope qwen2-audio-instruct，同步、base64 输入。
//
// 模型偶尔会加 "这段音频说的是：'...'" 这类包装，这里统一剥掉。
function stripAsrWrapper(raw) {
  if (!raw) return "";
  let t = String(raw).trim();
  // 常见前缀
  t = t.replace(/^(?:这段音频(?:的内容)?(?:说的)?(?:是|为)[:：]?\s*)/u, "");
  t = t.replace(/^(?:录音(?:的内容)?(?:说的)?(?:是|为)[:：]?\s*)/u, "");
  t = t.replace(/^(?:转写(?:结果)?[:：]?\s*)/u, "");
  t = t.replace(/^(?:内容[:：]\s*)/u, "");
  // 包成各种引号的
  t = t.replace(/^[「『"'""'']+/u, "").replace(/[」』"'""''。.]+$/u, "");
  return t.trim();
}

async function handleTranscribe(req, res) {
  const session = userFromToken(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: "未登录" });
    return;
  }
  const rate = checkRequestRate("transcribe", session, req);
  if (!rate.ok) {
    sendJson(res, 429, { ok: false, error: `识别太频繁，${rate.retryAfter}s 后再试` });
    return;
  }
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    sendJson(res, 500, { ok: false, error: "服务端未配置 DASHSCOPE_API_KEY" });
    return;
  }
  // 收音频字节（最多 10MB，避免被大文件打爆）
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of req) {
      total += chunk.length;
      if (total > 10 * 1024 * 1024) throw new Error("音频太大（>10MB）");
      chunks.push(chunk);
    }
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message });
    return;
  }
  const audioBuf = Buffer.concat(chunks);
  if (audioBuf.length < 1024) {
    sendJson(res, 400, { ok: false, error: "音频太短，重录" });
    return;
  }
  const contentType = String(req.headers["content-type"] || "audio/webm").split(";")[0].trim();
  const audioB64 = audioBuf.toString("base64");
  const dataUrl = `data:${contentType};base64,${audioB64}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const r = await fetch("https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen2-audio-instruct",
        input: {
          messages: [
            {
              role: "user",
              content: [
                { audio: dataUrl },
                { text: "仅输出这段录音的中文转写，逐字照实。不加引号、不加前后缀、不加解释、不要说‘这段音频说的是’之类的话。如果听不清，只回复空字符串。" },
              ],
            },
          ],
        },
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data.message || data.error?.message || `HTTP ${r.status}`;
      sendJson(res, 200, { ok: false, error: `ASR 失败：${msg}` });
      return;
    }
    // qwen-audio-instruct：output.choices[0].message.content 可能是字符串，或 [{text:"..."}]
    const choice = data?.output?.choices?.[0]?.message?.content;
    let text = "";
    if (typeof choice === "string") text = choice;
    else if (Array.isArray(choice)) text = choice.map((c) => c?.text || "").join("").trim();
    text = stripAsrWrapper((text || "").trim());
    if (!text) {
      sendJson(res, 200, { ok: false, error: "没识别到内容" });
      return;
    }
    sendJson(res, 200, { ok: true, text });
  } catch (err) {
    sendJson(res, 200, { ok: false, error: err.name === "AbortError" ? "ASR 超时" : err.message });
  } finally {
    clearTimeout(timer);
  }
}

async function callProvider(provider, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        temperature: 0.2,
        messages: buildMessages(payload),
        tools: buildToolSchemas(),
        tool_choice: "auto",
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error?.message || `HTTP ${response.status}`);
    }

    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("Empty LLM response");
    const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const toolCalls = rawCalls
      .map((call, idx) => {
        if (call?.type && call.type !== "function") return null;
        const fn = call?.function || call;
        const name = String(fn?.name || "").trim();
        if (!name) return null;
        let args = fn?.arguments;
        if (typeof args === "string") {
          try { args = JSON.parse(args); } catch { args = {}; }
        }
        const id = String(call.id || `call_${Date.now()}_${idx}`);
        return { id, name, args: args || {} };
      })
      .filter(Boolean);
    const assistantMessage = String(message.content || "").trim();
    if (!toolCalls.length && !assistantMessage) {
      throw new Error("Provider returned no actionable response");
    }
    return { toolCalls, assistantMessage };
  } finally {
    clearTimeout(timer);
  }
}

function buildMessages({ text, today, clients, existingTopics, recentShoots, scheduleContext, chatHistory }) {
  const clientSummary = (clients || [])
    .map((client) => {
      const types = (client.contentTypes || []).join("、");
      return `- ${client.name}：每 ${client.publishIntervalDays} 天 1 条，${client.defaultPublishTime}，类型：${types}`;
    })
    .join("\n");

  const systemLines = [
    "你是短视频代运营的智能排期助手，叫小拍。和用户对话时口语一点，像朋友帮忙记事，偶尔顺便提醒一句。",
    "你能调用一组工具帮用户操作系统（建客户/排拍摄/记发布/查询等）。同一条消息允许按顺序调用多个工具完成多件事，最后再用 reply_only 总结一句。",
    "如果已经调用真实工具，reply_only 只能总结本轮动作意图或结果，禁止只说‘我看看/我查一下/我先处理’这种没有执行结论的话。",
    "今天的日期由 today 字段给出，必须用它做相对日期换算。日期参数全用 YYYY-MM-DD，时间用 24 小时 HH:MM。",
    "客户名必须按用户原话原样传给工具，不要私自替换为列表里的现有客户名，前端会负责模糊匹配。",
    "用户没明说数字时绝对不要替他猜：count/shootCount 别填。模糊或缺关键参数时不要调工具，直接 reply_only 用一句口语反问。",
    "用户问‘今天/明天/某天发什么、有没有排期、查一下、看看、统计’时，必须调用 query_today/query_date/query_stats/search_videos/query_video_shoot 等查询工具；禁止只用 reply_only 说‘我查查/我看看’。",
    "上下文 recentShoots 字段里列着近期拍摄会话（含 sessionId/client/shootDate/shootCount）。当用户说‘修正/改一下/不止 X 条/其实 X 条/重新算’等修正语义时，优先用 update_shoot_count 修改已存在的会话，绝不要新建。",
    "用户说‘还有/存片/库存/补录某天拍的 N 条’时，用 record_shoot，并填对应 shootDate。若用户同时说‘穿插着发/重新排/修改排期/排乱了’，record_shoot 后必须再调用 rebuild_client_schedule，keepLocked=false；包含‘穿插’二字时绝不能只记录不重排。",
    "用户说‘删除重复/去重/越排越多/排重了’时，用 dedupe_client_data。用户说‘删除某天拍摄记录/删掉 X 日拍摄’时，用 delete_shoot_session，不要只取消发布。",
    "用户说‘从今天/某天开始发’或明确列出多个发布日期时，用 set_client_publish_schedule。只给起始日期时填 startDate；逐条指定日期时填 dates。不要只查询，也不要用 rebuild_client_schedule 代替。",
    "上下文 scheduleContext 包含未来发布、待发布素材和近期取消记录。涉及排期原因、排到哪天、为什么有空档时先结合它判断；用户只是询问时用 query_client_schedule，不要擅自修改。",
    "你可以大胆调用合适工具完成明确指令。删除、批量重排、整体顺延、减少素材等敏感动作由前端统一弹窗确认，不要因为担心权限而只回复空话。",
    "existingTopics 字段里列着已经被占用的视频简称（每条 ≤6 字）。提炼新主题时务必避开它们，且新主题之间也要互不重名。",
    "回话风格：友人型，简短自然，偶尔插一句轻提醒（比如‘顺便提醒下还有一条周五没排’）。不要 Markdown 或代码块。",
  ];

  const messages = [
    { role: "system", content: systemLines.join("\n") },
    {
      role: "system",
      content: JSON.stringify(
        {
          today,
          clients: clientSummary,
          existingTopics: Array.isArray(existingTopics) ? existingTopics : [],
          recentShoots: Array.isArray(recentShoots) ? recentShoots : [],
          scheduleContext: scheduleContext || {},
        },
        null,
        2,
      ),
    },
  ];

  if (Array.isArray(chatHistory)) {
    for (const turn of chatHistory.slice(-20)) {
      if (!turn || typeof turn !== "object") continue;
      if (turn.role === "tool") {
        if (!turn.tool_call_id) continue;
        messages.push({
          role: "tool",
          tool_call_id: String(turn.tool_call_id),
          name: turn.name ? String(turn.name) : undefined,
          content: String(turn.content || ""),
        });
        continue;
      }
      if (turn.role === "assistant") {
        const msg = { role: "assistant", content: String(turn.content || "") };
        if (Array.isArray(turn.tool_calls) && turn.tool_calls.length) {
          msg.tool_calls = turn.tool_calls.map((c) => ({
            id: String(c.id || ""),
            type: "function",
            function: { name: String(c.function?.name || c.name || ""), arguments: typeof c.function?.arguments === "string" ? c.function.arguments : JSON.stringify(c.function?.arguments || c.args || {}) },
          }));
        }
        messages.push(msg);
        continue;
      }
      const content = String(turn.content || "").trim();
      if (!content) continue;
      messages.push({ role: "user", content });
    }
  }

  messages.push({ role: "user", content: String(text || "") });
  return messages;
}

// ============ Tool 定义 ============
function buildToolSchemas() {
  const tool = (name, description, properties, required = []) => ({
    type: "function",
    function: { name, description, parameters: { type: "object", properties, required } },
  });
  const s = (description) => ({ type: "string", description });
  const i = (description) => ({ type: "integer", description });
  const arrS = (description) => ({ type: "array", items: { type: "string" }, description });
  const arrItems = (description) => ({
    type: "array",
    description,
    items: { type: "object", properties: { topic: { type: "string" }, contentType: { type: "string" } } },
  });
  return [
    tool("reply_only", "只回一句话，不执行任何系统动作。用于反问、澄清或最终的口语化总结。每次回复结尾都应有一次 reply_only。", { message: s("回给用户的口语化中文一句话") }, ["message"]),
    tool("create_client", "新增客户。", { name: s("客户名"), publishIntervalDays: i("每隔几天 1 条，默认 1"), defaultPublishTime: s("默认发布时间 HH:MM，默认 17:00"), contentTypes: arrS("内容类型") }, ["name"]),
    tool("rename_client", "客户改名。", { client: s("旧名"), newName: s("新名") }, ["client", "newName"]),
    tool("add_client_alias", "给客户加别名。", { client: s("客户名"), alias: s("别名") }, ["client", "alias"]),
    tool("remove_client_alias", "删客户某个别名。", { client: s("客户名"), alias: s("别名") }, ["client", "alias"]),
    tool("update_client_settings", "改频率或默认发布时间。", { client: s("客户名"), publishIntervalDays: i("隔几天 1 条"), defaultPublishTime: s("HH:MM") }, ["client"]),
    tool("update_client_types", "改内容类型列表。", { client: s("客户名"), contentTypes: arrS("类型列表") }, ["client", "contentTypes"]),
    tool("delete_client", "删客户（前端会确认）。", { client: s("客户名") }, ["client"]),
    tool("bind_account", "绑抖音/小红书/视频号。", { client: s("客户名"), platform: { type: "string", enum: ["douyin", "xhs", "channels"] }, identifier: s("链接或账号原文") }, ["client", "platform", "identifier"]),
    tool("plan_shoot", "排拍摄计划。用户没说数量时 shootCount 别填。", { client: s("客户名"), shootDate: s("YYYY-MM-DD"), shootCount: i("条数"), contentType: s("内容类型"), items: arrItems("具体每条") }, ["client"]),
    tool("record_shoot", "记录已完成拍摄。", { client: s("客户名"), shootDate: s("YYYY-MM-DD"), items: arrItems("每条"), shootCount: i("只说数量没说主题时用") }, ["client"]),
    tool("append_to_shoot", "在最近一次拍摄上追加 N 条。", { client: s("客户名"), count: i("追加几条"), contentType: s("可选") }, ["count"]),
    tool("update_shoot_count", "修正某次拍摄的总条数。", { client: s("客户名"), newCount: i("新总条数"), shootDate: s("YYYY-MM-DD"), sessionId: s("recentShoots 里的 sessionId") }, ["newCount"]),
    tool("move_shoot_plan", "把拍摄计划挪到另一天。", { client: s("客户名"), targetDate: s("YYYY-MM-DD") }, ["client", "targetDate"]),
    tool("postpone_shoot_plan", "用户说今天没拍/改明天/延期拍摄时，把最近一条拍摄计划顺延。明确说了哪天用 targetDate，明确说了延几天用 days；如果只说'延期/顺延'没给具体天数或日期，targetDate 和 days 都别填，让前端来问。", { client: s("客户名"), targetDate: s("YYYY-MM-DD，可选"), days: i("顺延天数，仅在用户明确说了几天时填") }, ["client"]),
    tool("cancel_shoot_plan", "取消拍摄计划。", { client: s("客户名") }, ["client"]),
    tool("delete_shoot_session", "删除已完成或计划中的拍摄记录，并删除它生成的素材和发布。按 sessionId 最准，也可按 client+shootDate。", { client: s("客户名"), shootDate: s("YYYY-MM-DD"), sessionId: s("recentShoots 里的 sessionId，可选"), allOnDate: { type: "boolean", description: "是否删除该客户当天全部拍摄记录" } }, []),
    tool("dedupe_client_data", "清理某客户重复拍摄/重复素材/重复发布，然后重排未来排期。用于‘删除重复/去重/排重了/越排越多’。", { client: s("客户名") }, ["client"]),
    tool("rebuild_client_schedule", "重新生成某客户未来发布排期。用户说‘修改排期/重新排/穿插着发/全部重排/锁住的也重排’时 keepLocked=false；只想保留手动锁定时 keepLocked=true。", { client: s("客户名"), keepLocked: { type: "boolean", description: "是否保留未来锁定发布，默认 true；彻底重排填 false" } }, ["client"]),
    tool("set_client_publish_schedule", "按明确起始日或逐条指定日期重排某客户当前全部待发布素材。用户说‘从今天开始发’填 startDate；用户列出多个日期时填 dates。", { client: s("客户名"), startDate: s("YYYY-MM-DD，可选；按客户频率从这天开始排"), dates: arrS("逐条指定的发布日期 YYYY-MM-DD，数量必须和待发布素材一致") }, ["client"]),
    tool("update_shoot_topics", "用户粘了多条文案，给每条提炼 ≤6 字简称。", {
      client: s("客户名，可选"),
      items: {
        type: "array",
        description: "每条文案 1 项",
        items: {
          type: "object",
          properties: {
            index: { type: "integer", description: "1 起序号" },
            topic: { type: "string", description: "≤6 字简称，避开 existingTopics" },
            contentType: { type: "string", description: "内容类型" },
          },
          required: ["index", "topic"],
        },
      },
    }, ["items"]),
    tool("rename_video", "改视频简称。", { oldTopicHint: s("旧简称关键词"), newTopic: s("新简称 ≤6 字"), client: s("客户名，可选") }, ["oldTopicHint", "newTopic"]),
    tool("retype_video", "改某条视频的内容类型。", { topicHint: s("视频关键词"), contentType: s("新类型"), client: s("客户名，可选") }, ["topicHint", "contentType"]),
    tool("delete_video", "删某条视频。", { topicHint: s("视频关键词"), client: s("客户名，可选") }, ["topicHint"]),
    tool("mark_published", "标为已发。", { topicHint: s("视频关键词"), client: s("客户名，可选") }, ["topicHint"]),
    tool("move_publish", "改某条发布的日期。", { client: s("客户名"), topicHint: s("视频关键词"), targetDate: s("YYYY-MM-DD") }, ["client", "targetDate"]),
    tool("cancel_publish", "取消某条发布。可按日期取消（推荐），也可按视频关键词。", { client: s("客户名"), date: s("YYYY-MM-DD，要取消那天的发布"), topicHint: s("视频关键词，可选") }, ["client"]),
    tool("reschedule_time", "改某条发布的具体时间。", { client: s("客户名"), topicHint: s("视频关键词"), targetTime: s("HH:MM") }, ["topicHint", "targetTime"]),
    tool("shift_day", "把某天发布顺延 N 天。", { sourceDate: s("YYYY-MM-DD"), days: i("天数"), client: s("客户名，可选") }, ["sourceDate", "days"]),
    tool("skip_day", "跳过某天的发布。", { sourceDate: s("YYYY-MM-DD"), client: s("客户名，可选") }, ["sourceDate"]),
    tool("shift_all", "把客户所有未来发布整体推 N 天。", { client: s("客户名"), days: i("天数") }, ["client", "days"]),
    tool("query_today", "查今天发什么。", { client: s("客户名，可选") }, []),
    tool("query_date", "查某天发什么。", { date: s("YYYY-MM-DD"), client: s("客户名，可选") }, ["date"]),
    tool("query_client_schedule", "查某客户未来发布排期、空档和排到哪天。用户问为什么排到某月、当前怎么排、后面发什么时使用。", { client: s("客户名"), limit: i("最多列多少条，默认 20") }, ["client"]),
    tool("query_stats", "查客户统计。", { client: s("客户名"), scope: { type: "string", enum: ["month", "week", "all"] } }, ["client"]),
    tool("search_videos", "按关键词找视频。", { keyword: s("关键词"), client: s("客户名，可选") }, ["keyword"]),
    tool("query_video_shoot", "问某条视频是哪次/哪天拍的。", { topicHint: s("视频关键词"), client: s("客户名，可选") }, ["topicHint"]),
    tool("help", "用户问怎么用 / 我能说什么。", {}, []),
  ];
}

function parseJsonContent(content) {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("LLM response is not JSON");
    return JSON.parse(match[0]);
  }
}

const TIKHUB_BASE = (process.env.TIKHUB_BASE_URL || "https://api.tikhub.io").replace(/\/$/, "");
const ACCOUNT_DATA_CACHE_MS = 24 * 60 * 60 * 1000;
const PROFILE_CACHE_MS = ACCOUNT_DATA_CACHE_MS;
const POST_STATS_CACHE_MS = ACCOUNT_DATA_CACHE_MS;
const avatarCache = new Map();

async function handleAvatar(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const profileUrl = (url.searchParams.get("url") || "").trim();
  const directSecId = (url.searchParams.get("sec_user_id") || "").trim();
  if (!profileUrl && !directSecId) {
    sendJson(res, 400, { ok: false, error: "缺少 url 或 sec_user_id 参数" });
    return;
  }

  const token = process.env.TIKHUB_TOKEN;
  if (!token) {
    sendJson(res, 503, { ok: false, error: "服务端未配置 TIKHUB_TOKEN" });
    return;
  }

  const cacheKey = directSecId || profileUrl;
  const cached = avatarCache.get(cacheKey);
  if (cached && Date.now() - cached.at < PROFILE_CACHE_MS) {
    sendJson(res, 200, { ok: true, ...cached.value, cached: true });
    return;
  }

  try {
    const secUserId = directSecId || (await resolveSecUserId(profileUrl, token));
    if (!secUserId) {
      sendJson(res, 200, { ok: false, error: "未能解析主页链接到 sec_user_id" });
      return;
    }
    const profile = await fetchUserProfile(secUserId, token);
    avatarCache.set(cacheKey, { at: Date.now(), value: profile });
    sendJson(res, 200, { ok: true, ...profile });
  } catch (error) {
    sendJson(res, 200, { ok: false, error: error.message });
  }
}

async function resolveSecUserId(profileUrl, token) {
  const endpoint = `${TIKHUB_BASE}/api/v1/douyin/web/get_sec_user_id?url=${encodeURIComponent(profileUrl)}`;
  const data = await tikhubFetch(endpoint, token);
  if (typeof data?.data === "string") return data.data;
  if (Array.isArray(data?.data) && data.data.length) return data.data[0];
  return null;
}

async function fetchUserProfile(secUserId, token) {
  const endpoint = `${TIKHUB_BASE}/api/v1/douyin/web/handler_user_profile?sec_user_id=${encodeURIComponent(secUserId)}`;
  const data = await tikhubFetch(endpoint, token);
  const user = data?.data?.user || {};
  const pickUrl = (node) => (Array.isArray(node?.url_list) && node.url_list[0]) || "";
  return {
    secUserId,
    nickname: user.nickname || "",
    uniqueId: user.unique_id || "",
    signature: user.signature || "",
    followerCount: Number(user.follower_count) || 0,
    awemeCount: Number(user.aweme_count) || 0,
    totalFavorited: Number(user.total_favorited) || 0,
    followingCount: Number(user.following_count) || 0,
    avatarSmall: pickUrl(user.avatar_thumb) || pickUrl(user.avatar_168x168) || pickUrl(user.avatar_300x300),
    avatarLarge: pickUrl(user.avatar_300x300) || pickUrl(user.avatar_larger) || pickUrl(user.avatar_thumb),
  };
}

const videoStatsCache = new Map();

async function handleVideoStats(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const profileUrl = (url.searchParams.get("url") || "").trim();
  let secUserId = (url.searchParams.get("sec_user_id") || "").trim();
  const count = Math.min(Math.max(Number(url.searchParams.get("count") || 20), 1), 50);
  if (!profileUrl && !secUserId) {
    sendJson(res, 400, { ok: false, error: "缺少 url 或 sec_user_id 参数" });
    return;
  }

  const token = process.env.TIKHUB_TOKEN;
  if (!token) {
    sendJson(res, 503, { ok: false, error: "服务端未配置 TIKHUB_TOKEN" });
    return;
  }

  try {
    if (!secUserId) secUserId = await resolveSecUserId(profileUrl, token);
    if (!secUserId) {
      sendJson(res, 200, { ok: false, error: "未能解析主页链接到 sec_user_id" });
      return;
    }
    const cacheKey = `${secUserId}:${count}`;
    const cached = videoStatsCache.get(cacheKey);
    if (cached && Date.now() - cached.at < POST_STATS_CACHE_MS) {
      sendJson(res, 200, { ok: true, secUserId, videos: cached.videos, cached: true });
      return;
    }
    const posts = await fetchUserPostList(secUserId, count, token);
    if (!posts.length) {
      videoStatsCache.set(cacheKey, { at: Date.now(), videos: [] });
      sendJson(res, 200, { ok: true, secUserId, videos: [] });
      return;
    }
    const aweme_ids = posts.map((p) => p.awemeId);
    const statsMap = await fetchMultiVideoStatistics(aweme_ids, token);
    const videos = posts.map((p) => {
      const s = statsMap[p.awemeId] || {};
      return {
        awemeId: p.awemeId,
        desc: p.desc,
        createTime: p.createTime,
        cover: p.cover,
        playCount: s.playCount ?? p.playCount ?? 0,
        diggCount: s.diggCount ?? p.diggCount ?? 0,
        shareCount: s.shareCount ?? p.shareCount ?? 0,
        commentCount: p.commentCount ?? 0,
        downloadCount: s.downloadCount ?? 0,
      };
    });
    videoStatsCache.set(cacheKey, { at: Date.now(), videos });
    sendJson(res, 200, { ok: true, secUserId, videos });
  } catch (error) {
    sendJson(res, 200, { ok: false, error: error.message });
  }
}

async function fetchUserPostList(secUserId, count, token) {
  // Web 端点会滞后数天；App V3 端点能返回抖音主页最新作品。
  const endpoint = `${TIKHUB_BASE}/api/v1/douyin/app/v3/fetch_user_post_videos?sec_user_id=${encodeURIComponent(secUserId)}&max_cursor=0&count=${count}&sort_type=0`;
  const data = await tikhubFetch(endpoint, token);
  const list = data?.data?.aweme_list || [];
  return list.map((item) => {
    const stats = item.statistics || {};
    const cover = item.video?.cover?.url_list?.[0] || item.video?.origin_cover?.url_list?.[0] || "";
    return {
      awemeId: String(item.aweme_id || ""),
      desc: item.desc || "",
      createTime: Number(item.create_time) || 0,
      cover,
      diggCount: Number(stats.digg_count) || 0,
      shareCount: Number(stats.share_count) || 0,
      commentCount: Number(stats.comment_count) || 0,
      playCount: Number(stats.play_count) || 0,
    };
  }).sort((a, b) => b.createTime - a.createTime);
}

async function fetchMultiVideoStatistics(awemeIds, token) {
  if (!awemeIds.length) return {};
  const endpoint = `${TIKHUB_BASE}/api/v1/douyin/app/v3/fetch_multi_video_statistics?aweme_ids=${encodeURIComponent(awemeIds.join(","))}`;
  const data = await tikhubFetch(endpoint, token);
  const list = data?.data?.statistics_list || [];
  const map = {};
  for (const s of list) {
    map[String(s.aweme_id)] = {
      playCount: Number(s.play_count) || 0,
      diggCount: Number(s.digg_count) || 0,
      shareCount: Number(s.share_count) || 0,
      downloadCount: Number(s.download_count) || 0,
    };
  }
  return map;
}

const profileCache = new Map();
const postStatsCache = new Map();

async function handleProfile(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const platform = (url.searchParams.get("platform") || "").trim();
  const refresh = url.searchParams.get("refresh") === "1";
  const token = process.env.TIKHUB_TOKEN;
  if (!token) {
    sendJson(res, 503, { ok: false, error: "服务端未配置 TIKHUB_TOKEN" });
    return;
  }
  try {
    if (platform === "douyin") {
      const profileUrl = (url.searchParams.get("url") || "").trim();
      const search = (url.searchParams.get("search") || "").trim();
      const directSecId = (url.searchParams.get("identifier") || url.searchParams.get("sec_user_id") || "").trim();
      if (!profileUrl && !directSecId && search) {
        const candidates = await searchDouyinUsers(search, token);
        sendJson(res, 200, { ok: true, platform: "douyin", candidates });
        return;
      }
      const cacheKey = `douyin:${directSecId || profileUrl}`;
      const cached = profileCache.get(cacheKey);
      if (!refresh && cached && Date.now() - cached.at < PROFILE_CACHE_MS) {
        sendJson(res, 200, { ok: true, ...cached.value, cached: true });
        return;
      }
      const secUserId = directSecId
        ? await normalizeDouyinIdentifier(directSecId, token)
        : await resolveSecUserId(profileUrl, token);
      if (!secUserId) { sendJson(res, 200, { ok: false, error: "未能解析抖音主页" }); return; }
      const profile = await fetchUserProfile(secUserId, token);
      const result = {
        platform: "douyin",
        identifier: profileUrl || `https://www.douyin.com/user/${secUserId}`,
        secUserId,
        nickname: profile.nickname,
        uniqueId: profile.uniqueId,
        signature: profile.signature,
        avatarSmall: profile.avatarSmall,
        avatarLarge: profile.avatarLarge,
        followerCount: profile.followerCount,
        postCount: profile.awemeCount,
        totalFavorited: profile.totalFavorited,
      };
      profileCache.set(cacheKey, { at: Date.now(), value: result });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }
    if (platform === "xhs") {
      const shareInput = (url.searchParams.get("url") || "").trim();
      const searchInput = (url.searchParams.get("search") || "").trim();
      const directId = (url.searchParams.get("identifier") || url.searchParams.get("user_id") || "").trim();
      const userId = directId || (await resolveXhsUserId(shareInput));
      if (!userId) {
        const keyword = searchInput || extractXhsSearchTerm(shareInput);
        if (keyword) {
          const candidates = await searchXhsUsers(keyword, token);
          sendJson(res, 200, { ok: true, platform: "xhs", candidates });
          return;
        }
        sendJson(res, 200, { ok: false, error: "未能解析小红书主页（请粘贴完整 user/profile/ 链接）" });
        return;
      }
      const cacheKey = `xhs:${userId}`;
      const cached = profileCache.get(cacheKey);
      if (!refresh && cached && Date.now() - cached.at < PROFILE_CACHE_MS) {
        sendJson(res, 200, { ok: true, ...cached.value, cached: true });
        return;
      }
      const data = await tikhubFetch(`${TIKHUB_BASE}/api/v1/xiaohongshu/web/get_user_info?user_id=${encodeURIComponent(userId)}`, token);
      const u = data?.data?.data || {};
      const result = {
        platform: "xhs",
        identifier: userId,
        userId,
        nickname: u.nickname || "",
        uniqueId: u.red_id ? String(u.red_id) : "",
        signature: u.desc || "",
        avatarSmall: u.images || "",
        avatarLarge: u.imageb || u.images || "",
        followerCount: Number(u.fans) || 0,
        postCount: 0,
        totalFavorited: Number(u.liked) || 0,
      };
      profileCache.set(cacheKey, { at: Date.now(), value: result });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }
    if (platform === "channels") {
      const search = (url.searchParams.get("search") || "").trim();
      const username = (url.searchParams.get("identifier") || url.searchParams.get("username") || "").trim();
      if (username) {
        const cacheKey = `channels:${username}`;
        const cached = profileCache.get(cacheKey);
        if (!refresh && cached && Date.now() - cached.at < PROFILE_CACHE_MS) {
          sendJson(res, 200, { ok: true, ...cached.value, cached: true });
          return;
        }
        const home = await fetchChannelsHome(username, token, { refresh });
        const result = {
          platform: "channels",
          identifier: username,
          userName: username,
          nickname: home.nickname,
          uniqueId: home.nickname,
          signature: home.signature,
          avatarSmall: home.avatar,
          avatarLarge: home.avatar,
          followerCount: 0,
          postCount: home.postCount,
          totalFavorited: home.totalDigg,
        };
        profileCache.set(cacheKey, { at: Date.now(), value: result });
        sendJson(res, 200, { ok: true, ...result });
        return;
      }
      if (search) {
        const candidates = await searchChannels(search, token);
        sendJson(res, 200, { ok: true, platform: "channels", candidates });
        return;
      }
      sendJson(res, 400, { ok: false, error: "缺少 search 或 identifier 参数" });
      return;
    }
    sendJson(res, 400, { ok: false, error: `未知 platform: ${platform}` });
  } catch (error) {
    sendJson(res, 200, { ok: false, error: error.message });
  }
}

async function handlePostStats(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const platform = (url.searchParams.get("platform") || "").trim();
  const identifier = (url.searchParams.get("identifier") || "").trim();
  const refresh = url.searchParams.get("refresh") === "1";
  const count = Math.min(Math.max(Number(url.searchParams.get("count") || 20), 1), 50);
  const token = process.env.TIKHUB_TOKEN;
  if (!token) { sendJson(res, 503, { ok: false, error: "服务端未配置 TIKHUB_TOKEN" }); return; }
  if (!identifier) { sendJson(res, 400, { ok: false, error: "缺少 identifier 参数" }); return; }
  const cacheKey = `${platform}:${identifier}:${count}`;
  const cached = postStatsCache.get(cacheKey);
  if (!refresh && cached && Date.now() - cached.at < POST_STATS_CACHE_MS) {
    sendJson(res, 200, { ok: true, platform, posts: cached.posts, cached: true });
    return;
  }
  try {
    let posts = [];
    if (platform === "douyin") {
      const list = await fetchUserPostList(identifier, count, token);
      if (list.length) {
        const statsMap = await fetchMultiVideoStatistics(list.map((p) => p.awemeId), token);
        posts = list.map((p) => ({
          id: p.awemeId,
          desc: p.desc,
          createTime: p.createTime,
          cover: p.cover,
          playCount: statsMap[p.awemeId]?.playCount ?? p.playCount ?? 0,
          diggCount: statsMap[p.awemeId]?.diggCount ?? p.diggCount ?? 0,
          shareCount: statsMap[p.awemeId]?.shareCount ?? p.shareCount ?? 0,
          commentCount: p.commentCount ?? 0,
        }));
      }
    } else if (platform === "xhs") {
      posts = await fetchXhsUserNotes(identifier, count, token);
    } else if (platform === "channels") {
      posts = await fetchChannelsPosts(identifier, count, token, { refresh });
    } else {
      sendJson(res, 400, { ok: false, error: `未知 platform: ${platform}` });
      return;
    }
    postStatsCache.set(cacheKey, { at: Date.now(), posts });
    sendJson(res, 200, { ok: true, platform, posts });
  } catch (error) {
    sendJson(res, 200, { ok: false, error: error.message });
  }
}

async function resolveXhsUserId(input) {
  if (!input) return "";
  const firstUrl = String(input).match(/https?:\/\/[^\s，。]+/i)?.[0] || "";
  if (firstUrl && firstUrl !== input) return resolveXhsUserId(firstUrl);
  const direct = input.match(/\/user\/profile\/([a-f0-9]{16,32})/i);
  if (direct) return direct[1];
  const bare = input.match(/\b([a-f0-9]{20,32})\b/i);
  if (bare) return bare[1];
  if (/xhslink\.com/.test(input)) {
    try {
      const response = await fetch(input, { redirect: "follow" });
      const finalUrl = response.url;
      const m = finalUrl.match(/\/user\/profile\/([a-f0-9]{16,32})/i);
      if (m) return m[1];
    } catch {}
  }
  return "";
}

function extractXhsSearchTerm(input = "") {
  return String(input)
    .replace(/https?:\/\/[^\s，。]+/ig, "")
    .replace(/在小红书.*$/g, "")
    .replace(/查看Ta的主页.*/g, "")
    .replace(/^@/, "")
    .trim();
}

async function searchXhsUsers(keyword, token) {
  const endpoint = `${TIKHUB_BASE}/api/v1/xiaohongshu/web_v3/fetch_search_users?keyword=${encodeURIComponent(keyword)}&page=1`;
  const data = await tikhubFetch(endpoint, token);
  const users = data?.data?.data?.users || data?.data?.users || [];
  return users.slice(0, 10).map((user) => ({
    identifier: user.id || "",
    nickname: user.name || "",
    uniqueId: user.redId || "",
    avatar: user.image || "",
    authInfo: user.subTitle || "",
    desc: [user.fans ? `${user.fans} 粉` : "", user.noteCount ? `${user.noteCount} 笔记` : ""].filter(Boolean).join(" · "),
    followerCount: Number(user.fans) || 0,
  })).filter((candidate) => candidate.identifier);
}

async function searchChannels(keyword, token) {
  for (const endpoint of [
    `${TIKHUB_BASE}/api/v1/wechat_channels/fetch_user_search_v2?keywords=${encodeURIComponent(keyword)}&page=1`,
    `${TIKHUB_BASE}/api/v1/wechat_channels/fetch_user_search?keywords=${encodeURIComponent(keyword)}&page=1`,
  ]) {
    try {
      const data = await tikhubFetch(endpoint, token);
      const items = data?.data?.items || [];
      const candidates = items.slice(0, 10).map((item) => ({
        userName: item.jumpInfo?.userName || "",
        nickname: stripHtmlTags(item.title),
        avatar: item.thumbUrl || "",
        authInfo: item.authInfo || "",
        desc: stripHtmlTags(item.desc),
      })).filter((c) => c.userName);
      if (candidates.length) return candidates;
    } catch {}
  }
  return searchChannelsFromOrdinary(keyword, token);
}

async function searchChannelsFromOrdinary(keyword, token) {
  const items = await fetchChannelsSearchItems(keyword, token);
  const byName = new Map();
  for (const item of items) {
    const title = stripHtmlTags(item.source?.title || "");
    if (!title) continue;
    const existing = byName.get(title) || {
      userName: `search:${title}`,
      nickname: title,
      avatar: item.source?.iconUrl || "",
      authInfo: "综合搜索",
      desc: "",
      followerCount: 0,
      _count: 0,
    };
    existing._count += 1;
    if (!existing.desc) existing.desc = stripHtmlTags(item.title || item.desc || "");
    if (!existing.avatar && item.source?.iconUrl) existing.avatar = item.source.iconUrl;
    byName.set(title, existing);
  }
  return [...byName.values()]
    .sort((a, b) => b._count - a._count)
    .slice(0, 10)
    .map(({ _count, ...candidate }) => ({ ...candidate, authInfo: `${candidate.authInfo} · ${_count} 条相关作品` }));
}

async function fetchChannelsSearchItems(keyword, token) {
  const endpoint = `${TIKHUB_BASE}/api/v1/wechat_channels/fetch_search_ordinary?keywords=${encodeURIComponent(keyword)}`;
  const data = await tikhubFetch(endpoint, token);
  return data?.data?.items || data?.data?.object_list || [];
}

function stripHtmlTags(value) {
  return String(value || "").replace(/<[^>]+>/g, "");
}

function decodeSearchUsername(username = "") {
  return username.startsWith("search:") ? username.slice(7) : "";
}

async function fetchChannelsSearchProfile(keyword, token) {
  const items = await fetchChannelsSearchItems(keyword, token);
  const matched = items.filter((item) => stripHtmlTags(item.source?.title || "") === keyword || stripHtmlTags(item.source?.title || "").includes(keyword) || keyword.includes(stripHtmlTags(item.source?.title || "")));
  const useItems = matched.length ? matched : items;
  const first = useItems[0] || {};
  return {
    nickname: stripHtmlTags(first.source?.title || keyword),
    avatar: first.source?.iconUrl || "",
    signature: "来自视频号综合搜索",
    postCount: useItems.length,
    totalDigg: useItems.reduce((sum, item) => sum + Number(item.likeNum || item.like_num || 0), 0),
    searchItems: useItems,
  };
}

function mapChannelsSearchPost(item) {
  return {
    id: String(item.docID || item.docId || item.exportId || item.hashDocID || ""),
    desc: stripHtmlTags(item.title || item.desc || ""),
    createTime: Number(item.pubTime || item.publishTime || item.createtime || 0),
    cover: item.image || item.cover || "",
    playCount: 0,
    diggCount: Number(item.likeNum || item.like_num || 0),
    shareCount: Number(item.forwardNum || item.forward_count || 0),
    commentCount: Number(item.commentNum || item.comment_count || 0),
  };
}

async function searchDouyinUsers(keyword, token) {
  const endpoint = `${TIKHUB_BASE}/api/v1/douyin/creator/fetch_user_search?user_name=${encodeURIComponent(keyword)}`;
  const data = await tikhubFetch(endpoint, token);
  const rawItems = findCandidateArray(data, (item) => {
    const user = item?.user_info || item?.user || item;
    return user?.sec_uid || user?.sec_user_id || user?.secUid || user?.uid || user?.user_id || user?.short_id;
  });
  return rawItems.slice(0, 20).map((item) => {
    const user = item?.user_info || item?.user || item;
    const avatar = pickMediaUrl(user.avatar_thumb || user.avatar_medium || user.avatar_larger) || user.avatar || user.avatarUrl || "";
    const shortId = user.unique_id || user.uniqueId || user.short_id || "";
    const secUserId = user.sec_uid || user.sec_user_id || user.secUid || shortId;
    return {
      identifier: secUserId,
      nickname: user.nickname || user.nick_name || "",
      uniqueId: shortId,
      avatar,
      authInfo: user.custom_verify || user.enterprise_verify_reason || "",
      desc: user.signature || "",
      followerCount: Number(user.follower_count || user.followers_count || user.mplatform_followers_count || 0),
    };
  }).filter((candidate) => candidate.identifier);
}

async function normalizeDouyinIdentifier(identifier, token) {
  if (/^MS4wLjAB/i.test(identifier)) return identifier;
  const endpoint = `${TIKHUB_BASE}/api/v1/douyin/web/fetch_user_profile_by_short_id?short_id=${encodeURIComponent(identifier)}`;
  const data = await tikhubFetch(endpoint, token);
  return data?.data?.data?.user?.sec_uid || data?.data?.user?.sec_uid || identifier;
}

function findCandidateArray(value, predicate) {
  const seen = new Set();
  const queue = [value];
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      if (current.some((item) => item && typeof item === "object" && predicate(item))) return current;
      queue.push(...current);
    } else {
      queue.push(...Object.values(current));
    }
  }
  return [];
}

function pickMediaUrl(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node?.url_list) && node.url_list[0]) return node.url_list[0];
  if (Array.isArray(node?.urlList) && node.urlList[0]) return node.urlList[0];
  return "";
}

const channelsHomeCache = new Map();

async function fetchChannelsHomePayload(username, token, { refresh = false } = {}) {
  const cached = channelsHomeCache.get(username);
  if (!refresh && cached && Date.now() - cached.at < ACCOUNT_DATA_CACHE_MS) return cached.data;
  const endpoint = `${TIKHUB_BASE}/api/v1/wechat_channels/fetch_home_page`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ username, last_buffer: "" }),
  });
  const data = await response.json().catch(() => ({}));
  channelsHomeCache.set(username, { at: Date.now(), data });
  return data;
}

async function fetchChannelsHome(username, token, { refresh = false } = {}) {
  const searchKeyword = decodeSearchUsername(username);
  if (searchKeyword) return fetchChannelsSearchProfile(searchKeyword, token);
  const data = await fetchChannelsHomePayload(username, token, { refresh });
  const objects = data?.data?.object || [];
  let nickname = "", avatar = "", signature = "", totalDigg = 0;
  for (const obj of objects) {
    const contact = obj.contact;
    if (contact?.nickname && !nickname) {
      nickname = contact.nickname;
      avatar = contact.headUrl || contact.head_img_url || "";
      signature = contact.signature || "";
    }
    totalDigg += Number(obj.like_count || obj.likeCount || 0);
  }
  return { nickname, avatar, signature, postCount: objects.length, totalDigg };
}

async function fetchChannelsPosts(username, count, token, { refresh = false } = {}) {
  const searchKeyword = decodeSearchUsername(username);
  if (searchKeyword) {
    const profile = await fetchChannelsSearchProfile(searchKeyword, token);
    return (profile.searchItems || []).slice(0, count).map(mapChannelsSearchPost);
  }
  const data = await fetchChannelsHomePayload(username, token, { refresh });
  const objects = data?.data?.object || [];
  return objects.slice(0, count).map((obj) => {
    const media = obj.media || obj.objectDesc?.media?.[0] || {};
    const cover = media.thumbUrl || media.coverUrl || media.url || "";
    return {
      id: String(obj.id || obj.docId || ""),
      desc: obj.objectDesc?.description || obj.desc || "",
      createTime: Number(obj.createtime || obj.create_time || obj.publishTime || 0),
      cover,
      playCount: 0,
      diggCount: Number(obj.like_count || obj.likeCount || 0),
      shareCount: Number(obj.forward_count || obj.share_count || 0),
      commentCount: Number(obj.comment_count || obj.commentCount || 0),
    };
  });
}

async function fetchXhsUserNotes(userId, count, token) {
  const endpoint = `${TIKHUB_BASE}/api/v1/xiaohongshu/app_v2/get_user_posted_notes?user_id=${encodeURIComponent(userId)}`;
  const data = await tikhubFetch(endpoint, token);
  const list = data?.data?.data?.notes || [];
  return list.slice(0, count).map((n) => ({
    id: String(n.id || ""),
    desc: n.title || n.desc || "",
    createTime: Number(n.create_time || n.time || 0),
    cover: (n.images_list && n.images_list[0]?.url) || "",
    playCount: Number(n.view_count || 0),
    diggCount: Number(n.likes || n.liked_count || 0),
    shareCount: Number(n.share_count || 0),
    commentCount: Number(n.comments_count || 0),
  }));
}

async function tikhubFetch(url, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data?.detail;
      const msg = typeof detail === "object"
        ? (detail.message_zh || detail.message || JSON.stringify(detail))
        : (detail || data?.message || `tikhub HTTP ${response.status}`);
      throw new Error(msg);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// ========== Auth & Admin ==========

// 数据目录：本地默认在项目里；云托管/容器里用 DATA_DIR 环境变量指到挂载盘
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const ORGS_FILE = path.join(DATA_DIR, "orgs.json");
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
let usersCache = null;
let sessionsCache = null;
let orgsCache = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadUsers() {
  if (usersCache) return usersCache;
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) {
    usersCache = [];
    return usersCache;
  }
  try {
    usersCache = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    if (!Array.isArray(usersCache)) usersCache = [];
  } catch {
    usersCache = [];
  }
  return usersCache;
}

function saveUsers() {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(usersCache || [], null, 2));
}

// ===== 组织（工作区）=====
// 模型：每个用户有且只有一个"个人工作区"，orgs[ownerId]，数据 = states[ownerId]。
// "创建组织" = 给自己的工作区命名 + 邀请成员；被邀请者接受后读写同一份 states[ownerId]。
function loadOrgs() {
  if (orgsCache) return orgsCache;
  ensureDataDir();
  if (!fs.existsSync(ORGS_FILE)) { orgsCache = {}; return orgsCache; }
  try {
    orgsCache = JSON.parse(fs.readFileSync(ORGS_FILE, "utf8"));
    if (!orgsCache || typeof orgsCache !== "object") orgsCache = {};
  } catch { orgsCache = {}; }
  return orgsCache;
}
function saveOrgs() {
  ensureDataDir();
  fs.writeFileSync(ORGS_FILE, JSON.stringify(orgsCache || {}, null, 2));
}
function findUserById(id) { return loadUsers().find((u) => u.id === id) || null; }
function findUserByUsername(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return null;
  return loadUsers().find((u) => u.username.toLowerCase() === n) || null;
}
function userLabel(userId) {
  const u = findUserById(userId);
  return { username: u?.username || "", displayName: u?.displayName || u?.username || userId };
}
function ensurePersonalOrg(user) {
  const orgs = loadOrgs();
  if (!orgs[user.id]) {
    orgs[user.id] = {
      id: user.id,
      ownerId: user.id,
      name: `${user.displayName || user.username}的工作区`,
      createdAt: new Date().toISOString(),
      members: [{ userId: user.id, role: "owner", status: "active", at: new Date().toISOString() }],
    };
    saveOrgs();
  } else if (!orgs[user.id].members.some((m) => m.userId === user.id)) {
    orgs[user.id].members.unshift({ userId: user.id, role: "owner", status: "active", at: new Date().toISOString() });
    saveOrgs();
  }
  return orgs[user.id];
}
function userOrgs(userId) {
  return Object.values(loadOrgs()).filter((o) => (o.members || []).some((m) => m.userId === userId));
}
function memberEntry(org, userId) {
  return (org?.members || []).find((m) => m.userId === userId) || null;
}
function isActiveMember(org, userId) {
  const m = memberEntry(org, userId);
  return Boolean(m && m.status === "active");
}
function orgPublic(org, selfId) {
  const me = memberEntry(org, selfId);
  return {
    id: org.id,
    ownerId: org.ownerId,
    name: org.name,
    ownerName: userLabel(org.ownerId).displayName,
    myRole: me?.role || "",
    myStatus: me?.status || "",
    members: (org.members || []).map((m) => {
      const lbl = userLabel(m.userId);
      return { userId: m.userId, username: lbl.username, displayName: lbl.displayName, role: m.role, status: m.status };
    }),
  };
}

async function handleOrg(req, res) {
  const session = userFromToken(req);
  if (!session) { sendJson(res, 401, { ok: false, error: "未登录" }); return; }
  const self = session.user;
  const url = new URL(req.url, `http://${req.headers.host}`);
  const action = url.pathname.split("/")[3] || "";
  ensurePersonalOrg(self);
  const orgs = loadOrgs();

  if (req.method === "GET" && action === "mine") {
    const list = userOrgs(self.id).map((o) => orgPublic(o, self.id));
    const invites = list.filter((o) => o.myStatus === "invited");
    sendJson(res, 200, { ok: true, self: { id: self.id, username: self.username, displayName: self.displayName }, orgs: list, invites });
    return;
  }
  if (req.method !== "POST") { sendJson(res, 405, { ok: false, error: "method not allowed" }); return; }
  const body = await readJson(req);

  if (action === "rename") {
    const org = orgs[self.id];
    const name = String(body.name || "").trim();
    if (!name) { sendJson(res, 400, { ok: false, error: "组织名不能为空" }); return; }
    org.name = name.slice(0, 40);
    saveOrgs();
    sendJson(res, 200, { ok: true, org: orgPublic(org, self.id) });
    return;
  }

  if (action === "invite") {
    const orgId = String(body.orgId || self.id);
    const org = orgs[orgId];
    if (!org) { sendJson(res, 404, { ok: false, error: "组织不存在" }); return; }
    const mine = memberEntry(org, self.id);
    if (!mine || mine.status !== "active" || (mine.role !== "owner" && mine.role !== "editor")) {
      sendJson(res, 403, { ok: false, error: "没权限邀请" }); return;
    }
    const target = findUserByUsername(body.username);
    if (!target) { sendJson(res, 404, { ok: false, error: "没找到这个账号，对方要先注册" }); return; }
    if (target.id === org.ownerId) { sendJson(res, 400, { ok: false, error: "TA 就是组织拥有者" }); return; }
    const role = body.role === "viewer" ? "viewer" : "editor";
    const existing = memberEntry(org, target.id);
    if (existing && existing.status === "active") {
      sendJson(res, 200, { ok: true, already: true, org: orgPublic(org, self.id) });
      return;
    }
    if (existing) {
      existing.role = role; existing.status = "invited"; existing.invitedBy = self.id; existing.at = new Date().toISOString();
    } else {
      org.members.push({ userId: target.id, role, status: "invited", invitedBy: self.id, at: new Date().toISOString() });
    }
    saveOrgs();
    sendJson(res, 200, { ok: true, org: orgPublic(org, self.id) });
    return;
  }

  if (action === "respond") {
    const org = orgs[String(body.orgId || "")];
    if (!org) { sendJson(res, 404, { ok: false, error: "组织不存在" }); return; }
    const m = memberEntry(org, self.id);
    if (!m || m.status !== "invited") { sendJson(res, 400, { ok: false, error: "没有待处理的邀请" }); return; }
    if (body.accept) { m.status = "active"; m.at = new Date().toISOString(); }
    else { org.members = org.members.filter((x) => x.userId !== self.id); }
    saveOrgs();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (action === "member") {
    const orgId = String(body.orgId || self.id);
    const org = orgs[orgId];
    if (!org) { sendJson(res, 404, { ok: false, error: "组织不存在" }); return; }
    if (org.ownerId !== self.id) { sendJson(res, 403, { ok: false, error: "只有拥有者能管理成员" }); return; }
    const targetId = String(body.userId || "");
    if (targetId === org.ownerId) { sendJson(res, 400, { ok: false, error: "不能修改拥有者" }); return; }
    const m = memberEntry(org, targetId);
    if (!m) { sendJson(res, 404, { ok: false, error: "成员不存在" }); return; }
    if (body.role === "remove") { org.members = org.members.filter((x) => x.userId !== targetId); }
    else if (body.role === "editor" || body.role === "viewer") { m.role = body.role; }
    else { sendJson(res, 400, { ok: false, error: "role 不合法" }); return; }
    saveOrgs();
    sendJson(res, 200, { ok: true, org: orgPublic(org, self.id) });
    return;
  }

  if (action === "leave") {
    const org = orgs[String(body.orgId || "")];
    if (!org) { sendJson(res, 404, { ok: false, error: "组织不存在" }); return; }
    if (org.ownerId === self.id) { sendJson(res, 400, { ok: false, error: "拥有者不能退出自己的工作区" }); return; }
    org.members = org.members.filter((x) => x.userId !== self.id);
    saveOrgs();
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { ok: false, error: "未知操作" });
}

function loadSessions() {
  if (sessionsCache) return sessionsCache;
  ensureDataDir();
  if (!fs.existsSync(SESSIONS_FILE)) {
    sessionsCache = {};
    return sessionsCache;
  }
  try {
    sessionsCache = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
    if (!sessionsCache || typeof sessionsCache !== "object") sessionsCache = {};
  } catch {
    sessionsCache = {};
  }
  // 清理过期
  const now = Date.now();
  for (const [token, info] of Object.entries(sessionsCache)) {
    if (!info?.expiresAt || info.expiresAt < now) delete sessionsCache[token];
  }
  return sessionsCache;
}

function saveSessions() {
  ensureDataDir();
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessionsCache || {}, null, 2));
}

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password || ""), useSalt, 64).toString("hex");
  return { salt: useSalt, hash };
}

function verifyPassword(password, salt, hash) {
  const actual = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}

function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

function userFromToken(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const sessions = loadSessions();
  const info = sessions[token];
  if (!info) return null;
  if (info.expiresAt < Date.now()) {
    delete sessions[token];
    saveSessions();
    return null;
  }
  const user = loadUsers().find((u) => u.id === info.userId);
  if (!user) return null;
  return { token, user };
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    role: user.role || "member",
    createdAt: user.createdAt,
  };
}

function isAdminRequest(req) {
  const adminToken = process.env.ADMIN_TOKEN;
  const bootstrapToken = req.headers["x-admin-token"];
  const bearerToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (adminToken && (bootstrapToken === adminToken || bearerToken === adminToken)) return true;

  const session = userFromToken(req);
  return session?.user?.role === "admin";
}

function adminUserCount(users) {
  return users.filter((user) => user.role === "admin").length;
}

async function handleAuth(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  if (path === "/api/auth/login" && req.method === "POST") {
    const body = await readJson(req);
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!username || !password) {
      sendJson(res, 400, { ok: false, error: "请输入账号和密码" });
      return;
    }
    const user = loadUsers().find((u) => u.username.toLowerCase() === username);
    if (!user || !verifyPassword(password, user.salt, user.hash)) {
      sendJson(res, 401, { ok: false, error: "账号或密码错误" });
      return;
    }
    const token = newToken();
    const sessions = loadSessions();
    sessions[token] = { userId: user.id, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS };
    saveSessions();
    sendJson(res, 200, { ok: true, token, user: publicUser(user), expiresAt: sessions[token].expiresAt });
    return;
  }
  if (path === "/api/auth/me" && req.method === "GET") {
    const session = userFromToken(req);
    if (!session) {
      sendJson(res, 401, { ok: false, error: "未登录或令牌过期" });
      return;
    }
    sendJson(res, 200, { ok: true, user: publicUser(session.user) });
    return;
  }
  if (path === "/api/auth/logout" && req.method === "POST") {
    const session = userFromToken(req);
    if (session) {
      const sessions = loadSessions();
      delete sessions[session.token];
      saveSessions();
    }
    sendJson(res, 200, { ok: true });
    return;
  }
  sendJson(res, 404, { ok: false, error: "未知 auth 接口" });
}

async function handleAdmin(req, res) {
  if (!isAdminRequest(req)) {
    sendJson(res, 401, { ok: false, error: "需要管理员账号" });
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  const segments = url.pathname.split("/").filter(Boolean);
  // /api/admin/users  or /api/admin/users/:id
  if (segments[2] === "users") {
    if (req.method === "GET" && !segments[3]) {
      const users = loadUsers().map(publicUser);
      sendJson(res, 200, { ok: true, users });
      return;
    }
    if (req.method === "POST" && !segments[3]) {
      const body = await readJson(req);
      const username = String(body.username || "").trim().toLowerCase();
      const password = String(body.password || "");
      const displayName = String(body.displayName || body.display_name || "").trim();
      const role = body.role === "admin" ? "admin" : "member";
      if (!username || !password) {
        sendJson(res, 400, { ok: false, error: "username 和 password 必填" });
        return;
      }
      if (password.length < 6) {
        sendJson(res, 400, { ok: false, error: "密码至少 6 位" });
        return;
      }
      const users = loadUsers();
      if (users.some((u) => u.username.toLowerCase() === username)) {
        sendJson(res, 409, { ok: false, error: "账号已存在" });
        return;
      }
      const { salt, hash } = hashPassword(password);
      const user = {
        id: `u_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`,
        username,
        displayName: displayName || username,
        role,
        salt,
        hash,
        createdAt: new Date().toISOString(),
      };
      users.push(user);
      saveUsers();
      sendJson(res, 200, { ok: true, user: publicUser(user) });
      return;
    }
    if (req.method === "DELETE" && segments[3]) {
      const id = segments[3];
      const users = loadUsers();
      const idx = users.findIndex((u) => u.id === id);
      if (idx < 0) {
        sendJson(res, 404, { ok: false, error: "用户不存在" });
        return;
      }
      if (users[idx].role === "admin" && adminUserCount(users) <= 1) {
        sendJson(res, 400, { ok: false, error: "至少保留一个管理员" });
        return;
      }
      users.splice(idx, 1);
      saveUsers();
      // 顺手清掉该用户的 session
      const sessions = loadSessions();
      for (const [t, info] of Object.entries(sessions)) {
        if (info.userId === id) delete sessions[t];
      }
      saveSessions();
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "PATCH" && segments[3]) {
      const id = segments[3];
      const body = await readJson(req);
      const users = loadUsers();
      const user = users.find((u) => u.id === id);
      if (!user) {
        sendJson(res, 404, { ok: false, error: "用户不存在" });
        return;
      }
      if (typeof body.displayName === "string") user.displayName = body.displayName.trim() || user.displayName;
      if (body.role === "admin" || body.role === "member") {
        if (user.role === "admin" && body.role === "member" && adminUserCount(users) <= 1) {
          sendJson(res, 400, { ok: false, error: "至少保留一个管理员" });
          return;
        }
        user.role = body.role;
      }
      if (typeof body.password === "string" && body.password) {
        if (body.password.length < 6) {
          sendJson(res, 400, { ok: false, error: "密码至少 6 位" });
          return;
        }
        const next = hashPassword(body.password);
        user.salt = next.salt;
        user.hash = next.hash;
      }
      saveUsers();
      sendJson(res, 200, { ok: true, user: publicUser(user) });
      return;
    }
  }
  sendJson(res, 404, { ok: false, error: "未知 admin 接口" });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  if (isBlockedStaticPath(pathname)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  const filePath = path.normalize(path.join(ROOT, pathname));

  if (!filePath.startsWith(ROOT)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendText(res, 404, "File not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function isBlockedStaticPath(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.includes("data") || parts.includes(".git") || parts.includes(".claude") || parts.includes(".preview")) return true;
  const base = parts.at(-1) || "";
  if (base === ".env" || base.startsWith(".env.") || base === "cloud-env.json") return true;
  return false;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}
