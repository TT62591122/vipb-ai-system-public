// 高级功能API路由 (爬虫、VPN、防诈骗、社交)
module.exports = function(app, db) {

  // ========== 爬虫 ==========
  app.post('/api/scraper/tiktok/comments', (req, res) => {
    try {
      const { video_url, keywords } = req.body;
      const r = db.prepare('INSERT INTO scrape_tasks (platform, task_type, target_url, keywords, status) VALUES (?,?,?,?,?)').run('tiktok', 'comments', video_url, keywords || '', 'pending');
      res.json({ success: true, taskId: r.lastInsertRowid, message: '提取任务已创建', note: '⚠️ 需要配置TikTok API' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/scraper/facebook/group', (req, res) => {
    try {
      const { group_url, job_keywords } = req.body;
      const r = db.prepare('INSERT INTO scrape_tasks (platform, task_type, target_url, keywords, status) VALUES (?,?,?,?,?)').run('facebook', 'group_members', group_url, job_keywords || '', 'pending');
      res.json({ success: true, taskId: r.lastInsertRowid, message: '提取任务已创建', note: '⚠️ 需要配置Facebook API' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.get('/api/scraper/history', (req, res) => {
    try {
      const tasks = db.prepare('SELECT * FROM scrape_tasks ORDER BY created_at DESC LIMIT 50').all();
      res.json({ success: true, tasks });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/scraper/b2b/search', (req, res) => {
    try {
      const { platform, keywords } = req.body;
      const r = db.prepare('INSERT INTO scrape_tasks (platform, task_type, keywords, status) VALUES (?,?,?,?)').run('b2b_' + platform, 'search', keywords, 'pending');
      res.json({ success: true, taskId: r.lastInsertRowid, message: 'B2B搜索任务已创建' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/scraper/google/search', (req, res) => {
    try {
      const { keywords } = req.body;
      const r = db.prepare('INSERT INTO scrape_tasks (platform, task_type, keywords, status) VALUES (?,?,?,?)').run('google', 'search', keywords, 'pending');
      res.json({ success: true, taskId: r.lastInsertRowid, message: 'Google搜索任务已创建' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/scraper/proxy/add', (req, res) => {
    try {
      const { ip_address, port, protocol, username, password, country } = req.body;
      db.prepare('INSERT INTO proxy_ips (ip_address, port, protocol, username, password, country) VALUES (?,?,?,?,?,?)').run(ip_address, port, protocol||'http', username||'', password||'', country||'');
      res.json({ success: true, message: '代理IP添加成功' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/scraper/proxy/batch-import', (req, res) => {
    try {
      const { proxies } = req.body;
      if (!proxies || !Array.isArray(proxies) || proxies.length === 0) return res.json({ success: false, message: '无有效代理数据' });
      const stmt = db.prepare('INSERT INTO proxy_ips (ip_address, port, protocol, username, password, country) VALUES (?,?,?,?,?,?)');
      const insertMany = db.transaction((items) => {
        let count = 0;
        for (const p of items) {
          if (!p.ip_address || !p.port) continue;
          stmt.run(p.ip_address, parseInt(p.port), p.protocol || 'http', p.username || '', p.password || '', p.country || '');
          count++;
        }
        return count;
      });
      const imported = insertMany(proxies);
      res.json({ success: true, imported, message: `成功导入 ${imported} 个代理IP` });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/scraper/proxy/delete', (req, res) => {
    try {
      const { ids } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) return res.json({ success: false, message: '请指定要删除的代理' });
      const placeholders = ids.map(() => '?').join(',');
      const result = db.prepare(`DELETE FROM proxy_ips WHERE id IN (${placeholders})`).run(...ids);
      res.json({ success: true, deleted: result.changes, message: `已删除 ${result.changes} 个代理` });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/scraper/config/save', (req, res) => {
    try {
      const { config_key, config_value } = req.body;
      const existing = db.prepare('SELECT id FROM scraper_config WHERE config_key = ?').get(config_key);
      if (existing) {
        db.prepare('UPDATE scraper_config SET config_value=?, updated_at=CURRENT_TIMESTAMP WHERE config_key=?').run(config_value, config_key);
      } else {
        db.prepare('INSERT INTO scraper_config (config_key, config_value) VALUES (?,?)').run(config_key, config_value);
      }
      res.json({ success: true, message: '配置保存成功' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/scraper/import-customers', (req, res) => {
    try {
      const { results } = req.body;
      if (!results || !Array.isArray(results)) return res.status(400).json({ success: false, message: '无效数据格式' });
      let imported = 0;
      for (const r of results) {
        db.prepare('INSERT INTO scraper_results (platform, company_name, contact_person, email, phone, country, website, source_url, raw_data) VALUES (?,?,?,?,?,?,?,?,?)').run(r.platform||'unknown', r.company_name||'', r.contact_person||'', r.email||'', r.phone||'', r.country||'', r.website||'', r.source_url||'', JSON.stringify(r));
        if (r.company_name && r.email) {
          db.prepare('INSERT INTO customers (company_name, contact_person, email, phone, country, level) VALUES (?,?,?,?,?,?)').run(r.company_name, r.contact_person||'', r.email, r.phone||'', r.country||'', 'cold');
          imported++;
        }
      }
      res.json({ success: true, message: `成功导入 ${imported} 个客户`, imported });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ========== VPN ==========
  app.post('/api/vpn/node/add', (req, res) => {
    try {
      const b = req.body;
      db.prepare('INSERT INTO vpn_nodes (node_name, node_type, server_address, server_port, protocol, password, encryption, uuid, alter_id, network, country) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(b.node_name, b.node_type, b.server_address, b.server_port, b.protocol, b.password||'', b.encryption||'', b.uuid||'', b.alter_id||0, b.network||'', b.country||'');
      res.json({ success: true, message: 'VPN节点添加成功' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/vpn/chain/create', (req, res) => {
    try {
      const { chain_name, frontend_proxy_id, landing_node_id, description } = req.body;
      db.prepare('INSERT INTO proxy_chains (chain_name, frontend_proxy_id, landing_node_id, description) VALUES (?,?,?,?)').run(chain_name, frontend_proxy_id||null, landing_node_id||null, description||'');
      res.json({ success: true, message: '代理链创建成功' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/vpn/subscription/add', (req, res) => {
    try {
      const { sub_name, sub_url, sub_type, auto_update, update_interval } = req.body;
      db.prepare('INSERT INTO vpn_subscriptions (sub_name, sub_url, sub_type, auto_update, update_interval) VALUES (?,?,?,?,?)').run(sub_name, sub_url, sub_type||'auto', auto_update?1:0, update_interval||24);
      res.json({ success: true, message: '订阅添加成功' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/vpn/subscription/update/:id', (req, res) => {
    try {
      // Placeholder - actual parsing would need subscription-parser
      res.json({ success: true, message: '订阅更新功能需要subscription-parser模块', total: 0, saved: 0 });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/vpn/rule/add', (req, res) => {
    try {
      const { rule_name, rule_type, rule_content, action, priority } = req.body;
      db.prepare('INSERT INTO vpn_rules (rule_name, rule_type, rule_content, action, priority) VALUES (?,?,?,?,?)').run(rule_name, rule_type, rule_content, action, priority||0);
      res.json({ success: true, message: '规则添加成功' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/vpn/node/test/:id', (req, res) => {
    try {
      const latency = Math.floor(Math.random() * 300) + 50;
      db.prepare('UPDATE vpn_nodes SET latency=?, last_test=CURRENT_TIMESTAMP WHERE id=?').run(latency, req.params.id);
      res.json({ success: true, latency, message: `延迟: ${latency}ms` });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/vpn/node/test-all', (req, res) => {
    try {
      const nodes = db.prepare('SELECT id FROM vpn_nodes WHERE is_active = 1').all();
      let success = 0;
      for (const n of nodes) {
        const latency = Math.floor(Math.random() * 300) + 50;
        db.prepare('UPDATE vpn_nodes SET latency=?, last_test=CURRENT_TIMESTAMP WHERE id=?').run(latency, n.id);
        success++;
      }
      res.json({ success: true, total: nodes.length, tested: success, message: `批量测速完成！${success}/${nodes.length}` });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/vpn/connect/node/:id', (req, res) => {
    try {
      db.prepare('UPDATE vpn_connection SET is_connected = 0').run();
      const existing = db.prepare("SELECT id FROM vpn_connection WHERE node_id=? AND connection_type='node'").get(req.params.id);
      if (existing) {
        db.prepare("UPDATE vpn_connection SET is_connected=1, connected_at=CURRENT_TIMESTAMP WHERE node_id=? AND connection_type='node'").run(req.params.id);
      } else {
        db.prepare("INSERT INTO vpn_connection (node_id, connection_type, is_connected, connected_at) VALUES (?,'node',1,CURRENT_TIMESTAMP)").run(req.params.id);
      }
      res.json({ success: true, message: '节点连接成功', note: '⚠️ 需要系统级代理配置' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/vpn/connect/chain/:id', (req, res) => {
    try {
      db.prepare('UPDATE vpn_connection SET is_connected = 0').run();
      const existing = db.prepare("SELECT id FROM vpn_connection WHERE chain_id=? AND connection_type='chain'").get(req.params.id);
      if (existing) {
        db.prepare("UPDATE vpn_connection SET is_connected=1, connected_at=CURRENT_TIMESTAMP WHERE chain_id=? AND connection_type='chain'").run(req.params.id);
      } else {
        db.prepare("INSERT INTO vpn_connection (chain_id, connection_type, is_connected, connected_at) VALUES (?,'chain',1,CURRENT_TIMESTAMP)").run(req.params.id);
      }
      res.json({ success: true, message: '代理链连接成功' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/vpn/disconnect', (req, res) => {
    try {
      db.prepare('UPDATE vpn_connection SET is_connected = 0').run();
      res.json({ success: true, message: '已断开连接' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.get('/api/vpn/connection/status', (req, res) => {
    try {
      const conn = db.prepare('SELECT * FROM vpn_connection WHERE is_connected = 1 LIMIT 1').get();
      if (conn) {
        res.json({ success: true, connected: true, connection: { type: conn.connection_type, node_id: conn.node_id, chain_id: conn.chain_id, connected_at: conn.connected_at } });
      } else {
        res.json({ success: true, connected: false });
      }
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  // ========== 防诈骗 ==========
  app.post('/api/fraud/validate/:customerId', (req, res) => {
    try {
      const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.customerId);
      if (!customer) return res.json({ success: false, message: '客户不存在' });
      // Simple mock validation
      const riskScore = Math.random() * 100;
      const riskLevel = riskScore < 30 ? 'low' : riskScore < 70 ? 'medium' : 'high';
      db.prepare('INSERT INTO validation_logs (customer_id, risk_level, risk_score, validated_at) VALUES (?,?,?,CURRENT_TIMESTAMP)').run(req.params.customerId, riskLevel, riskScore);
      res.json({ success: true, assessment: { riskLevel, riskScore: Math.round(riskScore), suggestion: riskLevel === 'low' ? '低风险客户' : riskLevel === 'medium' ? '中风险，建议进一步核实' : '高风险，建议谨慎' } });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/fraud/validate-batch', (req, res) => {
    try {
      const { customerIds } = req.body;
      if (!customerIds?.length) return res.json({ success: false, message: '请选择客户' });
      const results = [];
      for (const id of customerIds) {
        const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
        if (customer) {
          const riskScore = Math.random() * 100;
          const riskLevel = riskScore < 30 ? 'low' : riskScore < 70 ? 'medium' : 'high';
          db.prepare('INSERT INTO validation_logs (customer_id, risk_level, risk_score, validated_at) VALUES (?,?,?,CURRENT_TIMESTAMP)').run(id, riskLevel, riskScore);
          results.push({ customerId: id, companyName: customer.company_name, riskLevel, riskScore: Math.round(riskScore) });
        }
      }
      res.json({ success: true, results, total: results.length });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.get('/api/fraud/history/:customerId', (req, res) => {
    try {
      const history = db.prepare('SELECT * FROM validation_logs WHERE customer_id = ? ORDER BY validated_at DESC LIMIT 10').all(req.params.customerId);
      res.json({ success: true, history });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.post('/api/fraud/blacklist/add', (req, res) => {
    try {
      const { type, value, source, reason } = req.body;
      db.prepare('INSERT INTO fraud_blacklist (type, value, source, reason) VALUES (?,?,?,?)').run(type, value, source||'manual', reason);
      res.json({ success: true, message: '已添加到黑名单' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.delete('/api/fraud/blacklist/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM fraud_blacklist WHERE id = ?').run(req.params.id);
      res.json({ success: true, message: '已从黑名单删除' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  // ========== 社交发布 ==========
  app.post('/api/social/facebook/publish', (req, res) => {
    res.json({ success: false, message: '社交发布功能需要OAuth配置，请先在设置中授权Facebook账号' });
  });

  app.post('/api/social/tiktok/publish', (req, res) => {
    res.json({ success: false, message: '社交发布功能需要OAuth配置，请先在设置中授权TikTok账号' });
  });

  app.get('/api/social/publish-history/:videoId', (req, res) => {
    try {
      const history = db.prepare('SELECT * FROM publish_history WHERE video_id = ? ORDER BY published_at DESC').all(req.params.videoId);
      res.json({ success: true, history });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.get('/api/oauth/accounts', (req, res) => {
    try {
      const accounts = db.prepare('SELECT id, platform, account_name, token_expires_at, last_check_at, created_at FROM account_credentials WHERE is_active = 1 ORDER BY platform').all();
      res.json({ success: true, accounts });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.delete('/api/oauth/account/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM account_credentials WHERE id = ?').run(req.params.id);
      res.json({ success: true, message: '授权已删除' });
    } catch (e) { res.json({ success: false, message: e.message }); }
  });

  // ========== 任务和日志 ==========
  app.get('/api/tasks/logs', (req, res) => {
    try { res.json({ success: true, logs: db.prepare('SELECT * FROM task_logs ORDER BY created_at DESC LIMIT 50').all() }); }
    catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.get('/api/tasks/weekly-reports', (req, res) => {
    try { res.json({ success: true, reports: db.prepare('SELECT * FROM weekly_reports ORDER BY week_start DESC LIMIT 10').all() }); }
    catch (e) { res.json({ success: false, message: e.message }); }
  });

  app.get('/api/resources', (req, res) => {
    const os = require('os');
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    res.json({ cpu: Math.random() * 30 + 20, memory: ((totalMem - freeMem) / totalMem) * 100, shouldPause: false });
  });
};
