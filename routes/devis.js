const express = require('express');
const { db, ready } = require('../database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// GET /api/devis — liste avec filtres
router.get('/', requireAuth, async (req, res) => {
  await ready;
  try {
    const { statut, service, q } = req.query;
    let sql = `
      SELECT d.*, c.nom as client_nom, c.ville as client_ville
      FROM espoir_devis d LEFT JOIN clients c ON d.client_id = c.id
      WHERE 1=1
    `;
    const params = [];
    if (statut)  { sql += ' AND d.statut = ?';          params.push(statut); }
    if (service) { sql += ' AND d.service = ?';         params.push(service); }
    if (q)       { sql += ' AND (d.reference LIKE ? OR c.nom LIKE ?)'; params.push('%'+q+'%','%'+q+'%'); }
    sql += ' ORDER BY d.id DESC';
    const devis = await db.allAsync(sql, params);
    res.json({ ok: true, devis });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/devis/:id — détail d'un devis avec ses lignes
router.get('/:id', requireAuth, async (req, res) => {
  await ready;
  try {
    const devis = await db.getAsync(`
      SELECT d.*, c.nom as client_nom, c.email as client_email,
             c.telephone as client_tel, c.ville as client_ville,
             c.contact_nom, c.contact_poste
      FROM espoir_devis d LEFT JOIN clients c ON d.client_id = c.id
      WHERE d.id = ?
    `, [req.params.id]);
    if (!devis) return res.status(404).json({ error: 'Devis introuvable.' });
    const lignes = await db.allAsync('SELECT * FROM espoir_devis_lignes WHERE devis_id = ? ORDER BY id', [req.params.id]);
    res.json({ ok: true, devis, lignes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/devis — créer un devis
router.post('/', requireAuth, async (req, res) => {
  await ready;
  try {
    const { client_id, service, chef_projet, description, date_validite, lignes } = req.body;
    if (!client_id || !service) return res.status(400).json({ error: 'Client et service requis.' });

    // Générer référence automatique
    const last = await db.getAsync("SELECT reference FROM espoir_devis ORDER BY id DESC LIMIT 1");
    let nextNum = 1;
    if (last) {
      const parts = last.reference.split('-');
      nextNum = parseInt(parts[parts.length - 1]) + 1;
    }
    const year = new Date().getFullYear();
    const reference = `DEV-${year}-${String(nextNum).padStart(3,'0')}`;

    // Calculer montants depuis les lignes
    let montant_ht = 0;
    const lignesData = lignes || [];
    for (const l of lignesData) {
      l.total = parseFloat(l.quantite || 0) * parseFloat(l.prix_unitaire || 0);
      montant_ht += l.total;
    }
    const tva = 18;
    const montant_ttc = montant_ht * (1 + tva / 100);

    const result = await db.runAsync(`
      INSERT INTO espoir_devis (reference, client_id, service, montant_ht, tva, montant_ttc,
        statut, date_emission, date_validite, chef_projet, description, created_by)
      VALUES (?, ?, ?, ?, ?, ?, 'brouillon', date('now'), ?, ?, ?, ?)
    `, [reference, client_id, service, montant_ht, tva, montant_ttc,
        date_validite || null, chef_projet || null, description || null, req.session.user.id]);

    for (const l of lignesData) {
      await db.runAsync(`
        INSERT INTO espoir_devis_lignes (devis_id, designation, unite, quantite, prix_unitaire, total)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [result.lastID, l.designation, l.unite || '', l.quantite || 1, l.prix_unitaire || 0, l.total]);
    }

    await db.runAsync('INSERT INTO espoir_activite (user_id,action,detail) VALUES (?,?,?)',
      [req.session.user.id, 'Devis cree', `${reference} - ${service}`]);

    res.json({ ok: true, id: result.lastID, reference });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/devis/:id/statut — changer le statut
router.patch('/:id/statut', requireAuth, async (req, res) => {
  await ready;
  try {
    const { statut } = req.body;
    const statuts = ['brouillon','en_attente','envoye','accepte','refuse','expire'];
    if (!statuts.includes(statut)) return res.status(400).json({ error: 'Statut invalide.' });
    await db.runAsync('UPDATE espoir_devis SET statut = ? WHERE id = ?', [statut, req.params.id]);
    const d = await db.getAsync('SELECT reference FROM espoir_devis WHERE id = ?', [req.params.id]);
    await db.runAsync('INSERT INTO espoir_activite (user_id,action,detail) VALUES (?,?,?)',
      [req.session.user.id, 'Statut devis modifie', `${d.reference} → ${statut}`]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/devis/:id — supprimer un devis
router.delete('/:id', requireAuth, async (req, res) => {
  await ready;
  try {
    await db.runAsync('DELETE FROM espoir_devis_lignes WHERE devis_id = ?', [req.params.id]);
    await db.runAsync('DELETE FROM espoir_devis WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/devis/stats/resume — stats pour KPIs
router.get('/stats/resume', requireAuth, async (req, res) => {
  await ready;
  try {
    const stats = {
      total:          parseInt((await db.getAsync("SELECT COUNT(*) as n FROM espoir_devis"))?.n || 0),
      en_attente:     parseInt((await db.getAsync("SELECT COUNT(*) as n FROM espoir_devis WHERE statut IN ('en_attente','envoye','expire_bientot')"))?.n || 0),
      acceptes:       parseInt((await db.getAsync("SELECT COUNT(*) as n FROM espoir_devis WHERE statut = 'accepte'"))?.n || 0),
      pipeline:       parseFloat((await db.getAsync("SELECT COALESCE(SUM(montant_ht),0) as t FROM espoir_devis WHERE statut IN ('en_attente','envoye','expire_bientot')"))?.t || 0),
      ca_accepte:     parseFloat((await db.getAsync("SELECT COALESCE(SUM(montant_ht),0) as t FROM espoir_devis WHERE statut = 'accepte'"))?.t || 0),
      taux_conversion:parseInt((await db.getAsync("SELECT COUNT(*) as n FROM espoir_devis WHERE statut IN ('accepte','refuse')"))?.n || 0),
      nb_acceptes_calc:parseInt((await db.getAsync("SELECT COUNT(*) as n FROM espoir_devis WHERE statut = 'accepte'"))?.n || 0),
    };
    if (stats.taux_conversion > 0)
      stats.taux = Math.round((stats.nb_acceptes_calc / stats.taux_conversion) * 100);
    else stats.taux = 0;
    res.json({ ok: true, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
