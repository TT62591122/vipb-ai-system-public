# Development Guide — VIPB AI System V2

This document explains how the system is built, how to run it for
development, how its key subsystems work, and how to extend it. For the
product overview see [README.md](README.md); for an evidence-based account
of what works and what does not, see [docs/FEATURE-STATUS.md](docs/FEATURE-STATUS.md).

## 1. Runtime requirements

- Node.js 18+ (the codebase is CommonJS; entry point `server.js`)
- npm packages: `npm install` (better-sqlite3 and bcrypt are native modules —
  install on the same OS you will run on)
- Optional, only for the video module: FFmpeg on PATH and the Python
  `edge-tts` package
- Optional, only for fingerprint-browser features: an AdsPower, Multilogin
  or GeeLark account, or local Chromium via Puppeteer

## 2. Run for development

```bash
npm install
cp .env.example .env        # fill in your own values
node server.js              # or: npm run dev
```

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (3000 in the template; the reference deployment used 3001) |
| `NODE_ENV` | `development` \| `production` |
| `SESSION_SECRET` | Session signing secret — always set your own in production |
| `CREDENTIAL_KEY` | Key used to encrypt stored credentials (social/mail accounts). If unset, stored credentials cannot survive a restart — set it before adding accounts |
| `INITIAL_ADMIN_PASSWORD` | Password for the initial `admin` account created on first start; if unset, a random one is generated and printed once in the startup log |

On first start the app creates `data/vipb.db`, initialises the schema,
creates the initial admin (see above) and mounts all engines and routes.
There is no built-in default password.

## 3. Architecture

Eight product modules sit on one Express app, one SQLite database and one
engine layer:

| # | Module | Views | Main routes |
|---|---|---|---|
| 1 | Command dashboard | `views/dashboard.ejs` | `routes/api.js`, `routes/analytics-api.js` |
| 2 | CRM | `views/crm.ejs` | `routes/customer-api.js`, `routes/crud-api.js` |
| 3 | Trade (deals & inquiries) | `views/trade.ejs` | `routes/api.js` (trade) |
| 4 | Marketing (email) | `views/marketing.ejs`, `views/inbox.ejs` | `routes/email-api.js`, `routes/email-receiver-api.js`, `routes/inbox-api.js` |
| 5 | Social acquisition | `views/social.ejs`, `views/matrix.ejs` | `routes/matrix-api.js`, platform APIs |
| 6 | Account environments | `views/env.ejs` | `routes/env-api.js`, `routes/esim-api.js` |
| 7 | Product library | `views/products.ejs` | `routes/api.js` (products) |
| 8 | Settings | `views/settings.ejs` | `routes/settings-api.js`, `routes/env-api.js` |

**AI brain (as designed, 5 layers)**: (1) six specialist agents, (2) the
company knowledge base (`knowledge_base` table), (3) an execution layer of
engines, (4) a scheduling centre (AI router + command engine), (5) cost
control. Entry points: `src/ai-brain.js`, `src/ai-router.js`,
`src/ai-command-engine.js`; the console is `views/ai-command.ejs`.

**Data flow**: browser → Express routes → engines (`src/`) → DAL/SQLite;
real-time updates via Socket.IO; all outbound traffic can be forced through
the proxy layer (§5.1).

## 4. Code map

```
server.js          Entry point: middleware (helmet, session, CSRF, rate
                   limit), engine wiring, route mounting, inline legal pages
src/               ~90 engine modules (see §5)
  platforms/       15 platform executors + website extractor
routes/            ~40 route files, grouped by module (table above)
views/             EJS templates; views/partials/header|footer shared chrome
public/            Static assets (css/js/widget)
scripts/           Ops & check scripts; knowledge-injection scripts are
                   placeholders in this edition (see §5.3)
tests/             Jest suites (customers, email, health, matrix,
                   security, workflow) + helpers
data/              Created at runtime: vipb.db, uploads, product-images
```

## 5. Key subsystems

### 5.1 Account environments & egress (module 6)

- **Node parsing**: `src/proxy-parser.js` + `src/subscription-parser.js`
  parse subscription URLs and pasted node lists — vmess, vless, trojan,
  Shadowsocks, hysteria2, tuic, SOCKS5, Clash YAML and NekoBox exports.
- **Data**: `proxies`, `proxy_chains` (multi-hop: entry → landing),
  `vpn_subscriptions`, plus per-account bindings on `social_accounts`
  (`proxy_id` / `chain_id`). Speed tests: `POST /api/env/proxies/:id/test*`.
- **Egress resolution**: `src/outbound-proxy.js` builds HTTP/SOCKS agents —
  per-account binding first (account → its proxy, or its chain's landing
  proxy), then the global `outbound_proxy` setting; agents are cached 30s.
