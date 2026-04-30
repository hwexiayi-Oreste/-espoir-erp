const express = require('express');
const { db, ready } = require('../database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// Middleware client uniquement
function requireClient(req, res, next) {
  if (req.session.user.role !== 'client') return res.status(403).json({ error: 'Accès réservé aux clients.' });
  next();
}

// GET /api/espace-client/profil — trouver le client lié à cet utilisateur
router.get('/profil', requireAuth, requireClient, async (req, res) => {
  await ready;
  try {
    // Chercher le client par email
    const client = await db.getAsync(
      'SELECT * FROM espoir_clients WHERE email = ?',
      [req.session.user.email]
    );
    res.json({ ok: true, client: client || null, user: req.session.user });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/espace-client/devis
router.get('/devis', requireAuth, requireClient, async (req, res) => {
  await ready;
  try {
    const client = await db.getAsync('SELECT id FROM espoir_clients WHERE email = ?', [req.session.user.email]);
    if (!client) return res.json({ ok: true, devis: [] });

    const devis = await db.allAsync(`
      SELECT d.*, c.nom as client_nom
      FROM espoir_devis d
      LEFT JOIN espoir_clients c ON d.client_id = c.id
      WHERE d.client_id = ?
      ORDER BY d.id DESC
    `, [client.id]);
    res.json({ ok: true, devis });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/espace-client/chantiers
router.get('/chantiers', requireAuth, requireClient, async (req, res) => {
  await ready;
  try {
    const client = await db.getAsync('SELECT id FROM espoir_clients WHERE email = ?', [req.session.user.email]);
    if (!client) return res.json({ ok: true, chantiers: [] });

    const chantiers = await db.allAsync(`
      SELECT ch.*
      FROM espoir_chantiers ch
      WHERE ch.client_id = ?
      ORDER BY ch.id DESC
    `, [client.id]);
    res.json({ ok: true, chantiers });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/espace-client/factures
router.get('/factures', requireAuth, requireClient, async (req, res) => {
  await ready;
  try {
    const client = await db.getAsync('SELECT id FROM espoir_clients WHERE email = ?', [req.session.user.email]);
    if (!client) return res.json({ ok: true, factures: [] });

    const factures = await db.allAsync(`
      SELECT f.*
      FROM espoir_factures f
      WHERE f.client_id = ?
      ORDER BY f.id DESC
    `, [client.id]);
    res.json({ ok: true, factures });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/espace-client/stats
router.get('/stats', requireAuth, requireClient, async (req, res) => {
  await ready;
  try {
    const client = await db.getAsync('SELECT id FROM espoir_clients WHERE email = ?', [req.session.user.email]);
    if (!client) return res.json({ ok: true, stats: { devis: 0, chantiers: 0, factures: 0, ca: 0 } });

    const stats = {
      devis:     parseInt((await db.getAsync('SELECT COUNT(*) as n FROM espoir_devis WHERE client_id = ?', [client.id]))?.n || 0),
      chantiers: parseInt((await db.getAsync('SELECT COUNT(*) as n FROM espoir_chantiers WHERE client_id = ?', [client.id]))?.n || 0),
      factures:  parseInt((await db.getAsync("SELECT COUNT(*) as n FROM espoir_factures WHERE client_id = ?", [client.id]))?.n || 0),
      ca:        parseFloat((await db.getAsync("SELECT COALESCE(SUM(montant_ttc),0) as t FROM espoir_factures WHERE client_id = ? AND statut = 'payee'", [client.id]))?.t || 0),
      en_cours:  parseInt((await db.getAsync("SELECT COUNT(*) as n FROM espoir_chantiers WHERE client_id = ? AND statut = 'en_cours'", [client.id]))?.n || 0),
    };
    res.json({ ok: true, stats, client_id: client.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
