/**
 * 初始化AI Router的能力和任务映射
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function initMappings() {
  console.log('🚀 开始初始化AI能力和任务映射...');
  
  const SQL = await initSqlJs();
  const dbPath = path.join(__dirname, 'data/vipb.db');
  const buffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(buffer);
  
  // 1. 添加AI能力配置
  console.log('📝 添加AI能力配置...');
  
  const capabilities = [
    {
      name: '邮件生成',
      type: 'text-generation',
      description: '生成营销邮件主题和内容',
      primary_provider_id: 1, // 使用第一个提供商
      quality_mode: 'standard',
      max_cost_per_call: 0.05,
      daily_budget: 10.00
    },
    {
      name: '视频脚本生成',
      type: 'text-generation',
      description: '生成产品视频脚本',
      primary_provider_id: 1,
      quality_mode: 'standard',
      max_cost_per_call: 0.08,
      daily_budget: 15.00
    },
    {
      name: '询盘回复生成',
      type: 'text-generation',
      description: '生成客户询盘回复',
      primary_provider_id: 1,
      quality_mode: 'standard',
      max_cost_per_call: 0.05,
      daily_budget: 10.00
    },
    {
      name: '产品描述生成',
      type: 'text-generation',
      description: '生成产品描述和SEO内容',
      primary_provider_id: 1,
      quality_mode: 'standard',
      max_cost_per_call: 0.05,
      daily_budget: 10.00
    }
  ];
  
  capabilities.forEach(cap => {
    db.run(
      `INSERT INTO ai_capabilities (capability_name, capability_type, description, primary_provider_id, quality_mode, max_cost_per_call, daily_budget) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [cap.name, cap.type, cap.description, cap.primary_provider_id, cap.quality_mode, cap.max_cost_per_call, cap.daily_budget]
    );
  });
  
  console.log(`✅ 已添加 ${capabilities.length} 个AI能力`);
  
  // 2. 添加任务映射
  console.log('📝 添加任务映射...');
  
  const mappings = [
    // 邮件模块
    { module: 'email', task: '生成邮件主题', capability_id: 1, prompt: '请为以下产品生成一个吸引人的营销邮件主题：\n\n产品名称：{product_name}\n客户类型：{customer_type}\n营销目标：{campaign_goal}\n\n要求：\n1. 主题要简洁有力，不超过50个字符\n2. 突出产品优势\n3. 适合B2B外贸场景\n4. 使用英文\n\n只返回邮件主题，不要其他内容。' },
    { module: 'email', task: '生成邮件内容', capability_id: 1, prompt: '请为以下产品生成一封专业的营销邮件正文：\n\n产品名称：{product_name}\n邮件主题：{subject}\n客户类型：{customer_type}\n\n要求：\n1. 使用专业的商务英语\n2. 包含产品优势介绍\n3. 包含行动号召（CTA）\n4. 长度约200-300词\n5. 使用变量 {company_name} 和 {contact_person} 实现个性化\n\n只返回邮件正文，不要主题。' },
    
    // 视频模块
    { module: 'video', task: '生成视频脚本', capability_id: 2, prompt: '请为以下产品生成一个{duration}秒的TikTok/Facebook视频脚本：\n\n产品名称：{product_name}\n产品特点：{product_features}\n目标市场：{target_market}\n\n要求：\n1. 分为多个场景，每个场景约5秒\n2. 每个场景包含：场景描述 + 文案（英文）\n3. 文案要简短有力，适合外贸营销\n4. 突出产品优势和公司实力\n5. 最后一个场景要有行动号召（CTA）\n\n请按以下格式输出：\n场景1 (5秒): [场景描述]\n文案: "[英文文案]"\n\n场景2 (5秒): [场景描述]\n文案: "[英文文案]"\n...' },
    
    // 询盘模块
    { module: 'inquiry', task: '生成询盘回复', capability_id: 3, prompt: '请为以下客户询盘生成一封专业的回复邮件：\n\n客户姓名：{customer_name}\n客户国家：{customer_country}\n询盘内容：{inquiry_content}\n公司名称：{company_name}\n\n要求：\n1. 使用专业的商务英语\n2. 感谢客户询盘\n3. 简要介绍公司和产品优势\n4. 表达合作意愿\n5. 提供联系方式\n6. 长度约150-200词\n\n只返回邮件正文。' },
    { module: 'inquiry', task: '生成报价单', capability_id: 3, prompt: '请为以下客户生成一份专业的报价单内容：\n\n客户姓名：{customer_name}\n客户国家：{customer_country}\n产品信息：{products}\n贸易条款：{trade_term}\n付款条款：{payment_term}\n\n要求：\n1. 使用专业的商务英语\n2. 包含报价单标题\n3. 包含产品明细、数量、单价、总价\n4. 包含贸易条款和付款条款说明\n5. 包含有效期和备注\n6. 格式清晰专业\n\n返回完整的报价单内容。' },
    
    // 产品模块
    { module: 'product', task: '生成产品描述', capability_id: 4, prompt: '请为以下产品生成一份专业的产品描述：\n\n产品名称：{product_name}\n产品分类：{category}\n产品特点：{features}\n产品规格：{specifications}\n\n要求：\n1. 使用专业的英文\n2. 包含产品概述（2-3句话）\n3. 列出主要特点和优势\n4. 包含技术规格\n5. 包含应用场景\n6. 适合B2B外贸网站使用\n7. 长度约300-400词\n\n返回完整的产品描述。' }
  ];
  
  mappings.forEach(map => {
    db.run(
      `INSERT INTO module_task_mappings (module_name, task_name, capability_id, custom_prompt) 
       VALUES (?, ?, ?, ?)`,
      [map.module, map.task, map.capability_id, map.prompt]
    );
  });
  
  console.log(`✅ 已添加 ${mappings.length} 个任务映射`);
  
  // 保存数据库
  const data = db.export();
  fs.writeFileSync(dbPath, data);
  
  console.log('✅ 数据库已保存');
  console.log('🎉 初始化完成！');
  
  // 验证
  const capResult = db.exec('SELECT COUNT(*) as count FROM ai_capabilities');
  const mapResult = db.exec('SELECT COUNT(*) as count FROM module_task_mappings');
  
  console.log(`\n📊 验证结果：`);
  console.log(`   AI能力数量: ${capResult[0].values[0][0]}`);
  console.log(`   任务映射数量: ${mapResult[0].values[0][0]}`);
}

initMappings().catch(console.error);
