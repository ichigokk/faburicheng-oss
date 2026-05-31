// 排期：从 state 派生出 home 页要渲染的数据
// 对应 web 端 app-v2.js 880-1098 的 renderThreeDays/Week/Month + renderDayCard
const { formatDate, parseDate, addDays, formatShort, weekdayName, dayTitle, startOfWeek, startOfMonth, getCalendarDays } = require("./date");

const COLORS = ["#0f8f6a", "#2f6fbb", "#b66900", "#b33c4a", "#7654c7", "#16828f", "#9b5c1c", "#46636f"];

function clientColor(state, clientId) {
  const idx = Math.max(0, (state.clients || []).findIndex((c) => c.id === clientId));
  return COLORS[idx % COLORS.length];
}

function findClient(state, id) {
  return (state.clients || []).find((c) => c.id === id) || null;
}

function findVideo(state, id) {
  return (state.videoItems || []).find((v) => v.id === id) || null;
}

function isPlannedShoot(s) {
  return s?.planned === true || s?.status === "planned";
}

function uniqueValues(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function dominantShootContentType(session) {
  const types = (session.items || []).map((i) => i.contentType).filter(Boolean);
  if (!types.length) return "";
  const uniq = uniqueValues(types);
  return uniq.length === 1 ? uniq[0] : "内容";
}

function getPublishSlots(state, date) {
  return (state.publishSlots || [])
    .filter((s) => s.publishDate === date)
    .sort((a, b) => (a.publishTime || "").localeCompare(b.publishTime || ""));
}

function getShootSessions(state, date) {
  return (state.shootSessions || []).filter((s) => s.shootDate === date);
}

function clientAvatarSmall(state, client) {
  if (!client) return { color: COLORS[0], initial: "?", url: "" };
  const initial = (client.name || "?").trim().slice(0, 1);
  const accounts = Array.isArray(client.accounts) ? client.accounts : [];
  const douyin = accounts.find((a) => a.platform === "douyin") || null;
  const account = douyin || accounts.find((a) => a.avatarSmall || a.avatarLarge) || null;
  return {
    color: clientColor(state, client.id),
    initial,
    url: client.avatarUrl || account?.avatarSmall || account?.avatarLarge || "",
  };
}

function buildPublishEvent(state, slot) {
  const client = findClient(state, slot.clientId);
  const video = findVideo(state, slot.videoItemId);
  return {
    kind: "publish",
    id: slot.id,
    time: slot.publishTime || "--:--",
    title: `发布视频：${client?.name || ""} · ${video?.topic || ""}`,
    subtitle: `${video?.contentType || ""} · ${slot.locked ? "已锁定" : "自动排期"}`,
    avatar: clientAvatarSmall(state, client),
  };
}

function buildShootEvent(state, session) {
  const client = findClient(state, session.clientId);
  const planned = isPlannedShoot(session);
  const label = planned ? "计划拍摄" : "拍摄";
  const period = session.shootPeriod || "";
  let subtitle;
  if (planned) {
    const type = dominantShootContentType(session) || "内容";
    const count = Number(session.shootCount) || (session.items || []).length || 1;
    subtitle = `${dayTitle(session.shootDate)}${period}拍摄 ${count} 条${type}`;
  } else {
    subtitle = `${period ? `${period} · ` : ""}${session.summary || ""}`;
  }
  return {
    kind: "shoot",
    planned,
    id: session.id,
    label,
    time: label,
    title: `${client?.name || ""} · ${label} ${session.shootCount} 条`,
    subtitle,
    avatar: clientAvatarSmall(state, client),
  };
}

function buildDayCard(state, date) {
  const publishes = getPublishSlots(state, date).map((s) => buildPublishEvent(state, s));
  const shoots = getShootSessions(state, date).map((s) => buildShootEvent(state, s));
  const events = [...publishes, ...shoots];
  const d = parseDate(date);
  return {
    date,
    title: dayTitle(date),
    label: `${formatShort(d)} ${weekdayName(d)}`,
    isToday: date === formatDate(new Date()),
    isEmpty: events.length === 0,
    events,
  };
}

function buildThreeDays(state, anchorDate) {
  const start = parseDate(formatDate(anchorDate));
  const days = [0, 1, 2].map((i) => formatDate(addDays(start, i)));
  return {
    label: `${formatShort(parseDate(days[0]))} - ${formatShort(parseDate(days[2]))}`,
    days: days.map((d) => buildDayCard(state, d)),
  };
}

function buildCompactCell(state, dayDate, mode, month, selectedDate) {
  const date = formatDate(dayDate);
  const publishes = getPublishSlots(state, date);
  const shoots = getShootSessions(state, date);
  const clientIds = uniqueValues(publishes.map((s) => s.clientId));
  const dotLimit = mode === "month" ? 4 : 8;
  const dots = clientIds.slice(0, dotLimit).map((cid) => {
    const c = findClient(state, cid);
    return { ...clientAvatarSmall(state, c), kind: "publish" };
  });
  // shoot 去重（按 client + period）
  const seen = new Set();
  const shootGroups = [];
  for (const s of shoots) {
    const key = `${s.clientId}:${s.shootPeriod || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    shootGroups.push(s);
  }
  const shootLimit = mode === "month" ? 3 : 7;
  const shootDots = shootGroups.slice(0, shootLimit).map((s) => {
    const c = findClient(state, s.clientId);
    return { ...clientAvatarSmall(state, c), kind: isPlannedShoot(s) ? "planned" : "shoot" };
  });
  return {
    date,
    day: dayDate.getDate(),
    weekChar: weekdayName(dayDate).replace("周", ""),
    isToday: date === formatDate(new Date()),
    isSelected: !!selectedDate && date === selectedDate,
    muted: mode === "month" && month && dayDate.getMonth() !== month.getMonth(),
    dots,
    shootDots,
  };
}

function buildWeek(state, anchorDate, selectedDate) {
  const start = startOfWeek(anchorDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const label = `${formatShort(days[0])} - ${formatShort(days[6])}`;
  const cells = days.map((d) => buildCompactCell(state, d, "week", null, selectedDate));
  const inline = selectedDate && days.some((d) => formatDate(d) === selectedDate)
    ? buildDayCard(state, selectedDate)
    : null;
  return { label, cells, inline };
}

function buildMonth(state, anchorDate, selectedDate) {
  const month = startOfMonth(anchorDate);
  const days = getCalendarDays(month);
  const label = `${month.getFullYear()} 年 ${month.getMonth() + 1} 月`;
  const cells = days.map((d) => buildCompactCell(state, d, "month", month, selectedDate));
  const inline = selectedDate && days.some((d) => formatDate(d) === selectedDate)
    ? buildDayCard(state, selectedDate)
    : null;
  return { label, cells, inline };
}

function buildScheduleView(state, viewMode, anchorDate, selectedDate) {
  if (viewMode === "week") return { mode: "week", ...buildWeek(state, anchorDate, selectedDate) };
  if (viewMode === "month") return { mode: "month", ...buildMonth(state, anchorDate, selectedDate) };
  return { mode: "days", ...buildThreeDays(state, anchorDate) };
}

// 首页提醒：过期发布 + 到期/过期拍摄计划
function buildPublishAlerts(state) {
  const today = formatDate(new Date());
  const publishAlerts = (state.publishSlots || [])
    .filter((slot) => slot.publishDate < today && !slot.matched)
    .map((slot) => {
      const client = findClient(state, slot.clientId);
      const video = findVideo(state, slot.videoItemId);
      return {
        id: slot.id,
        type: "publish_due",
        publishDate: slot.publishDate,
        publishTime: slot.publishTime || "",
        clientName: client?.name || "",
        topic: video?.topic || "",
      };
    });
  const shootAlerts = (state.shootSessions || [])
    .filter((session) => isPlannedShoot(session) && session.shootDate <= today)
    .sort((a, b) => a.shootDate.localeCompare(b.shootDate))
    .map((session) => {
      const client = findClient(state, session.clientId);
      return {
        id: session.id,
        type: "shoot_plan_due",
        publishDate: session.shootDate,
        publishTime: session.shootDate < today ? "过期拍摄" : "今日拍摄",
        clientName: client?.name || "",
        topic: `${Number(session.shootCount) || (session.items || []).length || 1} 条待确认`,
      };
    });
  const alerts = [...shootAlerts, ...publishAlerts];
  return { total: alerts.length, top: alerts.slice(0, 3) };
}

module.exports = {
  COLORS,
  clientColor,
  findClient,
  findVideo,
  isPlannedShoot,
  buildDayCard,
  buildThreeDays,
  buildWeek,
  buildMonth,
  buildScheduleView,
  buildPublishAlerts,
};
