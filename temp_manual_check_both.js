const { EmailReceiver } = require('./src/email-receiver');
const Database = require('better-sqlite3');

(async () => {
  const db = new Database('./data/vipb.db');
  const receiver = new EmailReceiver(db, null, { pollInterval: 60000 });

  for (const id of [25,27]) {
    try {
      const r = await receiver.checkAccount(id);
      console.log(`ACCOUNT ${id} RESULT:`);
      console.log(JSON.stringify(r));
    } catch (e) {
      console.log(`ACCOUNT ${id} ERROR: ${e.message}`);
    }
  }

  db.close();
})();
