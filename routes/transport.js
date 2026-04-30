const express = require('express');
const { db, ready } = require('../database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// GET /api/transport/stats
router.get('/stats', requireAuth, async (req, res) => {
  await ready;
  try {
    const stats = {
      total_vehicules:     parseInt((await db.getAsync("SELECT COUNT(*) as n FROM espoir_vehicules")).n || 0),
      disponibles:         parseInt((await db.getAsync("SELECT COUNT(*) as n FROM espoir_vehicules WHERE statut='disponible'")).n || 0),
      en_mission:          parseInt((await db.getAsync("SELECT COUNT(*) as n FROM espoir_vehicules WHERE statut='en_mission'")).n || 0),
      maintenance:         parseInt((await db.getAsync("SELECT COUNT(*) as n FROM espoir_vehicules WHERE statut='maintenance'")).n || 0),
      missions_en_cours:   parseInt((await db.getAsync("SELECT COUNT(*) as n FROM espoir_missions WHERE statut='en_cours'")).n || 0),
    };
    res.json({ ok: true, stats });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/transport/vehicules
router.get('/vehicules', requireAuth, async (req, res) => {
  await ready;
  try {
    const { statut, q } = req.query;
    let sql = 'SELECT * FROM espoir_vehicules WHERE 1=1';
    const params = [];
    if (statut) { sql += ' AND statut = ?'; params.push(statut); }
    if (q)      { sql += ' AND (immatriculation LIKE ? OR marque LIKE ? OR type_vehicule LIKE ?)'; params.push('%'+q+'%','%'+q+'%','%'+q+'%'); }
    sql += ' ORDER BY id DESC';
    const vehicules = await db.allAsync(sql, params);
    res.json({ ok: true, vehicules });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/transport/vehicules/:id
router.get('/vehicules/:id', requireAuth, async (req, res) => {
  await ready;
  try {
    const vehicule = await db.getAsync('SELECT * FROM espoir_vehicules WHERE id = ?', [req.params.id]);
    if (!vehicule) return res.status(404).json({ error: 'Véhicule introuvable.' });
    const missions = await db.allAsync(`
      SELECT m.*, c.nom as chantier_nom FROM espoir_missions m
      LEFT JOIN espoir_chantiers c ON m.chantier_id = c.id
      WHERE m.vehicule_id = ? ORDER BY m.id DESC LIMIT 10
    `, [req.params.id]);
    res.json({ ok: true, vehicule, missions });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/transport/vehicules
router.post('/vehicules', requireAuth, async (req, res) => {
  await ready;
  try {
    const { immatriculation, marque, modele, type_vehicule, capacite, chauffeur, date_maintenance, statut, notes } = req.body;
    if (!immatriculation) return res.status(400).json({ error: 'L\'immatriculation est requise.' });
    const result = await db.runAsync(
      'INSERT INTO espoir_vehicules (immatriculation, marque, modele, type_vehicule, capacite, chauffeur, date_maintenance, statut, notes) VALUES (?,?,?,?,?,?,?,?,?)',
      [immatriculation, marque||'', modele||'', type_vehicule||'', capacite||'', chauffeur||'', date_maintenance||null, statut||'disponible', notes||'']
    );
    await db.runAsync('INSERT INTO espoir_activite (user_id, action, detail) VALUES (?,?,?)',
      [req.session.user.id, 'Véhicule ajouté', immatriculation]);
    res.json({ ok: true, id: result.lastID });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/transport/vehicules/:id
router.put('/vehicules/:id', requireAuth, async (req, res) => {
  await ready;
  try {
    const { immatriculation, marque, modele, type_vehicule, capacite, chauffeur, date_maintenance, statut, notes } = req.body;
    await db.runAsync(
      'UPDATE espoir_vehicules SET immatriculation=?, marque=?, modele=?, type_vehicule=?, capacite=?, chauffeur=?, date_maintenance=?, statut=?, notes=? WHERE id=?',
      [immatriculation, marque||'', modele||'', type_vehicule||'', capacite||'', chauffeur||'', date_maintenance||null, statut||'disponible', notes||'', req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/transport/vehicules/:id
router.delete('/vehicules/:id', requireAuth, async (req, res) => {
  await ready;
  try {
    const v = await db.getAsync('SELECT immatriculation FROM espoir_vehicules WHERE id=?', [req.params.id]);
    await db.runAsync('DELETE FROM espoir_vehicules WHERE id=?', [req.params.id]);
    await db.runAsync('INSERT INTO espoir_activite (user_id, action, detail) VALUES (?,?,?)',
      [req.session.user.id, 'Véhicule supprimé', v?.immatriculation||'']);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/transport/missions
router.get('/missions', requireAuth, async (req, res) => {
  await ready;
  try {
    const missions = await db.allAsync(`
      SELECT m.*, v.immatriculation, v.type_vehicule, v.chauffeur, c.nom as chantier_nom
      FROM espoir_missions m
      LEFT JOIN espoir_vehicules v ON m.vehicule_id = v.id
      LEFT JOIN espoir_chantiers c ON m.chantier_id = c.id
      ORDER BY m.id DESC
    `);
    res.json({ ok: true, missions });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/transport/missions
router.post('/missions', requireAuth, async (req, res) => {
  await ready;
  try {
    const { vehicule_id, chantier_id, type_mission, depart, destination, date_debut, date_fin_prevue, notes } = req.body;
    if (!vehicule_id || !type_mission) return res.status(400).json({ error: 'Véhicule et type de mission requis.' });
    const result = await db.runAsync(
      'INSERT INTO espoir_missions (vehicule_id, chantier_id, type_mission, depart, destination, date_debut, date_fin_prevue, statut, notes) VALUES (?,?,?,?,?,?,?,?,?)',
      [vehicule_id, chantier_id||null, type_mission, depart||'', destination||'', date_debut||null, date_fin_prevue||null, 'planifie', notes||'']
    );
    // Mettre le véhicule en mission
    await db.runAsync("UPDATE espoir_vehicules SET statut='en_mission' WHERE id=?", [vehicule_id]);
    await db.runAsync('INSERT INTO espoir_activite (user_id, action, detail) VALUES (?,?,?)',
      [req.session.user.id, 'Mission créée', type_mission]);
    res.json({ ok: true, id: result.lastID });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/transport/missions/:id/statut
router.patch('/missions/:id/statut', requireAuth, async (req, res) => {
  await ready;
  try {
    const { statut } = req.body;
    await db.runAsync('UPDATE espoir_missions SET statut=? WHERE id=?', [statut, req.params.id]);
    if (statut === 'termine') {
      const m = await db.getAsync('SELECT vehicule_id FROM espoir_missions WHERE id=?', [req.params.id]);
      if (m) await db.runAsync("UPDATE espoir_vehicules SET statut='disponible' WHERE id=?", [m.vehicule_id]);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
