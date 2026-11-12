# VIPB-AI-System 完整架构文档

> 自动生成于 2026-03-24

## 1. 项目概览

- **技术栈**: Node.js + Express + better-sqlite3 + Socket.IO + EJS + Puppeteer
- **启动**: `node server.js` 或 `pm2 start ecosystem.config.js`
- **端口**: 3001 (默认)
- **数据库**: SQLite (`data/vipb.db`)
- **入口**: `server.js`

### 目录结构
```
config/ (1 files)
data/ (10 files)
logs/ (7 files)
migrations/ (2 files)
public/ (3 files)
public/js/ (2 files)
routes/ (47 files)
scripts/ (21 files)
src/ (74 files)
src/platforms/ (15 files)
src/esim/ (3 files)
src/human/ (6 files)
tests/ (9 files)
views/ (18 files)
views/partials/ (2 files)
```

## 2. 核心入口 server.js

- **文件大小**: 60264 bytes, 1383 行

### 引入模块

- `dotenv`
- `src/logger`
- `express`
- `path`
- `http`
- `socket.io`
- `express-session`
- `bcrypt`
- `express-rate-limit`
- `helmet`
- `cookie-parser`
- `crypto`
- `src/database`
- `src/init-users`
- `src/auth-middleware`
- `src/config`
- `node-cron`
- `src/backup`
- `src/email-sender`
- `src/whatsapp-client`
- `src/antiban-engine`
- `src/lead-scoring`
- `src/linkedin-automation`
- `routes/calendar-api`
- `src/unified-inbox`
- `src/journey-engine`
- `routes/analytics-api`
- `src/social-accounts`
- `src/wa-number-checker`
- `src/social-dispatcher`
- `routes/settings-api`
- `src/browser-adapters`
- `fs`
- `fs`
- `src/input-validator`
- `src/dal`
- `src/audit-logger`
- `src/alert-engine`
- `csurf`
- `speakeasy`
- `routes/tracking-api`
- `fs`
- `src/config`
- `src/crypto-utils`
- `src/oauth-manager`
- `routes/pages`
- `routes/api`
- `routes/ai-api`
- `routes/trade-api`
- `routes/marketing-api`
- `routes/social-api`
- `routes/tiktok-api`
- `routes/env-api`
- `routes/esim-api`
- `routes/browser-adapters-api`
- `routes/products-api`
- `routes/settings-api`
- `routes/whatsapp-api`
- `src/matrix-task-engine`
- `routes/matrix-api`
- `src/platforms/facebook/executor`
- `src/platforms/google-maps/executor`
- `src/platforms/tiktok/executor`
- `src/platforms/instagram/executor`
- `src/platforms/youtube/executor`
- `src/platforms/twitter/executor`
- `src/platforms/vk/executor`
- `src/platforms/reddit/executor`
- `src/ai-filter-engine`
- `src/platforms/outlook/executor`
- `src/platforms/website/extractor`
- `src/platforms/pinterest/executor`
- `src/platforms/threads/executor`
- `src/platforms/line/executor`
- `src/inbox-sync-engine`
- `src/esim/sms-engine`
- `src/emergency-brake`
- `src/human-behavior-engine`
- `routes/human-behavior-api`
- `routes/video-api`
- `routes/widget-api`
- `src/seo-engine`
- `routes/seo-api`
- `src/platforms/yandex-maps/executor`
- `src/platforms/shopee/executor`
- `routes/antiban-api`
- `routes/emergency-api`
- `routes/lead-scoring-api`
- `routes/linkedin-api`
- `routes/calendar-api`
- `routes/inbox-api`
- `routes/journey-api`
- `routes/analytics-api`
- `routes/social-accounts-api`
- `routes/customer-api`
- `routes/email-api`
- `src/email-receiver`
- `src/email-auto-replier`
- `src/ai-brain`
- `routes/email-receiver-api`
- `routes/followup-api`
- `routes/stats-api`
- `routes/customer-import-export`
- `routes/wa-checker-api`
- `routes/dispatcher-api`
- `routes/ai-command-api`
- `routes/agent-api`
- `routes/agent-dashboard-api`
- `src/agent-scanner`
- `routes/channel-tools-api`
- `routes/unsubscribe`
- `routes/analytics-dashboard-api`
- `routes/crud-api`
- `routes/advanced-api`
- `routes/digital-human-api`
- `src/workflow-engine`
- `routes/workflow-api`
- `src/live-restream-engine`
- `routes/restream-api`
- `src/database`
- `src/database`

### 路由挂载

- `/api/track` → `./routes/tracking-api`
- `/` → `./routes/pages`
- `/api` → `./routes/api`
- `/api/ai` → `./routes/ai-api`
- `/api/trade` → `./routes/trade-api`
- `/api/marketing` → `./routes/marketing-api`
- `/api/social` → `./routes/social-api`
- `/api/tiktok` → `./routes/tiktok-api`
- `/api/browser-adapters` → `./routes/browser-adapters-api`
- `/api/products` → `./routes/products-api`
- `/api/settings` → `./routes/settings-api`
- `/api/human-behavior` → `./routes/human-behavior-api`
- `/api/antiban` → `./routes/antiban-api`
- `/api/emergency` → `./routes/emergency-api`
- `/api/scoring` → `./routes/lead-scoring-api`
- `/api/calendar` → `./routes/calendar-api`
- `/api/inbox` → `./routes/inbox-api`
- `/api/journeys` → `./routes/journey-api`
- `/api/analytics` → `./routes/analytics-api`
- `/api/social-accounts` → `./routes/social-accounts-api`
- `/api/customer-merge` → `./routes/customer-api`
- `/api` → `./routes/email-api`
- `/api/followups` → `./routes/followup-api`
- `/api/stats` → `./routes/stats-api`
- `/api/customers` → `./routes/customer-import-export`
- `/api/wa-checker` → `./routes/wa-checker-api`
- `/api/dispatcher` → `./routes/dispatcher-api`
- `/api/ai-command` → `./routes/ai-command-api`
- `/api/agent` → `./routes/agent-api`
- `/api/agent/dashboard` → `./routes/agent-dashboard-api`
- `/api/channel-tools` → `./routes/channel-tools-api`
- `/` → `./routes/unsubscribe`
- `/api/analytics-dashboard` → `./routes/analytics-dashboard-api`
- `/api/digital-humans` → `./routes/digital-human-api`

### 定时任务 (cron)


共 5 个定时任务

## 3. 数据库设计

共 **90** 张表

### CRM/客户 (5表)

| 表名 | 字段 | 数据量 |
|------|------|--------|
| agent_customer_profiles | 14 列 | 0 行 |
| customer_identifiers | 6 列 | 2 行 |
| customers | 18 列 | 2 行 |
| lead_score_events | 8 列 | 0 行 |
| social_leads | 9 列 | 0 行 |

### 邮件 (14表)

| 表名 | 字段 | 数据量 |
|------|------|--------|
| email_accounts | 19 列 | 2 行 |
| email_blacklist | 5 列 | 0 行 |
| email_sequences | 8 列 | 0 行 |
| email_tracking_events | 7 列 | 0 行 |
| email_verification_cache | 7 列 | 5 行 |
| email_warmup_config | 7 列 | 0 行 |
| email_warmup_log | 9 列 | 0 行 |
| emails | 27 列 | 19 行 |
| inbox_canned_responses | 8 列 | 0 行 |
| inbox_conversations | 18 列 | 4 行 |
| inbox_messages | 11 列 | 54 行 |
| inbox_sync_state | 6 列 | 0 行 |
| received_emails | 20 列 | 48 行 |
| unsubscribes | 6 列 | 0 行 |

### 社媒/社交 (5表)

| 表名 | 字段 | 数据量 |
|------|------|--------|
| matrix_task_items | 10 列 | 0 行 |
| matrix_tasks | 31 列 | 0 行 |
| social_accounts | 35 列 | 0 行 |
| social_execution_log | 8 列 | 0 行 |
| social_posts | 10 列 | 0 行 |

### AI/智能 (6表)

| 表名 | 字段 | 数据量 |
|------|------|--------|
| ai_conversations | 5 列 | 78 行 |
| ai_logs | 10 列 | 9 行 |
| ai_task_steps | 15 列 | 81 行 |
| ai_tasks | 12 列 | 40 行 |
| intent_detections | 11 列 | 1 行 |
| knowledge_base | 5 列 | 111 行 |

### WhatsApp (8表)

| 表名 | 字段 | 数据量 |
|------|------|--------|
| wa_auto_replies | 12 列 | 0 行 |
| wa_broadcast_lists | 6 列 | 0 行 |
| wa_broadcast_logs | 13 列 | 0 行 |
| wa_conversations | 16 列 | 0 行 |
| wa_messages | 15 列 | 0 行 |
| wa_number_cache | 6 列 | 0 行 |
| wa_quick_replies | 8 列 | 0 行 |
| whatsapp_messages | 8 列 | 0 行 |

### 任务/调度 (2表)

| 表名 | 字段 | 数据量 |
|------|------|--------|
| pending_actions | 21 列 | 0 行 |
| scheduled_tasks | 9 列 | 0 行 |

### 系统/配置 (5表)

| 表名 | 字段 | 数据量 |
|------|------|--------|
| automation_settings | 4 列 | 0 行 |
| restream_sessions | 10 列 | 0 行 |
| settings | 3 列 | 27 行 |
| users | 8 列 | 2 行 |
| widget_configs | 9 列 | 0 行 |

### 营销/序列 (11表)

| 表名 | 字段 | 数据量 |
|------|------|--------|
| journey_enrollments | 9 列 | 0 行 |
| journey_logs | 8 列 | 0 行 |
| journeys | 12 列 | 0 行 |
| li_sequences | 11 列 | 0 行 |
| quotes | 21 列 | 0 行 |
| sequence_enrollments | 14 列 | 1 行 |
| sequence_step_log | 9 列 | 0 行 |
| sequences | 7 列 | 2 行 |
| sqlite_sequence | 2 列 | 37 行 |
| workflow_runs | 7 列 | 0 行 |
| workflows | 10 列 | 0 行 |

### 产品 (1表)

| 表名 | 字段 | 数据量 |
|------|------|--------|
| products | 18 列 | 2 行 |

### 安全/审计 (1表)

| 表名 | 字段 | 数据量 |
|------|------|--------|
| alerts | 5 列 | 1 行 |

### 其他 (32表)

