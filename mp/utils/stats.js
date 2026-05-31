// 统计：从 state 派生出 stats 页要渲染的数据
// 对应 web 端 app-v2.js 1204-1285 的 buildClientStats / renderStatsOverview / renderStatCard
const { formatDate, parseDate, addDays, diffDays } = require("./date");

function isPlannedShoot(s) {
  return s?.planned === true || s?.status === "planned";
}

function buildClientStats(state, client) {
  const today = formatDate(new Date());
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const nextMonth = formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 1));

  const slots = (state.publishSlots || []).filter((s) => s.clientId === client.id);
  const videos = (state.videoItems || []).filter((v) => v.clientId === client.id);
  const scheduledIds = new Set(slots.map((s) => s.videoItemId));
  const pendingVideos = videos.filter((v) => v.status !== "已发布");
  const stock = pendingVideos.filter((v) => !scheduledIds.has(v.id)).length;
  const unposted = pendingVideos.length;

  const monthShoots = (state.shootSessions || [])
    .filter((s) => s.clientId === client.id && !isPlannedShoot(s) && s.shootDate >= monthStart && s.shootDate < nextMonth)
    .reduce((sum, s) => sum + (Number(s.shootCount) || 0), 0);

  const monthPublished = slots.filter(
    (s) => s.publishDate >= monthStart && s.publishDate < nextMonth && s.publishDate <= today
  ).length;

  const futureDates = slots.filter((s) => s.publishDate >= today).map((s) => s.publishDate).sort();
  const lastScheduled = futureDates[futureDates.length - 1] || "";
  const coverDays = lastScheduled ? Math.max(0, diffDays(today, lastScheduled) + 1) : 0;
  const shootBefore = lastScheduled ? formatDate(addDays(parseDate(lastScheduled), -2)) : today;

  return {
    clientId: client.id,
    name: client.name || "",
    publishIntervalDays: client.publishIntervalDays || 0,
    defaultPublishTime: client.defaultPublishTime || "",
    contentTypes: (client.contentTypes || []).join("、"),
    stock,
    unposted,
    monthShoots,
    monthPublished,
    coverDays,
    lastScheduled,
    shootBefore,
    progressPercent: Math.min(100, Math.round((coverDays / 14) * 100)),
    statusLabel: coverDays <= 2 ? "缺片风险" : coverDays <= 5 ? "需要关注" : "库存健康",
    statusKind: coverDays <= 2 ? "risk" : coverDays <= 5 ? "warn" : "ok",
  };
}

function buildStatsView(state) {
  const rows = (state.clients || []).map((c) => buildClientStats(state, c));
  const totalUnposted = rows.reduce((sum, r) => sum + r.unposted, 0);
  const riskCount = rows.filter((r) => r.coverDays <= 2).length;
  const monthShoots = rows.reduce((sum, r) => sum + r.monthShoots, 0);
  return {
    overview: { monthShoots, totalUnposted, riskCount },
    rows,
    summary: `${rows.length} 个客户`,
  };
}

function buildClientDetail(state, clientId) {
  const client = (state.clients || []).find((c) => c.id === clientId);
  if (!client) return null;
  const stats = buildClientStats(state, client);
  const today = formatDate(new Date());

  const slots = (state.publishSlots || []).filter((s) => s.clientId === clientId);
  const videos = (state.videoItems || []).filter((v) => v.clientId === clientId);

  const nextSlots = slots
    .filter((s) => s.publishDate >= today)
    .sort((a, b) => a.publishDate.localeCompare(b.publishDate))
    .slice(0, 5)
    .map((s) => {
      const v = videos.find((vi) => vi.id === s.videoItemId);
      return {
        id: s.id,
        publishDate: s.publishDate,
        publishTime: s.publishTime || "",
        topic: v?.topic || "—",
        contentType: v?.contentType || "",
        locked: !!s.locked,
      };
    });

  const recentShoots = (state.shootSessions || [])
    .filter((s) => s.clientId === clientId && !isPlannedShoot(s))
    .sort((a, b) => b.shootDate.localeCompare(a.shootDate))
    .slice(0, 5)
    .map((s) => ({
      id: s.id,
      shootDate: s.shootDate,
      shootCount: s.shootCount,
      summary: s.summary || (s.items || []).map((i) => i.topic).join("、") || "",
    }));

  const accounts = (client.accounts || []).map((a) => ({
    platform: a.platform || "",
    nickname: a.nickname || "",
    uniqueId: a.uniqueId || "",
  }));

  return {
    clientId,
    name: client.name || "",
    contentTypes: stats.contentTypes,
    publishIntervalDays: stats.publishIntervalDays,
    defaultPublishTime: stats.defaultPublishTime,
    coverDays: stats.coverDays,
    statusLabel: stats.statusLabel,
    statusKind: stats.statusKind,
    nextSlots,
    recentShoots,
    accounts,
    stock: stats.stock,
    unposted: stats.unposted,
    monthShoots: stats.monthShoots,
    monthPublished: stats.monthPublished,
  };
}

module.exports = {
  buildClientStats,
  buildStatsView,
  buildClientDetail,
};
