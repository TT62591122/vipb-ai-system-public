/**
 * 产品库 API
 */
const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

router.get('/', (req, res) => {
  try {
  const db = req.app.locals.db;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const paginate = req.query.page !== undefined;

  if (paginate) {
    const total = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
    const data = db.prepare('SELECT * FROM products ORDER BY id LIMIT ? OFFSET ?').all(limit, offset);
    res.json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } else {
    res.json(db.prepare('SELECT * FROM products ORDER BY id').all());
  }
  } catch(e) { console.error('[Products] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

// 产品图片上传
const productImageStorage = multer.diskStorage({
  destination: function(req, file, cb) {
    const dir = path.join(__dirname, '..', 'data', 'product-images');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function(req, file, cb) {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `product_${Date.now()}_${Math.random().toString(36).slice(2,8)}${ext}`);
  }
});
const productUpload = multer({ 
  storage: productImageStorage, 
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('只允许上传图片文件'));
  }
});

router.post('/upload-images', productUpload.array('images', 10), (req, res) => {
  try {
  if (!req.files || !req.files.length) {
    return res.json({ success: false, error: '没有上传文件' });
  }
  const urls = req.files.map(f => `/product-images/${f.filename}`);
  res.json({ success: true, urls });
  } catch(e) { console.error('[Products] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.get('/:id', (req, res) => {
  try {
  const p = req.app.locals.db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
  } catch(e) { console.error('[Products] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.post('/', (req, res) => {
  try {
  const db = req.app.locals.db;
  const { name, category, model, description, specs, price_100, price_500, price_1000, moq, currency, images, certifications } = req.body;
  const r = db.prepare('INSERT INTO products (name,category,model,description,specs,price_100,price_500,price_1000,moq,currency,images,certifications) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(name, category, model, description, JSON.stringify(specs||{}), price_100, price_500, price_1000, moq||100, currency||'USD', JSON.stringify(images||[]), JSON.stringify(certifications||[]));
  req.app.locals.auditLog('created', 'product', r.lastInsertRowid, { name, category });
  res.json({ id: r.lastInsertRowid, success: true });
  } catch(e) { console.error('[Products] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.put('/:id', (req, res) => {
  try {
  const db = req.app.locals.db;
  const fields = ['name','category','model','description','ai_description','specs','price_100','price_500','price_1000','moq','currency','images','certifications','video_script','is_active'];
  const updates = []; const params = [];
  fields.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f}=?`); params.push(typeof req.body[f] === 'object' ? JSON.stringify(req.body[f]) : req.body[f]); }});
  updates.push("updated_at=datetime('now')");
  params.push(req.params.id);
  db.prepare(`UPDATE products SET ${updates.join(',')} WHERE id=?`).run(...params);
  res.json({ success: true });
  } catch(e) { console.error('[Products] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/:id', (req, res) => {
  try {
  req.app.locals.db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);
  req.app.locals.auditLog('deleted', 'product', parseInt(req.params.id), {});
  res.json({ success: true });
  } catch(e) { console.error('[Products] 错误:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
