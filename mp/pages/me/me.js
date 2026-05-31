const { fetchState, fetchStatus, logout, request } = require("../../utils/api");
const { saveAuth, clearAuth } = require("../../utils/storage");

Page({
  data: {
    user: null,
    clients: [],
    llmStatus: null,
    llmLoading: false,
    showAddClient: false,
    form: {
      clientName: "",
      clientInterval: "1",
      clientTime: "17:00",
      clientTypes: "案例、干货、老板IP、日常",
      clientDouyinUrl: "",
      clientXhsUrl: "",
      clientChannelsName: "",
    },
    saving: false,
  },

  onShow() {
    const app = getApp();
    const auth = app.globalData.auth;
    if (!auth?.token) {
      this.setData({ user: null, clients: [] });
      return;
    }
    const user = auth.user || { displayName: auth.name || "已登录", role: auth.role || "member" };
    this.setData({ user });
    this.refreshClients();
    if (!this.data.llmStatus) this.refreshLlmStatus();
  },

  refreshClients() {
    const state = getApp().globalData.state || {};
    this.setData({ clients: state.clients || [] });
  },

  async refreshLlmStatus() {
    this.setData({ llmLoading: true });
    try {
      const res = await fetchStatus();
      if (!res?.ok) throw new Error(res?.error || "查询失败");
      this.setData({ llmStatus: res });
    } catch (err) {
      this.setData({ llmStatus: { ok: false, providers: [], error: err.message } });
    } finally {
      this.setData({ llmLoading: false });
    }
  },

  goLogin() {
    wx.navigateTo({ url: "/pages/login/login" });
  },

  async doLogout() {
    const app = getApp();
    try { await logout(); } catch {}
    app.globalData.auth = null;
    app.globalData.state = { clients: [], shootSessions: [], videoItems: [], publishSlots: [], chatHistory: [], lastShootSessionId: "" };
    app.globalData.stateLoaded = false;
    clearAuth();
    this.setData({ user: null, clients: [] });
  },

  toggleAddClient() {
    this.setData({ showAddClient: !this.data.showAddClient });
  },

  onFormInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  async saveClient() {
    const f = this.data.form;
    const name = (f.clientName || "").trim();
    if (!name) {
      wx.showToast({ icon: "none", title: "客户名必填" });
      return;
    }
    const app = getApp();
    const state = app.globalData.state || { clients: [], shootSessions: [], videoItems: [], publishSlots: [], chatHistory: [] };

    const id = `client_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const contentTypes = (f.clientTypes || "")
      .split(/[、，,\/\s]+/).map((s) => s.trim()).filter(Boolean);
    const accounts = [];
    if (f.clientDouyinUrl) accounts.push({ platform: "douyin", url: f.clientDouyinUrl.trim() });
    if (f.clientXhsUrl) accounts.push({ platform: "xhs", url: f.clientXhsUrl.trim() });
    if (f.clientChannelsName) accounts.push({ platform: "channels", nickname: f.clientChannelsName.trim() });

    const newClient = {
      id,
      name,
      publishIntervalDays: Math.max(1, Number(f.clientInterval) || 1),
      defaultPublishTime: f.clientTime || "17:00",
      contentTypes: contentTypes.length ? contentTypes : ["案例", "干货", "老板IP", "日常"],
      accounts,
      createdAt: new Date().toISOString(),
    };
    state.clients = [...(state.clients || []), newClient];
    app.globalData.state = state;

    this.setData({ saving: true });
    try {
      await request({
        path: "/api/state",
        method: "PUT",
        data: { state: {
          ...state,
          chatHistory: (app.globalData.chatHistory || []).slice(-20),
          lastShootSessionId: app.globalData.lastShootSessionId || "",
        } },
      });
      this.setData({
        showAddClient: false,
        form: {
          clientName: "", clientInterval: "1", clientTime: "17:00",
          clientTypes: "案例、干货、老板IP、日常",
          clientDouyinUrl: "", clientXhsUrl: "", clientChannelsName: "",
        },
      });
      this.refreshClients();
      wx.showToast({ icon: "success", title: "加好了" });
    } catch (err) {
      wx.showToast({ icon: "none", title: "保存失败：" + err.message });
    } finally {
      this.setData({ saving: false });
    }
  },
});
