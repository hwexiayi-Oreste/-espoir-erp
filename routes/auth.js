const express = require('express');
const bcrypt  = require('bcryptjs');
const { db, ready } = require('../database');
const router  = express.Router();

router.post('/login', async (req, res) => {
  await ready;
  const { email, mot_de_passe } = req.body;
  if (!email || !mot_de_passe)
    return res.status(400).json({ error: 'Email et mot de passe requis.' });
  try {
    const user = await db.getAsync(
      'SELECT * FROM espoir_utilisateurs WHERE email = ? AND actif = 1',
      [email.trim().toLowerCase()]
    );
    if (!user) return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
    if (!bcrypt.compareSync(mot_de_passe, user.mot_de_passe))
      return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
    await db.runAsync('UPDATE espoir_utilisateurs SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
    req.session.user = { id: user.id, nom: user.nom, prenom: user.prenom, email: user.email, role: user.role };
    const redirect = req.session.user.role === 'client' ? '/espace-client' : '/dashboard';
    res.json({ ok: true, user: req.session.user, redirect });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (req.session && req.session.user) return const redirect = req.session.user.role === 'client' ? '/espace-client' : '/dashboard';
    res.json({ ok: true, user: req.session.user, redirect });
  res.status(401).json({ ok: false });
});

module.exports = router;
