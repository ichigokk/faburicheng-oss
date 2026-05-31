const { loginByPassword } = require("../../utils/api");
const { saveAuth } = require("../../utils/storage");

function emptyState() {
  return { clients: [], shootSessions: [], videoItems: [], publishSlots: [], cancelledDates: [], chatHistory: [], lastShootSessionId: "", version: 0 };
}

Page({
  data: { username: "", password: "", loading: false, error: "" },
  onUsername(e) { this.setData({ username: e.detail.value }); },
  onPassword(e) { this.setData({ password: e.detail.value }); },
  async doLogin() {
    const { username, password } = this.data;
    if (!username || !password) { this.setData({ error: "账号密码都得填" }); return; }
    this.setData({ loading: true, error: "" });
    try {
      const res = await loginByPassword(username.trim(), password);
      if (!res?.ok) throw new Error(res?.error || "登录失败");
      const auth = { token: res.token, user: res.user, expiresAt: res.expiresAt };
      saveAuth(auth);
      const app = getApp();
      app.globalData.auth = auth;
      app.globalData.state = emptyState();
      app.globalData.chatHistory = [];
      app.globalData.lastShootSessionId = "";
      app.globalData.stateLoaded = false;
      wx.switchTab({ url: "/pages/home/home" });
    } catch (err) {
      this.setData({ error: err.message });
    } finally {
      this.setData({ loading: false });
    }
  },
});
