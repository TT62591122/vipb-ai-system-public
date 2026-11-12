/**
 * VIPB Chat Widget - 嵌入式客服组件
 */
(function() {
  var config = window.VIPBWidget || {};
  var serverUrl = config.serverUrl || '';
  var siteId = config.siteId || '';
  var visitorId = localStorage.getItem('vipb_visitor_id') || 'visitor_' + Date.now() + '_' + Math.random().toString(36).substr(2,6);
  localStorage.setItem('vipb_visitor_id', visitorId);

  // 创建样式
  var style = document.createElement('style');
  style.textContent = `
    #vipb-widget-btn{position:fixed;bottom:20px;right:20px;width:60px;height:60px;border-radius:50%;background:#667eea;color:#fff;border:none;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.3);font-size:24px;z-index:99999;transition:transform .2s}
    #vipb-widget-btn:hover{transform:scale(1.1)}
    #vipb-widget-box{position:fixed;bottom:90px;right:20px;width:360px;height:500px;background:#fff;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,0.2);z-index:99999;display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,sans-serif}
    #vipb-widget-box.open{display:flex}
    .vipb-header{background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:16px;display:flex;align-items:center;gap:10px}
    .vipb-header h4{margin:0;font-size:16px;font-weight:600}
    .vipb-header small{opacity:0.8;font-size:12px}
    .vipb-close{background:none;border:none;color:#fff;font-size:20px;cursor:pointer;margin-left:auto}
    .vipb-messages{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
    .vipb-msg{max-width:80%;padding:8px 12px;border-radius:12px;font-size:14px;line-height:1.4;word-wrap:break-word}
    .vipb-msg.in{background:#f0f0f0;align-self:flex-start;border-bottom-left-radius:4px}
    .vipb-msg.out{background:#667eea;color:#fff;align-self:flex-end;border-bottom-right-radius:4px}
    .vipb-input{display:flex;padding:8px;border-top:1px solid #eee;gap:8px}
    .vipb-input input{flex:1;border:1px solid #ddd;border-radius:20px;padding:8px 16px;font-size:14px;outline:none}
    .vipb-input input:focus{border-color:#667eea}
    .vipb-input button{background:#667eea;color:#fff;border:none;border-radius:20px;padding:8px 16px;cursor:pointer;font-size:14px}
  `;
  document.head.appendChild(style);

  // 创建按钮
  var btn = document.createElement('button');
  btn.id = 'vipb-widget-btn';
  btn.innerHTML = '💬';
  document.body.appendChild(btn);

  // 创建聊天框
  var box = document.createElement('div');
  box.id = 'vipb-widget-box';
  box.innerHTML = '<div class="vipb-header"><div><h4>Chat with us</h4><small>We usually reply instantly</small></div><button class="vipb-close">&times;</button></div><div class="vipb-messages" id="vipb-msgs"></div><div class="vipb-input"><input id="vipb-inp" placeholder="Type a message..." /><button id="vipb-send">Send</button></div>';
  document.body.appendChild(box);

  var msgsEl = document.getElementById('vipb-msgs');
  var inpEl = document.getElementById('vipb-inp');

  btn.onclick = function() { box.classList.toggle('open'); };
  box.querySelector('.vipb-close').onclick = function() { box.classList.remove('open'); };

  function addMsg(text, dir) {
    var el = document.createElement('div');
    el.className = 'vipb-msg ' + dir;
    el.textContent = text;
    msgsEl.appendChild(el);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  document.getElementById('vipb-send').onclick = sendMsg;
  inpEl.onkeypress = function(e) { if(e.key==='Enter') sendMsg(); };

  function sendMsg() {
    var text = inpEl.value.trim();
    if (!text) return;
    addMsg(text, 'out');
    inpEl.value = '';

    fetch(serverUrl + '/api/widget/message', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ site_id: siteId, visitor_id: visitorId, message: text })
    }).then(function(r){return r.json()}).then(function(data){
      if (data.auto_reply) addMsg(data.auto_reply, 'in');
    }).catch(function(){});
  }

  // 加载历史
  fetch(serverUrl + '/api/widget/messages?site_id=' + siteId + '&visitor_id=' + visitorId)
    .then(function(r){return r.json()})
    .then(function(data){
      (data.messages||[]).forEach(function(m){
        addMsg(m.content, m.direction === 'inbound' ? 'out' : 'in');
      });
    }).catch(function(){});
})();
