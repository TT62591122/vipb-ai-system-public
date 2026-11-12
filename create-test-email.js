const db = require('better-sqlite3')('data/vipb.db');

// 插入邮件到数据库
const stmt = db.prepare(`
  INSERT INTO emails (customer_id, account_id, to_addr, subject, body, status, created_at)
  VALUES (null, 27, 'customer@example.com', ?, ?, 'draft', datetime('now'))
`);

const subject = 'Reliable Partner for Your Business - VIPB Solutions';
const body = `Dear Business Partner,

I hope this email finds you well.

My name is from VIPB AI System, and I'm reaching out to explore potential business cooperation with you.

**Why Choose VIPB?**

✓ **Competitive Pricing** - We understand the importance of cost control in African markets
✓ **Fast Delivery** - Established logistics channels to major African ports (Lagos, Mombasa, Durban, etc.)
✓ **Flexible Payment Terms** - T/T, L/C, and other mutually agreeable methods
✓ **Quality Guarantee** - All products come with warranty and after-sales support
✓ **WhatsApp Support** - Instant communication for quick responses to your needs

**Our Main Products/Services:**
- AI-powered business automation solutions
- Customer relationship management (CRM) systems
- Multi-channel marketing tools
- Custom software development

We have been helping businesses across Africa streamline operations and reduce costs by 30-50%.

**Next Steps:**
If you're interested, I'd love to:
1. Learn more about your specific needs
2. Share our product catalog with pricing
3. Arrange a quick call via WhatsApp or Zoom

Please feel free to reach me directly or reply to this email.

Looking forward to building a long-term partnership with you.

Best regards,
VIPB AI System Team
Email: user@example.com

---
P.S. We offer special discounts for first-time orders from African partners. Let's discuss how we can support your growth!
`;

const result = stmt.run(subject, body);
console.log('✅ 邮件已创建，ID:', result.lastInsertRowid);

// 更新为 queued 状态
db.prepare("UPDATE emails SET status='queued' WHERE id=?").run(result.lastInsertRowid);
console.log('✅ 邮件已加入发送队列');

db.close();
