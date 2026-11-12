/**
 * 退订页面路由（公开访问，不需要登录）
 * 只加不改 — 新路由
 */
const router = require('express').Router();

module.exports = function(db) {
  const { UnsubscribeManager } = require('../src/unsubscribe-manager');
  const unsubMgr = new UnsubscribeManager(db);

  // GET /unsubscribe?email=xxx&token=xxx — 显示退订页面
  router.get('/unsubscribe', (req, res) => {
    const { email, token } = req.query;
    res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribe | VIPB</title>
<style>body{font-family:Arial,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}
.card{background:#fff;padding:40px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1);max-width:500px;text-align:center}
.btn{display:inline-block;padding:12px 30px;border:none;border-radius:5px;font-size:16px;cursor:pointer;margin:5px}
.btn-unsub{background:#dc3545;color:#fff}.btn-cancel{background:#6c757d;color:#fff}
.success{color:#28a745;font-size:24px}
textarea{width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;resize:vertical;margin:10px 0}
</style></head><body>
<div class="card" id="unsub-form">
  <h2>📧 Email Unsubscribe</h2>
  <p>Email: <strong>${email||''}</strong></p>
  <p>Are you sure you want to unsubscribe from our mailing list?</p>
  <textarea id="reason" rows="3" placeholder="Reason for unsubscribing (optional)"></textarea>
  <div>
    <button class="btn btn-unsub" onclick="doUnsub()">Yes, Unsubscribe</button>
    <button class="btn btn-cancel" onclick="window.close()">Cancel</button>
  </div>
</div>
<div class="card" id="unsub-done" style="display:none">
  <div class="success">✅</div>
  <h2>Successfully Unsubscribed</h2>
  <p>You have been removed from our mailing list.</p>
  <p><small>If this was a mistake, please contact us.</small></p>
</div>
<script>
async function doUnsub(){
  const reason = document.getElementById('reason').value;
  const res = await fetch('/unsubscribe', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({email:'${(email||'').replace(/'/g,"\\'")}',token:'${(token||'').replace(/'/g,"\\'")}',reason})
  });
  const data = await res.json();
  if(data.success){
    document.getElementById('unsub-form').style.display='none';
    document.getElementById('unsub-done').style.display='';
  } else { alert(data.error||'Failed'); }
}
</script></body></html>`);
  });

  // POST /unsubscribe — 处理退订
  router.post('/unsubscribe', (req, res) => {
    const { email, token, reason } = req.body;
    if (!email || !token) return res.status(400).json({ success: false, error: 'missing parameters' });
    const result = unsubMgr.unsubscribe(email, token, reason);
    res.json(result);
  });

  return router;
};