| 表名 | 字段 | 数据量 |
|------|------|--------|
| account_personalities | 24 列 | 0 行 |
| activity_log | 8 列 | 332 行 |
| agent_action_log | 12 列 | 0 行 |
| agent_action_log_archive | 12 列 | 0 行 |
| agent_autonomy | 10 列 | 1 行 |
| agent_experiences | 13 列 | 0 行 |
| agent_scan_results | 14 列 | 0 行 |
| agent_strategies | 9 列 | 0 行 |
| agent_upgrade_requests | 9 列 | 0 行 |
| behavior_logs | 7 列 | 0 行 |
| browser_profiles | 12 列 | 1 行 |
| collected_data | 25 列 | 0 行 |
| content_calendar | 19 列 | 0 行 |
| content_templates | 9 列 | 26 行 |
| conversion_events | 8 列 | 0 行 |
| deals | 17 列 | 0 行 |
| digital_human_videos | 8 列 | 0 行 |
| digital_humans | 7 列 | 0 行 |
| esim_providers | 8 列 | 8 行 |
| followup_logs | 7 列 | 0 行 |
| followup_plans | 10 列 | 0 行 |
| inquiries | 12 列 | 0 行 |
| li_action_logs | 9 列 | 0 行 |
| li_prospects | 20 列 | 0 行 |
| marketing_spend | 8 列 | 0 行 |
| outlook_send_log | 7 列 | 0 行 |
| phone_numbers | 14 列 | 0 行 |
| proxies | 22 列 | 175 行 |
| proxy_chains | 9 列 | 0 行 |
| proxy_subscriptions | 13 列 | 2 行 |
| restream_logs | 6 列 | 0 行 |
| sms_logs | 10 列 | 0 行 |

### 所有表字段详情

<details><summary>点击展开90张表的完整字段列表</summary>

#### account_personalities (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| account_id | TEXT | ✓ |  |
| platform | TEXT | ✓ |  |
| template_name | TEXT |  |  |
| mouse_speed | REAL |  |  |
| mouse_precision | REAL |  |  |
| mouse_curve_intensity | REAL |  |  |
| typing_speed_wpm | INTEGER |  |  |
| typing_error_rate | REAL |  |  |
| typing_pause_freq | REAL |  |  |
| typing_burst_mode | INTEGER |  |  |
| scroll_speed | REAL |  |  |
| avg_page_view_sec | INTEGER |  |  |
| likes_ratio | REAL |  |  |
| comment_ratio | REAL |  |  |
| preferred_start_hour | INTEGER |  |  |
| preferred_end_hour | INTEGER |  |  |
| lunch_break_start | INTEGER |  |  |
| lunch_break_end | INTEGER |  |  |
| avg_session_minutes | INTEGER |  |  |
| is_mobile | INTEGER |  |  |
| screen_dpi | REAL |  |  |
| created_at | DATETIME |  |  |
| updated_at | DATETIME |  |  |

#### activity_log (332 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| entity_type | TEXT |  |  |
| entity_id | INTEGER |  |  |
| action | TEXT |  |  |
| details | TEXT |  |  |
| created_at | DATETIME |  |  |
| user_id | TEXT |  |  |
| ip_address | TEXT |  |  |

#### agent_action_log (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| action_type | TEXT | ✓ |  |
| triggered_by | TEXT |  |  |
| target_customer_id | INTEGER |  |  |
| decision_reason | TEXT |  |  |
| decision_score | REAL |  |  |
| action_detail | TEXT |  |  |
| result | TEXT |  |  |
| status | TEXT |  |  |
| experience_extracted | INTEGER |  |  |
| cost | REAL |  |  |
| created_at | TEXT |  |  |

#### agent_action_log_archive (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| action_type | TEXT | ✓ |  |
| triggered_by | TEXT |  |  |
| target_customer_id | INTEGER |  |  |
| decision_reason | TEXT |  |  |
| decision_score | REAL |  |  |
| action_detail | TEXT |  |  |
| result | TEXT |  |  |
| status | TEXT |  |  |
| experience_extracted | INTEGER |  |  |
| cost | REAL |  |  |
| created_at | TEXT |  |  |

#### agent_autonomy (1 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| current_level | INTEGER |  |  |
| last_upgrade_at | TEXT |  |  |
| last_rejected_at | TEXT |  |  |
| reject_count | INTEGER |  |  |
| experiences_at_last_reject | INTEGER |  |  |
| experiences_required_for_retry | INTEGER |  |  |
| upgrade_history | TEXT |  |  |
| created_at | TEXT |  |  |
| updated_at | TEXT |  |  |

#### agent_customer_profiles (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| customer_id | INTEGER | ✓ |  |
| language_preference | TEXT |  |  |
| communication_style | TEXT |  |  |
| interests | TEXT |  |  |
| best_contact_time | TEXT |  |  |
| response_pattern | TEXT |  |  |
| deal_stage | TEXT |  |  |
| reply_rate | REAL |  |  |
| avg_reply_hours | REAL |  |  |
| total_interactions | INTEGER |  |  |
| last_positive_at | TEXT |  |  |
| notes | TEXT |  |  |
| updated_at | TEXT |  |  |

#### agent_experiences (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| category | TEXT | ✓ |  |
| situation | TEXT | ✓ |  |
| action | TEXT | ✓ |  |
| result | TEXT |  |  |
| result_sentiment | TEXT |  |  |
| lesson | TEXT |  |  |
| confidence | REAL |  |  |
| times_applied | INTEGER |  |  |
| is_valid | INTEGER |  |  |
| source | TEXT |  |  |
| created_at | TEXT |  |  |
| updated_at | TEXT |  |  |

#### agent_scan_results (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| scan_id | TEXT | ✓ |  |
| customer_id | INTEGER |  |  |
| trigger_type | TEXT | ✓ |  |
| trigger_reason | TEXT |  |  |
| priority | TEXT |  |  |
| decision | TEXT |  |  |
| decision_reason | TEXT |  |  |
| action_type | TEXT |  |  |
| action_detail | TEXT |  |  |
| status | TEXT |  |  |
| cost | REAL |  |  |
| created_at | TEXT |  |  |
| executed_at | TEXT |  |  |

#### agent_strategies (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| name | TEXT | ✓ |  |
| description | TEXT |  |  |
| target_segment | TEXT |  |  |
| rules | TEXT |  |  |
| performance | TEXT |  |  |
| is_active | INTEGER |  |  |
| created_at | TEXT |  |  |
| updated_at | TEXT |  |  |

#### agent_upgrade_requests (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| from_level | INTEGER | ✓ |  |
| to_level | INTEGER | ✓ |  |
| reason | TEXT |  |  |
| metrics | TEXT |  |  |
| status | TEXT |  |  |
| user_response | TEXT |  |  |
| created_at | TEXT |  |  |
| responded_at | TEXT |  |  |

#### ai_conversations (78 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| role | TEXT | ✓ |  |
| content | TEXT | ✓ |  |
| task_id | INTEGER |  |  |
| created_at | TEXT |  |  |

#### ai_logs (9 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| agent | TEXT |  |  |
| model | TEXT |  |  |
| prompt_tokens | INTEGER |  |  |
| completion_tokens | INTEGER |  |  |
| cost | REAL |  |  |
| task | TEXT |  |  |
| result | TEXT |  |  |
| cached | INTEGER |  |  |
| created_at | DATETIME |  |  |

#### ai_task_steps (81 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| task_id | INTEGER | ✓ |  |
| step_order | INTEGER | ✓ |  |
| agent | TEXT | ✓ |  |
| engine | TEXT | ✓ |  |
| action | TEXT | ✓ |  |
| input | TEXT |  |  |
| output | TEXT |  |  |
| status | TEXT |  |  |
| provider_used | TEXT |  |  |
| cost | REAL |  |  |
| tokens | INTEGER |  |  |
| started_at | TEXT |  |  |
| completed_at | TEXT |  |  |
| created_at | TEXT |  |  |

#### ai_tasks (40 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| user_input | TEXT | ✓ |  |
| parsed_intent | TEXT |  |  |
| sub_tasks | TEXT |  |  |
| status | TEXT |  |  |
| result | TEXT |  |  |
| total_cost | REAL |  |  |
| total_tokens | INTEGER |  |  |
| brain_provider | TEXT |  |  |
| started_at | TEXT |  |  |
| completed_at | TEXT |  |  |
| created_at | TEXT |  |  |

#### alerts (1 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| level | TEXT |  |  |
| message | TEXT |  |  |
| data | TEXT |  |  |
| created_at | DATETIME |  |  |

#### automation_settings (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| key | TEXT | ✓ |  |
| config | TEXT | ✓ |  |
| updated_at | TEXT |  |  |

#### behavior_logs (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| account_id | TEXT | ✓ |  |
| platform | TEXT | ✓ |  |
| action_type | TEXT | ✓ |  |
| duration_ms | INTEGER |  |  |
| details | TEXT |  |  |
| created_at | DATETIME |  |  |

#### browser_profiles (1 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| name | TEXT |  |  |
| platform | TEXT |  |  |
| proxy_id | INTEGER |  |  |
| fingerprint | TEXT |  |  |
| cookies | TEXT |  |  |
| status | TEXT |  |  |
| health_score | REAL |  |  |
| last_used | DATETIME |  |  |
| created_at | DATETIME |  |  |
| browser_type | TEXT |  |  |
| external_profile_id | TEXT |  |  |

#### collected_data (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| task_id | INTEGER |  |  |
| platform | TEXT |  |  |
| data_type | TEXT |  |  |
| external_id | TEXT |  |  |
| username | TEXT |  |  |
| display_name | TEXT |  |  |
| profile_url | TEXT |  |  |
| avatar_url | TEXT |  |  |
| bio | TEXT |  |  |
| email | TEXT |  |  |
| phone | TEXT |  |  |
| website | TEXT |  |  |
| country | TEXT |  |  |
| gender | TEXT |  |  |
| age_range | TEXT |  |  |
| followers_count | INTEGER |  |  |
| following_count | INTEGER |  |  |
| posts_count | INTEGER |  |  |
| engagement_rate | REAL |  |  |
| is_active | INTEGER |  |  |
| last_active_at | DATETIME |  |  |
| raw_data | TEXT |  |  |
| tags | TEXT |  |  |
| created_at | DATETIME |  |  |

#### content_calendar (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| title | TEXT | ✓ |  |
| content | TEXT |  |  |
| platform | TEXT | ✓ |  |
| content_type | TEXT |  |  |
| media_urls | TEXT |  |  |
| hashtags | TEXT |  |  |
| target_audience | TEXT |  |  |
| language | TEXT |  |  |
| status | TEXT |  |  |
| scheduled_at | DATETIME |  |  |
| published_at | DATETIME |  |  |
| ai_generated | INTEGER |  |  |
| engagement | TEXT |  |  |
| notes | TEXT |  |  |
| created_by | TEXT |  |  |
| approved_by | TEXT |  |  |
| created_at | DATETIME |  |  |
| updated_at | DATETIME |  |  |

#### content_templates (26 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| name | TEXT |  |  |
| category | TEXT |  |  |
| platform | TEXT |  |  |
| content | TEXT |  |  |
| variables | TEXT |  |  |
| use_count | INTEGER |  |  |
| created_at | DATETIME |  |  |
| reference_only | BOOLEAN |  |  |

#### conversion_events (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| customer_id | INTEGER |  |  |
| event_type | TEXT | ✓ |  |
| channel | TEXT |  |  |
| campaign | TEXT |  |  |
| revenue | REAL |  |  |
| metadata | TEXT |  |  |
| created_at | DATETIME |  |  |

#### customer_identifiers (2 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| customer_id | INTEGER | ✓ |  |
| channel | TEXT | ✓ |  |
| identifier | TEXT | ✓ |  |
| verified | INTEGER |  |  |
| created_at | DATETIME |  |  |