- **Fingerprints**: `src/fingerprint-engine.js` (a browser pool) generates
  complete fingerprints — user agent, screen, languages, timezone, WebGL,
  canvas seed, audio seed, WebRTC policy, hardware concurrency, device
  memory — one per browser profile (`env profiles` in `routes/env-api.js`).
- **Browser adapters**: `src/browser-adapters.js` — `AdsPowerAdapter`,
  `MultiloginAdapter`, `GeeLarkAdapter`, plus the local Puppeteer pool;
  `BrowserAdapterManager` selects per profile. `src/human-behavior-engine.js`
  adds human-like scrolling/typing/mouse movement used by executors.

### 5.2 Email pipeline (module 4)

- `src/email-sender.js`: SMTP sending with template personalisation, bulk
  queues and send statistics.
- `src/antiban-engine.js`: pacing and limit rules (default 2s/message plus
  per-account daily caps) consulted before every send.
- `src/email-receiver.js` (IMAP), `src/email-tracker.js` (open tracking),
  `src/email-auto-replier.js`, `src/email-verifier.js`,
  `src/wa-number-checker.js` (WhatsApp number existence checks),
  `src/personalized-email-builder.js` (AI-drafted one-to-one outreach).

### 5.3 AI brain & knowledge base

- Commands from the console are parsed by `src/ai-command-engine.js`,
  routed by `src/ai-router.js`/`src/ai-brain.js` to engines; conversations
  and tasks persist in `ai_conversations` / `ai_tasks`.
- The knowledge base lives in `knowledge_base` (category, title, content)
  and is consulted by the brain and the email builder. **The owner's
  knowledge content is not distributed with this code** — the
  `scripts/inject-*knowledge*.js` files are placeholders explaining how
  injection works. To use your own knowledge, insert rows in the same
  shape (see the placeholder scripts) or re-enable the original scripts
  from your private copy.

### 5.4 Social subsystem (module 5)

Two complementary mechanisms:

- **Dispatcher/adapters** (`src/social-dispatcher.js`): `BaseAdapter`
  interface — `connect`, `disconnect`, `sendMessage`, `post`, `getStatus` —
  with WhatsApp, TikTok, Facebook and LinkedIn adapters. The dispatcher
  picks the account, attaches its proxy/cookies, enforces warm-up and
  daily-limit checks, and updates account stats after each action.
  OAuth tokens are managed by `src/oauth-manager.js` (Facebook/TikTok).
- **Executors** (`src/platforms/<name>/executor.js`): Puppeteer-based
  collection/action flows per platform. Pattern: a class with
  `async execute(context)`, helpers for human-like interaction, and
  `_acquireBrowser(accountId)` to get the account's profiled browser.

**Add a platform**: create `src/platforms/<name>/executor.js` following
the pattern above, register its routes in `server.js` (see existing
platform route files such as `routes/tiktok-api.js`), and add its page
link in `views/partials/header.ejs`.

### 5.5 Tasks, workflows, scheduling

- `src/matrix-task-engine.js`: multi-account matrix tasks with lifecycle
  (create → run → pause → resume → complete).
- `src/workflow-engine.js` + `src/multichannel-sequence.js`: step
  workflows and multi-channel follow-up sequences; `src/journey-engine.js`
  moves customers through journey stages; `src/lead-scoring.js` scores
  leads (`/api/scoring/rules`).
- `src/task-scheduler.js` (node-cron): daily email run, daily video post,
  hourly OAuth-token check, nightly DB backup (kept 7 days), weekly
  report. `src/emergency-brake.js` is the global stop switch
  (`/api/emergency/status`); `src/alert-engine.js` and
  `src/audit-logger.js` cover alerting and audit trails.

### 5.6 Video

`src/video-generator.js` composes scenes (image + text + Edge-TTS voice)
with FFmpeg, adds watermark and randomisation; `src/video-mix-engine.js`
and `src/live-restream-engine.js` cover remixing and restreaming.

### 5.7 Security model

- Auth: session login, bcrypt password hashing, optional TOTP
  (`src/auth-middleware.js`, `src/init-users.js`).
- CSRF (csurf), rate limiting, Helmet headers, input validation
  (`src/input-validator.js`).
- Stored secrets are encrypted with `CREDENTIAL_KEY`
  (`src/crypto-utils.js`); a security audit (see `SECURITY-AUDIT.md`)
  fixed 9.5/10 critical items — CSRF coverage is partial and HTTPS is
  left to the deployment.

## 6. Database

