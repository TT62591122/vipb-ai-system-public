/**
 * 认证中间件 — 保护所有路由
 */

/**
 * 检查用户是否已登录
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  
  // API请求返回JSON错误
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ success: false, error: '未登录，请先登录' });
  }
  
  // 页面请求重定向到登录页，记住原始URL以便登录后跳回
  req.session.returnTo = req.originalUrl;
  res.redirect('/login');
}

/**
 * 检查是否已登录（用于登录页，已登录则跳转到首页）
 */
function redirectIfAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard');
  }
  next();
}

module.exports = { requireAuth, redirectIfAuth };
