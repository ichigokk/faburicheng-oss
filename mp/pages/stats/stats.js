const { fetchState } = require("../../utils/api");
const { buildStatsView, buildClientDetail } = require("../../utils/stats");

Page({
  data: {
    loggedIn: false,
    loading: false,
    overview: { monthShoots: 0, totalUnposted: 0, riskCount: 0 },
    rows: [],
    summary: "",
    selectedClientId: "",
    detail: null,
  },

  onShow() {
    const app = getApp();
    const loggedIn = !!app.globalData.auth?.token;
    this.setData({ loggedIn });
    if (!loggedIn) return;
    if (!app.globalData.stateLoaded) {
      this.pullState();
    } else {
      this.renderStats();
    }
  },

  async pullState() {
    this.setData({ loading: true });
    try {
      const res = await fetchState();
      if (!res?.ok) throw new Error(res?.error || "拉取失败");
      const app = getApp();
      app.globalData.state = res.state || {};
      app.globalData.stateLoaded = true;
      this.renderStats();
    } catch (err) {
      wx.showToast({ icon: "none", title: "拉取失败：" + err.message });
    } finally {
      this.setData({ loading: false });
    }
  },

  renderStats() {
    const state = getApp().globalData.state || {};
    const view = buildStatsView(state);
    this.setData({
      overview: view.overview,
      rows: view.rows,
      summary: view.summary,
    });
    if (this.data.selectedClientId) {
      const detail = buildClientDetail(state, this.data.selectedClientId);
      this.setData({ detail });
    }
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const detail = buildClientDetail(getApp().globalData.state || {}, id);
    this.setData({ selectedClientId: id, detail });
  },

  closeDetail() {
    this.setData({ selectedClientId: "", detail: null });
  },

  goLogin() {
    wx.switchTab({ url: "/pages/me/me" });
  },
});