Single SQLite file `data/vipb.db` (better-sqlite3), 90+ tables grouped by
domain: users & credentials, customers & deals, emails & received_emails,
knowledge_base, content templates, social_accounts, proxies & chains &
subscriptions, browser profiles, eSIM providers & phones, ai_tasks &
ai_conversations, matrix tasks & workflows, settings, activity/audit
logs. Access goes through `src/database.js` / `src/dal.js`; nightly
backups via `src/backup.js` (7-day retention).

## 7. Testing

```bash
npm test   # jest --forceExit --detectOpenHandles
```

`tests/setup.js` boots a throwaway server on `TEST_PORT` (default 3099)
and waits for `/api/health`. Suites cover customers, email, health,
matrix, security and workflow. Operational scripts (`full-test.js`,
`_exec*.js`, `test-*.ps1`, jest helpers) read the admin password from
`ADMIN_PASSWORD` / `TEST_ADMIN_PASSWORD` environment variables — they
refuse to run without them. A full manual QA report from a live instance
(2026-03-15) is kept in `test-report-2026-03-15.md`.

## 8. Known issues (from the 2026-03-15 QA run — read before extending)

- Missing: pages `/ai`, `/analytics`; endpoints `vpn-nodes`,
  `trade/inquiries`, `marketing/calendar`, `marketing/templates`,
  `ai/logs`, `followups/plans`, `analytics/overview`, `seo/status`,
  `email-receiver/accounts`, `dispatcher/status`, `wa-checker/status`
  (404) and `linkedin/prospects`, `restream/sessions` (403).
- eSIM: adding a phone number fails with HTTP 400 (provider CRUD works).
- Data: `activity_log` had orphaned user references; one invalid JSON
  row in `settings`.
- A module-load probe reported several engines with empty exports
  (workflow-engine, emergency-brake, scraper-engine, platform executors)
  even though the app assembles them via `server.js` — verify exports
  when touching those modules.
- Remote control (mobile API / push) was never implemented.

## 9. Conventions

- Secrets only via environment variables or the encrypted credential
  store — never hardcode keys, tokens or passwords (the initial admin
  password rule in §2 exists for this reason).
- New platform work goes through the executor/adapter patterns in §5.4;
  new outbound HTTP should respect the egress layer in §5.1.
- Keep per-module status honest: update `docs/FEATURE-STATUS.md` when a
  module's state changes.

---

## 中文版（要点）

- **运行**：Node.js 18+，`npm install` 后复制 `.env.example` 为 `.env`（关键项：`SESSION_SECRET`、`CREDENTIAL_KEY` 凭证加密密钥、`INITIAL_ADMIN_PASSWORD` 初始管理员口令、未设则随机生成并打印一次；`PORT` 模板为 3000、原部署用 3001）。首次启动自动建库建号，无内置默认口令。视频模块另需 FFmpeg 与 edge-tts。
- **架构**：8 大模块共用一个 Express 应用、一套引擎层（src/ 约 90 个模块）、一个 SQLite 库（90+ 表）。AI 大脑为 5 层设计：专家 Agent＋知识库＋执行层＋调度中心＋成本控制，入口 ai-brain/ai-router/ai-command-engine。
- **环境与出口（核心子系统）**：节点解析支持 vmess/vless/trojan/ss/hysteria2/tuic/Clash/NekoBox 格式；代理链为多级跳板；出站流量由 outbound-proxy 按“账号绑定 → 全局设置”顺序选代理；指纹引擎生成整套浏览器指纹，适配器对接 AdsPower/Multilogin/GeeLark 与本地浏览器池。
- **邮件**：发送（防封节奏 2 秒/封＋账号日限）＋IMAP 接收＋打开追踪＋自动回复＋邮箱/WA 号码验证。
- **知识库**：存于 knowledge_base 表供 AI 大脑与邮件生成调用；**所有者的知识内容不随代码分发**，仓库内注入脚本为占位说明，使用者请写入自己的知识。
- **社媒**：调度层适配器（connect/sendMessage/post 接口，含养号与限额检查、OAuth 管理）＋15 个平台执行器（Puppeteer 的 execute(context) 模式）；新增平台照执行器模式加文件、注册路由、补导航。
- **任务与安全**：矩阵任务引擎、工作流、node-cron 定时（日发邮件/视频、小时查 token、夜备数据库留 7 天、周报）、紧急刹车；安全为会话＋bcrypt＋可选 TOTP、CSRF、限流、凭证加密，审计修过 9.5/10 项。
- **测试**：`npm test`（Jest，测试服端口 3099）；运维脚本从环境变量读管理员口令。
- **已知问题**：见上文 §8（缺失页面/接口清单、eSIM 加号码 400、个别引擎导出异常、远程控制未实现）——扩展开发前先读。
