/**
 * 渠道工具 API
 * 统一暴露：邮箱验证、垃圾词检测、意图识别、待办管理、报价跟踪
 */
const router = require('express').Router();

module.exports = function(db) {
  const { EmailVerifier } = require('../src/email-verifier');
  const { SpamDetector } = require('../src/spam-detector');
  const { IntentDetector } = require('../src/intent-detector');
  const { PendingActions } = require('../src/pending-actions');
  const { QuoteTracker } = require('../src/quote-tracker');

  const verifier = new EmailVerifier(db);
  const spamDetector = new SpamDetector();
  const intentDetector = new IntentDetector(db);
  const pendingActions = new PendingActions(db);
  const quoteTracker = new QuoteTracker(db);

  // ==================== 邮箱验证 ====================
  router.post('/verify-email', async (req, res) => {
    try {
      const { email, skipSmtp } = req.body;
      if (!email) return res.status(400).json({ success: false, error: '缺少email参数' });
      const result = await verifier.verify(email, { skipSmtp: !!skipSmtp });
      res.json({ success: true, data: result });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  router.post('/verify-email/batch', async (req, res) => {
    try {
      const { emails, skipSmtp } = req.body;
      if (!emails || !Array.isArray(emails)) return res.status(400).json({ success: false, error: '缺少emails数组' });
      const results = await verifier.batchVerify(emails.slice(0, 100), { skipSmtp: !!skipSmtp });
      res.json({ success: true, data: results });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==================== 垃圾词检测 ====================
  router.post('/spam-check', (req, res) => {
    try {
      const { subject, body } = req.body;
      const result = spamDetector.analyze(subject, body);
      res.json({ success: true, data: result });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==================== 意图识别 ====================
  router.post('/detect-intent', (req, res) => {
    try {
      const { text, channel, sourceId, customerId, customerEmail } = req.body;
      if (!text) return res.status(400).json({ success: false, error: '缺少text参数' });
      const result = intentDetector.detect(text, { channel, sourceId, customerId, customerEmail });
      res.json({ success: true, data: result });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  router.get('/intents/pending', (req, res) => {
    const data = intentDetector.getPendingPricingIntents(parseInt(req.query.limit) || 50);
    res.json({ success: true, data });
  });

  // ==================== 待办管理 ====================
  router.get('/pending-actions', (req, res) => {
    const data = pendingActions.getPending({
      type: req.query.type,
      priority: req.query.priority,
      channel: req.query.channel,
      limit: parseInt(req.query.limit) || 100
    });
    res.json({ success: true, data });
  });

  router.get('/pending-actions/stats', (req, res) => {
    res.json({ success: true, data: pendingActions.getStats() });
  });

  router.post('/pending-actions/:id/resolve', (req, res) => {
    pendingActions.resolve(parseInt(req.params.id), req.body.handledBy || 'admin', req.body.notes || '');
    res.json({ success: true });
  });

  router.post('/pending-actions/:id/dismiss', (req, res) => {
    pendingActions.dismiss(parseInt(req.params.id), req.body.reason || '');
    res.json({ success: true });
  });

  router.get('/pending-actions/escalation', (req, res) => {
    const data = pendingActions.getEscalationDue();
    res.json({ success: true, data });
  });

  // ==================== 报价跟踪 ====================
  router.get('/quotes', (req, res) => {
    const data = quoteTracker.list({
      status: req.query.status,
      channel: req.query.channel,
      customerId: req.query.customer_id ? parseInt(req.query.customer_id) : null,
      limit: parseInt(req.query.limit) || 50
    });
    res.json({ success: true, data });
  });

  router.post('/quotes', (req, res) => {
    try {
      const id = quoteTracker.create(req.body);
      res.json({ success: true, data: { id } });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  router.put('/quotes/:id/status', (req, res) => {
    quoteTracker.updateStatus(parseInt(req.params.id), req.body.status, req.body.reason || '');
    res.json({ success: true });
  });

  router.post('/quotes/:id/followup', (req, res) => {
    quoteTracker.markFollowedUp(parseInt(req.params.id));
    res.json({ success: true });
  });

  router.get('/quotes/need-followup', (req, res) => {
    const data = quoteTracker.getNeedFollowUp(parseInt(req.query.days) || 3);
    res.json({ success: true, data });
  });

  router.get('/quotes/expiring', (req, res) => {
    const data = quoteTracker.getExpiring(parseInt(req.query.days) || 7);
    res.json({ success: true, data });
  });

  router.get('/quotes/stats', (req, res) => {
    const data = quoteTracker.getStats(req.query.period || '30d');
    res.json({ success: true, data });
  });

  // ==================== 多渠道序列 ====================
  const { MultichannelSequence } = require('../src/multichannel-sequence');
  const sequenceEngine = new MultichannelSequence(db);

  router.get('/sequences', (req, res) => {
    res.json({ success: true, data: sequenceEngine.listSequences() });
  });

  router.post('/sequences', (req, res) => {
    try {
      const id = sequenceEngine.createSequence(req.body.name, req.body.description, req.body.steps);
      res.json({ success: true, data: { id } });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  router.post('/sequences/enroll', (req, res) => {
    try {
      const result = sequenceEngine.enroll(req.body.sequenceId, req.body.customer, req.body.variables);
      res.json(result);
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  router.get('/sequences/due', (req, res) => {
    res.json({ success: true, data: sequenceEngine.getDueSteps() });
  });

  router.post('/sequences/enrollments/:id/execute', async (req, res) => {
    try {
      await sequenceEngine.executeStep(parseInt(req.params.id), req.body.result || {});
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  router.post('/sequences/enrollments/:id/pause', (req, res) => {
    sequenceEngine.pause(parseInt(req.params.id), req.body.reason);
    res.json({ success: true });
  });

  router.post('/sequences/enrollments/:id/resume', (req, res) => {
    sequenceEngine.resume(parseInt(req.params.id));
    res.json({ success: true });
  });

  router.post('/sequences/enrollments/:id/cancel', (req, res) => {
    sequenceEngine.cancel(parseInt(req.params.id));
    res.json({ success: true });
  });

  router.get('/sequences/enrollments', (req, res) => {
    const data = sequenceEngine.listEnrollments({
      status: req.query.status,
      sequenceId: req.query.sequence_id ? parseInt(req.query.sequence_id) : null,
      limit: parseInt(req.query.limit) || 50
    });
    res.json({ success: true, data });
  });

  router.get('/sequences/stats', (req, res) => {
    res.json({ success: true, data: sequenceEngine.getStats() });
  });

  // ==================== 邮件预热 ====================
  const { WarmupEngine } = require('../src/warmup-engine');
  const warmupEngine = new WarmupEngine(db);

  router.post('/warmup/enable', (req, res) => {
    warmupEngine.enable(parseInt(req.body.accountId), req.body.partnerEmail);
    res.json({ success: true });
  });

  router.post('/warmup/disable', (req, res) => {
    warmupEngine.disable(parseInt(req.body.accountId));
    res.json({ success: true });
  });

  router.get('/warmup/status/:accountId', (req, res) => {
    const data = warmupEngine.getStatus(parseInt(req.params.accountId));
    res.json({ success: true, data });
  });

  router.post('/warmup/run', async (req, res) => {
    try {
      const results = await warmupEngine.runWarmup();
      res.json({ success: true, data: results });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  router.get('/warmup/stats/:accountId', (req, res) => {
    const data = warmupEngine.getStats(parseInt(req.params.accountId), parseInt(req.query.days) || 14);
    res.json({ success: true, data });
  });

  // --- 前端UI用的额外预热端点 ---
  router.get('/warmup/configs', (req, res) => {
    try {
      const configs = db.prepare(`
        SELECT wc.*, ea.email as account_email 
        FROM email_warmup_config wc 
        LEFT JOIN email_accounts ea ON wc.account_id = ea.id
        ORDER BY wc.account_id
      `).all();
      res.json({ success: true, data: configs });
    } catch(e) { res.json({ success: true, data: [] }); }
  });

  router.post('/warmup/start', (req, res) => {
    try {
      const { account_id, partner_email } = req.body;
      if (!account_id) return res.status(400).json({ success: false, error: '缺少account_id' });
      warmupEngine.enable(account_id, partner_email);
      res.json({ success: true });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
  });

  router.post('/warmup/:accountId/stop', (req, res) => {
    warmupEngine.disable(parseInt(req.params.accountId));
    res.json({ success: true });
  });

  router.post('/warmup/:accountId/start', (req, res) => {
    warmupEngine.enable(parseInt(req.params.accountId));
    res.json({ success: true });
  });

  router.get('/warmup/logs', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 30;
      const logs = db.prepare(`SELECT * FROM email_warmup_log ORDER BY sent_at DESC LIMIT ?`).all(limit);
      res.json({ success: true, data: logs });
    } catch(e) { res.json({ success: true, data: [] }); }
  });

  // --- 前端UI用的额外序列端点 ---
  router.post('/sequences/:id/enroll', (req, res) => {
    try {
      const result = sequenceEngine.enroll(parseInt(req.params.id), { email: req.body.customer_email }, req.body.variables);
      res.json(result);
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
  });

  router.get('/sequences/logs', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 20;
      const logs = db.prepare(`SELECT * FROM sequence_step_log ORDER BY executed_at DESC LIMIT ?`).all(limit);
      res.json({ success: true, data: logs });
    } catch(e) { res.json({ success: true, data: [] }); }
  });

  // ==================== SPF/DKIM/DMARC 检测 ====================
  const { DomainAuthChecker } = require('../src/domain-auth-checker');
  const authChecker = new DomainAuthChecker();

  router.post('/check-domain-auth', async (req, res) => {
    try {
      const { domain } = req.body;
      if (!domain) return res.status(400).json({ success: false, error: '缺少domain参数' });
      const result = await authChecker.check(domain);
      res.json({ success: true, data: result });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // ==================== 退订管理 ====================
  const { UnsubscribeManager } = require('../src/unsubscribe-manager');
  const unsubMgr = new UnsubscribeManager(db, { baseUrl: 'http://localhost:3001' });

  router.get('/unsubscribes', (req, res) => {
    res.json({ success: true, data: unsubMgr.list(parseInt(req.query.limit) || 100) });
  });

  router.post('/unsubscribes/check', (req, res) => {
    const { email } = req.body;
    res.json({ success: true, data: { unsubscribed: unsubMgr.isUnsubscribed(email) } });
  });

  router.post('/unsubscribes/resubscribe', (req, res) => {
    const result = unsubMgr.resubscribe(req.body.email);
    res.json(result);
  });

  router.get('/unsubscribe-link', (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ success: false, error: '缺少email' });
    res.json({ success: true, data: { url: unsubMgr.getUnsubscribeUrl(email), headers: unsubMgr.getHeaders(email) } });
  });

  return router;
};
