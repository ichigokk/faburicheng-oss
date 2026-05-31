// 小程序里用 wx.setStorageSync 代替 localStorage
const AUTH_KEY = "fbc_auth_v1";
const STATE_KEY = "fbc_state_v1";
const CHAT_KEY = "fbc_chat_v1";

function safeRead(key, fallback) {
  try {
    const raw = wx.getStorageSync(key);
    if (!raw) return fallback;
    if (typeof raw === "string") return JSON.parse(raw);
    return raw;
  } catch (e) {
    return fallback;
  }
}

function safeWrite(key, value) {
  try {
    wx.setStorageSync(key, JSON.stringify(value));
  } catch (e) {
    console.warn("storage write failed", key, e);
  }
}

module.exports = {
  loadAuth: () => safeRead(AUTH_KEY, null),
  saveAuth: (auth) => safeWrite(AUTH_KEY, auth),
  clearAuth: () => wx.removeStorageSync(AUTH_KEY),

  loadState: () => safeRead(STATE_KEY, { clients: [], shootSessions: [], videoItems: [], publishSlots: [], cancelledDates: [], chatHistory: [], lastShootSessionId: "", version: 0 }),
  saveState: (state) => safeWrite(STATE_KEY, state),

  loadChat: () => safeRead(CHAT_KEY, []),
  saveChat: (chat) => safeWrite(CHAT_KEY, chat),
};
