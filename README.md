# 短视频排期助手 · Faburicheng

*[English](#english) · 中文(下方)*

<a name="english"></a>
**English** — Faburicheng is a self-hosted scheduling and asset tool for short-video teams that run content for several client accounts at once. You describe what you shot in plain language ("filmed 5 videos for client A today, the first is a founder story…") and it parses the client, count, topics and content types, then slots each video into the publishing calendar based on that client's cadence and content-type rotation. You keep editing the schedule the same way — move, postpone, cancel, dedupe — by typing or speaking. It runs as a Web PWA and a WeChat Mini Program that share state, with a Node.js server that proxies the LLM calls so API keys never reach the browser. DeepSeek and Qwen are supported, with a local rule-based fallback when neither is available.

---

一个可自托管的短视频团队排期与素材管理工具。它面向需要同时管理多个客户账号的内容团队，提供 Web PWA 和微信小程序两种入口，并支持使用大模型解析自然语言排期指令。

## 功能

- 管理客户、拍摄计划、素材条目和发布排期
- 通过自然语言创建、修改、延期、取消和去重排期
- 在 Web 与微信小程序之间同步状态
- 支持账号密码登录、管理员初始化和组织协作
- 可选接入 DeepSeek、通义千问和 TikHub
- 提供 Docker 与 Node.js 自托管方式

## 截图

截图和演示视频会在后续版本补充。当前项目仍处于早期阶段，欢迎通过 Issue 反馈使用场景。

## 快速开始

需要 Node.js 20 或更高版本。

```bash
cp .env.example .env
npm start
```

打开：

```text
http://localhost:5173
```

首次使用时，可以在 `.env` 中设置：

```bash
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=请替换为至少六位密码
BOOTSTRAP_ADMIN_DISPLAY=管理员
```

也可以设置 `ADMIN_TOKEN`，然后通过 `/admin.html` 创建第一个管理员。

## 模型配置

至少配置一个模型 API key：

```bash
DEEPSEEK_API_KEY=
DASHSCOPE_API_KEY=
```

调用顺序：

1. 优先使用 DeepSeek。
2. DeepSeek 未配置、失败或超时后，自动切换至通义千问。
3. 两个模型都不可用时，前端仍可使用本地规则解析部分指令。

密钥仅由本地 `server.js` 读取，不会写入前端页面。完整变量见 [.env.example](./.env.example)。

## 项目结构

| 路径 | 说明 |
| --- | --- |
| `server.js` | Node.js 服务端、认证、状态同步和模型代理 |
| `index.html`、`app-v2.js` | Web PWA |
| `admin.html`、`admin.js` | 管理员界面 |
| `mp/` | 微信小程序 |
| `Dockerfile` | Docker 部署 |

## 部署

见 [DEPLOY.md](./DEPLOY.md)。

## 数据与隐私

- `.env` 和 `data/` 已加入 `.gitignore`，不要提交生产密钥或用户数据。
- TikHub 为可选第三方接口。启用前请自行确认服务条款、数据来源和所在地区的合规要求。
- 上线前应补充面向最终用户的隐私政策和用户协议。

## 贡献

欢迎提交 Issue 和 Pull Request。开始开发前请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可证

[MIT](./LICENSE)
