require('dotenv').config();
const { EmailReceiver } = require('./src/email-receiver');
const Database = require('better-sqlite3');

(async () => {
  const db = new Database('./data/vipb.db');
  const receiver = new EmailReceiver(db, null, { pollInterval: 60000 });
  const ids = [25,27];

  for (const id of ids) {
    const acc = db.prepare('SELECT * FROM email_accounts WHERE id=? AND is_active=1').get(id);
    if (!acc) { console.log(`ACCOUNT ${id}: NOT_FOUND`); continue; }
    try {
      const r = await receiver._fetchNewEmails(acc);
      console.log(`ACCOUNT ${id} (${acc.email}) DIRECT FETCH:`);
      console.log(JSON.stringify(r));
    } catch (e) {
      console.log(`ACCOUNT ${id} (${acc.email}) DIRECT FETCH ERROR: ${e.message}`);
    }
  }

  db.close();
})();
