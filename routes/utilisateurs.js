const express = require('express');
const bcrypt  = require('bcryptjs');
const { db, ready } = require('../database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// Middleware admin uniquement
function requireAdmin(req, res, next) {
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
  next();
}

// GET /api/utilisateurs
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  await ready;
  try {
    const users = await db.allAsync(
      'SELECT id, nom, prenom, email, role, actif, telephone, created_at, last_login FROM espoir_utilisateurs ORDER BY id ASC'
    );
    res.json({ ok: true, users });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/utilisateurs/:id
router.get('/:id', requireAuth, requireAdmin, async (req, res) => {
  await ready;
  try {
    const user = await db.getAsync(
      'SELECT id, nom, prenom, email, role, actif, telephone, created_at, last_login FROM espoir_utilisateurs WHERE id = ?',
      [req.params.id]
    );
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    res.json({ ok: true, user });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/utilisateurs — créer
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  await ready;
  try {
    const { nom, prenom, email, mot_de_passe, role, telephone } = req.body;
    if (!nom || !prenom || !email || !mot_de_passe) return res.status(400).json({ error: 'Nom, prénom, email et mot de passe requis.' });

    const existing = await db.getAsync('SELECT id FROM espoir_utilisateurs WHERE email = ?', [email.trim().toLowerCase()]);
    if (existing) return res.status(400).json({ error: 'Cet email est déjà utilisé.' });

    const hash = bcrypt.hashSync(mot_de_passe, 10);
    const result = await db.runAsync(
      'INSERT INTO espoir_utilisateurs (nom, prenom, email, mot_de_passe, role, telephone, actif) VALUES (?,?,?,?,?,?,1)',
      [nom.trim(), prenom.trim(), email.trim().toLowerCase(), hash, role||'technicien', telephone||'']
    );
    await db.runAsync('INSERT INTO espoir_activite (user_id, action, detail) VALUES (?,?,?)',
      [req.session.user.id, 'Utilisateur créé', `${prenom} ${nom} (${role})`]);
    res.json({ ok: true, id: result.lastID });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/utilisateurs/:id — modifier
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  await ready;
  try {
    const { nom, prenom, email, role, telephone } = req.body;
    if (!nom || !prenom || !email) return res.status(400).json({ error: 'Nom, prénom et email requis.' });

    await db.runAsync(
      'UPDATE espoir_utilisateurs SET nom=?, prenom=?, email=?, role=?, telephone=? WHERE id=?',
      [nom.trim(), prenom.trim(), email.trim().toLowerCase(), role||'technicien', telephone||'', req.params.id]
    );
    await db.runAsync('INSERT INTO espoir_activite (user_id, action, detail) VALUES (?,?,?)',
      [req.session.user.id, 'Utilisateur modifié', `${prenom} ${nom}`]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/utilisateurs/:id/actif — activer/désactiver
router.patch('/:id/actif', requireAuth, requireAdmin, async (req, res) => {
  await ready;
  try {
    if (parseInt(req.params.id) === req.session.user.id) return res.status(400).json({ error: 'Impossible de désactiver votre propre compte.' });
    const { actif } = req.body;
    await db.runAsync('UPDATE espoir_utilisateurs SET actif=? WHERE id=?', [actif ? 1 : 0, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/utilisateurs/:id/password — réinitialiser mot de passe
router.patch('/:id/password', requireAuth, requireAdmin, async (req, res) => {
  await ready;
  try {
    const { nouveau_mot_de_passe } = req.body;
    if (!nouveau_mot_de_passe || nouveau_mot_de_passe.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 caractères minimum).' });
    const hash = bcrypt.hashSync(nouveau_mot_de_passe, 10);
    await db.runAsync('UPDATE espoir_utilisateurs SET mot_de_passe=? WHERE id=?', [hash, req.params.id]);
    await db.runAsync('INSERT INTO espoir_activite (user_id, action, detail) VALUES (?,?,?)',
      [req.session.user.id, 'Mot de passe réinitialisé', `Utilisateur #${req.params.id}`]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
