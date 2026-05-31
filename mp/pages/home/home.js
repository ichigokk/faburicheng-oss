const { parseCommand, fetchState, pushState, API_BASE } = require("../../utils/api");
const { saveChat, loadChat } = require("../../utils/storage");
const {
  formatDate,
  addDays,
  parseDate,
  startOfWeek,
  startOfMonth,
  isPeriodOnToday,
} = require("../../utils/date");
const { buildScheduleView, buildPublishAlerts } = require("../../utils/schedule");
const { executeToolCalls } = require("../../utils/dispatcher");
const ops = require("../../utils/state-ops");
const MAX_CHAT_HISTORY = 20;

function emptyState() {
  return { clients: [], shootSessions: [], videoItems: [], publishSlots: [], cancelledDates: [], chatHistory: [], lastShootSessionId: "", version: 0 };
}

function cleanClientAliases(client) {
  const seen = new Set();
  client.aliases = (Array.isArray(client.aliases) ? client.aliases : [])
    .map((alias) => String(alias || "").trim())
    .filter((alias) => alias && alias !== client.name && !ops.isSystemAlias(client, alias))
    .filter((alias) => {
      if (seen.has(alias)) return false;
      seen.add(alias);
      return true;
    });
  return client;
}

function normalizeState(raw) {
  const state = raw && typeof raw === "object" ? raw : {};
  return {
    ...emptyState(),
    ...state,
    clients: Array.isArray(state.clients) ? state.clients.map((client) => cleanClientAliases(client)) : [],
    shootSessions: Array.isArray(state.shootSessions) ? state.shootSessions : [],
    videoItems: Array.isArray(state.videoItems) ? state.videoItems : [],
    publishSlots: Array.isArray(state.publishSlots) ? state.publishSlots : [],
    cancelledDates: Array.isArray(state.cancelledDates) ? state.cancelledDates : [],
    chatHistory: Array.isArray(state.chatHistory) ? state.chatHistory.slice(-MAX_CHAT_HISTORY) : [],
    version: Number(state.version) || 0,
  };
}

function buildScheduleContext(state, today) {
  const findClientName = (clientId) => (state.clients.find((client) => client.id === clientId) || {}).name || "";
  const findVideoTopic = (videoItemId) => (state.videoItems.find((video) => video.id === videoItemId) || {}).topic || "";
  return {
    futureSlots: (state.publishSlots || [])
      .filter((slot) => slot.publishDate >= today)
      .sort((a, b) => a.publishDate.localeCompare(b.publishDate) || (a.publishTime || "").localeCompare(b.publishTime || ""))
      .slice(0, 100)
      .map((slot) => ({
        client: findClientName(slot.clientId),
        topic: findVideoTopic(slot.videoItemId),
        publishDate: slot.publishDate,
        publishTime: slot.publishTime,
        locked: Boolean(slot.locked),
      })),
    pendingVideos: (state.videoItems || [])
      .filter((video) => video.status === "待发布")
      .slice(0, 100)
      .map((video) => ({
        client: findClientName(video.clientId),
        topic: video.topic,
        scheduled: (state.publishSlots || []).some((slot) => slot.videoItemId === video.id),
      })),
    recentCancelledDates: (state.cancelledDates || []).slice(-30).map((entry) => ({
      client: findClientName(entry.clientId),
      date: entry.date,
    })),
  };
}