#### customers (2 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| company | TEXT |  |  |
| contact_name | TEXT |  |  |
| email | TEXT |  |  |
| phone | TEXT |  |  |
| country | TEXT |  |  |
| source | TEXT |  |  |
| lead_score | INTEGER |  |  |
| stage | TEXT |  |  |
| tags | TEXT |  |  |
| notes | TEXT |  |  |
| ai_summary | TEXT |  |  |
| created_at | DATETIME |  |  |
| updated_at | DATETIME |  |  |
| lead_grade | TEXT |  |  |
| score_updated_at | DATETIME |  |  |
| preferred_email_account_id | INTEGER |  |  |
| preferred_social_accounts | TEXT |  |  |

#### deals (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| customer_id | INTEGER |  |  |
| inquiry_id | INTEGER |  |  |
| title | TEXT |  |  |
| amount | REAL |  |  |
| currency | TEXT |  |  |
| stage | TEXT |  |  |
| products | TEXT |  |  |
| quote_data | TEXT |  |  |
| pi_number | TEXT |  |  |
| shipping_info | TEXT |  |  |
| payment_info | TEXT |  |  |
| notes | TEXT |  |  |
| created_at | DATETIME |  |  |
| updated_at | DATETIME |  |  |
| ai_generated | INTEGER |  |  |
| ai_analysis | TEXT |  |  |

#### digital_human_videos (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| human_id | INTEGER |  |  |
| title | TEXT |  |  |
| video_path | TEXT |  |  |
| language | TEXT |  |  |
| duration | REAL |  |  |
| status | TEXT |  |  |
| created_at | DATETIME |  |  |

#### digital_humans (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| name | TEXT | ✓ |  |
| avatar_url | TEXT |  |  |
| voice_id | TEXT |  |  |
| voice_provider | TEXT |  |  |
| settings | TEXT |  |  |
| created_at | DATETIME |  |  |

#### email_accounts (2 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| email | TEXT |  |  |
| display_name | TEXT |  |  |
| smtp_host | TEXT |  |  |
| smtp_port | INTEGER |  |  |
| smtp_user | TEXT |  |  |
| smtp_pass | TEXT |  |  |
| imap_host | TEXT |  |  |
| imap_port | INTEGER |  |  |
| warmup_stage | TEXT |  |  |
| daily_sent | INTEGER |  |  |
| daily_limit | INTEGER |  |  |
| health_score | REAL |  |  |
| is_active | INTEGER |  |  |
| created_at | DATETIME |  |  |
| auth_type | TEXT |  |  |
| oauth_credentials | TEXT |  |  |
| gmail_client_id | TEXT |  |  |
| gmail_client_secret | TEXT |  |  |

#### email_blacklist (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| email | TEXT |  |  |
| reason | TEXT |  |  |
| bounced_at | DATETIME |  |  |
| created_at | DATETIME |  |  |

#### email_sequences (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| name | TEXT |  |  |
| description | TEXT |  |  |
| steps | TEXT |  |  |
| target_industry | TEXT |  |  |
| is_active | INTEGER |  |  |
| stats | TEXT |  |  |
| created_at | DATETIME |  |  |

#### email_tracking_events (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| email_id | INTEGER | ✓ |  |
| event_type | TEXT | ✓ |  |
| url | TEXT |  |  |
| ip | TEXT |  |  |
| user_agent | TEXT |  |  |
| created_at | DATETIME |  |  |

#### email_verification_cache (5 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| email | TEXT |  | ✓ |
| valid | INTEGER |  |  |
| score | INTEGER |  |  |
| reason | TEXT |  |  |
| mx_host | TEXT |  |  |
| checked_at | TEXT |  |  |
| expires_at | TEXT |  |  |

#### email_warmup_config (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| account_id | INTEGER |  | ✓ |
| enabled | INTEGER |  |  |
| stage | TEXT |  |  |
| started_at | TEXT |  |  |
| partner_email | TEXT |  |  |
| daily_sent_today | INTEGER |  |  |
| last_sent_date | TEXT |  |  |

#### email_warmup_log (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| account_id | INTEGER | ✓ |  |
| direction | TEXT | ✓ |  |
| to_addr | TEXT |  |  |
| from_addr | TEXT |  |  |
| subject | TEXT |  |  |
| status | TEXT |  |  |
| error | TEXT |  |  |
| created_at | TEXT |  |  |

#### emails (19 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| customer_id | INTEGER |  |  |
| account_id | INTEGER |  |  |
| direction | TEXT |  |  |
| from_addr | TEXT |  |  |
| to_addr | TEXT |  |  |
| subject | TEXT |  |  |
| body | TEXT |  |  |
| status | TEXT |  |  |
| sequence_id | INTEGER |  |  |
| sequence_step | INTEGER |  |  |
| opened | INTEGER |  |  |
| clicked | INTEGER |  |  |
| bounced | INTEGER |  |  |
| spam_score | REAL |  |  |
| sent_at | DATETIME |  |  |
| created_at | DATETIME |  |  |
| open_count | INTEGER |  |  |
| click_count | INTEGER |  |  |
| first_opened_at | DATETIME |  |  |
| first_clicked_at | DATETIME |  |  |
| scheduled_at | DATETIME |  |  |
| retry_count | INTEGER |  |  |
| last_retry_at | TEXT |  |  |
| attachments | TEXT |  |  |
| inline_images | TEXT |  |  |
| source | TEXT |  |  |

#### esim_providers (8 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| name | TEXT | ✓ |  |
| code | TEXT | ✓ |  |
| countries | TEXT |  |  |
| config_fields | TEXT |  |  |
| website | TEXT |  |  |
| status | TEXT |  |  |
| created_at | DATETIME |  |  |

#### followup_logs (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| plan_id | INTEGER |  |  |
| customer_id | INTEGER |  |  |
| step | INTEGER |  |  |
| action | TEXT |  |  |
| result | TEXT |  |  |
| created_at | DATETIME |  |  |

#### followup_plans (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| customer_id | INTEGER |  |  |
| step | INTEGER |  |  |
| delay_days | INTEGER |  |  |
| template_id | INTEGER |  |  |
| status | TEXT |  |  |
| next_run_at | DATETIME |  |  |
| last_run_at | DATETIME |  |  |
| created_at | DATETIME |  |  |
| updated_at | DATETIME |  |  |

#### inbox_canned_responses (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| shortcut | TEXT |  |  |
| title | TEXT |  |  |
| content | TEXT |  |  |
| channel | TEXT |  |  |
| language | TEXT |  |  |
| use_count | INTEGER |  |  |
| created_at | DATETIME |  |  |

#### inbox_conversations (4 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| channel | TEXT | ✓ |  |
| channel_id | TEXT |  |  |
| customer_id | INTEGER |  |  |
| contact_name | TEXT |  |  |
| contact_avatar | TEXT |  |  |
| last_message | TEXT |  |  |
| last_message_at | DATETIME |  |  |
| last_direction | TEXT |  |  |
| unread_count | INTEGER |  |  |
| status | TEXT |  |  |
| priority | TEXT |  |  |
| assigned_to | TEXT |  |  |
| labels | TEXT |  |  |
| metadata | TEXT |  |  |
| created_at | DATETIME |  |  |
| updated_at | DATETIME |  |  |
| category | TEXT |  |  |

#### inbox_messages (54 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| conversation_id | INTEGER | ✓ |  |
| channel | TEXT | ✓ |  |
| direction | TEXT |  |  |
| sender_name | TEXT |  |  |
| content | TEXT |  |  |
| content_type | TEXT |  |  |
| media_url | TEXT |  |  |
| metadata | TEXT |  |  |
| read_at | DATETIME |  |  |
| created_at | DATETIME |  |  |

#### inbox_sync_state (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| platform | TEXT |  | ✓ |
| last_cursor | TEXT |  |  |
| last_sync_at | DATETIME |  |  |
| status | TEXT |  |  |
| error | TEXT |  |  |
| updated_at | DATETIME |  |  |

#### inquiries (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| customer_id | INTEGER |  |  |
| subject | TEXT |  |  |
| content | TEXT |  |  |
| product | TEXT |  |  |
| quantity | TEXT |  |  |
| priority | TEXT |  |  |
| status | TEXT |  |  |
| ai_score | REAL |  |  |
| ai_analysis | TEXT |  |  |
| created_at | DATETIME |  |  |
| updated_at | DATETIME |  |  |

#### intent_detections (1 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| channel | TEXT | ✓ |  |
| source_id | TEXT |  |  |
| customer_id | INTEGER |  |  |
| customer_email | TEXT |  |  |
| message_text | TEXT |  |  |
| intent | TEXT | ✓ |  |
| confidence | REAL |  |  |
| matched_keywords | TEXT |  |  |
| handled | INTEGER |  |  |
| created_at | TEXT |  |  |

#### journey_enrollments (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| journey_id | INTEGER | ✓ |  |
| customer_id | INTEGER | ✓ |  |
| current_step | INTEGER |  |  |
| status | TEXT |  |  |
| entered_at | DATETIME |  |  |
| next_action_at | DATETIME |  |  |
| completed_at | DATETIME |  |  |
| data | TEXT |  |  |

#### journey_logs (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| journey_id | INTEGER |  |  |
| customer_id | INTEGER |  |  |
| step_index | INTEGER |  |  |
| action_type | TEXT |  |  |
| action_detail | TEXT |  |  |
| result | TEXT |  |  |
| created_at | DATETIME |  |  |

#### journeys (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| name | TEXT | ✓ |  |
| description | TEXT |  |  |
| trigger_type | TEXT | ✓ |  |
| trigger_config | TEXT |  |  |
| steps | TEXT |  |  |
| is_active | INTEGER |  |  |
| total_entered | INTEGER |  |  |
| total_completed | INTEGER |  |  |
| total_converted | INTEGER |  |  |
| created_at | DATETIME |  |  |
| updated_at | DATETIME |  |  |

#### knowledge_base (111 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| category | TEXT |  |  |
| key | TEXT |  |  |
| value | TEXT |  |  |
| updated_at | DATETIME |  |  |

#### lead_score_events (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| customer_id | INTEGER | ✓ |  |
| event_type | TEXT | ✓ |  |
| score_delta | INTEGER | ✓ |  |
| source | TEXT |  |  |
| details | TEXT |  |  |
| expires_at | DATETIME |  |  |
| created_at | DATETIME |  |  |

#### li_action_logs (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| prospect_id | INTEGER |  |  |
| sequence_id | INTEGER |  |  |
| step_index | INTEGER |  |  |
| action_type | TEXT |  |  |
| content | TEXT |  |  |
| status | TEXT |  |  |
| error | TEXT |  |  |
| created_at | DATETIME |  |  |

#### li_prospects (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| customer_id | INTEGER |  |  |
| linkedin_url | TEXT |  |  |
| full_name | TEXT |  |  |
| headline | TEXT |  |  |
| company | TEXT |  |  |
| location | TEXT |  |  |
| industry | TEXT |  |  |
| connection_status | TEXT |  |  |
| tags | TEXT |  |  |
| sequence_id | INTEGER |  |  |
| sequence_step | INTEGER |  |  |
| last_action | TEXT |  |  |
| last_action_at | DATETIME |  |  |
| next_action | TEXT |  |  |
| next_action_at | DATETIME |  |  |
| reply_received | INTEGER |  |  |
| notes | TEXT |  |  |
| created_at | DATETIME |  |  |
| updated_at | DATETIME |  |  |

