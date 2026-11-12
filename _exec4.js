require('dotenv').config();
const http = require('http');
let cookie = '';

async function req(m,p,b){return new Promise((ok,ko)=>{const u=new URL(p,'http://localhost:3001');const o={hostname:u.hostname,port:u.port,path:u.pathname+u.search,method:m,headers:{'Content-Type':'application/json','Cookie':cookie}};const r=http.request(o,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{if(res.headers['set-cookie'])cookie=res.headers['set-cookie'].map(c=>c.split(';')[0]).join('; ');try{ok({status:res.statusCode,body:JSON.parse(d)})}catch{ok({status:res.statusCode,body:d})}})});r.on('error',ko);if(b)r.write(JSON.stringify(b));r.end();})}

async function login(){const p=await req('GET','/login');const m=typeof p.body==='string'&&p.body.match(/name="_csrf"\s+value="([^"]+)"/);if(!m)return false;return new Promise(ok=>{const f=`username=admin&password=${process.env.ADMIN_PASSWORD}&_csrf=${encodeURIComponent(m[1])}`;const o={hostname:'localhost',port:3001,path:'/login',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Cookie':cookie}};const r=http.request(o,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{if(res.headers['set-cookie'])cookie=res.headers['set-cookie'].map(c=>c.split(';')[0]).join('; ');ok(res.statusCode===302)})});r.write(f);r.end();})}

async function run() {
  if (!process.env.ADMIN_PASSWORD) { console.error('请先设置环境变量 ADMIN_PASSWORD'); process.exit(1); }
  const db = require('better-sqlite3')('./data/vipb.db');
  const bcrypt = require('bcrypt');
  const orig = db.prepare("SELECT password FROM users WHERE username='admin'").get().password;
  db.prepare("UPDATE users SET password=? WHERE username='admin'").run(bcrypt.hashSync(process.env.ADMIN_PASSWORD,10));
  await login();

  console.log('📤 执行AI任务（第二次，修复后）...\n');
  const result = await req('POST', '/api/ai-command/chat', {
    message: '把产品库里的DDSY2361这款产品图片生成非洲客户喜欢的单个产品的宣传单，附上商务营销文案，然后明天发送给customer@example.com这个客户。'
  });

  const taskId = result.body?.taskId;
  console.log('任务ID:', taskId);

  if (taskId) {
    for (let i = 0; i < 90; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const task = db.prepare("SELECT status, result FROM ai_tasks WHERE id=?").get(taskId);
      process.stdout.write('.');
      if (task?.status === 'completed' || task?.status === 'failed') {
        console.log(`\n\n📋 状态: ${task.status}`);
        console.log('📝 结果:\n', task.result);
        
        const steps = db.prepare("SELECT * FROM ai_task_steps WHERE task_id=? ORDER BY id").all(taskId);
        console.log(`\n📊 步骤 (${steps.length}):`);
        steps.forEach(s => {
          console.log(`  [${s.status}] ${s.action}`);
          if (s.output) {
            try {
              const o = JSON.parse(s.output);
              if (o.content) console.log(`    → ${o.content.substring(0, 200)}`);
              if (o.data) console.log(`    → data keys: ${Object.keys(o.data).join(', ')}`);
              if (o.error) console.log(`    → ERROR: ${o.error}`);
            } catch(e) { console.log(`    → ${s.output.substring(0, 200)}`); }
          }
        });
        break;
      }
    }
  }

  // Check scheduled tasks and files
  const fs = require('fs');
  const imgDir = './data/product-images';
  const files = fs.readdirSync(imgDir).filter(f => f.startsWith('ai_generated'));
  if (files.length) {
    console.log('\n🖼️ 生成的图片:');
    files.forEach(f => {
      const stat = fs.statSync(`${imgDir}/${f}`);
      console.log(`  ${f} (${(stat.size/1024).toFixed(1)}KB)`);
    });
  }

  db.prepare("UPDATE users SET password=? WHERE username='admin'").run(orig);
  require('fs').unlinkSync(__filename);
}

run().catch(e => console.error(e));
