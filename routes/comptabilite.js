const express = require('express');
const { db, ready } = require('../database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// GET /api/comptabilite/stats
router.get('/stats', requireAuth, async (req, res) => {
  await ready;
  try {
    const stats = {
      total_factures:   parseInt((await db.getAsync("SELECT COUNT(*) as n FROM espoir_factures")).n || 0),
      en_attente:       parseInt((await db.getAsync("SELECT COUNT(*) as n FROM espoir_factures WHERE statut IN ('envoyee','en_retard')")).n || 0),
      payees:           parseInt((await db.getAsync("SELECT COUNT(*) as n FROM espoir_factures WHERE statut='payee'")).n || 0),
      en_retard:        parseInt((await db.getAsync("SELECT COUNT(*) as n FROM espoir_factures WHERE statut='en_retard'")).n || 0),
      ca_total:         parseFloat((await db.getAsync("SELECT COALESCE(SUM(montant_ttc),0) as t FROM espoir_factures WHERE statut != 'annulee'")).t || 0),
      ca_encaisse:      parseFloat((await db.getAsync("SELECT COALESCE(SUM(montant_ttc),0) as t FROM espoir_factures WHERE statut='payee'")).t || 0),
      ca_en_attente:    parseFloat((await db.getAsync("SELECT COALESCE(SUM(montant_ttc),0) as t FROM espoir_factures WHERE statut IN ('envoyee','en_retard')")).t || 0),
    };
    res.json({ ok: true, stats });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/comptabilite/factures
router.get('/factures', requireAuth, async (req, res) => {
  await ready;
  try {
    const { statut, q } = req.query;
    let sql = `
      SELECT f.*, c.nom as client_nom
      FROM espoir_factures f
      LEFT JOIN espoir_clients c ON f.client_id = c.id
      WHERE 1=1
    `;
    const params = [];
    if (statut) { sql += ' AND f.statut = ?'; params.push(statut); }
    if (q)      { sql += ' AND (f.reference LIKE ? OR c.nom LIKE ?)'; params.push('%'+q+'%','%'+q+'%'); }
    sql += ' ORDER BY f.id DESC';
    const factures = await db.allAsync(sql, params);
    res.json({ ok: true, factures });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/comptabilite/factures/:id
router.get('/factures/:id', requireAuth, async (req, res) => {
  await ready;
  try {
    const facture = await db.getAsync(`
      SELECT f.*, c.nom as client_nom, c.telephone as client_tel,
             c.email as client_email, c.ville as client_ville,
             c.contact_nom as client_contact
      FROM espoir_factures f
      LEFT JOIN espoir_clients c ON f.client_id = c.id
      WHERE f.id = ?
    `, [req.params.id]);
    if (!facture) return res.status(404).json({ error: 'Facture introuvable.' });
    const lignes = await db.allAsync(
      'SELECT * FROM espoir_facture_lignes WHERE facture_id = ? ORDER BY id',
      [req.params.id]
    );
    const paiements = await db.allAsync(
      'SELECT * FROM espoir_paiements WHERE facture_id = ? ORDER BY date_paiement DESC',
      [req.params.id]
    );
    res.json({ ok: true, facture, lignes, paiements });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/comptabilite/factures
router.post('/factures', requireAuth, async (req, res) => {
  await ready;
  try {
    const { client_id, devis_id, lignes, tva, date_echeance, notes } = req.body;
    if (!client_id) return res.status(400).json({ error: 'Client requis.' });

    // Générer référence
    const last = await db.getAsync("SELECT reference FROM espoir_factures ORDER BY id DESC LIMIT 1");
    let nextNum = 1;
    if (last?.reference) {
      const n = parseInt(last.reference.replace('FAC-','').replace(/-.*/,''));
      if (!isNaN(n)) nextNum = n + 1;
    }
    const year = new Date().getFullYear();
    const reference = `FAC-${String(nextNum).padStart(3,'0')}-${year}`;

    // Calculer totaux
    const tauxTVA = parseFloat(tva) || 18;
    let montantHT = 0;
    if (lignes && lignes.length > 0) {
      montantHT = lignes.reduce((s, l) => s + (parseFloat(l.quantite)||0) * (parseFloat(l.prix_unitaire)||0), 0);
    }
    const montantTVA = montantHT * tauxTVA / 100;
    const montantTTC = montantHT + montantTVA;

    const result = await db.runAsync(`
      INSERT INTO espoir_factures (reference, client_id, devis_id, montant_ht, tva, montant_tva, montant_ttc, statut, date_emission, date_echeance, notes)
      VALUES (?,?,?,?,?,?,?,'brouillon',CURRENT_DATE,?,?)
    `, [reference, client_id, devis_id||null, montantHT, tauxTVA, montantTVA, montantTTC, date_echeance||null, notes||'']);

    const factureId = result.lastID;

    if (lignes && lignes.length > 0) {
      for (const l of lignes) {
        const total = (parseFloat(l.quantite)||0) * (parseFloat(l.prix_unitaire)||0);
        await db.runAsync(
          'INSERT INTO espoir_facture_lignes (facture_id, designation, unite, quantite, prix_unitaire, total) VALUES (?,?,?,?,?,?)',
          [factureId, l.designation||'', l.unite||'', parseFloat(l.quantite)||0, parseFloat(l.prix_unitaire)||0, total]
        );
      }
    }

    await db.runAsync('INSERT INTO espoir_activite (user_id, action, detail) VALUES (?,?,?)',
      [req.session.user.id, 'Facture créée', reference]);

    res.json({ ok: true, id: factureId, reference });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/comptabilite/factures/:id/statut
router.patch('/factures/:id/statut', requireAuth, async (req, res) => {
  await ready;
  try {
    const { statut } = req.body;
    await db.runAsync('UPDATE espoir_factures SET statut=? WHERE id=?', [statut, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/comptabilite/factures/:id/paiement
router.post('/factures/:id/paiement', requireAuth, async (req, res) => {
  await ready;
  try {
    const { montant, mode_paiement, date_paiement, reference_paiement, notes } = req.body;
    if (!montant) return res.status(400).json({ error: 'Montant requis.' });

    await db.runAsync(
      'INSERT INTO espoir_paiements (facture_id, montant, mode_paiement, date_paiement, reference_paiement, notes) VALUES (?,?,?,?,?,?)',
      [req.params.id, parseFloat(montant), mode_paiement||'virement', date_paiement||null, reference_paiement||'', notes||'']
    );

    // Vérifier si totalement payé
    const facture = await db.getAsync('SELECT montant_ttc FROM espoir_factures WHERE id=?', [req.params.id]);
    const totalPaye = parseFloat((await db.getAsync('SELECT COALESCE(SUM(montant),0) as t FROM espoir_paiements WHERE facture_id=?', [req.params.id]))?.t || 0);

    if (facture && totalPaye >= parseFloat(facture.montant_ttc)) {
      await db.runAsync("UPDATE espoir_factures SET statut='payee' WHERE id=?", [req.params.id]);
    }

    await db.runAsync('INSERT INTO espoir_activite (user_id, action, detail) VALUES (?,?,?)',
      [req.session.user.id, 'Paiement enregistré', `${parseFloat(montant).toLocaleString('fr-FR')} FCFA`]);

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/comptabilite/devis-acceptes — pour créer facture depuis devis
router.get('/devis-acceptes', requireAuth, async (req, res) => {
  await ready;
  try {
    const devis = await db.allAsync(`
      SELECT d.*, c.nom as client_nom FROM espoir_devis d
      LEFT JOIN espoir_clients c ON d.client_id = c.id
      WHERE d.statut = 'accepte'
      ORDER BY d.id DESC
    `);
    res.json({ ok: true, devis });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// GET /api/comptabilite/seed — insérer données de démo (admin seulement)
router.get('/seed', requireAuth, async (req, res) => {
  await ready;
  try {
    if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé.' });
    
    const existing = await db.getAsync('SELECT COUNT(*) as n FROM espoir_factures');
    if (parseInt(existing?.n || 0) > 0) return res.json({ ok: true, message: 'Données déjà présentes.' });

    const factures = [
      ['FAC-001-2025',1,null,52000000,18,9360000,61360000,'payee','2025-04-25','2025-05-25','Facture finale hangar Bohicon'],
      ['FAC-002-2025',3,null,14200000,18,2556000,16756000,'payee','2025-04-20','2025-05-20','Groupes électrogènes BeninElec'],
      ['FAC-003-2025',2,null,38500000,18,6930000,45430000,'envoyee','2025-05-01','2025-06-01','Transport matériaux LogiTrans'],
      ['FAC-004-2025',4,null,74000000,18,13320000,87320000,'en_retard','2025-04-10','2025-05-10','Portiques portuaires PortCargo'],
    ];
    for (const f of factures) {
      const r = await db.runAsync(
        'INSERT INTO espoir_factures (reference,client_id,devis_id,montant_ht,tva,montant_tva,montant_ttc,statut,date_emission,date_echeance,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        f
      );
      // Ajouter une ligne par facture
      await db.runAsync(
        'INSERT INTO espoir_facture_lignes (facture_id,designation,unite,quantite,prix_unitaire,total) VALUES (?,?,?,?,?,?)',
        [r.lastID, 'Travaux selon devis', 'Forfait', 1, f[3], f[3]]
      );
    }
    // Paiements
    await db.runAsync('INSERT INTO espoir_paiements (facture_id,montant,mode_paiement,date_paiement,reference_paiement) VALUES (?,?,?,?,?)',
      [1,61360000,'virement','2025-05-20','VIR-20250520-001']);
    await db.runAsync('INSERT INTO espoir_paiements (facture_id,montant,mode_paiement,date_paiement,reference_paiement) VALUES (?,?,?,?,?)',
      [2,16756000,'cheque','2025-05-15','CHQ-20250515-001']);

    res.json({ ok: true, message: '4 factures de démo insérées.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
