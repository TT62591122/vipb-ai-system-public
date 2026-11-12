/**
 * SPF/DKIM/DMARC 域名邮件认证检测器
 * 检查发件域名的DNS记录，评估邮件投递能力
 * 只加不改 — 新模块
 */
const dns = require('dns');
const { Resolver } = dns;

class DomainAuthChecker {
  constructor() {
    // 使用独立Resolver绕过系统代理，直连公共DNS
    this.resolver = new Resolver();
    this.resolver.setServers(['8.8.8.8', '1.1.1.1', '208.67.222.222']);
  }
  /**
   * 检查域名的全部邮件认证记录
   * @param {string} domain - 域名
   * @returns {object} 检查结果
   */
  async check(domain) {
    if (!domain || typeof domain !== 'string') throw new Error('无效域名');
    domain = domain.replace(/^@/, '').toLowerCase().trim();
    
    const [spf, dkim, dmarc, mx] = await Promise.all([
      this._checkSPF(domain),
      this._checkDKIM(domain),
      this._checkDMARC(domain),
      this._checkMX(domain)
    ]);

    const issues = [];
    const suggestions = [];
    let score = 100;

    // MX
    if (!mx.found) { issues.push('❌ 无MX记录 — 域名无法收邮件'); score -= 30; }

    // SPF
    if (!spf.found) {
      issues.push('❌ 无SPF记录 — 邮件极易被标为垃圾邮件');
      suggestions.push('添加SPF记录: v=spf1 include:_spf.google.com ~all (如用Gmail发送)');
      score -= 30;
    } else if (spf.record && spf.record.includes('+all')) {
      issues.push('⚠️ SPF使用+all（允许任何IP发送）— 等于没设');
      suggestions.push('将+all改为~all或-all');
      score -= 20;
    } else if (spf.valid) {
      // Good
    }

    // DKIM
    if (!dkim.found) {
      issues.push('⚠️ 未检测到常见DKIM记录 — 影响投递率');
      suggestions.push('在域名DNS添加DKIM记录(由邮件服务商提供)');
      score -= 20;
    }

    // DMARC
    if (!dmarc.found) {
      issues.push('❌ 无DMARC记录 — 无法防止邮件伪造');
      suggestions.push('添加DMARC记录: v=DMARC1; p=none; rua=mailto:dmarc@' + domain);
      score -= 20;
    } else if (dmarc.policy === 'none') {
      issues.push('⚠️ DMARC策略为none — 仅监控不拦截');
      suggestions.push('建议逐步升级DMARC策略: none → quarantine → reject');
      score -= 5;
    }

    score = Math.max(0, score);
    const level = score >= 80 ? 'good' : score >= 50 ? 'warning' : 'danger';

    return {
      domain,
      score,
      level,
      mx,
      spf,
      dkim,
      dmarc,
      issues,
      suggestions,
      checkedAt: new Date().toISOString()
    };
  }

  async _checkSPF(domain) {
    try {
      const records = await this._resolveTxt(domain);
      const flat = records.map(r => r.join('')).filter(r => r.startsWith('v=spf1'));
      if (flat.length === 0) return { found: false };
      return { found: true, valid: true, record: flat[0] };
    } catch(e) {
      return { found: false, error: e.code };
    }
  }

  async _checkDKIM(domain) {
    const selectors = ['default', 'google', 'selector1', 'selector2', 'k1', 'dkim', 'mail', 's1', 's2'];
    for (const sel of selectors) {
      try {
        const records = await this._resolveTxt(`${sel}._domainkey.${domain}`);
        const flat = records.map(r => r.join('')).filter(r => r.includes('v=DKIM1') || r.includes('p='));
        if (flat.length > 0) {
          return { found: true, selector: sel, record: flat[0].substring(0, 200) };
        }
      } catch(e) { /* try next */ }
    }
    return { found: false, note: '未在常见selector中找到DKIM记录' };
  }

  async _checkDMARC(domain) {
    try {
      const records = await this._resolveTxt(`_dmarc.${domain}`);
      const flat = records.map(r => r.join('')).filter(r => r.startsWith('v=DMARC1'));
      if (flat.length === 0) return { found: false };
      const record = flat[0];
      const pMatch = record.match(/p=(\w+)/);
      return { found: true, policy: pMatch ? pMatch[1] : 'unknown', record };
    } catch(e) {
      return { found: false, error: e.code };
    }
  }

  async _checkMX(domain) {
    try {
      const records = await this._resolveMx(domain);
      if (!records.length) return { found: false };
      return { found: true, records: records.sort((a,b) => a.priority - b.priority).map(r => ({ priority: r.priority, exchange: r.exchange })) };
    } catch(e) {
      return { found: false, error: e.code };
    }
  }

  // Promise wrappers for resolver
  _resolveTxt(domain) {
    return new Promise((resolve, reject) => {
      this.resolver.resolveTxt(domain, (err, records) => err ? reject(err) : resolve(records));
    });
  }
  _resolveMx(domain) {
    return new Promise((resolve, reject) => {
      this.resolver.resolveMx(domain, (err, records) => err ? reject(err) : resolve(records));
    });
  }
}

module.exports = { DomainAuthChecker };
