const db = require('better-sqlite3')('./data/vipb.db');

console.log('=== ANTIBAN RULES (email) ===');
try {
  const rules = db.prepare("SELECT id,rule_type,content FROM antiban_rules WHERE rule_type LIKE '%email%'").all();
  rules.forEach(r => {
    const c = JSON.parse(r.content);
    console.log('Rule#' + r.id, r.rule_type);
    console.log(JSON.stringify(c, null, 2).substring(0, 1500));
    console.log('---');
  });
  if (!rules.length) console.log('(none found)');
} catch(e) { console.log('Error:', e.message); }

console.log('\n=== ALL ANTIBAN RULE TYPES ===');
try {
  db.prepare("SELECT DISTINCT rule_type FROM antiban_rules").all().forEach(r => console.log(r.rule_type));
} catch(e) { console.log('Error:', e.message); }

console.log('\n=== EMAIL SEQUENCES TABLE ===');
try {
  const cols = db.prepare("PRAGMA table_info(email_sequences)").all();
  console.log('Columns:', cols.map(c => c.name).join(', '));
  const seqs = db.prepare("SELECT * FROM email_sequences LIMIT 5").all();
  seqs.forEach(s => console.log(JSON.stringify(s)));
  if (!seqs.length) console.log('(empty)');
} catch(e) { console.log('No table:', e.message); }

db.close();
