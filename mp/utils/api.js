// 小程序网络层：直接走 wx.request → 你自有服务器。
// 发布前替换为已配置到微信小程序后台 request 合法域名中的 HTTPS 地址。
const API_BASE = "https://api.example.com";

function request({ path, method = "GET", data = null, header = {}, withAuth = true } = {}) {
  const app = getApp();
  const finalHeader = Object.assign({ "Content-Type": "application/json" }, header || {});
  if (withAuth && app.globalData.auth?.token) {
    finalHeader.Authorization = `Bearer ${app.globalData.auth.token}`;
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: API_BASE + path,
      method,
      data,
      header: finalHeader,
      timeout: 30000,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          const err = new Error(res.data?.error || `HTTP ${res.statusCode}`);
          err.statusCode = res.statusCode;
          err.data = res.data;
          reject(err);
        }
      },
      fail: (err) => reject(new Error(err.errMsg || "网络错误")),
    });
  });
}

function loginByPassword(username, password) {
  return request({ path: "/api/auth/login", method: "POST", data: { username, password }, withAuth: false });
}
function fetchMe() {
  return request({ path: "/api/auth/me", method: "GET" });
}
function parseCommand(payload) {
  return request({ path: "/api/parse", method: "POST", data: payload });
}
function fetchProfile(platform, params) {
  const qs = Object.entries({ platform, ...params })
    .filter(([_, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return request({ path: `/api/profile?${qs}`, method: "GET" });
}
function fetchState() {
  return request({ path: "/api/state", method: "GET" });
}
function pushState(state) {
  return request({ path: "/api/state", method: "PUT", data: { state } });
}
function fetchStatus() {
  return request({ path: "/api/status", method: "GET", withAuth: false });
}
function logout() {
  return request({ path: "/api/auth/logout", method: "POST" });
}

module.exports = {
  API_BASE,
  request,
  loginByPassword,
  fetchMe,
  parseCommand,
  fetchProfile,
  fetchState,
  pushState,
  fetchStatus,
  logout,
};
