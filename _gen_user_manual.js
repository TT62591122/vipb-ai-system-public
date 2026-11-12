const fs = require('fs');

const manualContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>VIPB AI System - 智能外贸营销系统使用说明书</title>
<style>
  body { font-family: 'Microsoft YaHei', 'PingFang SC', 'Segoe UI', sans-serif; max-width: 900px; margin: 0 auto; padding: 40px 30px; line-height: 2; color: #333; background: #fff; }
  .cover { text-align: center; margin-bottom: 80px; padding-top: 50px; }
  .cover h1 { color: #1a5276; font-size: 36px; border-bottom: none; }
  .cover p { font-size: 18px; color: #7f8c8d; }
  h1 { color: #1a5276; border-bottom: 3px solid #3498db; padding-bottom: 15px; font-size: 28px; margin-top: 60px; }
  h2 { color: #2980b9; border-bottom: 1px dashed #bdc3c7; padding-bottom: 8px; margin-top: 40px; font-size: 22px; }
  h3 { color: #2c3e50; margin-top: 25px; font-size: 18px; }
  p { margin: 12px 0; font-size: 15px; }
  ul, ol { padding-left: 25px; margin-bottom: 20px; }
  li { margin: 8px 0; font-size: 15px; }
  .highlight { background: #ebf5fb; padding: 15px 20px; border-left: 5px solid #3498db; margin: 20px 0; border-radius: 0 5px 5px 0; }
  .highlight strong { color: #e74c3c; }
  .btn { display: inline-block; background: #3498db; color: white; padding: 5px 12px; border-radius: 4px; font-size: 13px; font-weight: bold; margin: 0 3px; }
  .flow-chart { background: #f8f9fa; border: 1px solid #e1e8ed; padding: 20px; text-align: center; font-weight: bold; color: #2c3e50; border-radius: 8px; margin: 20px 0; }
  .flow-chart span { color: #e74c3c; margin: 0 10px; }
  table { width: 100%; border-collapse: collapse; margin: 20px 0; }
  th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
  th { background-color: #3498db; color: white; }
  tr:nth-child(even) { background-color: #f9f9f9; }
</style>
</head>
<body>

<div class="cover">
  <h1>VIPB AI System</h1>
  <p>— 智能外贸营销系统 V2.0 使用说明书 —</p>
  <p><strong>核心理念：一个人，一支军队，一个全自动获客印钞机</strong></p>
</div>

<h1>一、 系统概述与总体架构</h1>

<div class="highlight">
  <p><strong>产品简介：什么是 VIPB AI System？</strong></p>
  <p>这套系统是专为“一人外贸公司”或追求极致人效的业务团队打造的“核武器”。它不再是一个需要你手动敲字、回邮件的软件，而是一个拥有 <strong>AI 大脑、全渠道触手、自动化流水线</strong> 的数字化分身。</p>
  <p>你只需要设定目标和提供产品库，它就能 24 小时不知疲倦地在全网找客户、发邮件、聊 WhatsApp，并在客户有兴趣时第一时间通知你接手成交。</p>
</div>

<h2>1. 业务闭环架构：钱是怎么赚进来的？</h2>
<p>本系统的核心就是打通了外贸获客的“四大生命周期”，没有一个环节需要你人工去搬砖：</p>
<div class="flow-chart">
  矩阵/社媒采集 <span>➡</span> 自动化触达 (邮件/WhatsApp) <span>➡</span> 客户回复落入统一收件箱 <span>➡</span> 交易/报价管理 <span>➡</span> 成交
</div>
<ul>
  <li><strong>引流（矩阵采集）：</strong> 从 Google、LinkedIn、TikTok 等平台批量挖出目标客户的邮箱和电话。</li>
  <li><strong>触达（自动化序列）：</strong> AI 自动写开发信，连发 3~5 天的自动跟进邮件，直到客户回复。</li>
  <li><strong>转化（统一收件箱）：</strong> 客户一回复，立刻进入系统的“指挥中心”，AI 自动为客户打分并总结意向。</li>
  <li><strong>交易（CRM与订单）：</strong> 你只需在交易看板上管理高意向报价单，促成最终打款。</li>
</ul>

<h2>2. 核心模块协同机制</h2>
<p>系统不是孤立的工具堆砌，而是相互喂养的生态：</p>
<ul>
  <li>你在 <strong><span class="btn">产品库</span></strong> 上传了一个新插座的图片和价格；</li>
  <li>你可以直接去 <strong><span class="btn">AI任务中心</span></strong> 对系统说：“帮我给中东地区的A级客户写一封推荐这款插座的开发信，附上图片。”</li>
  <li>AI 会自动去 <strong><span class="btn">CRM</span></strong> 里捞出中东 A 级客户，去产品库调取图片，写出 100 封完全不同的本土化邮件，通过 <strong><span class="btn">营销中心</span></strong> 发送出去。</li>
</ul>

<h1>二、 核心指挥与中枢神经</h1>

<h2>1. 指挥中心 (Dashboard)：老板的仪表盘</h2>
<p><strong>每天早上打开电脑第一眼看什么？就看这里。</strong></p>
<ul>
  <li><strong>大盘数据：</strong> 今天系统自动挖了多少线索？发了多少邮件？有几个回复？</li>
  <li><strong>热门询盘：</strong> 哪几个客户刚刚打开了你的邮件 3 次以上？哪几个客户回了长邮件？系统会把他们飘红置顶。</li>
  <li><strong>待办管理：</strong> 昨天那个说“发个报价单”的客户，今天该跟进了，系统会像秘书一样贴在你的待办列表里。</li>
</ul>

<h2>2. 统一收件箱 (Inbox)：告别来回切软件</h2>
<p>做外贸最烦的就是：电脑挂着 WhatsApp 网页版，开着两个企业邮箱，还要看 TikTok 私信。统一收件箱彻底解决这个问题。</p>
<div class="highlight">
  <p><strong>核心亮点：</strong></p>
  <p>不管客户是用 Gmail 给你发邮件，还是在 WhatsApp 上问“How much”，只要是他发的消息，全都在 <strong><span class="btn">统一收件箱</span></strong> 里按客户名字聚合。你在这个页面回复，系统自动从对应渠道发回去。而且，AI 会自动过滤掉“推销”、“退订”等垃圾信息，只留真客户。</p>
</div>

<h2>3. ⚡ 工作流编排：让系统自动干活</h2>
<p>把你的销售套路，变成系统 24 小时执行的流水线。你可以像搭积木一样设定规则。</p>
<ul>
  <li><strong>触发器：</strong> 如果客户【打开邮件达到 3 次】...</li>
  <li><strong>动作：</strong> 则自动【在 WhatsApp 上给他发一条问候消息】。</li>
  <li><strong>动作：</strong> 并将他在 CRM 中的状态改为【高意向线索】。</li>
</ul>
<p>设定好之后，你睡觉的时候，系统就在帮你暖客。</p>

<h2>4. 🧠 AI 任务中心：你的 24 小时数字助理</h2>
<p>不需要懂代码，不需要找按钮，直接打字下达命令。它是整个系统的“大管家”。</p>
<ul>
  <li>你可以说：“帮我查一下昨天发给那个迪拜客户的报价单进展。”</li>
  <li>或者说：“给我今天新捞到的 50 个客户，每人写一封痛点开发信。”</li>
  <li>AI 能够直接听懂人话，调动底层引擎执行，并把结果呈现在你面前。</li>
</ul>

<h1>三、 客户与交易资产管理</h1>

<h2>1. 📋 CRM 客户关系管理</h2>
<p>告别混乱的 Excel 表格。这里的 CRM 是活的，客户进来后，系统一直在帮你追踪他。</p>
<ul>
  <li><strong>公海到私域：</strong> 矩阵挖来的线索先进“公海”，经过邮件和 WhatsApp 自动触达，回复的人自动沉淀到“私域”。</li>
  <li><strong>AI 智能打分：</strong> 你不用挨个看邮件判断客户好坏。AI 会根据客户的回复态度、查看频率，自动打出 0-100 的意向分。高分客户永远排在前面。</li>
  <li><strong>一键建档：</strong> 收到询盘，一键点击“转为客户”，他的邮箱、电话、社交媒体主页自动抓取建档。</li>
</ul>

<h2>2. 💰 交易中心 (Trade)：把控钱的进度</h2>
<p>外贸的核心是拿单。交易中心用看板（Kanban）的形式，让你对每一笔可能进账的钱了如指掌。</p>
<div class="flow-chart">
  新建报价单 <span>➡</span> 谈判中 <span>➡</span> 寄送样品 <span>➡</span> 等待打款 <span>➡</span> 赢单 / 输单
</div>
<ul>
  <li><strong>防流失提醒：</strong> 某个报价单停留在“发送 PI”阶段超过 7 天，系统会报警，提醒你立刻介入催款。</li>
  <li><strong>全链路挂钩：</strong> 这笔交易挂钩在哪个客户名下？发过什么邮件？点开详情一目了然，老板随时接盘员工离职留下的烂摊子。</li>
</ul>

<h2>3. 📦 产品库 (Products)：弹药库</h2>
<p>把你的核心产品（图片、型号、价格、认证、卖点）传上去。这不是给客户看的网站，这是给 AI 吃的“弹药”。</p>
<p>下次你让 AI 写邮件推销产品，AI 会自动从这里提取精确的参数和优势，绝不会张冠李戴胡编乱造。</p>

<h1>四、 全渠道主动营销阵地</h1>

<h2>1. 📧 营销中心：发得出去，客户愿看</h2>
<p>市面上普通的群发软件进了垃圾箱都没人知道，我们的系统用最顶级的逻辑保护你的送达率。</p>
<ul>
  <li><strong>千人千面：</strong> 群发 1000 封邮件，AI 自动改写 1000 次，每封邮件的主语、痛点、排版都不一样，极大概率绕过反垃圾机制。</li>
  <li><strong>多天自动跟进序列：</strong> 第一天发图册，没回？第三天发客户见证，没回？第七天发折扣优惠。一次设置，全套跟进，只要客户回复，序列立刻停止。</li>
  <li><strong>真实打开率追踪：</strong> 谁点开了你的链接？几点点开的？看了几次？后台数据清清楚楚，他在看你的瞬间，你就可以打电话过去。</li>
</ul>

<h2>2. 📱 社媒获客：多条腿走路</h2>
<p>只靠邮件早就不够了。系统集成了 WhatsApp、TikTok、LinkedIn 和 Facebook。</p>
<ul>
  <li><strong>WhatsApp：</strong> 支持官方 API 与网页版协议。直接发消息，不封号，高送达。</li>
  <li><strong>LinkedIn：</strong> 自动搜大企业高管，自动加好友，自动发私信。</li>
  <li>把社媒的散客，全部统一抓回 CRM 变成正规的 B2B 资产。</li>
</ul>

<h2>3. 🔥 矩阵任务中心：一个人就是一家公司</h2>
<p>这是整套系统最暴力的“印钞机”引擎，专给想做大规模业务的老板准备。</p>
<div class="highlight">
  <p><strong>小白级一键采集与群控：</strong></p>
  <p>不需要你懂爬虫。你只要在系统里建立一个任务：“给我搜索阿联酋地区所有带 'electric' 和 'trading' 字样的公司”。系统底层会并发调动 10 个浏览器，日夜不停地去地图和黄页上采集名字、提取官网、扒出老板邮箱，甚至自动发开发信。**这就是“一个人顶一个工作室”的秘密。**</p>
</div>

<h1>五、 增长黑客与基础保障</h1>

<h2>1. 🎬 视频与 SEO：免费流量的收割机</h2>
<p><strong>短视频获客：</strong> 不懂剪辑？没关系。在视频工坊，选一张产品图，AI 自动帮你配文案、配语音、配数字人出镜，一键生成几十条带货短视频，供你发到 TikTok 和 YouTube 矩阵。</p>
<p><strong>SEO 工具：</strong> 系统自动监控你的独立站健康度，告诉你客户都在搜什么词，帮你写博客文章，抢占谷歌首页免费流量。</p>

<h2>2. 🛡️ 环境管理：你的防封号金钟罩</h2>
<p>如果你玩社媒矩阵和批量邮件，肯定最怕“封号”。这里的“环境管理”是系统的隐形护城河。</p>
<ul>
  <li><strong>指纹浏览器隔离：</strong> 什么是防封？系统底层对接了高级指纹浏览器。你可以在系统里同时挂 5 个 WhatsApp 账号。系统会给它们分配不同的“虚拟电脑”（指纹）和不同国家的“虚拟网线”（代理 IP）。</li>
  <li>在 TikTok 和 Facebook 的安全算法看来，这完全是 5 个分布在世界各地的真人在玩手机。你的账号资产极其安全。</li>
</ul>

<h2>3. 🔧 渠道与设置：最忠诚的底层保镖</h2>
<p>这里有大量傻瓜式、一键式的保障工具，没有技术背景也能用：</p>
<ul>
  <li><strong>自动预热养号：</strong> 刚买的企业邮箱直接群发必死。系统提供自动“互相发邮件聊天”的功能，帮你把新邮箱的权重养高。</li>
  <li><strong>垃圾词安检：</strong> 写完的邮件，系统像安检员一样扫描一遍，提醒你“这个词容易进垃圾箱，建议替换”。</li>
  <li><strong>域名合规认证：</strong> 一键检测你的 SPF/DKIM 等高级域名配置是否合格，确保你发出去的信不被谷歌和微软拒收。</li>
</ul>

<hr>
<div style="text-align: center; color: #7f8c8d; margin-top: 50px;">
  <p>通过这五大核心板块，VIPB AI System V2 完成了对传统外贸的降维打击。</p>
  <p><strong>技术藏在底层，傻瓜式的商业变现在眼前。</strong>祝您签单顺利！</p>
</div>

</body>
</html>
`;

fs.writeFileSync('D:\\VIPB-AI-System-User-Manual.html', manualContent, 'utf8');
console.log('Done! 完美版产品说明书生成。');