#### li_sequences (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| name | TEXT |  |  |
| description | TEXT |  |  |
| target_industry | TEXT |  |  |
| target_region | TEXT |  |  |
| steps | TEXT |  |  |
| is_active | INTEGER |  |  |
| total_enrolled | INTEGER |  |  |
| total_replied | INTEGER |  |  |
| total_connected | INTEGER |  |  |
| created_at | DATETIME |  |  |

#### marketing_spend (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| channel | TEXT | ✓ |  |
| campaign | TEXT |  |  |
| amount | REAL | ✓ |  |
| currency | TEXT |  |  |
| period | TEXT |  |  |
| notes | TEXT |  |  |
| created_at | DATETIME |  |  |

#### matrix_task_items (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| task_id | INTEGER | ✓ |  |
| account_id | INTEGER |  |  |
| target | TEXT |  |  |
| action_data | TEXT |  |  |
| status | TEXT |  |  |
| result | TEXT |  |  |
| error | TEXT |  |  |
| executed_at | DATETIME |  |  |
| created_at | DATETIME |  |  |

#### matrix_tasks (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| task_type | TEXT | ✓ |  |
| platform | TEXT | ✓ |  |
| action | TEXT | ✓ |  |
| name | TEXT |  |  |
| status | TEXT |  |  |
| priority | INTEGER |  |  |
| account_ids | TEXT |  |  |
| input_data | TEXT |  |  |
| input_source_task_id | INTEGER |  |  |
| schedule_type | TEXT |  |  |
| scheduled_at | DATETIME |  |  |
| cron_expression | TEXT |  |  |
| max_concurrency | INTEGER |  |  |
| interval_min_sec | INTEGER |  |  |
| interval_max_sec | INTEGER |  |  |
| daily_limit | INTEGER |  |  |
| time_window_start | INTEGER |  |  |
| time_window_end | INTEGER |  |  |
| total_items | INTEGER |  |  |
| processed_items | INTEGER |  |  |
| success_items | INTEGER |  |  |
| failed_items | INTEGER |  |  |
| output_data | TEXT |  |  |
| output_file | TEXT |  |  |
| created_by | TEXT |  |  |
| started_at | DATETIME |  |  |
| completed_at | DATETIME |  |  |
| error_log | TEXT |  |  |
| created_at | DATETIME |  |  |
| updated_at | DATETIME |  |  |

#### outlook_send_log (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| account_email | TEXT | ✓ |  |
| recipient | TEXT | ✓ |  |
| subject | TEXT |  |  |
| status | TEXT |  |  |
| error_msg | TEXT |  |  |
| sent_at | TEXT |  |  |

#### pending_actions (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| type | TEXT | ✓ |  |
| priority | TEXT |  |  |
| title | TEXT | ✓ |  |
| description | TEXT |  |  |
| channel | TEXT |  |  |
| customer_id | INTEGER |  |  |
| customer_email | TEXT |  |  |
| customer_name | TEXT |  |  |
| source_message | TEXT |  |  |
| source_id | TEXT |  |  |
| status | TEXT |  |  |
| escalation_level | INTEGER |  |  |
| last_reminded_at | TEXT |  |  |
| handled_at | TEXT |  |  |
| handled_by | TEXT |  |  |
| notes | TEXT |  |  |
| created_at | TEXT |  |  |
| updated_at | TEXT |  |  |
| source | TEXT |  |  |
| auto_expire_at | TEXT |  |  |

#### phone_numbers (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| number | TEXT |  |  |
| country | TEXT |  |  |
| platform | TEXT |  |  |
| provider | TEXT |  |  |
| type | TEXT |  |  |
| status | TEXT |  |  |
| created_at | DATETIME |  |  |
| esim_provider_id | INTEGER |  |  |
| credentials | TEXT |  |  |
| sms_enabled | INTEGER |  |  |
| last_sms_at | DATETIME |  |  |
| sms_today | INTEGER |  |  |
| notes | TEXT |  |  |

#### products (2 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| name | TEXT |  |  |
| category | TEXT |  |  |
| model | TEXT |  |  |
| description | TEXT |  |  |
| ai_description | TEXT |  |  |
| specs | TEXT |  |  |
| price_100 | REAL |  |  |
| price_500 | REAL |  |  |
| price_1000 | REAL |  |  |
| moq | INTEGER |  |  |
| currency | TEXT |  |  |
| images | TEXT |  |  |
| certifications | TEXT |  |  |
| video_script | TEXT |  |  |
| is_active | INTEGER |  |  |
| created_at | DATETIME |  |  |
| updated_at | DATETIME |  |  |

#### proxies (175 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| type | TEXT |  |  |
| host | TEXT |  |  |
| port | INTEGER |  |  |
| username | TEXT |  |  |
| password | TEXT |  |  |
| country | TEXT |  |  |
| provider | TEXT |  |  |
| is_alive | INTEGER |  |  |
| speed_ms | INTEGER |  |  |
| last_checked | DATETIME |  |  |
| created_at | DATETIME |  |  |
| role | TEXT |  |  |
| protocol | TEXT |  |  |
| label | TEXT |  |  |
| subscription_id | INTEGER |  |  |
| share_link | TEXT |  |  |
| extra_config | TEXT |  |  |
| latency_ms | INTEGER |  |  |
| last_latency_test | DATETIME |  |  |
| group_name | TEXT |  |  |
| sort_order | INTEGER |  |  |

#### proxy_chains (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| name | TEXT |  |  |
| frontend_proxy_id | INTEGER |  |  |
| vpn_proxy_id | INTEGER |  |  |
| landing_proxy_id | INTEGER |  |  |
| status | TEXT |  |  |
| notes | TEXT |  |  |
| created_at | DATETIME |  |  |
| updated_at | DATETIME |  |  |

#### proxy_subscriptions (2 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| name | TEXT |  |  |
| url | TEXT | ✓ |  |
| type | TEXT |  |  |
| node_count | INTEGER |  |  |
| last_updated | DATETIME |  |  |
| auto_update | INTEGER |  |  |
| status | TEXT |  |  |
| created_at | DATETIME |  |  |
| upload_bytes | INTEGER |  |  |
| download_bytes | INTEGER |  |  |
| total_bytes | INTEGER |  |  |
| expire_time | INTEGER |  |  |

#### quotes (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| customer_id | INTEGER |  |  |
| customer_email | TEXT |  |  |
| customer_name | TEXT |  |  |
| channel | TEXT |  |  |
| products | TEXT |  |  |
| quantity | TEXT |  |  |
| quoted_price | TEXT |  |  |
| currency | TEXT |  |  |
| incoterm | TEXT |  |  |
| payment_terms | TEXT |  |  |
| validity_days | INTEGER |  |  |
| status | TEXT |  |  |
| notes | TEXT |  |  |
| pending_action_id | INTEGER |  |  |
| quoted_at | TEXT |  |  |
| followed_up_at | TEXT |  |  |
| closed_at | TEXT |  |  |
| close_reason | TEXT |  |  |
| created_at | TEXT |  |  |
| updated_at | TEXT |  |  |

#### received_emails (48 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| account_id | INTEGER | ✓ |  |
| message_id | TEXT |  |  |
| from_email | TEXT |  |  |
| from_name | TEXT |  |  |
| to_email | TEXT |  |  |
| subject | TEXT |  |  |
| body_text | TEXT |  |  |
| body_html | TEXT |  |  |
| in_reply_to | TEXT |  |  |
| references_header | TEXT |  |  |
| uid | INTEGER |  |  |
| flags | TEXT |  |  |
| customer_id | INTEGER |  |  |
| is_read | INTEGER |  |  |
| is_replied | INTEGER |  |  |
| ai_reply_id | INTEGER |  |  |
| folder | TEXT |  |  |
| received_at | DATETIME |  |  |
| created_at | DATETIME |  |  |

#### restream_logs (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| session_id | INTEGER |  |  |
| target_platform | TEXT |  |  |
| event | TEXT |  |  |
| data | TEXT |  |  |
| created_at | DATETIME |  |  |

#### restream_sessions (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| name | TEXT |  |  |
| source_url | TEXT | ✓ |  |
| targets | TEXT |  |  |
| status | TEXT |  |  |
| overlay_config | TEXT |  |  |
| scheduled_at | DATETIME |  |  |
| started_at | DATETIME |  |  |
| stopped_at | DATETIME |  |  |
| created_at | DATETIME |  |  |

#### scheduled_tasks (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| name | TEXT |  |  |
| cron | TEXT |  |  |
| handler | TEXT |  |  |
| params | TEXT |  |  |
| is_active | INTEGER |  |  |
| last_run | DATETIME |  |  |
| next_run | DATETIME |  |  |
| created_at | DATETIME |  |  |

#### sequence_enrollments (1 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| sequence_id | INTEGER | ✓ |  |
| customer_id | INTEGER |  |  |
| customer_email | TEXT |  |  |
| customer_name | TEXT |  |  |
| current_step | INTEGER |  |  |
| status | TEXT |  |  |
| pause_reason | TEXT |  |  |
| variables | TEXT |  |  |
| next_execute_at | TEXT |  |  |
| last_executed_at | TEXT |  |  |
| completed_at | TEXT |  |  |
| created_at | TEXT |  |  |
| updated_at | TEXT |  |  |

#### sequence_step_log (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| enrollment_id | INTEGER | ✓ |  |
| step_index | INTEGER | ✓ |  |
| channel | TEXT | ✓ |  |
| action | TEXT |  |  |
| status | TEXT |  |  |
| result | TEXT |  |  |
| error | TEXT |  |  |
| executed_at | TEXT |  |  |

#### sequences (2 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| name | TEXT | ✓ |  |
| description | TEXT |  |  |
| steps | TEXT | ✓ |  |
| is_active | INTEGER |  |  |
| created_at | TEXT |  |  |
| updated_at | TEXT |  |  |

#### settings (27 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| key | TEXT |  | ✓ |
| value | TEXT |  |  |
| updated_at | DATETIME |  |  |

#### sms_logs (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| phone_id | INTEGER |  |  |
| direction | TEXT |  |  |
| from_number | TEXT |  |  |
| to_number | TEXT |  |  |
| content | TEXT |  |  |
| status | TEXT |  |  |
| provider_msg_id | TEXT |  |  |
| error | TEXT |  |  |
| created_at | DATETIME |  |  |

#### social_accounts (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| platform | TEXT | ✓ |  |
| account_id | TEXT | ✓ |  |
| display_name | TEXT |  |  |
| phone | TEXT |  |  |
| email | TEXT |  |  |
| password | TEXT |  |  |
| proxy | TEXT |  |  |
| cookies | TEXT |  |  |
| access_token | TEXT |  |  |
| status | TEXT |  |  |
| account_type | TEXT |  |  |
| warmup_days | INTEGER |  |  |
| warmup_start | DATE |  |  |
| daily_limit | INTEGER |  |  |
| today_sent | INTEGER |  |  |
| tags | TEXT |  |  |
| notes | TEXT |  |  |
| last_active_at | DATETIME |  |  |
| login_at | DATETIME |  |  |
| created_at | DATETIME |  |  |
| updated_at | DATETIME |  |  |
| proxy_type | TEXT |  |  |
| browser_fingerprint | TEXT |  |  |
| health_score | INTEGER |  |  |
| last_error | TEXT |  |  |
| execution_count | INTEGER |  |  |
| proxy_id | INTEGER |  |  |
| profile_id | INTEGER |  |  |
| phone_id | INTEGER |  |  |
| chain_id | INTEGER |  |  |
| platform_user_id | TEXT |  |  |
| refresh_token | TEXT |  |  |
| token_expires_at | DATETIME |  |  |
| browser_type | TEXT |  |  |

