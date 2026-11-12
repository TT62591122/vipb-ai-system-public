const fs = require('fs');
const path = 'D:\\VIPB-AI-System\\src\\email-auto-replier.js';
let code = fs.readFileSync(path, 'utf8');

const regex = /`【需人工回复】客户询问了产品参数，产品库暂无匹配数据。\\n\\n检测原[^\n]+\\n匹配关键[^\n]+\\n\\n--- 客户原文 ---\\n\$\{\(email\.body \|\| ''\)\.substring\(0, 1000\)\}`/m;

const replacement = "``"; // Just an empty string or basic quote structure, let's refine this to generate a proper clean draft body

// Better replacement:
// Just leave a few empty lines and append the original email cleanly
const betterReplacement = "`\\n\\n\\n---Original---\\nFrom: ${email.from_name || email.from_email}\\nDate: ${email.received_at || new Date().toISOString()}\\nSubject: ${email.subject}\\n\\n${(email.body || '').substring(0, 2000)}`";

if (regex.test(code)) {
  code = code.replace(regex, betterReplacement);
  fs.writeFileSync(path, code, 'utf8');
  console.log('Successfully updated email-auto-replier.js');
} else {
  console.log('Regex did not match. Let me check the exact string.');
  
  // Alternative simple string replace
  const oldStr = "`【需人工回复】客户询问了产品参数，产品库暂无匹配数据。\\n\\n检测原? ${specCheck.reason}\\n匹配关键? ${specCheck.matchedKeywords.join(', ')}\\n\\n--- 客户原文 ---\\n${(email.body || '').substring(0, 1000)}`";
  
  // since there are weird encodings let's just use a more generic regex that matches the whole block between the commas
  const blockRegex = /`【需人工回复】客户询问了产品参数[\s\S]*?---\\n\$\{\(email\.body \|\| ''\)\.substring\(0, 1000\)\}`/;
  if (blockRegex.test(code)) {
    code = code.replace(blockRegex, betterReplacement);
    fs.writeFileSync(path, code, 'utf8');
    console.log('Successfully updated via block regex');
  } else {
    console.log('Still failed to match.');
  }
}
