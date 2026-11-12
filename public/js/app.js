/**
 * VIPB AI System V2 — 前端JS（增强版）
 * - AI结果Markdown渲染
 * - 友好的错误提示
 * - Loading状态管理
 */

// ========== Tab 持久化（全局） ==========
// 通过 URL hash 记住当前 tab，刷新后自动恢复
(function() {
  const hash = window.location.hash;
  if (hash) {
    const tab = document.querySelector('.nav-tabs a[href="' + hash + '"], .nav-pills a[href="' + hash + '"]');
    if (tab) {
      document.querySelectorAll('.nav-tabs .nav-link, .nav-pills .nav-link').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('show', 'active'));
      tab.classList.add('active');
      const pane = document.querySelector(hash);
      if (pane) pane.classList.add('show', 'active');
    }
  }
  document.querySelectorAll('.nav-tabs a[data-bs-toggle="tab"], .nav-pills a[data-bs-toggle="tab"], .nav-pills a[data-bs-toggle="pill"]').forEach(t => {
    t.addEventListener('shown.bs.tab', function(e) {
      history.replaceState(null, '', e.target.getAttribute('href'));
    });
  });
})();

/** 刷新页面并保持当前 tab */
function reloadKeepTab() {
  const activeTab = document.querySelector('.nav-tabs .nav-link.active, .nav-pills .nav-link.active');
  if (activeTab) {
    const href = activeTab.getAttribute('href');
    if (href && href.startsWith('#')) history.replaceState(null, '', href);
  }
  location.reload();
}

// API Helper
async function api(url, method = 'GET', data = null) {
  try {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (data) opts.body = JSON.stringify(data);
    const res = await fetch(url, opts);
    if (res.status === 401) {
      window.location.href = '/login';
      return { success: false, error: '登录已过期' };
    }
    return res.json();
  } catch (err) {
    return { success: false, error: '网络错误: ' + err.message };
  }
}

// Toast通知
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `alert alert-${type} position-fixed top-0 end-0 m-3 shadow`;
  el.style.zIndex = '9999';
  el.style.maxWidth = '400px';
  el.style.animation = 'fadeIn 0.3s ease';
  el.innerHTML = msg;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// 简易Markdown渲染
function renderMarkdown(text) {
  if (!text) return '';
  return text
    // 代码块
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-dark text-light p-2 rounded"><code>$2</code></pre>')
    // 行内代码
    .replace(/`([^`]+)`/g, '<code class="bg-dark text-light px-1 rounded">$1</code>')
    // 标题
    .replace(/^### (.+)$/gm, '<h6 class="mt-2 mb-1"><strong>$1</strong></h6>')
    .replace(/^## (.+)$/gm, '<h5 class="mt-3 mb-1"><strong>$1</strong></h5>')
    .replace(/^# (.+)$/gm, '<h4 class="mt-3 mb-2"><strong>$1</strong></h4>')
    // 加粗
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // 斜体
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // 有序列表
    .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
    // 无序列表
    .replace(/^[-•]\s+(.+)$/gm, '<li>$1</li>')
    // 分隔线
    .replace(/^---$/gm, '<hr>')
    // 换行
    .replace(/\n/g, '<br>');
}

// AI结果显示 - 格式化输出
function showAIResult(containerId, result) {
  const box = document.getElementById(containerId);
  if (!box) return;

  if (result.success) {
    const cachedBadge = result.cached ? '<span class="badge bg-secondary ms-2">缓存</span>' : '';
    box.innerHTML = `
      <div class="ai-chat-box">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <strong>${result.icon || '🤖'} ${result.agentName || 'AI助手'}${cachedBadge}</strong>
          <button class="btn btn-sm btn-outline-secondary" onclick="copyAIResult(this)" title="复制">📋</button>
        </div>
        <div class="ai-result-content">${renderMarkdown(result.result)}</div>
        <div class="ai-result-raw" style="display:none">${result.result}</div>
      </div>`;
  } else {
    let errorHtml = result.error || '未知错误';
    if (result.needConfig) {
      errorHtml += '<br><a href="/settings" class="btn btn-sm btn-purple mt-2">→ 前往设置配置AI Provider</a>';
    }
    box.innerHTML = `<div class="alert alert-warning">${errorHtml}</div>`;
  }
}

// 复制AI结果
function copyAIResult(btn) {
  const container = btn.closest('.ai-chat-box');
  const raw = container.querySelector('.ai-result-raw');
  if (raw) {
    navigator.clipboard.writeText(raw.textContent).then(() => {
      btn.textContent = '✅';
      setTimeout(() => btn.textContent = '📋', 2000);
    });
  }
}

// Loading状态
function setLoading(elementId, loading, text = 'AI分析中...') {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (loading) {
    el._originalHTML = el.innerHTML;
    el.innerHTML = `<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-purple"></div> ${text}</div>`;
  } else if (el._originalHTML) {
    el.innerHTML = el._originalHTML;
  }
}

