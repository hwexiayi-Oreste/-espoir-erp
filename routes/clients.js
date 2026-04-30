const express = require('express');
const { db, ready } = require('../database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// GET /api/clients — liste avec filtres
router.get('/', requireAuth, async (req, res) => {
  await ready;
  try {
    const { statut, q } = req.query;
    let sql = 'SELECT * FROM espoir_clients WHERE 1=1';
    const params = [];
    if (statut) { sql += ' AND statut = ?'; params.push(statut); }
    if (q)      { sql += ' AND (nom LIKE ? OR contact_nom LIKE ? OR ville LIKE ?)'; params.push('%'+q+'%','%'+q+'%','%'+q+'%'); }
    sql += ' ORDER BY nom ASC';
    const clients = await db.allAsync(sql, params);
    res.json({ ok: true, clients });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/clients/stats — KPIs
router.get('/stats', requireAuth, async (req, res) => {
  await ready;
  try {
    const stats = {
      total:    parseInt((await db.getAsync("SELECT COUNT(*) as n FROM espoir_clients"))?.n || 0),
      actifs:   parseInt((await db.getAsync("SELECT COUNT(*) as n FROM espoir_clients WHERE statut='actif'"))?.n || 0),
      prospects:parseInt((await db.getAsync("SELECT COUNT(*) as n FROM espoir_clients WHERE statut='prospect'"))?.n || 0),
      inactifs: parseInt((await db.getAsync("SELECT COUNT(*) as n FROM espoir_clients WHERE statut='inactif'"))?.n || 0),
      ca_total: parseFloat((await db.getAsync("SELECT COALESCE(SUM(montant_ht),0) as t FROM espoir_devis WHERE statut='accepte'"))?.t || 0),
    };
    res.json({ ok: true, stats });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/clients/:id — fiche client
router.get('/:id', requireAuth, async (req, res) => {
  await ready;
  try {
    const client = await db.getAsync('SELECT * FROM espoir_clients WHERE id = ?', [req.params.id]);
    if (!client) return res.status(404).json({ error: 'Client introuvable.' });

    const devis = await db.allAsync(
      'SELECT reference, service, montant_ht, statut, date_emission FROM espoir_devis WHERE client_id = ? ORDER BY id DESC',
      [req.params.id]
    );
    const chantiers = await db.allAsync(
      'SELECT reference, nom, type_service, statut, avancement, date_fin_prevue FROM espoir_chantiers WHERE client_id = ? ORDER BY id DESC',
      [req.params.id]
    );
    const ca = await db.getAsync(
      "SELECT COALESCE(SUM(montant_ht),0) as total FROM espoir_devis WHERE client_id = ? AND statut = 'accepte'",
      [req.params.id]
    );

    res.json({ ok: true, client, devis, chantiers, ca_total: ca.total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/clients — créer
router.post('/', requireAuth, async (req, res) => {
  await ready;
  try {
    const { nom, secteur, ville, telephone, email, contact_nom, contact_poste, statut, notes } = req.body;
    if (!nom) return res.status(400).json({ error: 'Le nom du client est requis.' });

    const result = await db.runAsync(
      'INSERT INTO espoir_clients (nom, secteur, ville, telephone, email, contact_nom, contact_poste, statut, notes) VALUES (?,?,?,?,?,?,?,?,?)',
      [nom, secteur||'', ville||'', telephone||'', email||'', contact_nom||'', contact_poste||'', statut||'prospect', notes||'']
    );
    await db.runAsync('INSERT INTO espoir_activite (user_id, action, detail) VALUES (?,?,?)',
      [req.session.user.id, 'Client créé', nom]);

    res.json({ ok: true, id: result.lastID });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/clients/:id — modifier
router.put('/:id', requireAuth, async (req, res) => {
  await ready;
  try {
    const { nom, secteur, ville, telephone, email, contact_nom, contact_poste, statut, notes } = req.body;
    if (!nom) return res.status(400).json({ error: 'Le nom est requis.' });

    await db.runAsync(
      'UPDATE espoir_clients SET nom=?, secteur=?, ville=?, telephone=?, email=?, contact_nom=?, contact_poste=?, statut=?, notes=? WHERE id=?',
      [nom, secteur||'', ville||'', telephone||'', email||'', contact_nom||'', contact_poste||'', statut||'actif', notes||'', req.params.id]
    );
    await db.runAsync('INSERT INTO espoir_activite (user_id, action, detail) VALUES (?,?,?)',
      [req.session.user.id, 'Client modifié', nom]);

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/clients/:id — supprimer
router.delete('/:id', requireAuth, async (req, res) => {
  await ready;
  try {
    const client = await db.getAsync('SELECT nom FROM espoir_clients WHERE id = ?', [req.params.id]);
    await db.runAsync('DELETE FROM espoir_clients WHERE id = ?', [req.params.id]);
    await db.runAsync('INSERT INTO espoir_activite (user_id, action, detail) VALUES (?,?,?)',
      [req.session.user.id, 'Client supprimé', client?.nom || '']);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
