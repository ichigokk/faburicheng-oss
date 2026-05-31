# 短视频排期助手 · 微信小程序

此目录包含微信小程序客户端。它通过 `wx.request` 访问自托管 Node.js 服务，与 Web 端共用账号和排期数据。

## 开始开发

1. 使用微信开发者工具打开本目录。
2. 在 `project.config.json` 中将 `appid` 替换为你自己的 AppID。仅本地体验时可继续使用 `touristappid`。
3. 在 `utils/api.js` 中将 `API_BASE` 替换为你的 HTTPS API 地址。
4. 在微信公众平台中将 API 域名加入 `request` 合法域名。
5. 不要提交微信开发者工具生成的 `project.private.config.json`。

## 主要模块

| 路径 | 说明 |
| --- | --- |
| `pages/login/` | 账号密码登录 |
| `pages/home/` | 排期助手、今日任务和自然语言操作 |
| `pages/stats/` | 数据统计 |
| `pages/me/` | 账号与客户管理 |
| `utils/api.js` | 服务端 API 调用 |
| `utils/state-ops.js` | 排期状态操作 |

## 上线检查项

- [ ] 后端已启用 HTTPS
- [ ] API 域名已加入小程序后台白名单
- [ ] LLM 和 TikHub 流量均通过服务端转发
- [ ] 已确认第三方数据接口的服务条款与合规要求
- [ ] 已补充隐私政策和用户协议
