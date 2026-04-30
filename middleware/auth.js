function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Non connecte' });
  res.redirect('/login');
}
module.exports = { requireAuth };
