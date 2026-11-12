require('dotenv').config();
const Database=require('better-sqlite3');
const { EmailReceiver }=require('./src/email-receiver');
const db=new Database('./data/vipb.db');
const r=new EmailReceiver(db,null,{pollInterval:60000});

const t1=r._shouldBlockUnknownEmail({
  accountId:27,messageId:'test-1',fromEmail:'ads@marketing-now.com',fromName:'Ads',
  subject:'BOOST TRAFFIC!!! SEO service for your website',
  bodyText:'Dear Sir, we provide lead generation and backlink service https://a.com https://b.com https://c.com',
  receivedAt:new Date().toISOString(),customerId:null
});

const t2=r._shouldBlockUnknownEmail({
  accountId:27,messageId:'test-2',fromEmail:'newbuyer@example.com',fromName:'Buyer',
  subject:'Request quotation for smart meter',
  bodyText:'Hello, please share quotation, MOQ, lead time and datasheet for DDSY2361.',
  receivedAt:new Date().toISOString(),customerId:null
});

const t3=r._shouldBlockUnknownEmail({
  accountId:27,messageId:'test-3',fromEmail:'hack@x.com',fromName:'Hack',
  subject:'Need your account',
  bodyText:'Please send your password and API key for verification code check?',
  receivedAt:new Date().toISOString(),customerId:null
});

const cols=db.prepare("PRAGMA table_info(blocked_emails)").all();
console.log('T1',JSON.stringify(t1));
console.log('T2',JSON.stringify(t2));
console.log('T3',JSON.stringify(t3));
console.log('blocked_emails columns:', cols.map(c=>c.name).join(','));
db.close();