#### social_execution_log (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| account_id | INTEGER | ✓ |  |
| platform | TEXT |  |  |
| action | TEXT |  |  |
| status | TEXT |  |  |
| details | TEXT |  |  |
| ip_used | TEXT |  |  |
| created_at | DATETIME |  |  |

#### social_leads (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| platform | TEXT |  |  |
| post_id | INTEGER |  |  |
| username | TEXT |  |  |
| profile_url | TEXT |  |  |
| message | TEXT |  |  |
| status | TEXT |  |  |
| customer_id | INTEGER |  |  |
| created_at | DATETIME |  |  |

#### social_posts (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| platform | TEXT |  |  |
| content | TEXT |  |  |
| media_urls | TEXT |  |  |
| status | TEXT |  |  |
| scheduled_at | DATETIME |  |  |
| published_at | DATETIME |  |  |
| engagement | TEXT |  |  |
| leads_collected | INTEGER |  |  |
| created_at | DATETIME |  |  |

#### sqlite_sequence (37 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| name | - |  |  |
| seq | - |  |  |

#### unsubscribes (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| email | TEXT | ✓ |  |
| token | TEXT | ✓ |  |
| reason | TEXT |  |  |
| source | TEXT |  |  |
| unsubscribed_at | DATETIME |  |  |

#### users (2 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| username | TEXT | ✓ |  |
| password | TEXT | ✓ |  |
| email | TEXT |  |  |
| role | TEXT |  |  |
| is_active | INTEGER |  |  |
| last_login | DATETIME |  |  |
| created_at | DATETIME |  |  |

#### wa_auto_replies (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| name | TEXT |  |  |
| trigger_type | TEXT |  |  |
| trigger_value | TEXT |  |  |
| reply_content | TEXT |  |  |
| reply_media | TEXT |  |  |
| is_ai | INTEGER |  |  |
| ai_agent | TEXT |  |  |
| conditions | TEXT |  |  |
| is_active | INTEGER |  |  |
| match_count | INTEGER |  |  |
| created_at | DATETIME |  |  |

#### wa_broadcast_lists (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| name | TEXT |  |  |
| description | TEXT |  |  |
| contacts | TEXT |  |  |
| tags | TEXT |  |  |
| created_at | DATETIME |  |  |

#### wa_broadcast_logs (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| broadcast_id | INTEGER |  |  |
| template_content | TEXT |  |  |
| total_contacts | INTEGER |  |  |
| sent | INTEGER |  |  |
| delivered | INTEGER |  |  |
| read_count | INTEGER |  |  |
| replied | INTEGER |  |  |
| failed | INTEGER |  |  |
| status | TEXT |  |  |
| started_at | DATETIME |  |  |
| completed_at | DATETIME |  |  |
| created_at | DATETIME |  |  |

#### wa_conversations (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| chat_id | TEXT |  |  |
| customer_id | INTEGER |  |  |
| contact_name | TEXT |  |  |
| contact_phone | TEXT |  |  |
| contact_avatar | TEXT |  |  |
| unread_count | INTEGER |  |  |
| last_message | TEXT |  |  |
| last_message_at | DATETIME |  |  |
| labels | TEXT |  |  |
| is_pinned | INTEGER |  |  |
| is_archived | INTEGER |  |  |
| assigned_to | TEXT |  |  |
| notes | TEXT |  |  |
| created_at | DATETIME |  |  |
| updated_at | DATETIME |  |  |

#### wa_messages (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| msg_id | TEXT |  |  |
| chat_id | TEXT |  |  |
| direction | TEXT |  |  |
| sender_name | TEXT |  |  |
| sender_phone | TEXT |  |  |
| content | TEXT |  |  |
| media_type | TEXT |  |  |
| media_url | TEXT |  |  |
| media_filename | TEXT |  |  |
| msg_type | TEXT |  |  |
| is_forwarded | INTEGER |  |  |
| quoted_msg_id | TEXT |  |  |
| status | TEXT |  |  |
| created_at | DATETIME |  |  |

#### wa_number_cache (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| phone | TEXT | ✓ |  |
| chat_id | TEXT |  |  |
| is_valid | INTEGER | ✓ |  |
| checked_at | DATETIME |  |  |
| source | TEXT |  |  |

#### wa_quick_replies (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| shortcut | TEXT |  |  |
| title | TEXT |  |  |
| content | TEXT |  |  |
| category | TEXT |  |  |
| media_path | TEXT |  |  |
| use_count | INTEGER |  |  |
| created_at | DATETIME |  |  |

#### whatsapp_messages (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| customer_id | INTEGER |  |  |
| phone | TEXT |  |  |
| direction | TEXT |  |  |
| content | TEXT |  |  |
| media_url | TEXT |  |  |
| status | TEXT |  |  |
| created_at | DATETIME |  |  |

#### widget_configs (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| site_id | TEXT |  | ✓ |
| company_name | TEXT |  |  |
| welcome_message | TEXT |  |  |
| theme_color | TEXT |  |  |
| position | TEXT |  |  |
| avatar_url | TEXT |  |  |
| auto_reply_enabled | INTEGER |  |  |
| auto_reply_message | TEXT |  |  |
| updated_at | DATETIME |  |  |

#### workflow_runs (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| workflow_id | INTEGER | ✓ |  |
| status | TEXT |  |  |
| step_results | TEXT |  |  |
| started_at | DATETIME |  |  |
| completed_at | DATETIME |  |  |
| error | TEXT |  |  |

#### workflows (0 行)

| 字段 | 类型 | NOT NULL | PK |
|------|------|----------|-----|
| id | INTEGER |  | ✓ |
| name | TEXT | ✓ |  |
| description | TEXT |  |  |
| steps | TEXT |  |  |
| status | TEXT |  |  |
| trigger_type | TEXT |  |  |
| cron_expression | TEXT |  |  |
| created_by | TEXT |  |  |
| created_at | DATETIME |  |  |
| updated_at | DATETIME |  |  |

</details>

## 4. 路由系统

共 **47** 个路由文件

### advanced-api.js (316 行)

- (未提取到标准路由定义)

### agent-api.js (274 行)

- `GET /experiences`
- `PUT /experiences/:id/validate`
- `DELETE /experiences/:id`
- `GET /strategies`
- `POST /strategies`
- `PUT /strategies/:id`
- `GET /knowledge`
- `GET /action-log`
- `GET /status`
- `PUT /scan-interval`
- `PUT /cost-limits`
- `GET /autonomy`
- `PUT /autonomy`
- `GET /upgrade-requests`
- `PUT /upgrade-requests/:id`
- `POST /scan`
- `GET /scan-results`
- `GET /scan-rules`
- `PUT /scan-rules`
- `PUT /toggle`

### agent-dashboard-api.js (179 行)

- `GET /overview`
- `GET /daily-trend`
- `GET /drafts`
- `POST /drafts/:id/send`
- `DELETE /drafts/:id`

### ai-api.js (183 行)

- `POST /chat`
- `POST /dashboard-suggestions`
- `POST /generate-email`
- `POST /generate-content`
- `POST /analyze-inquiry`
- `POST /assess-risk`
- `POST /generate-product-description`
- `GET /stats`
- `POST /test-connection`

### ai-command-api.js (49 行)

- `POST /chat`
- `GET /conversations`
- `DELETE /conversations`
- `GET /tasks`
- `GET /tasks/:id`

### analytics-api.js (222 行)

- `GET /dashboard`
- `GET /channels`
- `GET /spend`
- `POST /spend`
- `DELETE /spend/:id`
- `POST /conversion`
- `GET /conversions`
- `GET /attribution`

### analytics-dashboard-api.js (98 行)

- `GET /dashboard`
- `GET /intent-logs`

### antiban-api.js (133 行)

- `GET /rules`
- `GET /rules/default`
- `PUT /rules`
- `PUT /rules/:platform`
- `POST /rules/reset`
- `POST /check`
- `GET /accounts`
- `POST /accounts`
- `POST /accounts/:platform/:accountId/pause`
- `POST /accounts/:platform/:accountId/unpause`
- `GET /accounts/:platform/:accountId/stats`
- `POST /variation`

### api.js (169 行)

- `GET /customers`
- `GET /customers/:id`
- `POST /customers`
- `PUT /customers/:id`
- `DELETE /customers/:id`
- `GET /inquiries`
- `POST /inquiries`
- `PUT /inquiries/:id`
- `POST /ai/chat`
- `POST /ai/analyze-inquiry`
- `GET /ai/stats`

### browser-adapters-api.js (76 行)

- `GET /status`
- `GET /:type/profiles`
- `POST /:type/launch`
- `POST /:type/stop`
- `PUT /config`

### calendar-api.js (194 行)

- `GET /events`
- `POST /events`
- `PUT /events/:id`
- `DELETE /events/:id`
- `POST /ai-generate`
- `GET /stats`
- `GET /templates`
- `POST /templates`

### channel-tools-api.js (333 行)

- `POST /verify-email`
- `POST /verify-email/batch`
- `POST /spam-check`
- `POST /detect-intent`
- `GET /intents/pending`
- `GET /pending-actions`
- `GET /pending-actions/stats`
- `POST /pending-actions/:id/resolve`
- `POST /pending-actions/:id/dismiss`
- `GET /pending-actions/escalation`
- `GET /quotes`
- `POST /quotes`
- `PUT /quotes/:id/status`
- `POST /quotes/:id/followup`
- `GET /quotes/need-followup`
- `GET /quotes/expiring`
- `GET /quotes/stats`
- `GET /sequences`
- `POST /sequences`
- `POST /sequences/enroll`
- `GET /sequences/due`
- `POST /sequences/enrollments/:id/execute`
- `POST /sequences/enrollments/:id/pause`
- `POST /sequences/enrollments/:id/resume`
- `POST /sequences/enrollments/:id/cancel`
- `GET /sequences/enrollments`
- `GET /sequences/stats`
- `POST /warmup/enable`
- `POST /warmup/disable`
- `GET /warmup/status/:accountId`
- `POST /warmup/run`
- `GET /warmup/stats/:accountId`
- `GET /warmup/configs`
- `POST /warmup/start`
- `POST /warmup/:accountId/stop`
- `POST /warmup/:accountId/start`
- `GET /warmup/logs`
- `POST /sequences/:id/enroll`
- `GET /sequences/logs`
- `POST /check-domain-auth`
- `GET /unsubscribes`
- `POST /unsubscribes/check`
- `POST /unsubscribes/resubscribe`
- `GET /unsubscribe-link`

### crud-api.js (760 行)

- (未提取到标准路由定义)

### customer-api.js (67 行)

