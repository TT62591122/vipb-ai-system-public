# Feature Status — what actually ran, what was tested, what is missing

This page is based on a full review (2026-11-06) of the codebase, the
project's own documents, a dated QA test report run against a live instance
on 2026-03-15 (page/API results plus real database record counts), and the
system owner's own account of what he used. It supersedes an earlier,
over-conservative version of this page.

**Status tiers**

- **Ran in real use** — used by the owner, with usage traces in the data.
- **Passed measured tests** — page/API level verified in the 2026-03-15 QA
  run; deeper end-to-end execution not evidenced.
- **Implemented, not evidenced** — complete code, no test or usage evidence.
- **Not working / missing** — measured failure or never implemented.

| Area | Main code | Status | Evidence |
|---|---|---|---|
| Account environments: proxy nodes (NekoBox-style) | `src/proxy-parser.js`, `src/subscription-parser.js`, `routes/env-api.js`, `views/env.ejs` | **Ran in real use** | Subscription & paste import for vmess/vless/trojan/ss/hysteria2/tuic/Clash formats, one-click speed tests, provider grouping, proxy chains, routing rules. QA run found **195 proxy records** in the database; proxies/subscriptions/chains APIs all passed; owner confirms the nodes worked. |
| Fingerprint browsers & per-account egress | `src/fingerprint-engine.js`, `src/browser-adapters.js`, `src/outbound-proxy.js` | **Ran in real use** | Full fingerprint generation (screen, timezone, WebGL, canvas/audio seeds, WebRTC…); adapters for **AdsPower, Multilogin, GeeLark** plus a local browser pool; every social account binds its own proxy or chain for outbound traffic. Owner confirms it worked. |
| Email sending | `src/email-sender.js`, `src/antiban-engine.js`, `routes/email-api.js` | **Ran in real use** | SMTP sending with personalisation, 2s pacing, anti-ban rules, statistics. Owner-confirmed. |
| Knowledge base (AI brain's company knowledge) | injected via `scripts/inject-*` (content withheld) | **Ran in real use — content not published** | 111 entries distilled by the owner from 3M+ words of trade/sales material (market playbooks, buyer guides, outreach writing, pricing, anti-ban rules). The injection scripts in this repository are placeholders: the knowledge itself is the owner's asset and is deliberately **not** part of the published code. |
| Email receiving, tracking, auto-reply | `src/email-receiver.js`, `src/email-tracker.js`, `src/email-auto-replier.js` | Passed measured tests | 28 received emails in the QA database; inbox pages/APIs passed; one endpoint (`email-receiver/accounts`) returned 404. |
| AI command center & AI brain (5 layers) | `src/ai-command-engine.js`, `src/ai-brain.js`, `src/ai-router.js` | Ran in real use, with caveats | QA database held **62 AI conversations and 32 AI tasks** — real usage traces; command page and task/conversation APIs passed. Caveat: a module-load probe found some engines exporting empty objects under that probe (e.g. workflow/emergency-brake), so engine-level completeness is uneven. |
| Social matrix & 15 platform executors | `src/social-publisher.js`, `src/social-dispatcher.js`, `src/platforms/*` | Passed measured tests | Social page and posts/accounts APIs passed; executors are 134–624 lines each (Facebook, Instagram, TikTok, YouTube, X, LinkedIn*, Threads, Pinterest, Reddit, LINE, VK, Outlook, Shopee, Google Maps, Yandex Maps, website extractor). Per-platform live posting was not evidenced, and platform anti-automation rules apply. |
| Video generation (FFmpeg + Edge TTS) | `src/video-generator.js`, `src/video-mix-engine.js` | Passed measured tests | `/api/videos` and the video page passed; developer report marks compose/TTS/social publishing done. No finished-video artifact was archived as evidence. |
| CRM & trade | `routes/customer-api.js`, `routes/crud-api.js`, `src/lead-scoring.js`, `src/journey-engine.js` | Passed measured tests | Customers/deals APIs passed and Jest tests exist; usage was light (2 customer records at QA time) and `trade/inquiries` returned 404. |
| Analytics, SEO tools, unified inbox, matrix tasks & workflows, WhatsApp, digital human, live restream | various | Mixed: mostly passed measured tests | Inbox, matrix, workflow pages and most APIs passed; `analytics` page and `seo/status`, `dispatcher/status`, `wa-checker/status` endpoints returned 404 in the QA run. |
| Security stack | `server.js`, `src/audit-logger.js`, `src/emergency-brake.js` | Passed measured tests | A dedicated security audit fixed 9.5 of 10 critical items (auth, SQL injection, XSS, encryption, rate limits, headers; CSRF partial). Anti-ban/scoring/emergency APIs passed. The built-in default admin password was removed in the 2026-11 archive pass. |
| eSIM | `routes/esim-api.js` | **Partially working** | Provider CRUD passed with 8 providers loaded, but adding an eSIM phone number failed with HTTP 400 in the QA run — a confirmed defect. |
| Missing endpoints & pages (measured) | — | **Not working / missing** | Pages `/ai`, `/analytics` (404); APIs `vpn-nodes`, `trade/inquiries`, `marketing/calendar`, `marketing/templates`, `ai/logs`, `followups/plans`, `analytics/overview`, `seo/status` (404) and `linkedin/prospects`, `restream/sessions` (403). |
| Remote control (mobile API, push) | — | **Not implemented** | Marked unfinished in the developer's own final report (which claims 86% overall completion). |

\* LinkedIn automation lives in `src/linkedin-automation.js` / `routes/linkedin-api.js`.

## 中文说明（修正版）

本页口径（2026-11-06 全面复核后重写，取代上一版）：

- **实际跑通、用过的**：①**账号环境管理**——节点管理是整套 NekoBox 式功能（订阅导入、全协议解析、一键测速、代理链路、机场分类），实测时库里有 195 条节点；指纹浏览器生成全套指纹并对接 AdsPower/Multilogin/GeeLark 三家，账号按绑定节点出网。②**邮件发送**链路。③**知识库**——系统所有者从 300 多万词句中亲自提炼的外贸销售经验（111 条在库），属个人资产，**内容不随代码公开**，仓库内仅保留占位脚本。④**AI 指挥中心**真用过（留有 62 条对话、32 个任务记录），但引擎层完整性局部存疑。
- **实测通过（页面/接口层）**：邮件接收追踪、社媒矩阵与 15 个平台执行器、视频生成、CRM/交易、安全体系等——2026-03-15 实测报告有逐项记录；逐平台真发、视频成品等深度执行未见留存实证。
- **半通**：eSIM（供应商管理通、添加号码实测 400 失败）。
- **没通/没有的**：/ai、/analytics 两个页面与 11 个接口实测 404、2 个接口 403；远程控制未实现。
