const http = require('http');

// 针对非洲客户的开发信
const emailData = {
  to_addr: 'customer@example.com',
  subject: 'Reliable Partner for Your Business - VIPB Solutions',
  body: `Dear Business Partner,

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

Please feel free to reach me directly on WhatsApp: [Your Number] or reply to this email.

Looking forward to building a long-term partnership with you.

Best regards,
VIPB AI System Team
Email: user@example.com
Website: www.vipb-ai.com

---
P.S. We offer special discounts for first-time orders from African partners. Let's discuss how we can support your growth!
`,
  account_id: 27
};

const data = JSON.stringify(emailData);

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/emails/send',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('发送结果:', body);
  });
});

req.on('error', (e) => {
  console.error('请求错误:', e.message);
});

req.write(data);
req.end();
