# 上库审计与排除清单（Atlas，2026-11-05）
来源：VIPB-AI-System-Clean-20260827.rar（Google 云盘「我自己的开源项目」，48,481,998 字节，SHA-256 dcb3565c…f28bb）
原始解包：16,761 个文件 / 约 343MB，其中 node_modules 占 16,441 个文件 / 约 338MB（第三方依赖，不入库，用 package.json + package-lock.json 重装）。自有文件 320 个 / 约 4.7MB。

## 已排除（不在本候选包内）
- `.env` —— 标准做法不入库（本份实际只有 PORT、NODE_ENV 两个普通配置）
- `data/vipb.db` —— 数据库不进代码仓库（含知识库 111 条、话术模板 26 条、防封规则等业务know-how；原包仍在云盘 RAR 里备份）。已核：customers / emails / email_accounts / users / social_accounts / proxies 等 90 张业务表全为空行，整理方的清洁说明属实
- `scripts/inject-seed-data.js` —— 示例客户种子数据（约 100 个示例邮箱，含多家真实风格的公司域名邮箱）
- `cust.json`、`cust-upd.json` —— 测试用客户样例（example.com 域名，仍按个人数据形状排除）
- `_kb_full_dump.txt` —— 知识库导出转储，与数据库内容重复
- `src/app.js.sqljs-backup`、`src/deprecated/*.bak` —— 旧代码备份件

## 已脱敏（改动后入候选包）
- `.env.example` —— SESSION_SECRET、CREDENTIAL_KEY 的值已清空（原文件里是整理时新生成的真值样式字符串），只留变量名
- `tavily-search2.js` —— 代码里写死的一把 Tavily 接口钥匙（tvly- 开头、58 位）已改为读环境变量 TAVILY_API_KEY。**注意：这把钥匙已随文件经微信、云盘流转，应视为已扩散，建议到 Tavily 后台作废重发**

## 保留但须知道
- `src/init-users.js` 等处有系统自带默认管理员 admin / 旧默认口令（系统首次启动创建、文档多处明示）——私有仓库阶段保留原样；若将来转公开，须先改掉默认口令逻辑
- 知识库注入脚本（scripts/inject-knowledge*.js 等）含公司销售与外贸知识内容——私有阶段保留；转公开前须单独评估排除
- 本项目无独立 LICENSE 文件；package.json 标注 ISC（整理方/原作者归属未核实前，不对外宣称开源授权）

## 上传前编码规范化（内容不变，仅转码）
- `VIPB-start.bat`、`VIPB-stop.bat`：原为 GBK 编码，已转 UTF-8（文字内容一字未改）
- `_test_summary.md`：原为 UTF-16 编码，已转 UTF-8（文字内容一字未改）
原因：GitHub 快照上传只接受 UTF-8 文本文件。原始编码版本仍保留在云盘原包内。