function setBtnLoading(btnId, loading, originalText) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  if (loading) {
    btn._origText = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 处理中...';
  } else {
    btn.disabled = false;
    btn.textContent = originalText || btn._origText || '完成';
  }
}

// === Dashboard ===
async function getAISuggestions() {
  setBtnLoading('btn-ai-suggest', true);
  setLoading('ai-suggestions', true, '🤖 AI正在分析业务数据，生成工作建议...');
  
  const res = await api('/api/ai/dashboard-suggestions', 'POST');
  showAIResult('ai-suggestions', res);
  setBtnLoading('btn-ai-suggest', false, '🤖 AI工作建议');
}

// === CRM ===
async function addCustomer() {
  const form = document.getElementById('customer-form');
  if (!form) return;
  const data = Object.fromEntries(new FormData(form));
  const res = await api('/api/customers', 'POST', data);
  if (res.success) { toast('客户已添加'); location.reload(); }
  else toast(res.error || '添加失败', 'danger');
}

async function loadCustomerDetail(id) {
  const res = await api(`/api/customers/${id}`);
  const box = document.getElementById('customer-detail');
  if (!box) return;
  box.innerHTML = `
    <h5>${res.company || '未知公司'}</h5>
    <p><strong>联系人:</strong> ${res.contact_name || '-'} | <strong>邮箱:</strong> ${res.email || '-'}</p>
    <p><strong>国家:</strong> ${res.country || '-'} | <strong>来源:</strong> ${res.source || '-'} | <strong>评分:</strong> ${res.lead_score || 0}</p>
    <hr>
    <h6>询盘 (${(res.inquiries||[]).length})</h6>
    ${(res.inquiries||[]).map(i => `<div class="kanban-card"><strong>${i.subject}</strong><br><small>${i.product} - ${i.quantity}</small></div>`).join('')}
    <h6 class="mt-3">交易 (${(res.deals||[]).length})</h6>
    ${(res.deals||[]).map(d => `<div class="kanban-card"><strong>${d.title}</strong><br><small>$${d.amount} - ${d.stage}</small></div>`).join('')}
  `;
}

// === Trade: Drag & Drop ===
function initKanban() {
  document.querySelectorAll('.kanban-card[draggable]').forEach(card => {
    card.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', card.dataset.id); });
  });
  document.querySelectorAll('.kanban-column').forEach(col => {
    col.addEventListener('dragover', e => e.preventDefault());
    col.addEventListener('drop', async e => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      const stage = col.dataset.stage;
      await api(`/api/trade/deals/${id}/stage`, 'PUT', { stage });
      toast(`交易已移至 ${stage}`);
      location.reload();
    });
  });
}

// === AI Chat (CRM页面) ===
async function aiChat(agent) {
  const input = document.getElementById('ai-input');
  const output = document.getElementById('ai-output');
  if (!input || !output) return;
  const msg = input.value.trim();
  if (!msg) { toast('请输入消息', 'warning'); return; }

  setLoading('ai-output', true, '🤖 AI思考中...');
  const res = await api('/api/ai/chat', 'POST', { agent: agent || 'sales', message: msg });
  showAIResult('ai-output', res);
}

// === Settings ===
async function saveAIProvider() {
  const form = document.getElementById('ai-provider-form');
  if (!form) return;
  const data = Object.fromEntries(new FormData(form));
  
  // 基本验证
  if (!data.baseUrl) {
    toast('请输入API Base URL', 'warning');
    return;
  }
  if (!data.apiKey) {
    toast('请输入API Key', 'warning');
    return;
  }
  
  const res = await api('/api/settings/ai-provider', 'POST', data);
  if (res.success) toast('AI Provider已保存 ✅');
  else toast(res.error || '保存失败', 'danger');
}

async function testAIConnection() {
  const btn = document.getElementById('btn-test-ai');
  const status = document.getElementById('ai-test-status');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 测试中...'; }
  if (status) status.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 正在连接AI服务...';
  
  const res = await api('/api/ai/test-connection', 'POST');
  if (res.success) {
    if (status) status.innerHTML = '<span class="text-success">✅ 连接成功！AI服务正常</span>';
    toast('AI连接测试成功 ✅');
  } else {
    if (status) status.innerHTML = `<span class="text-danger">❌ ${res.error}</span>`;
    toast('连接失败: ' + res.error, 'danger');
  }
  if (btn) { btn.disabled = false; btn.textContent = '🔗 测试连接'; }
}

async function saveCompanyInfo() {
  const form = document.getElementById('company-form');
  if (!form) return;
  const data = Object.fromEntries(new FormData(form));
  const res = await api('/api/settings/company', 'POST', data);
  if (res.success) toast('公司信息已保存 ✅');
  else toast(res.error || '保存失败', 'danger');
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  initKanban();
});
