// Tool name → handler 映射
// 每个 handler 接收 (state, args)，返回 {ok, message}
const ops = require("./state-ops");

function help() {
  return {
    ok: true,
    message: [
      "我能帮你：",
      "· 客户：加客户/改名/加别名/改频率/改时间/改类型/绑账号/删客户",
      "· 拍摄：今天拍了 N 条/明天拍 / 改条数/取消/挪到X日/再补拍",
      "· 文案：粘多条文案自动提炼简称；改名/改类型；删除/已发",
      "· 发布：挪日期/改时间/不发了/顺延一天/跳过周末/未来推 N 天",
      "· 查询：今天发什么/某天/X 本月发了多少/含 X 的视频/X 哪天拍的",
    ].join("\n"),
  };
}

module.exports = {
  reply_only: (state, args) => ({ ok: true, message: String(args.message || "").trim() }),
  help: () => help(),

  create_client: (state, args) => {
    const client = ops.createClient(state, args);
    return client ? { ok: true, message: `${client.name} 加好了。` } : { ok: false, message: "建客户失败。" };
  },
  rename_client: (state, args) => {
    const client = ops.findClientByName(state, args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return ops.renameClient(state, { client, newName: args.newName });
  },
  add_client_alias: (state, args) => {
    const client = ops.findClientByName(state, args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return ops.addClientAlias(state, { client, alias: args.alias });
  },
  remove_client_alias: (state, args) => {
    const client = ops.findClientByName(state, args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return ops.removeClientAlias(state, { client, alias: args.alias });
  },
  update_client_settings: (state, args) => {
    const client = ops.findClientByName(state, args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return ops.updateClientSettings(state, {
      client,
      publishIntervalDays: args.publishIntervalDays,
      defaultPublishTime: args.defaultPublishTime,
    });
  },
  update_client_types: (state, args) => {
    const client = ops.findClientByName(state, args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return ops.updateClientTypes(state, { client, contentTypes: args.contentTypes });
  },
  delete_client: (state, args) => {
    const client = ops.findClientByName(state, args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return ops.deleteClient(state, { client });
  },
  bind_account: (state, args) => {
    // 简化版：小程序里不直接抓账号，只记下绑定信息，让 web 端去抓
    const client = ops.findClientByName(state, args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return { ok: true, message: `${client.name} 的${args.platform} 绑定信息我先记下了，下次到电脑/PWA 上点抓账号。` };
  },

  plan_shoot: (state, args) => {
    const client = ops.findClientByName(state, args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    const shootDate = args.shootDate || new Date().toISOString().slice(0, 10);
    let items = [];
    if (Array.isArray(args.items) && args.items.length) {
      const fbType = args.contentType || client.contentTypes?.[0] || "日常";
      items = args.items.map((it, i) => ({
        topic: it.topic || ops.fallbackShootTopic(shootDate, it.contentType || fbType, i),
        contentType: it.contentType || fbType,
        shootPeriod: "",
      }));
    } else if (args.shootCount) {
      const fbType = args.contentType || client.contentTypes?.[0] || "日常";
      const safeCount = Math.max(1, Math.min(Number(args.shootCount), 20));
      items = Array.from({ length: safeCount }, (_, i) => ({
        topic: ops.fallbackShootTopic(shootDate, fbType, i),
        contentType: fbType,
        shootPeriod: "",
      }));
    } else {
      return { ok: false, message: `${client.name} 拍几条？` };
    }
    return ops.planShoot(state, { client, shootDate, items });
  },
  record_shoot: (state, args) => {
    const client = ops.findClientByName(state, args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    const shootDate = args.shootDate || new Date().toISOString().slice(0, 10);
    let items = [];
    if (Array.isArray(args.items) && args.items.length) {
      const fbType = args.contentType || client.contentTypes?.[0] || "日常";
      items = args.items.map((it, i) => ({
        topic: it.topic || ops.fallbackShootTopic(shootDate, it.contentType || fbType, i),
        contentType: it.contentType || fbType,
        shootPeriod: "",
      }));
    } else if (args.shootCount) {
      const fbType = args.contentType || client.contentTypes?.[0] || "日常";
      const safeCount = Math.max(1, Math.min(Number(args.shootCount), 20));
      items = Array.from({ length: safeCount }, (_, i) => ({
        topic: ops.fallbackShootTopic(shootDate, fbType, i),
        contentType: fbType,
        shootPeriod: "",
      }));
    } else {
      return { ok: false, message: `${client.name} 拍了几条？` };
    }
    return ops.recordShoot(state, { client, shootDate, items });
  },
  append_to_shoot: (state, args) => {
    const client = args.client ? ops.findClientByName(state, args.client) : null;
    return ops.appendToShoot(state, { client, count: Number(args.count || 0), contentType: args.contentType });
  },
  update_shoot_count: (state, args) => {
    const client = args.client ? ops.findClientByName(state, args.client) : null;
    return ops.updateShootCount(state, {
      client,
      newCount: Number(args.newCount || 0),
      shootDate: args.shootDate || "",
      sessionId: args.sessionId || "",
    });
  },
  move_shoot_plan: (state, args) => {
    const client = ops.findClientByName(state, args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return ops.moveShootPlan(state, { client, targetDate: args.targetDate });
  },
  postpone_shoot_plan: (state, args) => {
    const client = ops.findClientByName(state, args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return ops.postponeShootPlan(state, { client, targetDate: args.targetDate || "", days: Number(args.days || 1) });
  },
  cancel_shoot_plan: (state, args) => {
    const client = ops.findClientByName(state, args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return ops.cancelShootPlan(state, { client });
  },
  delete_shoot_session: (state, args) => {
    const client = args.client ? ops.findClientByName(state, args.client) : null;
    return ops.deleteShootSession(state, {
      client,
      shootDate: args.shootDate || args.date || "",
      sessionId: args.sessionId || "",
      allOnDate: args.allOnDate === true,
    });
  },
  dedupe_client_data: (state, args) => {
    const client = ops.findClientByName(state, args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return ops.dedupeClientData(state, { client });
  },
  rebuild_client_schedule: (state, args) => {
    const client = ops.findClientByName(state, args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return ops.rebuildClientSchedule(state, { client, keepLocked: args.keepLocked !== false });
  },
  set_client_publish_schedule: (state, args) => {
    const client = ops.findClientByName(state, args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return ops.setClientPublishSchedule(state, { client, startDate: args.startDate || "", dates: args.dates });
  },

  update_shoot_topics: (state, args) => {
    const client = args.client ? ops.findClientByName(state, args.client) : null;
    const items = Array.isArray(args.items)
      ? args.items
          .map((it, i) => ({
            index: Number(it.index ?? i + 1),
            topic: String(it.topic || "").trim(),
            contentType: String(it.contentType || "").trim(),
          }))
          .filter((it) => it.topic)
      : [];
    return ops.applyTopicUpdates(state, { client, items });
  },
  rename_video: (state, args) => {
    const client = args.client ? ops.findClientByName(state, args.client) : null;
    return ops.renameVideo(state, { client, oldTopicHint: args.oldTopicHint, newTopic: args.newTopic });
  },
  retype_video: (state, args) => {
    const client = args.client ? ops.findClientByName(state, args.client) : null;
    return ops.retypeVideo(state, { client, topicHint: args.topicHint, contentType: args.contentType });
  },
  delete_video: (state, args) => {
    const client = args.client ? ops.findClientByName(state, args.client) : null;
    return ops.deleteVideo(state, { client, topicHint: args.topicHint });
  },
  mark_published: (state, args) => {
    const client = args.client ? ops.findClientByName(state, args.client) : null;
    return ops.markPublished(state, { client, topicHint: args.topicHint });
  },

  move_publish: (state, args) => {
    const client = ops.findClientByName(state, args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return ops.movePublish(state, { client, topicHint: args.topicHint || "", targetDate: args.targetDate });
  },
  cancel_publish: (state, args) => {
    const client = ops.findClientByName(state, args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return ops.cancelPublish(state, { client, topicHint: args.topicHint || "", date: args.date || "" });
  },
  reschedule_time: (state, args) => {
    const client = args.client ? ops.findClientByName(state, args.client) : null;
    return ops.rescheduleTime(state, { client, topicHint: args.topicHint, targetTime: args.targetTime });
  },
  shift_day: (state, args) => {
    const client = args.client ? ops.findClientByName(state, args.client) : null;
    return ops.shiftDay(state, { sourceDate: args.sourceDate, days: Number(args.days || 1), client });
  },
  skip_day: (state, args) => {
    const client = args.client ? ops.findClientByName(state, args.client) : null;
    return ops.skipDay(state, { sourceDate: args.sourceDate, client });
  },
  shift_all: (state, args) => {
    const client = ops.findClientByName(state, args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return ops.shiftAllForClient(state, { client, days: Number(args.days || 1) });
  },

  query_today: (state, args) => {
    const client = args.client ? ops.findClientByName(state, args.client) : null;
    return ops.queryToday(state, { client });
  },
  query_date: (state, args) => {
    const client = args.client ? ops.findClientByName(state, args.client) : null;
    return ops.queryDate(state, { date: args.date, client });
  },
  query_client_schedule: (state, args) => {
    const client = ops.findClientByName(state, args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return ops.queryClientSchedule(state, { client, limit: Number(args.limit || 20) });
  },
  query_stats: (state, args) => {
    const client = ops.findClientByName(state, args.client);
    if (!client) return { ok: false, message: `没找到客户：${args.client || ""}` };
    return ops.queryStats(state, { client, scope: args.scope || "month" });
  },
  search_videos: (state, args) => {
    const client = args.client ? ops.findClientByName(state, args.client) : null;
    return ops.searchVideos(state, { keyword: args.keyword || "", client });
  },
  query_video_shoot: (state, args) => {
    const client = args.client ? ops.findClientByName(state, args.client) : null;
    return ops.queryVideoShoot(state, { topicHint: args.topicHint || "", client });
  },
};
