require('dotenv').config();
const axios = require('axios');
const db = require('better-sqlite3')('./data/vipb.db');
const { decrypt } = require('./src/crypto-utils');

const row = db.prepare("SELECT value FROM settings WHERE key='ai_providers'").get();
const data = JSON.parse(row.value);
const v = data.vision[0];
const apiKey = decrypt(v.apiKey);

const url = `${v.baseUrl.replace(/\/+$/, '')}/v1beta/models/${v.model}:generateContent`;

// 测试1: 简单英文prompt（之前成功的）
async function test1() {
  console.log('Test 1: 简单英文...');
  const resp = await axios.post(url, {
    contents: [{ role: 'user', parts: [{ text: 'Generate a simple blue product flyer for a smart meter' }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '2K' } }
  }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 180000 });
  console.log('✅ 成功, candidates:', resp.data?.candidates?.length);
}

// 测试2: 带中文的长prompt（模拟实际场景）
async function test2() {
  console.log('\nTest 2: 带中文长prompt...');
  const prompt = `公司信息：公司英文名: Wenzhou Xingyuan Holding Co., Ltd., 网站: www.chinavipb.com

基于以下产品信息，生成一张非洲市场风格的A4竖版产品宣传单图片。产品名称：单相预付费卡表，产品描述：一表一卡功能特点：应用计算机管理，先购电后用电。设计要求：深蓝+金黄色配色，产品图居中，底部联系方式 WhatsApp: [Your WhatsApp Number]`;
  
  console.log('Prompt长度:', prompt.length);
  const resp = await axios.post(url, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '2K' } }
  }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 180000 });
  console.log('✅ 成功, candidates:', resp.data?.candidates?.length);
}

// 测试3: 带system message的完整messages数组（模拟_aiGenerate）
async function test3() {
  console.log('\nTest 3: 完整messages数组（模拟_aiGenerate）...');
  const prompt = `基于以下产品信息，生成一张非洲市场风格的A4竖版产品宣传单图片。产品名称：单相预付费卡表 DDSY2361。设计要求：深蓝+金黄色配色`;
  
  // 这是_aiGenerate实际构造的messages
  const messages = [
    { role: 'system', content: '你是VIPB AI系统的视觉设计师。请根据要求完成任务。' },
    { role: 'user', content: prompt }
  ];
  
  // 模拟Gemini分支的处理
  const userMsgs = messages.filter(m => m.role === 'user');
  const userMsg = userMsgs[userMsgs.length - 1];
  const finalPrompt = userMsg.content;
  
  console.log('Final prompt:', finalPrompt.substring(0, 100));
  const resp = await axios.post(url, {
    contents: [{ role: 'user', parts: [{ text: finalPrompt }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '2K' } }
  }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 180000 });
  console.log('✅ 成功, candidates:', resp.data?.candidates?.length);
}

async function main() {
  try { await test1(); } catch(e) { console.error('❌', e.response?.status, JSON.stringify(e.response?.data).substring(0,300)); }
  try { await test2(); } catch(e) { console.error('❌', e.response?.status, JSON.stringify(e.response?.data).substring(0,300)); }
  try { await test3(); } catch(e) { console.error('❌', e.response?.status, JSON.stringify(e.response?.data).substring(0,300)); }
}

main().then(() => process.exit(0));