- `POST /build-index`
- `GET /:id/identifiers`
- `GET /:id/conversations`
- `POST /:id/add-identifier`
- `POST /merge`
- `GET /find`

### customer-import-export.js (199 行)

- `POST /`
- `GET /:id`
- `PUT /:id`
- `DELETE /:id`
- `GET /`
- `POST /import`
- `GET /export`

### digital-human-api.js (185 行)

- `GET /`
- `GET /:id`
- `POST /`
- `PUT /:id`
- `DELETE /:id`
- `POST /:id/generate-video`
- `POST /:id/translate`
- `POST /batch-generate`
- `GET /:id/videos`

### dispatcher-api.js (97 行)

- `POST /execute`
- `POST /switch-proxy`
- `POST /switch-env`
- `GET /log/:accountId`
- `GET /log`
- `POST /batch`
- `GET /stats`

### email-api.js (420 行)

- `GET /email-presets`
- `GET /email-accounts`
- `POST /email-accounts`
- `PUT /email-accounts/:id`
- `DELETE /email-accounts/:id`
- `POST /email-accounts/:id/test`
- `GET /email-accounts/:id/gmail-auth-url`
- `GET /email-accounts/gmail-callback`
- `GET /emails`
- `POST /emails`
- `POST /emails/send`
- `POST /emails/batch-send`
- `POST /emails/send-test`
- `POST /emails/verify`
- `POST /emails/batch-verify`
- `POST /emails/approve`
- `POST /emails/reject`

### email-receiver-api.js (157 行)

- `POST /start`
- `POST /stop`
- `GET /status`
- `POST /check/:accountId`
- `POST /check-all`
- `GET /emails`
- `GET /emails/:id`
- `GET /auto-reply/settings`
- `PUT /auto-reply/settings`
- `GET /unread-count`

### emergency-api.js (79 行)

- `GET /status`
- `POST /stop`
- `POST /resume`
- `GET /logs`
- `GET /config`
- `PUT /config`

### env-api.js (561 行)

- `GET /profiles`
- `POST /profiles`
- `GET /proxies`
- `POST /proxies`
- `PUT /proxies/:id`
- `DELETE /proxies/:id`
- `POST /proxies/batch`
- `POST /proxies/import`
- `POST /proxies/:id/test`
- `POST /proxies/test-batch`
- `POST /proxies/:id/test-real`
- `POST /proxies/:id/test-url`
- `GET /subscriptions`
- `POST /subscriptions`
- `PUT /subscriptions/:id`
- `DELETE /subscriptions/:id`
- `POST /subscriptions/:id/refresh`
- `GET /phones`
- `POST /phones`
- `GET /chains`
- `POST /chains`
- `PUT /chains/:id`
- `DELETE /chains/:id`

### esim-api.js (521 行)

- `GET /providers`
- `POST /providers`
- `PUT /providers/:id`
- `DELETE /providers/:id`
- `GET /phones`
- `POST /phones`
- `POST /phones/batch-import`
- `PUT /phones/:id`
- `DELETE /phones/:id`
- `POST /phones/:id/test`
- `POST /phones/:id/validate`
- `GET /master-phone`
- `PUT /master-phone`
- `GET /logs`
- `POST /incoming/:phoneId`
- `POST /send`
- `POST /phones/parse-qr`

### followup-api.js (74 行)

- `POST /`
- `GET /`
- `PUT /:id`
- `DELETE /:id`
- `GET /logs`

### human-behavior-api.js (88 行)

- `GET /status`
- `GET /config`
- `PUT /config`
- `GET /personalities`
- `GET /personalities/:accountId`
- `PUT /personalities/:accountId`
- `DELETE /personalities/:accountId`
- `POST /personalities/:accountId/regenerate`
- `GET /logs`
- `GET /stats/:accountId`

### inbox-api.js (233 行)

- `GET /conversations`
- `GET /conversations/:id/messages`
- `GET /conversations/:id/ai-suggest`
- `POST /conversations/:id/reply`
- `POST /conversations/:id/read`
- `PUT /conversations/:id`
- `POST /conversations/:id/close`
- `POST /send`
- `GET /canned`
- `POST /canned`
- `DELETE /canned/:id`
- `GET /stats`

### journey-api.js (123 行)

- `GET /`
- `POST /`
- `GET /templates`
- `GET /stats`
- `GET /:id`
- `PUT /:id`
- `DELETE /:id`
- `POST /:id/enroll`
- `POST /:id/unenroll`
- `GET /:id/enrollments`
- `GET /:id/logs`
- `POST /process-queue`
- `GET /customer/:customerId`

### lead-scoring-api.js (97 行)

- `GET /rules`
- `PUT /rules`
- `POST /rules/reset`
- `POST /event`
- `POST /attribute`
- `GET /customer/:id`
- `GET /leaderboard`
- `GET /stats`
- `POST /recalculate`

### linkedin-api.js (159 行)

- `GET /sequences`
- `POST /sequences`
- `PUT /sequences/:id`
- `DELETE /sequences/:id`
- `GET /prospects`
- `POST /prospects`
- `DELETE /prospects/:id`
- `POST /enroll`
- `POST /unenroll/:prospectId`
- `POST /prospects/:id/replied`
- `POST /prospects/:id/connected`
- `POST /prospects/:id/link-customer`
- `POST /process-queue`
- `GET /stats`
- `GET /prospects/:id/logs`

### marketing-api.js (436 行)

- `GET /emails`
- `POST /emails`
- `POST /emails/:id/send`
- `POST /emails/batch-send`
- `POST /emails/send-now`
- `GET /sequences`
- `POST /sequences`
- `GET /accounts`
- `POST /accounts`
- `POST /accounts/batch`
- `DELETE /accounts/:id`
- `POST /accounts/batch-delete`
- `POST /accounts/:id/test`
- `GET /whatsapp`
- `POST /whatsapp`
- `POST /whatsapp/batch`
- `POST /campaign/ai-send`
- `GET /campaign/customers`

### matrix-api.js (149 行)

- `GET /stats`
- `GET /tasks`
- `GET /tasks/:id`
- `POST /tasks`
- `PUT /tasks/:id`
- `DELETE /tasks/:id`
- `POST /tasks/:id/start`
- `POST /tasks/:id/pause`
- `POST /tasks/:id/resume`
- `POST /tasks/:id/cancel`
- `GET /tasks/:id/items`
- `GET /tasks/:id/results`

### pages.js (178 行)

- `GET /`
- `GET /dashboard`
- `GET /crm`
- `GET /trade`
- `GET /marketing`
- `GET /social`
- `GET /env`
- `GET /products`
- `GET /ai-command`
- `GET /settings`
- `GET /channel-tools`

### products-api.js (99 行)

- `GET /`
- `POST /upload-images`
- `GET /:id`
- `POST /`
- `PUT /:id`
- `DELETE /:id`

### restream-api.js (116 行)

- `GET /platforms`
- `GET /sessions`
- `POST /sessions`
- `GET /sessions/:id`
- `PUT /sessions/:id`
- `DELETE /sessions/:id`
- `POST /sessions/:id/start`
- `POST /sessions/:id/stop`
- `GET /sessions/:id/status`
- `POST /sessions/:id/overlay`
- `POST /sessions/:id/schedule`
- `GET /sessions/:id/logs`

### seo-api.js (64 行)

- `POST /analyze`
- `POST /analyze/batch`
- `POST /keywords`
- `POST /optimize`
- `POST /sitemap`

### settings-api.js (701 行)

- `GET /`
- `GET /outbound-proxy`
- `PUT /outbound-proxy`
- `GET /detect-proxy`
- `GET /ai-providers`
- `PUT /ai-providers`
- `POST /test-ai-provider`
- `POST /ai-provider`
- `POST /company`
- `GET /export`
- `POST /import`
- `POST /change-password`
- `GET /totp`
- `POST /totp/setup`
- `POST /totp/enable`
- `POST /totp/disable`
- `GET /audit-logs`
- `POST /audit-logs/clean`
- `POST /backup`
- `GET /backups`
- `GET /backups/:filename`
- `DELETE /backups/:filename`
- `POST /backups/clean`
- `GET /modules`
- `PUT /modules`
- `GET /modules/:name`
- `GET /tiktok-api`
- `PUT /tiktok-api`
- `GET /youtube-api`
- `PUT /youtube-api`
- `GET /instagram-api`
- `PUT /instagram-api`
- `PUT /:key`

### social-accounts-api.js (128 行)

- `GET /`
- `GET /stats`
- `POST /`
- `POST /batch`
- `GET /:id`
- `PUT /:id`
- `DELETE /:id`
- `POST /batch-delete`
- `POST /:id/status`
- `PUT /:id/bindProxy`
- `PUT /:id/bindProfile`
- `PUT /:id/bindPhone`
- `GET /:id/bindings`

### social-api.js (78 行)

- `GET /posts`
- `POST /posts`
- `PUT /posts/:id`
- `GET /leads`
- `POST /leads`

### stats-api.js (53 行)

- `GET /overview`
- `GET /email`
- `GET /customers`
- `GET /timeline`

### tiktok-api.js (520 行)

- `GET /accounts`
- `GET /auth-status`
- `GET /auth-url`
- `POST /publish`
- `DELETE /accounts/:id`
- `GET /publish-status/:publishId`
- `POST /refresh-token`
- `GET /user-info`
- `GET /videos`

### tracking-api.js (82 行)

- `GET /open/:emailId.png`
- `GET /click/:emailId`
- `GET /stats/:emailId`
- `GET /stats`

### trade-api.js (102 行)

- `GET /deals`
- `GET /deals/:id`
- `POST /deals`
- `PUT /deals/:id`
- `PUT /deals/:id/stage`
- `DELETE /deals/:id`
- `POST /deals/:id/approve`
- `POST /deals/:id/reject`

### unsubscribe.js (67 行)

- `GET /unsubscribe`
- `POST /unsubscribe`

### video-api.js (137 行)

- `GET /`
- `GET /avatars`
- `POST /avatars`
- `POST /generate-script`
- `POST /batch-variants`
- `DELETE /:id`

### wa-checker-api.js (58 行)

- `POST /check`
- `POST /check-batch`
- `GET /stats`
- `GET /invalid`
- `POST /clear-cache`

### whatsapp-api.js (421 行)

- `GET /status`
- `POST /connect`
- `POST /disconnect`
- `GET /conversations`
- `GET /conversations/:chatId`
- `PUT /conversations/:chatId`
- `POST /send`
- `POST /send-product`
- `GET /quick-replies`
- `POST /quick-replies`
- `PUT /quick-replies/:id`
- `DELETE /quick-replies/:id`
- `POST /quick-replies/:id/use`
- `GET /broadcast-lists`
- `POST /broadcast-lists`
- `PUT /broadcast-lists/:id`
- `DELETE /broadcast-lists/:id`
- `POST /broadcast`
- `GET /broadcast-logs`
- `GET /auto-replies`
- `POST /auto-replies`
- `PUT /auto-replies/:id`
- `DELETE /auto-replies/:id`
- `GET /stats`
- `POST /check-number`
- `POST /check-numbers`

### widget-api.js (158 行)

- `GET /config`
- `POST /message`
- `GET /messages`
- `POST /configs`

