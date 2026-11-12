const db = require('better-sqlite3')('data/vipb.db');
const { EmailSender } = require('./src/email-sender');

async function sendQueuedEmail() {
  const sender = new EmailSender(db);
  
  // 获取队列中的邮件
  const email = db.prepare(`
    SELECT e.*, a.email as from_email, a.display_name, a.smtp_host, a.smtp_port, a.smtp_user, a.smtp_pass
    FROM emails e
    LEFT JOIN email_accounts a ON e.account_id = a.id
    WHERE e.id = 24
  `).get();
  
  if (!email) {
    console.error('❌ 邮件不存在');
    return;
  }
  
  console.log('📧 准备发送邮件:');
  console.log('   发件人:', email.from_email);
  console.log('   收件人:', email.to_addr);
  console.log('   主题:', email.subject);
  console.log('---');
  
  try {
    const result = await sender.sendEmail(24);
    console.log('---');
    if (result.success) {
      console.log('✅ 发送成功!');
      console.log('   消息 ID:', result.messageId);
    } else {
      console.log('❌ 发送失败:', result.error);
    }
  } catch (e) {
    console.error('❌ 发送异常:', e.message);
  }
  
  sender.closeAll();
  db.close();
}

sendQueuedEmail();
