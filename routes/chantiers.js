const express = require('express');
const { db, ready } = require('../database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// GET /api/chantiers/stats
router.get('/stats', requireAuth, async (req, res) => {
  await ready;
  try {
    const stats = {
      total:    (await db.getAsync("SELECT COUNT(*) as n FROM chantiers")).n,
      en_cours: (await db.getAsync("SELECT COUNT(*) as n FROM chantiers WHERE statut='en_cours'")).n,
      retard:   (await db.getAsync("SELECT COUNT(*) as n FROM chantiers WHERE statut='retard'")).n,
      planifie: (await db.getAsync("SELECT COUNT(*) as n FROM chantiers WHERE statut='planifie'")).n,
      livre:    (await db.getAsync("SELECT COUNT(*) as n FROM chantiers WHERE statut='livre'")).n,
      budget_total:  (await db.getAsync("SELECT COALESCE(SUM(budget),0) as t FROM chantiers WHERE statut IN ('en_cours','retard')")).t,
      depense_total: (await db.getAsync("SELECT COALESCE(SUM(depense),0) as t FROM chantiers WHERE statut IN ('en_cours','retard')")).t,
    };
    res.json({ ok: true, stats });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/chantiers
router.get('/', requireAuth, async (req, res) => {
  await ready;
  try {
    const { statut, q } = req.query;
    let sql = `
      SELECT ch.*, c.nom as client_nom
      FROM chantiers ch
      LEFT JOIN clients c ON ch.client_id = c.id
      WHERE 1=1
    `;
    const params = [];
    if (statut) { sql += ' AND ch.statut = ?'; params.push(statut); }
    if (q)      { sql += ' AND (ch.nom LIKE ? OR ch.lieu LIKE ? OR ch.chef_chantier LIKE ?)'; params.push('%'+q+'%','%'+q+'%','%'+q+'%'); }
    sql += ' ORDER BY ch.id DESC';
    const chantiers = await db.allAsync(sql, params);
    res.json({ ok: true, chantiers });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/chantiers/:id
router.get('/:id', requireAuth, async (req, res) => {
  await ready;
  try {
    const chantier = await db.getAsync(`
      SELECT ch.*, c.nom as client_nom, c.telephone as client_tel, c.email as client_email
      FROM chantiers ch
      LEFT JOIN clients c ON ch.client_id = c.id
      WHERE ch.id = ?
    `, [req.params.id]);
    if (!chantier) return res.status(404).json({ error: 'Chantier introuvable.' });
    res.json({ ok: true, chantier });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/chantiers
router.post('/', requireAuth, async (req, res) => {
  await ready;
  try {
    const { nom, client_id, type_service, lieu, chef_chantier, date_debut, date_fin_prevue, budget, statut, notes } = req.body;
    if (!nom) return res.status(400).json({ error: 'Le nom du chantier est requis.' });

    // Générer référence automatique
    const last = await db.getAsync("SELECT reference FROM chantiers ORDER BY id DESC LIMIT 1");
    let nextNum = 33;
    if (last && last.reference) {
      const n = parseInt(last.reference.replace('CH-',''));
      if (!isNaN(n)) nextNum = n + 1;
    }
    const reference = `CH-${String(nextNum).padStart(3,'0')}`;

    const result = await db.runAsync(`
      INSERT INTO chantiers (reference, nom, client_id, type_service, lieu, chef_chantier, date_debut, date_fin_prevue, budget, depense, avancement, statut, notes)
      VALUES (?,?,?,?,?,?,?,?,?,0,0,?,?)
    `, [reference, nom, client_id||null, type_service||'', lieu||'', chef_chantier||'', date_debut||null, date_fin_prevue||null, parseFloat(budget)||0, statut||'planifie', notes||'']);

    await db.runAsync('INSERT INTO activite (user_id, action, detail) VALUES (?,?,?)',
      [req.session.user.id, 'Chantier créé', `${reference} - ${nom}`]);

    res.json({ ok: true, id: result.lastID, reference });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/chantiers/:id
router.put('/:id', requireAuth, async (req, res) => {
  await ready;
  try {
    const { nom, client_id, type_service, lieu, chef_chantier, date_debut, date_fin_prevue, date_fin_reelle, budget, depense, avancement, statut, notes } = req.body;
    if (!nom) return res.status(400).json({ error: 'Le nom est requis.' });

    await db.runAsync(`
      UPDATE chantiers SET
        nom=?, client_id=?, type_service=?, lieu=?, chef_chantier=?,
        date_debut=?, date_fin_prevue=?, date_fin_reelle=?,
        budget=?, depense=?, avancement=?, statut=?, notes=?
      WHERE id=?
    `, [nom, client_id||null, type_service||'', lieu||'', chef_chantier||'',
        date_debut||null, date_fin_prevue||null, date_fin_reelle||null,
        parseFloat(budget)||0, parseFloat(depense)||0, parseInt(avancement)||0,
        statut||'planifie', notes||'', req.params.id]);

    await db.runAsync('INSERT INTO activite (user_id, action, detail) VALUES (?,?,?)',
      [req.session.user.id, 'Chantier modifié', nom]);

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/chantiers/:id/avancement
router.patch('/:id/avancement', requireAuth, async (req, res) => {
  await ready;
  try {
    const { avancement, statut } = req.body;
    await db.runAsync(
      'UPDATE chantiers SET avancement=?, statut=? WHERE id=?',
      [parseInt(avancement)||0, statut||'en_cours', req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/chantiers/:id
router.delete('/:id', requireAuth, async (req, res) => {
  await ready;
  try {
    const ch = await db.getAsync('SELECT nom FROM chantiers WHERE id=?', [req.params.id]);
    await db.runAsync('DELETE FROM chantiers WHERE id=?', [req.params.id]);
    await db.runAsync('INSERT INTO activite (user_id, action, detail) VALUES (?,?,?)',
      [req.session.user.id, 'Chantier supprimé', ch?.nom||'']);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
