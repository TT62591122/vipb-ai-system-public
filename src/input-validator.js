/**
 * 输入校验中间件
 * 用法: validateBody({ field: { type:'string', required:true, maxLength:255, pattern:/regex/ } })
 */

function validateBody(schema) {
  return (req, res, next) => {
    const errors = [];
    const body = req.body || {};

    for (const [field, rules] of Object.entries(schema)) {
      const value = body[field];

      // required check
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push({ field, message: `${field} 是必填项` });
        continue;
      }

      // skip further checks if not present and not required
      if (value === undefined || value === null || value === '') continue;

      // type check
      if (rules.type) {
        const actualType = typeof value;
        if (rules.type === 'number' && actualType !== 'number' && isNaN(Number(value))) {
          errors.push({ field, message: `${field} 必须是数字` });
          continue;
        }
        if (rules.type === 'string' && actualType !== 'string') {
          errors.push({ field, message: `${field} 必须是字符串` });
          continue;
        }
        if (rules.type === 'boolean' && actualType !== 'boolean') {
          errors.push({ field, message: `${field} 必须是布尔值` });
          continue;
        }
      }

      // maxLength check
      if (rules.maxLength && typeof value === 'string' && value.length > rules.maxLength) {
        errors.push({ field, message: `${field} 长度不能超过 ${rules.maxLength}` });
      }

      // minLength check
      if (rules.minLength && typeof value === 'string' && value.length < rules.minLength) {
        errors.push({ field, message: `${field} 长度不能少于 ${rules.minLength}` });
      }

      // pattern check
      if (rules.pattern && typeof value === 'string' && !rules.pattern.test(value)) {
        errors.push({ field, message: `${field} 格式不正确` });
      }

      // min/max for numbers
      if (rules.min !== undefined && Number(value) < rules.min) {
        errors.push({ field, message: `${field} 不能小于 ${rules.min}` });
      }
      if (rules.max !== undefined && Number(value) > rules.max) {
        errors.push({ field, message: `${field} 不能大于 ${rules.max}` });
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: '输入校验失败', fields: errors });
    }

    next();
  };
}

module.exports = { validateBody };