### workflow-api.js (88 行)

- `GET /`
- `POST /`
- `GET /:id`
- `PUT /:id`
- `DELETE /:id`
- `POST /:id/run`
- `GET /runs/:runId`
- `POST /runs/:runId/pause`
- `POST /runs/:runId/resume`

## 5. 核心引擎模块

共 **69** 个核心模块

### agent-decision.js (298 行)

主要方法/类: class AgentDecision, getAutonomyLevel(), getLevelInfo(), setAutonomyLevel(), checkUpgradeEligibility(), respondToUpgrade(), decide(), _calculateMetrics(), _getUpgradeCriteria(), _meetsUpgradeCriteria(), _notify()

### agent-learner.js (291 行)

主要方法/类: class AgentLearner, analyze(), _checkDataSufficiency(), _analyzeSubjectLines(), _analyzeSendTiming(), _analyzeRegionResponse()

### agent-memory.js (475 行)

主要方法/类: class AgentMemory, addExperience(), findExperiences(), listExperiences(), markExperience(), applyExperience(), _checkExperienceLimit(), getExperienceCount(), getKnowledge(), getAllKnowledge(), getProfile(), upsertProfile()

### agent-scanner.js (581 行)

主要方法/类: class AgentScanner, start(), stop(), runScan(), _conflictExclusionSQL(), _scanFirstTouch()

### ai-brain.js (652 行)

主要方法/类: class KnowledgeBase, get(), set(), getAll(), getContext(), initDefaults(), _hash(), _getProvider(), _buildSystemPrompt()

### ai-command-engine.js (904 行)

主要方法/类: class AICommandEngine, _getAllProviders(), _callAI(), _resolveEmailAccount(), processCommand()

> * AI任务中心引擎  * 用户自然语言指令 → 主脑AI解析意图 → 调度专家Agent → 执行系统动作 → 汇总结果

### ai-content-generator.js (210 行)

主要方法/类: class AIContentGenerator, generateComments(), generateDM(), generatePost(), _aiGenerateComments(), _aiGenerateDM(), _aiGeneratePost(), _templateComments(), _templateDM(), _templatePost(), _loadTemplates(), _getAIConfig()

> * AI 社媒评论/内容生成器  *   * 为群控任务生成个性化、多样化的评论和内容

### ai-filter-engine.js (364 行)

主要方法/类: class AIFilterEngine, execute(), filterGender(), filterAge(), filterIndustry()

### ai-optimizer.js (364 行)

主要方法/类: class AIOptimizer, collectEmailMetrics(), collectVideoMetrics(), collectCustomerMetrics(), analyzeAndOptimize(), checkIfNeedsOptimization(), generateOptimizations(), getDefaultOptimizations(), saveOptimizations()

### ai-router.js (724 行)

主要方法/类: class AIRouter, initialize(), loadProvidersToCache(), callAI(), fallbackCall(), selectProvider(), callProviderAPI()

> * AI智能路由引擎  * 三层架构 + 智能调度

### ai-tools.js (339 行)

主要方法/类: class ToolExecutor, getToolsForAgent(), execute(), _getBusinessStats(), _searchCustomers(), _getCustomerDetail(), _getDeals(), _getInquiries(), _getSalesPipeline(), _getEmailHistory()

### alert-engine.js (78 行)

主要方法/类: class AlertEngine, alert(), _sendWebhook()

> * AlertEngine - 主动告警通知引擎  * 支持: console日志、webhook通知、写入alerts表

### antiban-engine.js (520 行)

主要方法/类: class AntiBanEngine, _loadRules(), _saveRules(), updateRules(), updatePlatformRules(), getRules(), getDefaultRules(), resetRules(), check(), recordAction(), getTodayStats(), getAccountAge(), registerAccount()

> * 社媒防封 & 养号规则引擎  * 集中管理所有平台安全限制，支持手动编辑和自动更新

### audit-logger.js (150 行)

主要方法/类: class AuditLogger, _ensureIndex(), _prepareStatements(), log(), logReq(), batchLog(), getByEntity(), getByUser(), getByDateRange(), getRecentErrors(), getByCategory()

### auth-middleware.js (33 行)

主要方法/类: requireAuth(), redirectIfAuth()

> * 认证中间件 — 保护所有路由

### backup.js (196 行)

主要方法/类: ensureBackupDir(), generateBackupName(), performBackup(), listBackups(), deleteBackup(), getBackupPath(), cleanOldBackups(), formatSize()

### browser-adapters.js (325 行)

主要方法/类: class BaseBrowserAdapter, setConfig(), ping(), launch(), stop(), listProfiles(), createProfile(), _headers()

> * 外部指纹浏览器适配器  * 支持 AdsPower / Multilogin / GeeLark

### config.js (80 行)

主要方法/类: loadConfig(), deepMerge(), saveConfig()

> * 配置管理 — 从config目录读取，不硬编码

### cost-controller.js (144 行)

主要方法/类: class CostController, getTodayCost(), getMonthCost(), canSpend(), logUsage(), _getAgentLimits(), getAgentTodayCost(), getAgentMonthCost(), canAgentSpend(), canAgentScanSpend(), getAgentCostOverview(), getCostController()

### credential-store.js (78 行)

主要方法/类: class CredentialStore, setCredential(), getCredential(), migrateSocialAccounts(), migrateProxies(), migrateAll()

> * 凭证加密存储 (D16 + D18)  * 自动加密/解密 social_accounts 和 proxies 表的敏感字段

### crypto-utils.js (65 行)

主要方法/类: encrypt(), decrypt(), hashPassword(), verifyPassword()

> * 加密工具 — 保护敏感数据

### customer-merger.js (194 行)

主要方法/类: class CustomerMerger, _ensureSchema(), buildIndex(), findCustomer(), addIdentifier(), getCustomerIdentifiers(), getCustomerConversations(), mergeCustomers()

### dal.js (156 行)

主要方法/类: findById(), findByEmail(), create(), update(), delete(), list(), count(), listQueued(), updateStatus(), recent()

### database.js (685 行)

主要方法/类: initDatabase()

> * 数据库初始化 — 首次启动自动建表

### digital-human-engine.js (410 行)

主要方法/类: class DigitalHumanEngine, _ensureDirs(), _notify(), cloneVoice(), generateAvatar(), createTalkingHead(), translateAndDub()

> * P3-18 AI数字人/克隆翻译引擎  * 功能：声音克隆、数字人形象生成、口型同步视频、多语言翻译配音、批量生成

### domain-auth-checker.js (148 行)

主要方法/类: class DomainAuthChecker, check(), _checkSPF(), _checkDKIM(), _checkDMARC(), _checkMX(), _resolveTxt(), _resolveMx()

> * SPF/DKIM/DMARC 域名邮件认证检测器  * 检查发件域名的DNS记录，评估邮件投递能力  * 只加不改 — 新模块

### email-auto-replier.js (469 行)

主要方法/类: class EmailAutoReplier, _initSettings(), _bindEvents(), _handleNewEmail(), _generateAndSendReply()

> * 邮件AI自动回复处理器  * 监听 EmailReceiver 的 newEmail 事件  * 调用 AI Brain 生成回复 → 通过 EmailSender 发送

### email-receiver.js (569 行)

主要方法/类: class EmailReceiver, _initTable(), start(), stop(), getStatus(), checkAccount(), _getActiveAccounts(), _startPolling(), _fetchNewEmails()

### email-sender.js (839 行)

主要方法/类: class EmailSender, _getBounceThreshold(), _getTransporter(), _clearTransporter(), testConnection(), _getDailyLimit(), _canSend()

### email-tracker.js (148 行)

主要方法/类: class EmailTracker, _ensureTable(), injectTracking(), recordOpen(), recordClick(), getStats(), getAggregateStats()

### email-verifier.js (227 行)

主要方法/类: class EmailVerifier, _ensureTable(), verify(), batchVerify(), _isValidFormat(), _smtpCheck()

### emergency-brake.js (601 行)

主要方法/类: class EmergencyBrake, isStopped(), stopAll(), resumeAll()

### fingerprint-engine.js (601 行)

主要方法/类: class BrowserPool, _ensureTable(), _startIdleChecker(), _getFingerprint(), _getAccountProxy(), _getAccountProfile(), _buildProxyUrl(), _generateInstanceId(), acquire()

### fraud-validator.js (293 行)

主要方法/类: class FraudValidator, validateEmail(), checkDomainAge(), validateCompanyRegistration(), analyzePurchaseHistory()

### human-behavior-engine.js (328 行)

主要方法/类: class HumanBehaviorEngine, _initDB(), getPersonality(), listPersonalities(), updatePersonality(), deletePersonality(), wrap(), humanClick(), humanType()

### inbox-sync-engine.js (557 行)

主要方法/类: class InboxSyncEngine, _initSyncState(), startSync(), stopSync(), _pollPlatform(), _fetchMessages(), _getFetcher(), _getToken(), _fetchFacebook(), _fetchInstagram(), _fetchTikTok()

> * P1-7 聚合私信客服引擎 (Inbox Sync Engine)  * 定时轮询 Facebook/Instagram/TikTok/LinkedIn/Twitter 私信  * 统一写入 inbox_conversations + inbox_messages

### init-users.js (55 行)

主要方法/类: initUsers()

> * 初始化用户表和默认管理员账号

### input-validator.js (73 行)

主要方法/类: validateBody()

> * 输入校验中间件  * 用法: validateBody({ field: { type:'string', required:true, maxLength:255, pattern:/regex/ } })

### instagram-publisher.js (213 行)

主要方法/类: class InstagramPublisher, _getConfig(), _getToken(), getAuthUrl(), handleCallback(), publishImage(), publishVideo(), publishCarousel()

### intent-detector.js (231 行)

主要方法/类: class IntentDetector, _ensureTable(), detect(), _matchKeywords(), _log(), getPendingPricingIntents(), markHandled()

### journey-engine.js (465 行)

主要方法/类: class JourneyEngine, _initTables(), createJourney(), getJourneys(), getJourney(), updateJourney(), deleteJourney(), triggerEvent(), processQueue(), enrollCustomer()

> * 客户旅程自动化引擎 (Customer Journey Automation)  * 可视化流程编排：触发器 → 条件 → 动作

### lead-scoring.js (354 行)

主要方法/类: class LeadScoringEngine, _initTables(), _loadRules(), _saveRules(), getRules(), updateRules(), resetRules(), recordEvent(), setAttribute(), recalculate(), recalculateAll(), getScoreDetail(), getLeaderboard(), getGradeStats()

> * 线索评分引擎 (Lead Scoring Engine)  * 基于行为+属性双维度自动评分，驱动销售优先级

### linkedin-automation.js (386 行)

主要方法/类: class LinkedInAutomation, _initTables(), createSequence(), getSequences(), updateSequence(), deleteSequence(), addProspect(), addProspectsBatch(), getProspects(), deleteProspect()

> * LinkedIn 自动化外展引擎  * 自动化序列：浏览 → 连接 → 消息 → 跟进  * 集成防封引擎 + CRM + 线索评分

### live-restream-engine.js (322 行)

主要方法/类: class LiveRestreamEngine, createStream(), getSession(), listSessions(), updateStream(), deleteStream(), startRestream(), stopRestream(), getStatus(), addOverlay(), scheduleStream()

