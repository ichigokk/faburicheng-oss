// 纯逻辑：state 操作（创建/查询/修改）
// 设计：所有函数接收 state 作为入参，原地 mutate；返回 {ok, message}
const { formatDate, addDays, parseDate } = require("./date");

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueValues(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function findClient(state, id) {
  return (state.clients || []).find((c) => c.id === id);
}

function findClientByName(state, value) {
  const name = typeof value === "string" ? value : value?.name;
  if (!name) return null;
  return (state.clients || [])
    .slice()
    .sort((a, b) => b.name.length - a.name.length)
    .find((c) => clientNameMatches(c, name));
}

function findVideo(state, id) {
  return (state.videoItems || []).find((v) => v.id === id);
}

function findShootSession(state, id) {
  return (state.shootSessions || []).find((s) => s.id === id);
}

function clientNameMatches(client, name) {
  return [client.name, ...(client.aliases || [])].some(
    (item) => item && (item === name || name.includes(item) || item.includes(name)),
  );
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

function cleanClientAliases(client) {
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
}

function fallbackShootTopic(shootDate, contentType, index) {
  return `${shootDate || formatDate(new Date())} ${contentType || "内容"} ${index + 1}`;
}

function isPlaceholderTopic(topic = "") {
  const t = String(topic).trim();
  if (!t) return true;
  if (/^(未命名内容|待定拍摄内容)(?:\s*\d+)?$/.test(t)) return true;
  if (/^\d{4}-\d{2}-\d{2}\s+\S+\s+\d+$/.test(t)) return true;
  return false;
}

function trimToMaxChars(str, max) {
  return Array.from(String(str || "").trim()).slice(0, max).join("");
}

function makeUniqueTopic(rawTopic, taken) {
  const base = trimToMaxChars(rawTopic, 6);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 20; i += 1) {
    const cand = trimToMaxChars(base, 6 - String(i).length) + i;
    if (!taken.has(cand)) return cand;
  }
  return base + Date.now().toString().slice(-2);
}

function diffDays(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

// ============ 客户 CRUD ============

function createClient(state, { name, publishIntervalDays = 1, defaultPublishTime = "17:00", contentTypes = ["日常"] }) {
  const cleanName = name || `新客户 ${state.clients.length + 1}`;
  const existing = findClientByName(state, cleanName);
  if (existing) return existing;
  const client = {
    id: uid("client"),
    name: cleanName,
    aliases: [],
    publishIntervalDays: Math.max(1, publishIntervalDays || 1),
    defaultPublishTime: defaultPublishTime || "17:00",
    contentTypes: contentTypes.length ? contentTypes : ["日常"],
    active: true,
    accounts: [],
    needsProfileTodo: false,
  };
  state.clients.push(client);
  return client;
}

function renameClient(state, { client, newName }) {
  const trimmed = String(newName || "").trim();
  if (!trimmed) return { ok: false, message: "新名字不能空。" };
  if (state.clients.some((c) => c.id !== client.id && c.name === trimmed)) {
    return { ok: false, message: `已经有个客户叫 ${trimmed} 了。` };
  }
  const oldName = client.name;
  client.name = trimmed;
  if (oldName && oldName !== trimmed) addAliasToClient(client, oldName);
  return { ok: true, message: `${oldName} 改名为 ${trimmed}。` };
}

function addClientAlias(state, { client, alias }) {
  cleanClientAliases(client);
  if (!alias) return { ok: false, message: "别名我没听清。" };
  if (isSystemAlias(client, alias)) return { ok: false, message: "这是平台账号标识，不作为客户别名保存。" };
  if (alias === client.name) return { ok: false, message: "跟正名一样不用加。" };
  if ((client.aliases || []).includes(alias)) return { ok: true, message: `${client.name} 已经有 ${alias} 这个别名了。` };
  addAliasToClient(client, alias);
  cleanClientAliases(client);
  return { ok: true, message: `${client.name} 加了别名 ${alias}。` };
}

function removeClientAlias(state, { client, alias }) {
  if (!Array.isArray(client.aliases) || !client.aliases.includes(alias)) {
    return { ok: false, message: `${client.name} 没有 ${alias} 这个别名。` };
  }
  client.aliases = client.aliases.filter((a) => a !== alias);
  return { ok: true, message: `${client.name} 去掉了 ${alias}。` };
}

function updateClientSettings(state, { client, publishIntervalDays, defaultPublishTime }) {
  const changes = [];
  let reflowedCount = 0;
  if (publishIntervalDays) {
    const newInterval = Math.max(1, Math.min(Number(publishIntervalDays), 30));
    const changed = newInterval !== client.publishIntervalDays;
    client.publishIntervalDays = newInterval;
    changes.push(`每 ${client.publishIntervalDays} 天 1 条`);
    if (changed) {
      reflowedCount = reflowFutureSlots(state, client.id);
    }
  }
  let updatedSlots = 0;
  if (defaultPublishTime && /^\d{1,2}:\d{2}$/.test(defaultPublishTime)) {
    const normalized = defaultPublishTime.length === 4 ? "0" + defaultPublishTime : defaultPublishTime;
    client.defaultPublishTime = normalized;
    changes.push(`默认 ${normalized} 发`);
    const today = formatDate(new Date());
    for (const slot of state.publishSlots) {
      if (slot.clientId === client.id && !slot.locked && slot.publishDate > today && slot.publishTime !== normalized) {
        slot.publishTime = normalized;
        updatedSlots += 1;
      }
    }
  }
  if (!changes.length) return { ok: false, message: "没看到要改的。" };
  autoScheduleClient(state, client.id);
  const parts = [];
  if (reflowedCount > 0) parts.push(`${reflowedCount} 条日程按新节奏重排了`);
  if (updatedSlots > 0) parts.push(`${updatedSlots} 条发布时间跟着改了`);
  const tail = parts.length ? `，${parts.join("，")}。` : "。";
  return { ok: true, message: `${client.name} 改成${changes.join("、")}${tail}` };
}

function reflowFutureSlots(state, clientId) {
  const today = formatDate(new Date());
  let removed = 0;
  const removedVideoIds = new Set();
  state.publishSlots = state.publishSlots.filter((slot) => {
    if (slot.clientId !== clientId) return true;
    if (slot.locked) return true;
    if (slot.publishDate <= today) return true;
    removed += 1;
    removedVideoIds.add(slot.videoItemId);
    return false;
  });
  for (const video of state.videoItems) {
    if (removedVideoIds.has(video.id) && video.status !== "已发布") video.status = "待发布";
  }
  return removed;
}

function removeFutureSlotsForClient(state, clientId, { keepLocked = true } = {}) {
  const today = formatDate(new Date());
  const removedVideoIds = new Set();
  let removed = 0;
  state.publishSlots = state.publishSlots.filter((slot) => {
    if (slot.clientId !== clientId) return true;
    if (slot.publishDate <= today) return true;
    if (keepLocked && slot.locked) return true;
    removed += 1;
    removedVideoIds.add(slot.videoItemId);
    return false;
  });
  for (const video of state.videoItems) {
    if (removedVideoIds.has(video.id) && video.status !== "已发布") video.status = "待发布";
  }
  return removed;
}

function rebuildClientSchedule(state, { client, keepLocked = true } = {}) {
  if (!client) return { ok: false, message: "我没找到这个客户。" };
  const removed = removeFutureSlotsForClient(state, client.id, { keepLocked });
  autoScheduleClient(state, client.id);
  return { ok: true, message: `${client.name} 未来排期已重排${keepLocked ? "，手动锁定的保留了" : "，包括原来锁住的也重新排了"}（清理 ${removed} 条）。` };
}

function setClientPublishSchedule(state, { client, startDate = "", dates = [] } = {}) {
  if (!client) return { ok: false, message: "我没找到这个客户。" };
  const today = formatDate(new Date());
  const videos = orderVideosForScheduling(state, state.videoItems.filter((video) =>
    video.clientId === client.id && video.status === "待发布" && isVideoReady(state, video)
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
  return { ok: true, message: `${client.name} 的 ${videos.length} 条待发布已改成：${targetDates.join("、")}。` };
}

function deleteShootSession(state, { client, shootDate, sessionId, allOnDate = false } = {}) {
  let sessions = [];
  if (sessionId) {
    const session = findShootSession(state, sessionId);
    if (session) sessions = [session];
  } else if (client && shootDate) {
    sessions = state.shootSessions.filter((session) => session.clientId === client.id && session.shootDate === shootDate);
    if (!allOnDate && sessions.length > 1) {
      sessions = sessions.sort((a, b) => (b.completedAt || b.createdAt || "").localeCompare(a.completedAt || a.createdAt || "")).slice(0, 1);
    }
  }
  if (!sessions.length) return { ok: false, message: "没找到要删的拍摄记录。" };
  const sessionIds = new Set(sessions.map((session) => session.id));
  const videoIds = new Set(state.videoItems.filter((video) => sessionIds.has(video.shootSessionId)).map((video) => video.id));
  state.shootSessions = state.shootSessions.filter((session) => !sessionIds.has(session.id));
  state.videoItems = state.videoItems.filter((video) => !videoIds.has(video.id));
  state.publishSlots = state.publishSlots.filter((slot) => !videoIds.has(slot.videoItemId));
  if (state.lastShootSessionId && sessionIds.has(state.lastShootSessionId)) state.lastShootSessionId = "";
  if (client) autoScheduleClient(state, client.id);
  return { ok: true, message: `已删除 ${sessions.length} 条拍摄记录和对应素材/发布。` };
}

function dedupeClientData(state, { client } = {}) {
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
  rebuildClientSchedule(state, { client, keepLocked: false });
  return { ok: true, message: `${client.name} 去重完成：删了 ${removedSessions} 条重复拍摄、${removeVideoIds.size} 条重复素材、${removedSlots} 条重复发布，并已重排。` };
}

function updateClientTypes(state, { client, contentTypes }) {
  const cleaned = uniqueValues((contentTypes || []).map((t) => String(t).trim())).filter(Boolean);
  if (!cleaned.length) return { ok: false, message: "新的内容类型我没看清。" };
  client.contentTypes = cleaned;
  return { ok: true, message: `${client.name} 的内容类型改成：${cleaned.join("、")}。` };
}

function deleteClient(state, { client }) {
  const clientVideoIds = new Set(state.videoItems.filter((v) => v.clientId === client.id).map((v) => v.id));
  state.clients = state.clients.filter((c) => c.id !== client.id);
  state.shootSessions = state.shootSessions.filter((s) => s.clientId !== client.id);
  state.videoItems = state.videoItems.filter((v) => v.clientId !== client.id);
  state.publishSlots = state.publishSlots.filter(
    (slot) => slot.clientId !== client.id && !clientVideoIds.has(slot.videoItemId),
  );
  return { ok: true, message: `${client.name} 已删除。` };
}

// ============ 拍摄 ============

function ensurePlannedShootItems(items, fallbackTypes = [], shootDate = formatDate(new Date())) {
  const normalized = (items || [])
    .filter((it) => (it?.topic || "").trim())
    .map((it, i) => ({
      topic: it.topic,
      contentType: it.contentType || fallbackTypes[i % Math.max(fallbackTypes.length, 1)] || "日常",
      shootPeriod: it.shootPeriod || "",
    }));
  if (normalized.length) return normalized;
  return [
    {
      topic: fallbackShootTopic(shootDate, fallbackTypes[0] || "内容", 0),
      contentType: fallbackTypes[0] || "日常",
      shootPeriod: "",
    },
  ];
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

function findDuplicateShootSession(state, clientId, shootDate, items = []) {
  const key = shootDuplicateKey(shootDate, items);
  return (state.shootSessions || [])
    .filter((session) => session.clientId === clientId && session.shootDate === shootDate && session.status === "completed")
    .find((session) => {
      const sessionItems = Array.isArray(session.items) && session.items.length
        ? session.items
        : (state.videoItems || []).filter((video) => video.shootSessionId === session.id);
      return shootDuplicateKey(session.shootDate, sessionItems) === key;
    }) || null;
}

function sessionQualityScore(state, session) {
  const sessionItems = Array.isArray(session?.items) && session.items.length
    ? session.items
    : (state.videoItems || []).filter((video) => video.shootSessionId === session?.id);
  return sessionItems.reduce((score, item) => {
    const topic = String(item.topic || "").trim();
    if (!topic) return score - 2;
    return score + (isPlaceholderTopic(topic) ? 1 : 3);
  }, 0);
}

function planShoot(state, { client, shootDate, items }) {
  if (!client) return { ok: false, message: "我没找到这个客户。" };
  const useDate = shootDate || formatDate(new Date());
  const plannedItems = normalizeShootItemList(client, useDate, ensurePlannedShootItems(items, client.contentTypes, useDate));
  const session = {
    id: uid("shoot"),
    clientId: client.id,
    shootDate: useDate,
    shootPeriod: "",
    shootCount: plannedItems.length,
    status: "planned",
    planned: true,
    items: plannedItems,
    summary: plannedItems.map((it) => it.topic).join("、"),
    note: "",
    createdAt: new Date().toISOString(),
  };
  state.shootSessions.push(session);
  state.lastShootSessionId = session.id;
  return { ok: true, message: `${client.name} 的拍摄我排到 ${session.shootDate} 了。` };
}

function recordShoot(state, { client, shootDate, items }) {
  if (!client || !items?.length) return { ok: false, message: "客户或内容我没听全。" };
  const normalizedItems = normalizeShootItemList(client, shootDate, items);
  // 如果有当天或已过期计划，优先完成最近一条，避免 D+2 反馈时新建重复拍摄。
  const matched = state.shootSessions
    .filter((s) => s.clientId === client.id && s.shootDate <= shootDate && s.status === "planned")
    .sort((a, b) => b.shootDate.localeCompare(a.shootDate))[0];
  if (matched) {
    matched.status = "completed";
    matched.planned = false;
    matched.completedAt = new Date().toISOString();
    matched.items = normalizedItems;
    matched.shootCount = normalizedItems.length;
    matched.summary = normalizedItems.map((it) => it.topic).join("、");
    // 已经在 plan 时建了 video 吗？plan_shoot 没建 video，这里建
    const existingVideo = state.videoItems.some((v) => v.shootSessionId === matched.id);
    if (!existingVideo) {
      for (const item of normalizedItems) {
        state.videoItems.push({
          id: uid("video"),
          clientId: client.id,
          shootSessionId: matched.id,
          topic: item.topic,
          contentType: item.contentType,
          status: "待发布",
          createdAt: new Date().toISOString(),
        });
      }
    }
    autoScheduleClient(state, client.id);
    state.lastShootSessionId = matched.id;
    return { ok: true, message: `${client.name} 拍完了，原计划完成，排期也更新。` };
  }
  const duplicate = findDuplicateShootSession(state, client.id, shootDate, normalizedItems);
  if (duplicate) {
    state.lastShootSessionId = duplicate.id;
    return { ok: true, message: `${client.name} ${shootDate} 已经有 ${normalizedItems.length} 条拍摄记录了，我没重复新增。` };
  }
  // 新建一次完成的拍摄
  const session = {
    id: uid("shoot"),
    clientId: client.id,
    shootDate,
    shootPeriod: "",
    shootCount: normalizedItems.length,
    status: "completed",
    planned: false,
    items: normalizedItems,
    summary: normalizedItems.map((it) => it.topic).join("、"),
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
  if (shootDate < formatDate(new Date())) rebuildClientSchedule(state, { client, keepLocked: false });
  autoScheduleClient(state, client.id);
  state.lastShootSessionId = session.id;
  return { ok: true, message: `${client.name} 拍摄记好了，排期也给你排上。` };
}

function appendToShoot(state, { client, count, contentType }) {
  let session = null;
  if (client) {
    const sessions = state.shootSessions
      .filter((s) => s.clientId === client.id)
      .sort((a, b) => (b.completedAt || b.createdAt || "").localeCompare(a.completedAt || a.createdAt || ""));
    session = sessions[0] || null;
  }
  if (!session && state.lastShootSessionId) session = findShootSession(state, state.lastShootSessionId);
  if (!session) return { ok: false, message: "我不知道追加到哪次拍摄。" };
  const targetClient = findClient(state, session.clientId);
  const startIndex = state.videoItems.filter((v) => v.shootSessionId === session.id).length;
  const fallbackType = contentType || targetClient?.contentTypes?.[0] || "日常";
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
      clientId: session.clientId,
      shootSessionId: session.id,
      topic: newItem.topic,
      contentType: newItem.contentType,
      status: "待发布",
      createdAt: new Date().toISOString(),
    });
  }
  session.shootCount = session.items.length;
  session.summary = session.items.map((it) => it.topic).join("、");
  autoScheduleClient(state, session.clientId);
  return { ok: true, message: `${targetClient?.name || "客户"} 追加了 ${count} 条 ${fallbackType}。` };
}

function updateShootCount(state, { client, newCount, shootDate, sessionId }) {
  if (!Number.isFinite(newCount) || newCount < 1) return { ok: false, message: "条数没听清。" };
  let session = sessionId ? findShootSession(state, sessionId) : null;
  if (!session && client) {
    const sessions = state.shootSessions
      .filter((s) => s.clientId === client.id && (!shootDate || s.shootDate === shootDate))
      .sort((a, b) => (b.completedAt || b.createdAt || "").localeCompare(a.completedAt || a.createdAt || ""));
    session = sessions[0] || null;
  }
  if (!session) return { ok: false, message: "没找到要修正的拍摄。" };
  const targetClient = findClient(state, session.clientId);
  if (session.status === "planned" || session.planned === true) {
    const fallbackType = session.items?.[0]?.contentType || targetClient?.contentTypes?.[0] || "日常";
    const oldCount = Number(session.shootCount) || session.items?.length || 0;
    session.items = Array.from({ length: newCount }, (_, i) => (
      session.items?.[i] || { topic: fallbackShootTopic(session.shootDate, fallbackType, i), contentType: fallbackType, shootPeriod: "" }
    ));
    session.shootCount = newCount;
    session.summary = session.items.map((it) => it.topic).join("、");
    return { ok: true, message: `${targetClient?.name} ${session.shootDate} 拍摄计划改成 ${newCount} 条（原 ${oldCount} 条）。` };
  }
  const existing = state.videoItems
    .filter((v) => v.shootSessionId === session.id)
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  const oldCount = existing.length;
  if (newCount === oldCount) return { ok: true, message: `${targetClient?.name} ${session.shootDate} 已经是 ${oldCount} 条，没改。` };
  if (newCount > oldCount) {
    const fallbackType = session.items?.[0]?.contentType || targetClient?.contentTypes?.[0] || "日常";
    for (let i = oldCount; i < newCount; i += 1) {
      const newItem = { topic: fallbackShootTopic(session.shootDate, fallbackType, i), contentType: fallbackType, shootPeriod: "" };
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
    const toRemove = existing.slice(newCount);
    const ids = new Set(toRemove.map((v) => v.id));
    state.videoItems = state.videoItems.filter((v) => !ids.has(v.id));
    state.publishSlots = state.publishSlots.filter((slot) => !ids.has(slot.videoItemId));
    if (session.items) session.items = session.items.slice(0, newCount);
  }
  session.shootCount = newCount;
  if (session.items) session.summary = session.items.map((it) => it.topic).join("、");
  autoScheduleClient(state, session.clientId);
  return { ok: true, message: `${targetClient?.name} ${session.shootDate} 拍摄改成 ${newCount} 条（原 ${oldCount} 条）。` };
}

function moveShootPlan(state, { client, targetDate }) {
  if (!targetDate) return { ok: false, message: "新日期没听清。" };
  const session = state.shootSessions
    .filter((s) => s.clientId === client.id && s.status === "planned")
    .sort((a, b) => a.shootDate.localeCompare(b.shootDate))[0];
  if (!session) return { ok: false, message: "没找到要挪的计划。" };
  session.shootDate = targetDate;
  return { ok: true, message: `${client.name} 的拍摄挪到 ${targetDate}。` };
}

function postponeShootPlan(state, { client, targetDate, days = 1 }) {
  const session = state.shootSessions
    .filter((s) => s.clientId === client.id && s.status === "planned")
    .sort((a, b) => a.shootDate.localeCompare(b.shootDate))[0];
  if (!session) return { ok: false, message: "没找到要延期的计划。" };
  const safeDays = Math.max(1, Math.min(Number(days) || 1, 30));
  const nextDate = targetDate || formatDate(addDays(parseDate(session.shootDate), safeDays));
  session.shootDate = nextDate;
  return { ok: true, message: `${client.name} 的拍摄延期到 ${nextDate}。` };
}

function cancelShootPlan(state, { client }) {
  const session = state.shootSessions
    .filter((s) => s.clientId === client.id && s.status === "planned")
    .sort((a, b) => a.shootDate.localeCompare(b.shootDate))[0];
  if (!session) return { ok: false, message: "没要取消的计划。" };
  state.shootSessions = state.shootSessions.filter((s) => s.id !== session.id);
  return { ok: true, message: `${client.name} ${session.shootDate} 的拍摄取消了。` };
}

// ============ 视频条目 ============

function findVideosByHint(state, client, topicHint) {
  return state.videoItems.filter((v) => {
    if (client && v.clientId !== client.id) return false;
    const hay = String(v.topic || "");
    return hay.includes(topicHint) || topicHint.includes(hay);
  });
}

function applyTopicUpdates(state, { client, items }) {
  if (!items?.length) return { ok: false, message: "没读出对应主题。" };
  let session = null;
  if (client) {
    const sessions = state.shootSessions
      .filter((s) => s.clientId === client.id)
      .sort((a, b) => (b.completedAt || b.createdAt || "").localeCompare(a.completedAt || a.createdAt || ""));
    session = sessions[0] || null;
  }
  if (!session && state.lastShootSessionId) session = findShootSession(state, state.lastShootSessionId);
  if (!session) return { ok: false, message: "不知道这些文案对应哪次拍摄。" };
  const targetClient = findClient(state, session.clientId);
  const videos = state.videoItems
    .filter((v) => v.shootSessionId === session.id)
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  if (!videos.length) return { ok: false, message: "这次拍摄还没素材。" };
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
  if (!updated) return { ok: true, message: "这些文案主题之前已识别过。" };
  return { ok: true, message: `${targetClient?.name || "客户"} ${updated} 条主题写好。` };
}

function renameVideo(state, { client, oldTopicHint, newTopic }) {
  if (!oldTopicHint || !newTopic) return { ok: false, message: "旧名字或新简称没听清。" };
  const candidates = findVideosByHint(state, client, oldTopicHint);
  if (!candidates.length) return { ok: false, message: `没找到含 ${oldTopicHint} 的视频。` };
  if (candidates.length > 1) return { ok: false, message: `${candidates.length} 条都含 ${oldTopicHint}，再细一点。` };
  const taken = new Set(
    state.videoItems
      .filter((v) => v.id !== candidates[0].id && v.topic && !isPlaceholderTopic(v.topic))
      .map((v) => v.topic),
  );
  const trimmed = trimToMaxChars(newTopic, 6);
  if (taken.has(trimmed)) return { ok: false, message: `${trimmed} 已经被用了，换一个。` };
  const oldTopic = candidates[0].topic;
  candidates[0].topic = trimmed;
  const session = findShootSession(state, candidates[0].shootSessionId);
  if (session?.items) {
    for (const it of session.items) if (it.topic === oldTopic) it.topic = trimmed;
    session.summary = session.items.map((it) => it.topic).join("、");
  }
  return { ok: true, message: `"${oldTopic}" 改成 "${trimmed}"。` };
}

function retypeVideo(state, { client, topicHint, contentType }) {
  const matches = findVideosByHint(state, client, topicHint);
  if (!matches.length) return { ok: false, message: `没找到含 ${topicHint} 的视频。` };
  if (matches.length > 1) return { ok: false, message: `${matches.length} 条都含 ${topicHint}，再细点。` };
  matches[0].contentType = contentType;
  const session = findShootSession(state, matches[0].shootSessionId);
  if (session?.items) {
    for (const it of session.items) if (it.topic === matches[0].topic) it.contentType = contentType;
  }
  return { ok: true, message: `"${matches[0].topic}" 归到 ${contentType} 类。` };
}

function deleteVideo(state, { client, topicHint }) {
  const matches = findVideosByHint(state, client, topicHint);
  if (!matches.length) return { ok: false, message: `没找到含 ${topicHint} 的视频。` };
  if (matches.length > 1) return { ok: false, message: `${matches.length} 条都含 ${topicHint}，再细点。` };
  const target = matches[0];
  state.videoItems = state.videoItems.filter((v) => v.id !== target.id);
  state.publishSlots = state.publishSlots.filter((slot) => slot.videoItemId !== target.id);
  const session = findShootSession(state, target.shootSessionId);
  if (session?.items) {
    session.items = session.items.filter((it) => it.topic !== target.topic);
    session.shootCount = session.items.length;
    session.summary = session.items.map((it) => it.topic).join("、");
  }
  autoScheduleClient(state, target.clientId);
  return { ok: true, message: `"${target.topic}" 删了。` };
}

function markPublished(state, { client, topicHint }) {
  const matches = findVideosByHint(state, client, topicHint);
  if (!matches.length) return { ok: false, message: `没找到 ${topicHint}。` };
  if (matches.length > 1) return { ok: false, message: `${matches.length} 条都含 ${topicHint}，再细点。` };
  matches[0].status = "已发布";
  matches[0].publishedAt = new Date().toISOString();
  const slot = state.publishSlots.find((s) => s.videoItemId === matches[0].id);
  if (slot) slot.status = "已发布";
  return { ok: true, message: `"${matches[0].topic}" 标为已发。` };
}

// ============ 发布日程 ============

function movePublish(state, { client, topicHint, targetDate }) {
  if (!targetDate) return { ok: false, message: "目标日期没听清。" };
  const slots = state.publishSlots
    .filter((s) => s.clientId === client.id)
    .sort((a, b) => a.publishDate.localeCompare(b.publishDate));
  let target = topicHint
    ? slots.find((s) => {
        const v = findVideo(state, s.videoItemId);
        return v?.topic.includes(topicHint) || v?.contentType.includes(topicHint);
      })
    : slots[0];
  if (!target) target = slots[0];
  if (!target) return { ok: false, message: "没找到可移动的发布。" };
  target.publishDate = targetDate;
  target.locked = true;
  target.source = "ai_adjusted";
  return { ok: true, message: `${client.name} 的发布改到 ${targetDate}。` };
}

function cancelPublish(state, { client, topicHint, date }) {
  const slots = state.publishSlots
    .filter((s) => s.clientId === client.id)
    .sort((a, b) => a.publishDate.localeCompare(b.publishDate));
  let target = null;
  if (date) {
    target = slots.find((s) => s.publishDate === date);
    if (!target) return { ok: false, message: `${date} 没看到 ${client.name} 的发布。` };
  } else if (topicHint) {
    target = slots.find((s) => {
      const v = findVideo(state, s.videoItemId);
      return v?.topic.includes(topicHint);
    });
  } else {
    target = slots[0];
  }
  if (!target) return { ok: false, message: "没找到可取消的发布。" };
  const cancelledDate = target.publishDate;
  state.cancelledDates = Array.isArray(state.cancelledDates) ? state.cancelledDates : [];
  state.cancelledDates.push({ clientId: client.id, videoItemId: target.videoItemId, date: cancelledDate, ts: new Date().toISOString() });
  state.publishSlots = state.publishSlots.filter((s) => s.id !== target.id);
  const video = findVideo(state, target.videoItemId);
  if (video) video.status = "待发布";
  return { ok: true, message: `${client.name} ${cancelledDate} 的发布取消了。` };
}

function rescheduleTime(state, { client, topicHint, targetTime }) {
  if (!/^\d{1,2}:\d{2}$/.test(targetTime)) return { ok: false, message: "时间格式没看懂。" };
  const matches = findVideosByHint(state, client, topicHint);
  if (!matches.length) return { ok: false, message: `没找到 ${topicHint}。` };
  if (matches.length > 1) return { ok: false, message: `${matches.length} 条都含 ${topicHint}，再细点。` };
  const slot = state.publishSlots.find((s) => s.videoItemId === matches[0].id);
  if (!slot) return { ok: false, message: `"${matches[0].topic}" 还没排进日程。` };
  const time = targetTime.length === 4 ? "0" + targetTime : targetTime;
  slot.publishTime = time;
  slot.locked = true;
  slot.source = "ai_adjusted";
  return { ok: true, message: `"${matches[0].topic}" 发布时间改 ${time}。` };
}

function shiftDay(state, { sourceDate, days, client }) {
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
  return { ok: true, message: `${sourceDate} 上 ${targets.length} 条发布顺延 ${days} 天。` };
}

function skipDay(state, { sourceDate, client }) {
  const targets = state.publishSlots.filter((slot) => {
    if (slot.publishDate !== sourceDate) return false;
    if (client && slot.clientId !== client.id) return false;
    return true;
  });
  if (!targets.length) return { ok: false, message: `${sourceDate} 没有匹配的发布要跳。` };
  const ids = new Set(targets.map((s) => s.id));
  state.publishSlots = state.publishSlots.filter((s) => !ids.has(s.id));
  for (const slot of targets) {
    const v = findVideo(state, slot.videoItemId);
    if (v && v.status !== "已发布") v.status = "待发布";
  }
  return { ok: true, message: `${sourceDate} ${targets.length} 条发布跳了。` };
}

function shiftAllForClient(state, { client, days }) {
  const today = formatDate(new Date());
  const slots = state.publishSlots.filter((s) => s.clientId === client.id && s.publishDate >= today);
  if (!slots.length) return { ok: false, message: `${client.name} 没有未来未发布的发布计划。` };
  for (const slot of slots) {
    slot.publishDate = formatDate(addDays(parseDate(slot.publishDate), days));
    slot.locked = true;
    slot.source = "ai_adjusted";
  }
  return { ok: true, message: `${client.name} 的 ${slots.length} 条未来发布整体推 ${days} 天。` };
}

// ============ 自动排期 ============

function autoScheduleClient(state, clientId) {
  const client = state.clients.find((c) => c.id === clientId);
  if (!client) return;
  const scheduledIds = new Set(state.publishSlots.map((s) => s.videoItemId));
  const unscheduled = orderVideosForScheduling(state, state.videoItems
    .filter(
      (v) =>
        v.clientId === clientId &&
        v.status === "待发布" &&
        !scheduledIds.has(v.id) &&
        isVideoReady(state, v),
    )
  );
  for (const video of unscheduled) {
    const date = findBestDate(state, client, video);
    state.publishSlots.push({
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

function orderVideosForScheduling(state, videos) {
  const groups = new Map();
  for (const video of videos) {
    const session = state.shootSessions.find((item) => item.id === video.shootSessionId);
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

function isVideoReady(state, video) {
  if (!video?.shootSessionId) return true;
  const session = state.shootSessions.find((s) => s.id === video.shootSessionId);
  return Boolean(session && session.status === "completed");
}

function findBestDate(state, client, video) {
  const start = addDays(new Date(), 1);
  const cancelled = new Set(
    (state.cancelledDates || [])
      .filter((c) => c.clientId === client.id && (!c.videoItemId || c.videoItemId === video.id))
      .map((c) => c.date),
  );
  let fallback = "";
  for (let i = 0; i < 120; i += 1) {
    const date = formatDate(addDays(start, i));
    if (cancelled.has(date)) continue;
    if (state.publishSlots.some((s) => s.clientId === client.id && s.publishDate === date)) continue;
    if (!fallback) fallback = date;
    const dates = state.publishSlots.filter((s) => s.clientId === client.id).map((s) => s.publishDate).sort();
    const prev = dates.filter((d) => d < date).at(-1);
    const next = dates.find((d) => d > date);
    if (prev && diffDays(prev, date) < client.publishIntervalDays) continue;
    if (next && diffDays(date, next) < client.publishIntervalDays) continue;
    return date;
  }
  return fallback || formatDate(start);
}

// ============ 查询 ============

function summarizeSlotsForDate(state, date, client) {
  const slots = state.publishSlots
    .filter((s) => s.publishDate === date && (!client || s.clientId === client.id))
    .sort((a, b) => (a.publishTime || "").localeCompare(b.publishTime || ""));
  if (!slots.length) return null;
  return slots.map((slot) => {
    const c = findClient(state, slot.clientId);
    const v = findVideo(state, slot.videoItemId);
    return `${slot.publishTime || "时间未定"} · ${c?.name || "?"} · ${v?.topic || "?"}`;
  });
}

function queryToday(state, { client }) {
  const today = formatDate(new Date());
  const lines = summarizeSlotsForDate(state, today, client);
  if (!lines) return { ok: true, message: client ? `${client.name} 今天不发。` : "今天不发。" };
  return { ok: true, message: `今天 (${today})：\n${lines.join("\n")}` };
}

function queryDate(state, { date, client }) {
  const lines = summarizeSlotsForDate(state, date, client);
  if (!lines) return { ok: true, message: client ? `${client.name} ${date} 不发。` : `${date} 不发。` };
  return { ok: true, message: `${date}：\n${lines.join("\n")}` };
}

function queryClientSchedule(state, { client, limit = 20 }) {
  const today = formatDate(new Date());
  const slots = state.publishSlots
    .filter((slot) => slot.clientId === client.id && slot.publishDate >= today)
    .sort((a, b) => a.publishDate.localeCompare(b.publishDate) || (a.publishTime || "").localeCompare(b.publishTime || ""));
  if (!slots.length) return { ok: true, message: `${client.name} 后面还没安排发布。` };
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 30));
  const lines = slots.slice(0, safeLimit).map((slot) => {
    const video = findVideo(state, slot.videoItemId);
    return `· ${slot.publishDate} ${slot.publishTime || "时间未定"} | ${video?.topic || "未命名"}${slot.locked ? " | 已锁定" : ""}`;
  });
  const tail = slots.length > safeLimit ? `\n还有 ${slots.length - safeLimit} 条没展开。` : "";
  return { ok: true, message: `${client.name} 后面共 ${slots.length} 条：\n${lines.join("\n")}${tail}` };
}

function queryStats(state, { client, scope }) {
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
  return {
    ok: true,
    message: `${client.name} ${scopeLabel}：素材 ${allVideos.length} 条，已发 ${published} 条，待发 ${upcoming} 条。`,
  };
}

function searchVideos(state, { keyword, client }) {
  const matches = state.videoItems.filter((v) => {
    if (client && v.clientId !== client.id) return false;
    return String(v.topic || "").includes(keyword);
  });
  if (!matches.length) return { ok: true, message: `没找到含 ${keyword} 的视频。` };
  const lines = matches.slice(0, 10).map((v) => {
    const c = findClient(state, v.clientId);
    const slot = state.publishSlots.find((s) => s.videoItemId === v.id);
    const schedule = slot ? `${slot.publishDate} ${slot.publishTime}` : "未排期";
    return `· ${c?.name || "?"} | ${v.topic} | ${v.status} | ${schedule}`;
  });
  return { ok: true, message: `找到 ${matches.length} 条：\n${lines.join("\n")}` };
}

function queryVideoShoot(state, { topicHint, client }) {
  const matches = findVideosByHint(state, client, topicHint);
  if (!matches.length) return { ok: true, message: `没找到含 ${topicHint} 的视频。` };
  const lines = matches.slice(0, 5).map((v) => {
    const c = findClient(state, v.clientId);
    const session = findShootSession(state, v.shootSessionId);
    if (!session) return `· ${c?.name} | ${v.topic} | 无拍摄记录`;
    const same = state.videoItems.filter((x) => x.shootSessionId === session.id);
    const seq = same.findIndex((x) => x.id === v.id) + 1;
    return `· ${c?.name} | ${v.topic} | ${session.shootDate} 第 ${seq}/${same.length} 条`;
  });
  return { ok: true, message: matches.length === 1 ? lines[0].replace(/^· /, "") : `找到 ${matches.length} 条：\n${lines.join("\n")}` };
}

module.exports = {
  // helpers
  uid,
  uniqueValues,
  findClient,
  findClientByName,
  findVideo,
  findShootSession,
  findVideosByHint,
  fallbackShootTopic,
  isPlaceholderTopic,
  isSystemAlias,
  cleanClientAliases,
  addAliasToClient,
  // client crud
  createClient,
  renameClient,
  addClientAlias,
  removeClientAlias,
  updateClientSettings,
  updateClientTypes,
  deleteClient,
  // shoot
  planShoot,
  recordShoot,
  appendToShoot,
  updateShootCount,
  moveShootPlan,
  postponeShootPlan,
  cancelShootPlan,
  deleteShootSession,
  dedupeClientData,
  rebuildClientSchedule,
  setClientPublishSchedule,
  // video
  applyTopicUpdates,
  renameVideo,
  retypeVideo,
  deleteVideo,
  markPublished,
  // publish
  movePublish,
  cancelPublish,
  rescheduleTime,
  shiftDay,
  skipDay,
  shiftAllForClient,
  autoScheduleClient,
  // query
  queryToday,
  queryDate,
  queryClientSchedule,
  queryStats,
  searchVideos,
  queryVideoShoot,
};
