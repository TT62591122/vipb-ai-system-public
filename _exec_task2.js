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
  console.log('已登录\n');

  console.log('📤 发送指令...\n');
  const result = await req('POST', '/api/ai-command/chat', {
    message: '把产品库里的DDSY2361这款产品图片生成非洲客户喜欢的单个产品的宣传单，附上商务营销文案，然后明天发送给customer@example.com这个客户。'
  });

  console.log('状态:', result.status);
  const body = result.body;
  console.log('任务ID:', body?.taskId);
  console.log('意图:', body?.intent);
  
  if (body?.taskId) {
    let done = false;
    for (let i = 0; i < 40 && !done; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const s = await req('GET', `/api/ai-command/tasks/${body.taskId}`);
      const task = s.body?.task || s.body;
      const status = task?.status;
      process.stdout.write(`[${(i+1)*5}s] ${status} `);
      
      if (task?.steps) {
        const running = task.steps.find(s => s.status === 'running');
        const done_steps = task.steps.filter(s => s.status === 'completed').length;
        process.stdout.write(`(${done_steps}/${task.steps.length}完成)`);
        if (running) process.stdout.write(` 正在: ${running.description}`);
      }
      console.log();
      
      if (status === 'completed' || status === 'failed') {
        done = true;
        console.log('\n=== 结果 ===');
        if (task?.steps) {
          task.steps.forEach(s => {
            const r = s.result ? (typeof s.result === 'string' ? s.result : JSON.stringify(s.result)).substring(0, 200) : '';
            console.log(`Step ${s.step_number} [${s.status}]: ${s.description}`);
            if (r) console.log(`  → ${r}`);
          });
        }
        console.log('\n摘要:', task?.summary || '无');
      }
    }
  }

  // Check scheduled tasks
  const scheduled = db.prepare("SELECT * FROM scheduled_tasks WHERE status='pending'").all();
  if (scheduled.length > 0) {
    console.log('\n📅 定时任务:');
    scheduled.forEach(t => console.log(`  ${t.type} → ${t.scheduled_at} (${t.status})`));
  }

  db.prepare("UPDATE users SET password=? WHERE username='admin'").run(orig);
  require('fs').unlinkSync(__filename);
}

run().catch(e => console.error(e));