## 2026-11-05 第二轮处理（默认口令 / 知识库脚本 / 许可证）
- **默认管理员口令**：`src/init-users.js` 已取消写死的 admin/旧默认口令；改为首次启动时取环境变量 `INITIAL_ADMIN_PASSWORD`，未设置则随机生成并仅在启动日志打印一次（已通过替身模块功能测试：两种分支均正确、生成的口令不是 旧默认口令）。README、QUICK-START、CLEAN-EXPORT-README、.env.example 已同步新说明。历史/测试文件（SECURITY-AUDIT.md、TASK-COMPLETION-REPORT.md、test-*.ps1、full-test.js、_exec*.js 等）仍留有旧字样，属历史记录与本地测试脚本，不影响系统建号逻辑，随转公开复审时一并清理。
- **知识库脚本**：scripts/ 下 11 个 inject-*knowledge*.js（约 159KB 业务知识内容）已在仓库版替换为占位说明，内容原件保留在云盘原包内；其余 src/ 代码只是调用知识库、不含内容。注意：仓库第一个提交的历史里仍有内容版，若转公开须用无历史的新仓库导出，不能直接把本仓库改公开。
- **许可证**：package.json 原标 ISC（等于默认授予开源权利）已改为 UNLICENSED（未授予任何许可），在权利人确认前不对外授权；原作者署名「小A」保留未动。第三方直接依赖的许可清单见 THIRD-PARTY-NOTICES.md（全为 MIT/Apache-2.0 等宽松许可）。据系统自带条款页（server.js）文字，本系统对外宣称的权利人为 Wenzhou Xingyuan Holding Co., Ltd.，最终 LICENSE 文本与权利人名称待用户确认后落文件。
- **作者署名（2026-11-05 用户拍板）**：package.json 的 author 已由「小A」改为「VIPB」，以 VIPB 为本项目对外署名。SECURITY-AUDIT.md 中的「项目维护者：小A」为 2026-03 历史审计记录、views/settings.ejs 中的「AI销售Agent（小A分身）」为产品界面称呼，均非作者署名，未改动。
- **权利人确认（2026-11-05 用户确认）**：权利人为 Wenzhou Xingyuan Holding Co., Ltd.（温州星源控股，与系统自带条款页 server.js 的表述一致）；已新增 LICENSE 文件（保留全部权利、不授予使用许可），package.json 的 license 改为 SEE LICENSE IN LICENSE。是否改用 MIT 等开源许可，留待决定公开时再议。
- **开源前清理（2026-11-06）**：全部文件中的旧默认口令字样清零（复扫 0 处）——测试/运维脚本（tests/helpers.js、tests/customers.test.js、full-test.js、_exec*.js、test-*.ps1）改为读环境变量 ADMIN_PASSWORD / TEST_ADMIN_PASSWORD，未设置时报错退出；历史文档（SECURITY-AUDIT.md、TASK-COMPLETION-REPORT.md、测试教程.md）中的口令字样已脱敏。全量复扫确认：无真实钥匙格式、无个人电话/私人邮箱/公司邮箱、无服务器或代理 IP（仅公共 DNS 地址），邮箱均为 example.com 等测试域、电话为占位测试号。
- **展示材料（2026-11-06）**：公开版 README 已重写（英文为主、附中文概要，含功能、架构、快速开始与如实的状态说明）；新增横幅与架构图（docs/assets/，品牌绿文字图形）与 9 张界面截图（docs/screenshots/）——截图由系统自带真实页面模板渲染截取、数据为示例，来源说明见 docs/screenshots/NOTE.md，未使用任何伪造界面。
- **功能状态说明（2026-11-06）**：新增 docs/FEATURE-STATUS.md，逐模块标注三档状态（实际用过＝仅邮件发送链路／代码完整未经实际验证／开发方自述未完成＝远程控制）；依据为用户 2026-11-04 实际使用结论＋代码量盘点（src 约 2.3 万行、15 个平台执行器 134–624 行、无空壳）＋开发方最终报告（自称 86%、远程控制标未完成）。README 状态说明已链入该页。
- **功能状态说明修正（2026-11-06 二次复核）**：FEATURE-STATUS.md 已按深核报告重写。上一版把“未长期生产使用”等同于“未跑通”、且漏评账号环境管理，现已更正：环境管理（节点 195 条实测在库、三家指纹浏览器适配、账号级出口）与邮件发送、知识库、AI 指挥中心（62 条对话/32 任务痕迹）列为实际用过；eSIM 半通、13 个端点实测未通、远程控制未实现照实标注。知识库条目系所有者从 300 多万词句提炼的个人资产，内容不公开之决定不变。
- **开发说明（2026-11-06）**：新增 DEVELOPMENT.md（英文为主＋中文要点）：运行与环境变量、8 模块与 AI 大脑 5 层架构、代码地图、五大子系统（环境出口/邮件/知识库/社媒双机制/任务调度/视频/安全）、数据库、测试、已知问题清单（引 2026-03-15 实测）与开发约定。README 已加文档索引。
- **许可证切换（2026-11-12 用户决定 MIT 开源）**：LICENSE 由“保留全部权利”换成 MIT 协议（权利人仍为 Wenzhou Xingyuan Holding Co., Ltd.），package.json license 改回 MIT，README 许可章节与中文概要同步。MIT 草案文件 LICENSE-MIT-DRAFT.txt 已生效、不再是备稿。
