/**
 * Personalized email context builder.
 * Builds one-customer-one-email prompts from customer profile, products,
 * conversation history, and segment strategy.
 */
class PersonalizedEmailBuilder {
  constructor(db) {
    this.db = db;
  }

  build(type, customer = {}, context = {}) {
    const fullCustomer = this._loadCustomer(customer);
    const profile = this._loadProfile(fullCustomer.id);
    const history = this._loadHistory(fullCustomer, context);
    const products = this._matchProducts(fullCustomer, context, history);
    const segment = this._segmentCustomer(fullCustomer, profile, context, products);
    const strategy = this._buildStrategy(type, fullCustomer, segment, products, context);
    const prompt = this._composePrompt(type, fullCustomer, profile, history, products, segment, strategy, context);

    return { prompt, customer: fullCustomer, profile, history, products, segment, strategy };
  }

  _loadCustomer(customer) {
    if (customer && customer.id) {
      try {
        const row = this.db.prepare('SELECT * FROM customers WHERE id = ?').get(customer.id);
        if (row) return { ...row, ...customer };
      } catch (e) {}
    }
    return customer || {};
  }

  _loadProfile(customerId) {
    if (!customerId) return null;
    try {
      return this.db.prepare('SELECT * FROM agent_customer_profiles WHERE customer_id = ?').get(customerId) || null;
    } catch (e) {
      return null;
    }
  }

