// 小程序全局入口
const { loadAuth } = require("./utils/storage");

App({
  globalData: {
    // 后端地址在 utils/api.js 中配置。
    auth: null,
    state: { clients: [], shootSessions: [], videoItems: [], publishSlots: [], cancelledDates: [], chatHistory: [], lastShootSessionId: "", version: 0 },
    chatHistory: [],
    lastShootSessionId: "",
    stateLoaded: false,
  },
  onLaunch() {
    this.globalData.auth = loadAuth();
  },
});