> * P3-19 矩阵直播转播引擎  * 拉取源流 → 推送到多个目标平台（YouTube/Facebook/TikTok/Instagram/Twitch）  * 每个目标独立 ffmpeg 进程，独立监控

### logger.js (75 行)

主要方法/类: hijackConsole()

> * B9 日志系统 — 基于 pino  * 开发环境: pino-pretty 控制台输出  * 生产环境: 写文件 logs/app.log + logs/error.log

### matrix-task-engine.js (422 行)

主要方法/类: class MatrixTaskEngine, start(), _markInterruptedTasks(), recoverTasks(), stop(), registerExecutor(), createTask(), getTask(), listTasks(), updateTask(), deleteTask()

### multichannel-sequence.js (280 行)

主要方法/类: class MultichannelSequence, _ensureTable(), _seedDefaults(), createSequence(), enroll(), getDueSteps(), executeStep(), pause(), resume(), cancel(), onCustomerReply(), listSequences(), listEnrollments()

### oauth-manager.js (268 行)

主要方法/类: class OAuthManager, getFacebookAuthUrl(), handleFacebookCallback(), getTikTokAuthUrl(), handleTikTokCallback(), refreshTikTokToken(), saveCredentials(), getCredentials()

### outbound-proxy.js (129 行)

主要方法/类: getProxyAgent(), getAccountProxyAgent(), injectProxy(), injectProxyFetch(), clearProxyCache()

> ========== 全局代理缓存（settings表） ==========

### pending-actions.js (194 行)

主要方法/类: class PendingActions, _ensureTable(), create(), createFromPricingIntent(), getPending(), getStats(), resolve(), dismiss(), getEscalationDue(), updateEscalation()

### proxy-parser.js (426 行)

主要方法/类: parseShareLink(), safeDecode(), extractFragment(), parseSS(), parseVMess(), parseVLESS(), parseTrojan(), parseHysteria2(), parseTUIC(), parseWireGuard(), parseSOCKS(), splitHostPort(), isIPAddress(), fixSecurity()

> * 代理分享链接解析器 — 参考 NekoBox  * 支持: ss:// vmess:// vless:// trojan:// hy2:// tuic:// socks:// http://

### quote-tracker.js (175 行)

主要方法/类: class QuoteTracker, _ensureTable(), create(), updateStatus(), markFollowedUp(), getNeedFollowUp(), getExpiring(), getByCustomer(), getStats(), list()

### scraper-engine.js (163 行)

主要方法/类: class ScraperEngine, getAvailableProxy(), searchGoogle(), searchAlibaba(), executeTask()

### seo-engine.js (342 行)

主要方法/类: class SEOEngine, analyzePage(), researchKeywords()

### social-accounts.js (290 行)

主要方法/类: class SocialAccountManager, _getPlatformDefaultLimit(), _initTables(), addAccount(), addAccountsBatch(), getAccounts()

> * 社媒账号管理引擎  * 统一管理 WhatsApp / TikTok / Facebook / LinkedIn 账号

### social-dispatcher.js (498 行)

主要方法/类: class BaseAdapter, connect(), disconnect(), sendMessage(), post(), getStatus()

### social-publisher.js (275 行)

主要方法/类: class SocialPublisher, publishToFacebook(), publishToTikTok(), savePublishRecord(), checkPublishLimit()

### spam-detector.js (204 行)

主要方法/类: class SpamDetector, analyze()

### subscription-parser.js (262 行)

主要方法/类: class SubscriptionParser, parseSubscription(), parseClashYAML(), extractCountry(), parseBase64Content(), parseShadowsocks(), parseVMess()

### task-scheduler.js (70 行)

主要方法/类: class TaskScheduler, start(), stop(), addTask(), removeTask(), getTasksStatus(), backupDatabase()

### unified-inbox.js (507 行)

主要方法/类: class UnifiedInbox, _initTables(), _syncSentEmailsToInbox(), _classifyExistingConversations(), _classifyConversation(), _resolveAccountName()

> * 多渠道统一收件箱 (Unified Inbox)  * 聚合 WhatsApp / Email / LinkedIn / Facebook 所有对话到一个视图

### unsubscribe-manager.js (141 行)

主要方法/类: class UnsubscribeManager, _ensureTable(), generateToken(), getUnsubscribeUrl(), getHeaders(), appendUnsubLink(), unsubscribe(), isUnsubscribed(), list(), resubscribe()

### video-generator.js (261 行)

主要方法/类: class VideoGenerator, init(), generateVoiceover(), generateSilence(), generateScene(), mergeScenes(), addBackgroundMusic(), addWatermark(), randomizeVideo(), generateVideo()

### video-mix-engine.js (268 行)

主要方法/类: class VideoMixEngine, init(), generateScript(), _defaultScript(), mixClips(), _addTransitions(), generateVariants(), addMultiLanguageVoiceover()

### wa-number-checker.js (177 行)

主要方法/类: class WANumberChecker, _ensureSchema(), _normalize(), check(), checkBatch(), preSendCheck(), getStats(), getInvalidNumbers(), clearExpiredCache()

### warmup-engine.js (210 行)

主要方法/类: class WarmupEngine, _ensureTable(), enable(), disable(), getStatus(), runWarmup(), _calculateStage(), _getTodaySentCount(), getStats()

### whatsapp-client.js (728 行)

主要方法/类: class WhatsAppManager, _initTables(), initialize(), destroy(), setNumberChecker(), sendMessage(), sendMedia(), sendMediaFromUrl(), sendProductCard(), checkNumber()

> * WhatsApp Web 客户端管理器  * Phase 1: 基于 whatsapp-web.js 实现零成本 WhatsApp 自动化

### workflow-engine.js (293 行)

主要方法/类: class WorkflowEngine, _initTables(), createWorkflow(), getWorkflow(), listWorkflows(), updateWorkflow(), deleteWorkflow(), _topoSort(), runWorkflow(), map()

### youtube-publisher.js (205 行)

主要方法/类: class YouTubePublisher, _getConfig(), _getToken(), _refreshToken(), getAuthUrl(), handleCallback(), uploadVideo(), listVideos()

## 6. 平台执行器

共 **15** 个平台

### facebook (423 行)
- 方法: class FacebookExecutor, execute(), _randomDelay(), _humanScroll(), _humanMouseMove(), _humanType(), _acquireBrowser(), _releaseBrowser(), _scrollAndCollect(), _extractIdFromUrl()

### google-maps (373 行)
- 方法: class GoogleMapsExecutor, execute(), collectBusinesses(), collectContacts(), collectReviews()

### instagram (625 行)
- 方法: class InstagramExecutor, execute(), _randomDelay(), _humanScroll(), _humanMouseMove(), _humanType(), _acquireBrowser(), _releaseBrowser(), _extractUsername(), _scrollAndCollect()

### line (449 行)
- 方法: class LineExecutor, execute(), _randomDelay(), _humanScroll(), _humanMouseMove(), _humanType(), _acquireBrowser(), _releaseBrowser(), _collectGroupMembers(), _collectFriends()

### outlook (423 行)
- 方法: class OutlookExecutor, _ensureTable(), execute(), _batchSendEmail(), _login(), _composeSend()

### pinterest (401 行)
- 方法: class PinterestExecutor, execute(), _randomDelay(), _humanScroll(), _humanMouseMove(), _humanType(), _acquireBrowser(), _releaseBrowser(), _collectPins(), _collectBoardFollowers()

### reddit (294 行)
- 方法: class RedditExecutor, execute(), _randomDelay(), _humanScroll(), _humanMouseMove(), _humanType(), _acquireBrowser(), _releaseBrowser(), _extractRedditUser(), _scrollAndCollect()

### shopee (192 行)
- 方法: class ShopeeExecutor, _axiosConfig(), execute(), _collectSellers(), _collectProducts(), _collectReviews(), _getShopInfo()

### threads (426 行)
- 方法: class ThreadsExecutor, execute(), _randomDelay(), _humanScroll(), _humanMouseMove(), _humanType(), _acquireBrowser(), _releaseBrowser(), _collectFollowers(), _collectPostRepliers()

### tiktok (556 行)
- 方法: class TikTokExecutor, execute(), _randomDelay(), _humanScroll(), _humanMouseMove(), _humanType(), _acquireBrowser(), _releaseBrowser(), _extractUsernameFromUrl(), _scrollAndCollect()

### twitter (343 行)
- 方法: class TwitterExecutor, execute(), _randomDelay(), _humanScroll(), _humanMouseMove(), _humanType(), _acquireBrowser(), _releaseBrowser(), _extractUsername(), _scrollAndCollect()

### vk (301 行)
- 方法: class VKExecutor, execute(), _randomDelay(), _humanScroll(), _humanMouseMove(), _humanType(), _acquireBrowser(), _releaseBrowser(), _extractVkId(), _scrollAndCollect()

### website (225 行)
- 方法: class WebsiteContactExtractor, execute(), extractContacts(), extractFromUrls(), _extractFromSite(), _fetchPage(), _extractFromHtml()

### yandex-maps (135 行)
- 方法: class YandexMapsExecutor, execute(), _collectBusinesses(), _collectReviews()

### youtube (306 行)
- 方法: class YouTubeExecutor, execute(), _randomDelay(), _humanScroll(), _humanMouseMove(), _humanType(), _acquireBrowser(), _releaseBrowser(), _extractChannelId(), _scrollAndCollect()

## 7. 前端视图

共 **17** 个主页面

### ai-command.ejs (12.9KB)

### channel-tools.ejs (48.0KB)

### crm.ejs (18.4KB)

### dashboard.ejs (15.5KB)

### env.ejs (75.6KB)

### inbox.ejs (21.0KB)

### login.ejs (3.7KB)
- 标题: 登录 - VIPB AI System

### marketing.ejs (26.4KB)

### matrix.ejs (9.3KB)

### products.ejs (18.7KB)

### seo.ejs (7.5KB)

### settings.ejs (139.3KB)

### social.ejs (83.0KB)

### tiktok.ejs (18.4KB)

### trade.ejs (15.7KB)

### video.ejs (12.2KB)

### workflow.ejs (8.3KB)

## 8. 配置系统

- `settings.yaml` (33 行)

## 9. eSIM/SMS 引擎

共 9 个适配器: africas-talking, aliyun-sms, base-adapter, plivo, telnyx, tencent-sms, termii, twilio, vonage

## 10. 人类行为模拟引擎

- `behavior-chain.js` (112 行) — class BehaviorChain, warmup(), cooldown(), _tryRandomLike(), _sleep()
- `executor-mixin.js` (126 行) — applyHumanMixin()
- `keyboard-simulator.js` (139 行) — class KeyboardSimulator, type(), paste(), _typingDelay(), _nearbyKey(), _sleep()
- `mouse-simulator.js` (137 行) — class MouseSimulator, moveTo(), click(), clickElement(), _generateBezierPath(), _clickOffset(), _sleep()
- `personality.js` (71 行) — class PersonalityGenerator, generate(), fromRow()
- `scroll-simulator.js` (119 行) — class ScrollSimulator, readFeed(), scrollToElement(), scrollToTop(), _readingPause(), _sleep()