  _loadHistory(customer, context) {
    const email = (customer.email || context.email || '').trim();
    const rows = [];
    if (!email) return rows;

    try {
      const incoming = this.db.prepare(`
        SELECT 'in' as direction, from_email as who, subject, body_text as body, received_at as time
        FROM received_emails
        WHERE from_email = ? OR to_email = ? OR customer_id = ?
        ORDER BY received_at DESC LIMIT 8
      `).all(email, email, customer.id || -1);
      rows.push(...incoming);
    } catch (e) {}

    try {
      const outgoing = this.db.prepare(`
        SELECT 'out' as direction, to_addr as who, subject, body, sent_at as time
        FROM emails
        WHERE to_addr = ? OR customer_id = ?
        ORDER BY COALESCE(sent_at, created_at) DESC LIMIT 8
      `).all(email, customer.id || -1);
      rows.push(...outgoing);
    } catch (e) {}

    return rows
      .filter(r => r && (r.subject || r.body))
      .sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0))
      .slice(0, 12);
  }

  _matchProducts(customer, context, history) {
    let products = [];
    try {
      products = this.db.prepare(`
        SELECT id, name, model, category, description, ai_description, specs,
               certifications, price_100, price_500, price_1000, moq, currency
        FROM products
        WHERE is_active = 1 AND (name IS NOT NULL OR model IS NOT NULL OR category IS NOT NULL)
      `).all();
    } catch (e) {
      return [];
    }

    const text = [
      customer.company, customer.contact_name, customer.country, customer.source, customer.tags,
      customer.notes, customer.ai_summary, customer.industry, customer.customer_type,
      customer.main_needs, customer.interested_products, customer.website,
      context.topic, context.products, context.product, context.incomingEmail, context.customPrompt,
      history.map(h => `${h.subject || ''} ${h.body || ''}`).join(' ')
    ].filter(Boolean).join(' ').toLowerCase();

    const scored = products.map(p => {
      const terms = [
        p.name, p.model, p.category, p.description, p.ai_description, p.specs, p.certifications
      ].filter(Boolean).join(' ').toLowerCase().split(/[\s,;，。/|()（）\[\]{}"']+/).filter(w => w.length >= 2);
      let score = 0;
      for (const term of new Set(terms)) {
        if (text.includes(term)) score += term.length > 4 ? 2 : 1;
      }
      return { ...p, _score: score };
    }).sort((a, b) => b._score - a._score);

    const matched = scored.filter(p => p._score > 0).slice(0, 3);
    return matched.length ? matched : scored.slice(0, 2);
  }

  _segmentCustomer(customer, profile, context, products) {
    const text = [
      customer.company, customer.country, customer.source, customer.tags, customer.notes,
      customer.industry, customer.customer_type, customer.main_needs, context.incomingEmail
    ].filter(Boolean).join(' ').toLowerCase();

    let customerType = customer.customer_type || 'unknown';
    if (/(utility|power|electric|grid|energy|电力|电网|供电)/i.test(text)) customerType = 'utility';
    else if (/(distributor|dealer|trading|import|wholesale|经销|贸易|进口)/i.test(text)) customerType = 'distributor';
    else if (/(contractor|project|epc|engineering|工程|承包)/i.test(text)) customerType = 'contractor';
    else if (/(factory|manufacturer|工厂|制造)/i.test(text)) customerType = 'manufacturer';

    const country = (customer.country || '').toLowerCase();
    let market = 'global';
    if (/nigeria|ghana|kenya|tanzania|uganda|ethiopia|south africa|africa|非洲/.test(`${country} ${text}`)) market = 'africa';
    else if (/saudi|uae|qatar|oman|kuwait|middle east|中东/.test(`${country} ${text}`)) market = 'middle_east';
    else if (/turkey|europe|eu|德国|法国|欧洲|土耳其/.test(`${country} ${text}`)) market = 'europe_turkey';
    else if (/philippines|indonesia|vietnam|thailand|malaysia|southeast|东南亚/.test(`${country} ${text}`)) market = 'southeast_asia';

    return {
      customerType,
      market,
      language: customer.language_preference || profile?.language_preference || this._inferLanguage(customer, context),
      tone: customer.communication_style || profile?.communication_style || 'professional, concise, helpful',
      productFocus: products.map(p => p.model || p.name || p.category).filter(Boolean).join(', ')
    };
  }

  _inferLanguage(customer, context) {
    const text = `${context.incomingEmail || ''} ${customer.notes || ''}`;
    if (/[\u4e00-\u9fff]/.test(text)) return 'Chinese';
    return 'English';
  }

  _buildStrategy(type, customer, segment, products, context) {
    const painPoints = {
      utility: ['reduce non-technical losses', 'prepaid revenue control', 'stable metering deployment', 'easy maintenance'],
      distributor: ['marketable models', 'competitive MOQ', 'stable supply', 'catalog and sample support'],
      contractor: ['project delivery', 'certification documents', 'installation reliability', 'lead time control'],
      manufacturer: ['OEM/ODM options', 'component reliability', 'long-term supply', 'technical compatibility'],
      unknown: ['reliable quality', 'clear specifications', 'responsive support', 'practical quotation']
    };
    const marketAngles = {
      africa: 'emphasize prepaid metering, anti-tamper value, robust supply, and price/MOQ flexibility',
      middle_east: 'emphasize certification, durability, project support, and delivery reliability',
      europe_turkey: 'emphasize CE/IEC compliance, stable quality, documentation, and samples',
      southeast_asia: 'emphasize distributor support, quick response, and practical product fit',
      global: 'emphasize product fit, certification, stable supply, and clear next step'
    };

    return {
      objective: this._objectiveFor(type),
      painPoints: painPoints[segment.customerType] || painPoints.unknown,
      marketAngle: marketAngles[segment.market] || marketAngles.global,
      cta: this._ctaFor(type, context),
      productRule: products.length
        ? 'Use only the matched product facts below. Do not invent parameters, certificates, or prices.'
        : 'Product data is limited. Mention product categories only and ask for requirements before quoting.'
    };
  }

  _objectiveFor(type) {
    if (type === 'reply') return 'reply to the customer in a way that advances the existing conversation';
    if (type === 'followup') return 'write a natural follow-up that adds value without pressure';
    if (type === 'quote') return 'write a quotation-oriented email with clear next-step confirmation';
    return 'write a cold outreach email that feels specific to this customer';
  }

  _ctaFor(type, context) {
    if (type === 'reply') return 'answer the customer questions and ask for the missing requirement needed for the next step';
    if (type === 'quote') return 'ask them to confirm quantity, destination port, and target specifications';
    if (type === 'followup') return 'ask whether they want a catalog, sample quotation, or technical datasheet';
    return 'ask whether they handle smart meters/circuit breakers and offer to send a short catalog or sample quote';
  }

  _composePrompt(type, customer, profile, history, products, segment, strategy, context) {
    const customerLines = this._formatCustomer(customer, profile, segment);
    const productLines = this._formatProducts(products);
    const historyLines = this._formatHistory(history);
    const extraContext = [
      context.customPrompt ? `Internal request: ${context.customPrompt}` : '',
      context.incomingEmail ? `Incoming email/context:\n${context.incomingEmail}` : '',
      context.topic ? `Campaign topic: ${context.topic}` : '',
      context.lastEmail ? `Last email summary: ${context.lastEmail}` : ''
    ].filter(Boolean).join('\n\n');

    return `You are writing a one-to-one B2B foreign trade email for VIPB / Wenzhou Xingyuan.

Goal: ${strategy.objective}
Email type: ${type || 'cold'}
Required language: ${segment.language}
Tone: ${segment.tone}

Customer profile:
${customerLines}

Segmentation strategy:
- Customer segment: ${segment.customerType}
- Market segment: ${segment.market}
- Market angle: ${strategy.marketAngle}
- Likely pain points: ${strategy.painPoints.join('; ')}
- Product focus: ${segment.productFocus || 'smart meters and circuit breakers'}
- CTA: ${strategy.cta}

Matched products:
${productLines}

Historical context / conversation history:
${historyLines}

Additional context:
${extraContext || 'None'}

Writing rules:
- This must be 千人千面: use customer-specific signals from profile/history/market/product match. Avoid generic mass-mail wording.
- Mention only facts present in the customer profile, product data, or conversation history.
- ${strategy.productRule}
- Keep it concise: 120-220 English words unless the customer wrote in Chinese.
- Do not include internal analysis, strategy notes, alternatives, markdown, or JSON.
- Output exactly:
Subject: ...

Email body...`;
  }

  _formatCustomer(customer, profile, segment) {
    const lines = [
      ['Company', customer.company],
      ['Contact', customer.contact_name],
      ['Email', customer.email],
      ['Country/region', customer.country],
      ['Source', customer.source],
      ['Industry', customer.industry],
      ['Customer type', customer.customer_type || segment.customerType],
      ['Main needs', customer.main_needs],
      ['Interested products', customer.interested_products],
      ['Tags', customer.tags],
      ['Stage', customer.stage],
      ['Lead score', customer.lead_score],
      ['Notes', customer.notes],
      ['AI summary', customer.ai_summary],
      ['Language preference', customer.language_preference || profile?.language_preference],
      ['Communication style', customer.communication_style || profile?.communication_style]
    ].filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '');
    return lines.length ? lines.map(([k, v]) => `- ${k}: ${String(v).slice(0, 500)}`).join('\n') : '- No detailed profile yet';
  }

  _formatProducts(products) {
    if (!products.length) return '- No exact product match. Use broad category language only.';
    return products.map(p => {
      const prices = [
        p.price_100 ? `100pcs ${p.price_100}` : '',
        p.price_500 ? `500pcs ${p.price_500}` : '',
        p.price_1000 ? `1000pcs ${p.price_1000}` : ''
      ].filter(Boolean).join(', ');
      return [
        `- ${p.name || 'Unnamed product'} ${p.model ? `(${p.model})` : ''}`,
        p.category ? `  Category: ${p.category}` : '',
        p.description ? `  Description: ${String(p.description).slice(0, 300)}` : '',
        p.specs ? `  Specs: ${String(p.specs).slice(0, 400)}` : '',
        p.certifications ? `  Certifications: ${String(p.certifications).slice(0, 200)}` : '',
        p.moq ? `  MOQ: ${p.moq}` : '',
        prices ? `  Price references (${p.currency || 'USD'}): ${prices}` : ''
      ].filter(Boolean).join('\n');
    }).join('\n');
  }

  _formatHistory(history) {
    if (!history.length) return '- No previous conversation found';
    return history.slice(0, 8).map(h => {
      const dir = h.direction === 'in' ? 'Customer to us' : 'Us to customer';
      const body = String(h.body || '').replace(/\s+/g, ' ').slice(0, 240);
      return `- [${dir}] ${h.subject || '(no subject)'} | ${body}`;
    }).join('\n');
  }
}

module.exports = { PersonalizedEmailBuilder };
