const express = require('express');
const { db, ready } = require('../database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// GET /api/chantiers/stats
router.get('/stats', requireAuth, async (req, res) => {
  await ready;
  try {
    const stats = {
      total:    parseInt((await db.getAsync("SELECT COUNT(*) as n FROM espoir_chantiers"))?.n || 0),
      en_cours: parseInt((await db.getAsync("SELECT COUNT(*) as n FROM espoir_chantiers WHERE statut='en_cours'"))?.n || 0),
      retard:   parseInt((await db.getAsync("SELECT COUNT(*) as n FROM espoir_chantiers WHERE statut='retard'"))?.n || 0),
      planifie: parseInt((await db.getAsync("SELECT COUNT(*) as n FROM espoir_chantiers WHERE statut='planifie'"))?.n || 0),
      livre:    parseInt((await db.getAsync("SELECT COUNT(*) as n FROM espoir_chantiers WHERE statut='livre'"))?.n || 0),
      budget_total:  parseFloat((await db.getAsync("SELECT COALESCE(SUM(budget),0) as t FROM espoir_chantiers WHERE statut IN ('en_cours','retard')"))?.t || 0),
      depense_total: parseFloat((await db.getAsync("SELECT COALESCE(SUM(depense),0) as t FROM espoir_chantiers WHERE statut IN ('en_cours','retard')"))?.t || 0),
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
      FROM espoir_chantiers ch
      LEFT JOIN espoir_clients c ON ch.client_id = c.id
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

// GET /api/chantiers/:id — avec phases
router.get('/:id', requireAuth, async (req, res) => {
  await ready;
  try {
    const chantier = await db.getAsync(`
      SELECT ch.*, c.nom as client_nom, c.telephone as client_tel, c.email as client_email
      FROM espoir_chantiers ch
      LEFT JOIN espoir_clients c ON ch.client_id = c.id
      WHERE ch.id = ?
    `, [req.params.id]);
    if (!chantier) return res.status(404).json({ error: 'Chantier introuvable.' });

    const phases = await db.allAsync(
      'SELECT * FROM espoir_chantier_phases WHERE chantier_id = ? ORDER BY ordre ASC',
      [req.params.id]
    );

    res.json({ ok: true, chantier, phases });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/chantiers
router.post('/', requireAuth, async (req, res) => {
  await ready;
  try {
    const { nom, client_id, type_service, lieu, chef_chantier, date_debut, date_fin_prevue, budget, statut, notes, phases } = req.body;
    if (!nom) return res.status(400).json({ error: 'Le nom du chantier est requis.' });

    const last = await db.getAsync("SELECT reference FROM espoir_chantiers ORDER BY id DESC LIMIT 1");
    let nextNum = 33;
    if (last && last.reference) {
      const n = parseInt(last.reference.replace('CH-',''));
      if (!isNaN(n)) nextNum = n + 1;
    }
    const reference = `CH-${String(nextNum).padStart(3,'0')}`;

    const result = await db.runAsync(`
      INSERT INTO espoir_chantiers (reference, nom, client_id, type_service, lieu, chef_chantier, date_debut, date_fin_prevue, budget, depense, avancement, statut, notes)
      VALUES (?,?,?,?,?,?,?,?,?,0,0,?,?)
    `, [reference, nom, client_id||null, type_service||'', lieu||'', chef_chantier||'', date_debut||null, date_fin_prevue||null, parseFloat(budget)||0, statut||'planifie', notes||'']);

    const chantierID = result.lastID;

    // Insérer les phases par défaut selon le type de service
    const phasesDefaut = getPhasesDefaut(type_service);
    const phasesAInserer = (phases && phases.length > 0) ? phases : phasesDefaut;
    for (let i = 0; i < phasesAInserer.length; i++) {
      const p = phasesAInserer[i];
      await db.runAsync(
        'INSERT INTO espoir_chantier_phases (chantier_id, nom, avancement, statut, ordre) VALUES (?,?,?,?,?)',
        [chantierID, p.nom, p.avancement||0, p.statut||'a_faire', i+1]
      );
    }

    await db.runAsync('INSERT INTO espoir_activite (user_id, action, detail) VALUES (?,?,?)',
      [req.session.user.id, 'Chantier créé', `${reference} - ${nom}`]);

    res.json({ ok: true, id: chantierID, reference });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/chantiers/:id
router.put('/:id', requireAuth, async (req, res) => {
  await ready;
  try {
    const { nom, client_id, type_service, lieu, chef_chantier, date_debut, date_fin_prevue, date_fin_reelle, budget, depense, avancement, statut, notes, phases } = req.body;
    if (!nom) return res.status(400).json({ error: 'Le nom est requis.' });

    await db.runAsync(`
      UPDATE espoir_chantiers SET
        nom=?, client_id=?, type_service=?, lieu=?, chef_chantier=?,
        date_debut=?, date_fin_prevue=?, date_fin_reelle=?,
        budget=?, depense=?, avancement=?, statut=?, notes=?
      WHERE id=?
    `, [nom, client_id||null, type_service||'', lieu||'', chef_chantier||'',
        date_debut||null, date_fin_prevue||null, date_fin_reelle||null,
        parseFloat(budget)||0, parseFloat(depense)||0, parseInt(avancement)||0,
        statut||'planifie', notes||'', req.params.id]);

    // Mettre à jour les phases si fournies
    if (phases && phases.length > 0) {
      for (const p of phases) {
        if (p.id) {
          await db.runAsync(
            'UPDATE espoir_chantier_phases SET nom=?, avancement=?, statut=? WHERE id=?',
            [p.nom, p.avancement||0, p.statut||'a_faire', p.id]
          );
        }
      }
      // Recalculer avancement global depuis les phases
      const avancementMoyen = Math.round(phases.reduce((s,p) => s + (p.avancement||0), 0) / phases.length);
      await db.runAsync('UPDATE espoir_chantiers SET avancement=? WHERE id=?', [avancementMoyen, req.params.id]);
    }

    await db.runAsync('INSERT INTO espoir_activite (user_id, action, detail) VALUES (?,?,?)',
      [req.session.user.id, 'Chantier modifié', nom]);

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/chantiers/:id
router.delete('/:id', requireAuth, async (req, res) => {
  await ready;
  try {
    await db.runAsync('DELETE FROM espoir_chantier_phases WHERE chantier_id=?', [req.params.id]);
    const ch = await db.getAsync('SELECT nom FROM espoir_chantiers WHERE id=?', [req.params.id]);
    await db.runAsync('DELETE FROM espoir_chantiers WHERE id=?', [req.params.id]);
    await db.runAsync('INSERT INTO espoir_activite (user_id, action, detail) VALUES (?,?,?)',
      [req.session.user.id, 'Chantier supprimé', ch?.nom||'']);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Phases par défaut selon le type de service
function getPhasesDefaut(service) {
  const phases = {
    'Construction Metallique': [
      { nom: 'Études et plans d\'exécution' },
      { nom: 'Approvisionnement matériaux' },
      { nom: 'Fabrication charpente' },
      { nom: 'Fondations et ancrage' },
      { nom: 'Montage structure métallique' },
      { nom: 'Couverture et bardage' },
      { nom: 'Finitions et réception' },
    ],
    'Genie Civil': [
      { nom: 'Études géotechniques' },
      { nom: 'Terrassement général' },
      { nom: 'Fondations' },
      { nom: 'Gros œuvre (béton armé)' },
      { nom: 'Réseaux et VRD' },
      { nom: 'Finitions' },
      { nom: 'Réception et livraison' },
    ],
    'Transport': [
      { nom: 'Planification et autorisations' },
      { nom: 'Mobilisation véhicules' },
      { nom: 'Chargement' },
      { nom: 'Transport' },
      { nom: 'Déchargement et livraison' },
    ],
    'Manutention': [
      { nom: 'Préparation du site' },
      { nom: 'Installation équipements de levage' },
      { nom: 'Opération de manutention' },
      { nom: 'Mise en place et ancrage' },
      { nom: 'Tests et réception' },
    ],
  };
  return phases[service] || [
    { nom: 'Préparation' },
    { nom: 'Exécution' },
    { nom: 'Finitions' },
    { nom: 'Réception' },
  ];
}

module.exports = router;

// PATCH /api/chantiers/phase/:id — mettre à jour avancement d'une phase
router.patch('/phase/:id', requireAuth, async (req, res) => {
  await ready;
  try {
    const { avancement } = req.body;
    const pct = Math.min(100, Math.max(0, parseInt(avancement)||0));
    const statut = pct >= 100 ? 'termine' : pct > 0 ? 'en_cours' : 'a_faire';
    await db.runAsync(
      'UPDATE espoir_chantier_phases SET avancement=?, statut=? WHERE id=?',
      [pct, statut, req.params.id]
    );
    // Recalculer avancement global du chantier
    const phase = await db.getAsync('SELECT chantier_id FROM espoir_chantier_phases WHERE id=?', [req.params.id]);
    if (phase) {
      const avg = await db.getAsync('SELECT AVG(avancement) as moy FROM espoir_chantier_phases WHERE chantier_id=?', [phase.chantier_id]);
      const moy = Math.round(parseFloat(avg?.moy)||0);
      await db.runAsync('UPDATE espoir_chantiers SET avancement=? WHERE id=?', [moy, phase.chantier_id]);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