Page({
  data: {
    loggedIn: false,
    viewMode: "days",
    anchorIso: "",
    selectedDate: "",
    periodLabel: "",
    isOnToday: true,
    scheduleMode: "days",
    days: [],
    weekCells: [],
    monthCells: [],
    inlineDay: null,
    alert: { total: 0, top: [] },
    commandText: "",
    sending: false,
    reply: "",
    loadingState: false,
    // 语音
    recording: false,
    recordCancelled: false,
    recordStartedAt: 0,
    transcribing: false,
    // 对话浮窗
    chatExpanded: false,
    chatMessages: [],         // 渲染用：[{role:"user"|"assistant", content, key}]
    chatAutoScrollKey: "",
    pendingClientPrompt: null,
    commandBallMode: false,   // 滚动轻量化：输入条是否已收成悬浮球
  },

  onLoad() {
    const today = formatDate(new Date());
    this.setData({ anchorIso: today });
    this.initRecorder();
  },

  // ===== 语音录制 + STT =====
  // 改为 tap-to-toggle：点一次开始录，再点一次停 + 自动发送
  // 原因：iOS 上 bindtouchend 不可靠，按住模式会卡住
  initRecorder() {
    if (this._recorder) return;
    const rec = wx.getRecorderManager();
    rec.onStart(() => {});
    rec.onStop((res) => this.onRecordStop(res));
    rec.onError((err) => {
      this.clearSafetyTimer();
      this.setData({ recording: false, transcribing: false, reply: "录音出错：" + (err.errMsg || "未知") });
    });
    this._recorder = rec;
  },

  clearSafetyTimer() {
    if (this._safetyTimer) {
      clearTimeout(this._safetyTimer);
      this._safetyTimer = null;
    }
  },

  // 兜底：超过 65 秒还在录音/识别，强行复位
  startSafetyTimer() {
    this.clearSafetyTimer();
    this._safetyTimer = setTimeout(() => {
      try { this._recorder?.stop(); } catch {}
      this.setData({ recording: false, transcribing: false, reply: "卡住了，已复位，重新试" });
    }, 65000);
  },

  // 入口：tap-to-toggle
  async toggleTalk() {
    if (this.data.sending || this.data.transcribing) return;
    if (this.data.recording) {
      this.stopTalk();
    } else {
      await this.startTalk();
    }
  },

  async startTalk() {
    if (this.data.recording) return;
    // 权限检查
    try {
      const setting = await new Promise((resolve, reject) =>
        wx.getSetting({ success: resolve, fail: reject })
      );
      if (setting.authSetting["scope.record"] === false) {
        wx.showModal({
          title: "需要录音权限",
          content: "请到 设置 里打开「录音」权限",
          confirmText: "去开启",
          success: (r) => { if (r.confirm) wx.openSetting(); },
        });
        return;
      }
    } catch {}
    this.initRecorder();
    this.setData({ recording: true, recordCancelled: false, recordStartedAt: Date.now(), reply: "我在听… 再点一下结束" });
    this.startSafetyTimer();
    try {
      this._recorder.start({
        duration: 60000,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: "aac",          // iOS 上比 mp3 更稳
      });
    } catch (err) {
      this.clearSafetyTimer();
      this.setData({ recording: false, reply: "启动录音失败：" + err.message });
    }
  },

  stopTalk() {
    if (!this.data.recording) return;
    const tooShort = Date.now() - this.data.recordStartedAt < 350;
    if (tooShort) {
      this.setData({ recordCancelled: true, reply: "太短啦，再说一遍" });
    }
    // 立刻把 UI 解锁，不等 onStop 回调
    this.setData({ recording: false });
    try { this._recorder.stop(); } catch {}
  },

  async onRecordStop(res) {
    this.clearSafetyTimer();
    // 确保 UI 解锁
    if (this.data.recording) this.setData({ recording: false });
    if (this.data.recordCancelled) return;
    const tempPath = res.tempFilePath;
    if (!tempPath) {
      this.setData({ reply: "录音失败，没拿到文件" });
      return;
    }
    this.setData({ transcribing: true, reply: "识别中…" });
    // 是否多轮决定要不要顺便展浮窗，但识别阶段先不强制展，让 sendCommand 决定
    this.syncChatMessages();
    try {
      const fs = wx.getFileSystemManager();
      const buf = fs.readFileSync(tempPath);
      const app = getApp();
      const token = app.globalData.auth?.token;
      if (!token) throw new Error("先登录");
      const resp = await new Promise((resolve, reject) => {
        wx.request({
          url: API_BASE + "/api/transcribe",
          method: "POST",
          header: {
            "Content-Type": "audio/aac",
            Authorization: `Bearer ${token}`,
          },
          data: buf,
          responseType: "text",
          dataType: "json",
          timeout: 60000,
          success: (r) => resolve(r),
          fail: (e) => reject(new Error(e.errMsg || "网络错误")),
        });
      });
      if (resp.statusCode < 200 || resp.statusCode >= 300) {
        throw new Error(`HTTP ${resp.statusCode}`);
      }
      const data = resp.data || {};
      if (!data.ok) throw new Error(data.error || "识别失败");
      this.setData({ commandText: data.text });
      await this.sendCommand();
    } catch (err) {
      const app = getApp();
      app.globalData.chatHistory.push({ role: "assistant", content: "识别失败：" + err.message });
      this.syncChatMessages();
    } finally {
      this.setData({ transcribing: false });
    }
  },

  onShow() {
    const app = getApp();
    const loggedIn = !!app.globalData.auth?.token;
    this.setData({ loggedIn });
    if (!loggedIn) return;
    if (!app.globalData.stateLoaded) {
      this.pullState();
    } else {
      this.renderSchedule();
    }
    this.syncChatMessages();
  },

  // ===== 对话浮窗 =====
  // chatHistory 里有 user/assistant/tool 多种角色，浮窗只展示 user + assistant 文字
  syncChatMessages() {
    const raw = getApp().globalData.chatHistory || [];
    const msgs = [];
    let idx = 0;
    for (const m of raw) {
      if (m.role !== "user" && m.role !== "assistant") continue;
      const content = String(m.content || "").trim();
      if (!content) continue;
      msgs.push({ key: `msg-${idx++}`, role: m.role, content });
    }
    const lastKey = msgs.length ? msgs[msgs.length - 1].key : "";
    // 连续对话（>=2 条 user 输入 即 4 条记录）就自动浮起，已手动收起的不要再自动展开
    const userCount = msgs.filter((m) => m.role === "user").length;
    const shouldAuto = (userCount >= 2 || this.data.pendingClientPrompt) && !this._chatManuallyCollapsed;
    this.setData({
      chatMessages: msgs,
      chatAutoScrollKey: lastKey,
      chatExpanded: shouldAuto || this.data.chatExpanded,
    });
  },

  toggleChatPanel() {
    const next = !this.data.chatExpanded;
    this._chatManuallyCollapsed = !next; // 收起时记一笔，避免下条消息又被自动展开
    this.setData({ chatExpanded: next });
  },

  clearChat() {
    const app = getApp();
    app.globalData.chatHistory = [];
    this._chatManuallyCollapsed = true;
    this.setData({ chatMessages: [], chatExpanded: false, reply: "", pendingClientPrompt: null });
    // 也把云端同步清掉
    this.persistState();
  },

  noop() {},

  // 滚动轻量化：下滑把输入条收成右下角悬浮球，上滑/点球还原
  onPageScroll(e) {
    const y = (e && e.scrollTop) || 0;
    if (this.data.chatExpanded || y < 24) {
      if (this.data.commandBallMode) this.setData({ commandBallMode: false });
      this._lastScrollTop = y;
      return;
    }
    const delta = y - (this._lastScrollTop || 0);
    if (delta > 6 && !this.data.commandBallMode) this.setData({ commandBallMode: true });
    else if (delta < -6 && this.data.commandBallMode) this.setData({ commandBallMode: false });
    this._lastScrollTop = y;
  },

  exitBall() {
    if (this.data.commandBallMode) this.setData({ commandBallMode: false });
  },

  onPageTap() {
    if (!this.data.chatExpanded) return;
    this._chatManuallyCollapsed = true;
    this.setData({ chatExpanded: false });
  },

  goLogin() { wx.switchTab({ url: "/pages/me/me" }); },
  onCmdInput(e) { this.setData({ commandText: e.detail.value }); },

  editEvent(e) {
    const kind = e.currentTarget.dataset.kind;
    const date = e.currentTarget.dataset.date || "";
    const title = e.currentTarget.dataset.title || "";
    const keyword = kind === "shoot" ? "拍摄" : "发布";
    this._chatManuallyCollapsed = true;
    this.setData({
      commandText: `修改 ${date} ${title} 的${keyword}：`,
      chatExpanded: false,
    });
  },

  deleteEvent(e) {
    const id = e.currentTarget.dataset.id;
    const kind = e.currentTarget.dataset.kind;
    if (!id) return;
    wx.showModal({
      title: kind === "shoot" ? "删除拍摄记录？" : "删除发布排期？",
      content: kind === "shoot" ? "会同时删除这次拍摄生成的素材和对应发布排期。" : "只删除排期，素材会回到待发布。",
      confirmText: "删除",
      confirmColor: "#d83b50",
      success: async (res) => {
        if (!res.confirm) return;
        const app = getApp();
        const state = app.globalData.state;
        let result;
        if (kind === "shoot") {
          const session = ops.findShootSession(state, id);
          const client = session ? ops.findClient(state, session.clientId) : null;
          result = ops.deleteShootSession(state, { client, sessionId: id });
        } else {
          result = this.deletePublishSlot(state, id);
        }
        if (result?.ok) {
          await this.persistState();
          this.renderSchedule();
        }
        wx.showToast({ icon: "none", title: result?.message || "已处理" });
      },
    });
  },

  deletePublishSlot(state, slotId) {
    const slot = (state.publishSlots || []).find((s) => s.id === slotId);
    if (!slot) return { ok: false, message: "没找到这条发布排期。" };
    state.publishSlots = (state.publishSlots || []).filter((s) => s.id !== slotId);
    const video = ops.findVideo(state, slot.videoItemId);
    if (video && video.status !== "已发布") video.status = "待发布";
    state.cancelledDates = Array.isArray(state.cancelledDates) ? state.cancelledDates : [];
    state.cancelledDates.push({ clientId: slot.clientId, videoItemId: slot.videoItemId, date: slot.publishDate, ts: new Date().toISOString() });
    const client = ops.findClient(state, slot.clientId);
    return { ok: true, message: `${client?.name || "客户"} ${slot.publishDate} 的发布排期已删除。` };
  },

  setViewMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!mode || mode === this.data.viewMode) return;
    this.setData({ viewMode: mode, selectedDate: "" });
    this.renderSchedule();
  },

  shiftPeriod(e) {
    const dir = Number(e.currentTarget.dataset.dir || 0);
    if (!dir) return;
    const anchor = parseDate(this.data.anchorIso || formatDate(new Date()));
    let next;
    if (this.data.viewMode === "month") {
      next = new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
    } else if (this.data.viewMode === "week") {
      next = addDays(startOfWeek(anchor), dir * 7);
    } else {
      next = addDays(anchor, dir * 3);
    }
    this.setData({ anchorIso: formatDate(next), selectedDate: "" });
    this.renderSchedule();
  },

  goToday() {
    this.setData({ anchorIso: formatDate(new Date()), selectedDate: "" });
    this.renderSchedule();
  },

  openDate(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    if (this.data.viewMode === "days") {
      this.setData({ selectedDate: this.data.selectedDate === date ? "" : date });
      this.renderSchedule();
      return;
    }
    if (this.data.viewMode === "month") {
      const target = parseDate(date);
      const cur = startOfMonth(parseDate(this.data.anchorIso));
      if (target.getFullYear() !== cur.getFullYear() || target.getMonth() !== cur.getMonth()) {
        this.setData({ anchorIso: formatDate(startOfMonth(target)) });
      }
    }
    this.setData({ selectedDate: date });
    this.renderSchedule();
  },

  jumpToDate(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    this.setData({ viewMode: "days", anchorIso: date, selectedDate: "" });
    this.renderSchedule();
  },

  renderSchedule() {
    const state = getApp().globalData.state || { clients: [], publishSlots: [], shootSessions: [], videoItems: [] };
    const anchor = parseDate(this.data.anchorIso || formatDate(new Date()));
    const view = buildScheduleView(state, this.data.viewMode, anchor, this.data.selectedDate || null);
    const alert = buildPublishAlerts(state);
    this.setData({
      scheduleMode: view.mode,
      periodLabel: view.label,
      days: view.mode === "days" ? view.days : [],
      weekCells: view.mode === "week" ? view.cells : [],
      monthCells: view.mode === "month" ? view.cells : [],
      inlineDay: view.mode !== "days" ? view.inline : null,
      isOnToday: isPeriodOnToday(this.data.viewMode, anchor),
      alert,
    });
  },

  async pullState() {
    this.setData({ loadingState: true });
    try {
      const res = await fetchState();
      if (!res?.ok) throw new Error(res?.error || "拉取失败");
      const app = getApp();
      app.globalData.state = normalizeState(res.state);
      app.globalData.chatHistory = app.globalData.state.chatHistory || [];
      app.globalData.lastShootSessionId = app.globalData.state.lastShootSessionId || "";
      app.globalData.stateLoaded = true;
      this.renderSchedule();
    } catch (err) {
      wx.showToast({ icon: "none", title: "拉取数据失败：" + err.message });
    } finally {
      this.setData({ loadingState: false });
    }
  },

  async persistState() {
    const app = getApp();
    const stateToPush = {
      ...app.globalData.state,
      chatHistory: (app.globalData.chatHistory || []).slice(-MAX_CHAT_HISTORY),
      lastShootSessionId: app.globalData.lastShootSessionId || "",
      version: Number(app.globalData.state.version) || 0,
    };
    try {
      const res = await pushState(stateToPush);
      if (typeof res?.version === "number") app.globalData.state.version = res.version;
    } catch (err) {
      console.warn("push state failed", err);
      if (err.statusCode === 409 && err.data?.state) {
        app.globalData.state = normalizeState(err.data.state);
        app.globalData.chatHistory = app.globalData.state.chatHistory || [];
        app.globalData.lastShootSessionId = app.globalData.state.lastShootSessionId || "";
        this.renderSchedule();
        this.syncChatMessages();
        wx.showToast({ icon: "none", title: "数据已被别处更新，已刷新" });
        return;
      }
      wx.showToast({ icon: "none", title: "保存失败，本地暂存" });
    }
  },

  async sendCommand() {
    const text = (this.data.commandText || "").trim();
    if (!text) return;
    const app = getApp();
    // 仅多轮（已有 >=1 条 user）才自动展浮窗；单轮内联反馈
    const existingUserCount = (app.globalData.chatHistory || []).filter((m) => m.role === "user").length;
    const isMultiTurn = existingUserCount >= 1;
    app.globalData.chatHistory.push({ role: "user", content: text });
    this._sentUserText = text;
    const patch = { sending: true, reply: "想一下…", commandText: "" };
    if (isMultiTurn) {
      patch.chatExpanded = true;
      this._chatManuallyCollapsed = false;
    }
    this.setData(patch);
    this.syncChatMessages();
    try {
      const today = formatDate(new Date());
      const lower = formatDate(addDays(new Date(), -14));
      const upper = formatDate(addDays(new Date(), 30));
      const recentShoots = (app.globalData.state.shootSessions || [])
        .filter((s) => s.shootDate >= lower && s.shootDate <= upper)
        .map((s) => ({
          sessionId: s.id,
          client: (app.globalData.state.clients.find((c) => c.id === s.clientId) || {}).name || "",
          shootDate: s.shootDate,
          status: s.status,
          shootCount: s.shootCount,
        }));
      const existingTopics = (app.globalData.state.videoItems || []).map((v) => v.topic).filter(Boolean);
      const res = await parseCommand({
        text,
        today,
        clients: app.globalData.state.clients || [],
        existingTopics,
        recentShoots,
        scheduleContext: buildScheduleContext(app.globalData.state, today),
        chatHistory: (app.globalData.chatHistory || []).slice(-MAX_CHAT_HISTORY),
      });
      if (!res.ok) throw new Error(res.error || "解析失败");

      const confirmedCalls = await this.confirmSensitiveTools(res.toolCalls || []);
      if (!confirmedCalls) {
        this.setData({ reply: "好，这次先不执行。" });
        return;
      }
      const exec = executeToolCalls(app.globalData.state, confirmedCalls, res.assistantMessage || "");
      app.globalData.lastShootSessionId = app.globalData.state.lastShootSessionId || app.globalData.lastShootSessionId;
      const clientPrompt = this.buildClientPrompt(exec);
      if (clientPrompt) {
        this._chatManuallyCollapsed = false;
        this.setData({ pendingClientPrompt: clientPrompt, chatExpanded: true });
      }

      // 用户消息已在 sendCommand 开头入队，避免重复
      if (this._sentUserText !== text) {
        app.globalData.chatHistory.push({ role: "user", content: text });
      }
      this._sentUserText = "";
      const assistantEntry = { role: "assistant", content: exec.summary || "" };
      if (exec.calls.length) {
        assistantEntry.tool_calls = exec.calls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.args || {}) },
        }));
      }
      app.globalData.chatHistory.push(assistantEntry);
      for (const m of exec.toolMessages) app.globalData.chatHistory.push(m);
      if (app.globalData.chatHistory.length > MAX_CHAT_HISTORY) {
        app.globalData.chatHistory = app.globalData.chatHistory.slice(-MAX_CHAT_HISTORY);
      }

      await this.persistState();
      this.renderSchedule();
      // 单轮反馈：把 summary 也回写到内联 reply（浮窗展开时 wxml 已经隐藏 reply）
      this.setData({ reply: exec.summary || "完成" });
      this.syncChatMessages();
    } catch (err) {
      const app2 = getApp();
      app2.globalData.chatHistory.push({ role: "assistant", content: `出错了：${err.message}` });
      this.setData({ reply: `出错了：${err.message}` });
      this.syncChatMessages();
    } finally {
      this.setData({ sending: false });
    }
  },

  async confirmSensitiveTools(toolCalls) {
    const sensitive = new Set([
      "delete_client",
      "delete_shoot_session",
      "dedupe_client_data",
      "rebuild_client_schedule",
      "set_client_publish_schedule",
      "delete_video",
      "shift_all",
    ]);
    const calls = (toolCalls || []).map((call) => ({ ...call, args: { ...(call.args || {}) } }));
    for (const call of calls) {
      if (!sensitive.has(call.name) || call.args.__confirmed) continue;
      const client = call.args.client ? `「${call.args.client}」` : "";
      const descriptions = {
        delete_client: `删除客户${client}及相关日程、素材？`,
        delete_shoot_session: `删除${client}的拍摄记录及对应素材、发布？`,
        dedupe_client_data: `清理${client}的重复数据并重排？`,
        rebuild_client_schedule: `重新生成${client}未来的发布排期？`,
        set_client_publish_schedule: `按你指定的日期整体调整${client}待发布素材？`,
        delete_video: `删除素材「${call.args.topicHint || ""}」及对应发布？`,
        shift_all: `把${client}未来发布整体顺延 ${Number(call.args.days || 1)} 天？`,
      };
      const confirmed = await new Promise((resolve) => {
        wx.showModal({
          title: "确认执行",
          content: descriptions[call.name] || "确认执行这项修改？",
          confirmText: "确认",
          cancelText: "取消",
          success: (result) => resolve(Boolean(result.confirm)),
          fail: () => resolve(false),
        });
      });
      if (!confirmed) return null;
      call.args.__confirmed = true;
    }
    return calls;
  },

  buildClientPrompt(exec) {
    const shootTools = ["plan_shoot", "record_shoot", "update_shoot_count"];
    const idx = (exec.actionResults || []).findIndex((r, i) => !r.ok && /没找到客户/.test(r.message) && shootTools.includes(exec.calls?.[i]?.name));
    if (idx < 0) return null;
    const call = exec.calls[idx];
    const rawName = String(call.args?.client || "").trim();
    const candidates = (getApp().globalData.state.clients || [])
      .map((client) => ({ client, score: this.fuzzyClientScore(rawName, client) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => ({ id: x.client.id, name: x.client.name }));
    return { rawName, call, candidates };
  },

  fuzzyClientScore(query, client) {
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
  },

  async onClientPromptAction(e) {
    const action = e.currentTarget.dataset.action;
    const clientId = e.currentTarget.dataset.clientId;
    const prompt = this.data.pendingClientPrompt;
    if (!prompt) return;
    const app = getApp();
    if (action === "cancel") {
      app.globalData.chatHistory.push({ role: "assistant", content: "好，这条先不处理。" });
      this.setData({ pendingClientPrompt: null });
      this.syncChatMessages();
      await this.persistState();
      return;
    }
    const rawName = prompt.rawName || "新客户";
    const original = { ...prompt.call, args: { ...(prompt.call.args || {}) } };
    const calls = [];
    if (action === "create") {
      calls.push({
        name: "create_client",
        args: {
          name: rawName,
          publishIntervalDays: 1,
          defaultPublishTime: "17:00",
          contentTypes: this.promptContentTypes(original.args),
        },
      });
      original.args.client = rawName;
    } else if (action === "alias") {
      const client = (app.globalData.state.clients || []).find((c) => c.id === clientId);
      if (!client) return;
      calls.push({ name: "add_client_alias", args: { client: client.name, alias: rawName } });
      original.args.client = client.name;
    }
    calls.push(original);
    const exec = executeToolCalls(app.globalData.state, calls, "");
    app.globalData.chatHistory.push({ role: "assistant", content: exec.summary || "处理好了。" });
    for (const m of exec.toolMessages) app.globalData.chatHistory.push(m);
    if (app.globalData.chatHistory.length > MAX_CHAT_HISTORY) {
      app.globalData.chatHistory = app.globalData.chatHistory.slice(-MAX_CHAT_HISTORY);
    }
    this.setData({ pendingClientPrompt: null, reply: exec.summary || "处理好了。" });
    await this.persistState();
    this.renderSchedule();
    this.syncChatMessages();
  },

  promptContentTypes(args = {}) {
    const types = [];
    if (args.contentType) types.push(args.contentType);
    if (Array.isArray(args.items)) {
      for (const item of args.items) if (item?.contentType) types.push(item.contentType);
    }
    return [...new Set(types)].filter(Boolean);
  },
});
