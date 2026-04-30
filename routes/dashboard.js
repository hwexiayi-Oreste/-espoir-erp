const express = require('express');
const { db, ready } = require('../database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  await ready;
  try {
    const kpis = {
      chantiers_actifs:     (await db.getAsync("SELECT COUNT(*) as n FROM espoir_chantiers WHERE statut IN ('en_cours','retard')")).n,
      chantiers_retard:     (await db.getAsync("SELECT COUNT(*) as n FROM espoir_chantiers WHERE statut = 'retard'")).n,
      devis_en_attente:     (await db.getAsync("SELECT COUNT(*) as n FROM espoir_devis WHERE statut IN ('en_attente','envoye','expire_bientot')")).n,
      devis_expire_bientot: (await db.getAsync("SELECT COUNT(*) as n FROM espoir_devis WHERE statut = 'expire_bientot'")).n,
      clients_actifs:       (await db.getAsync("SELECT COUNT(*) as n FROM espoir_clients WHERE statut = 'actif'")).n,
      prospects:            (await db.getAsync("SELECT COUNT(*) as n FROM espoir_clients WHERE statut = 'prospect'")).n,
      pipeline_fcfa:        (await db.getAsync("SELECT COALESCE(SUM(montant_ht),0) as total FROM espoir_devis WHERE statut IN ('en_attente','envoye','expire_bientot')")).total,
      ca_acceptes:          (await db.getAsync("SELECT COALESCE(SUM(montant_ht),0) as total FROM espoir_devis WHERE statut = 'accepte'")).total,
    };

    const derniers_devis = await db.allAsync(`
      SELECT d.reference, d.montant_ht, d.statut, d.service, c.nom as client_nom
      FROM espoir_devis d LEFT JOIN clients c ON d.client_id = c.id
      ORDER BY d.id DESC LIMIT 5
    `);

    const chantiers = await db.allAsync(`
      SELECT ch.nom, ch.type_service, ch.lieu, ch.avancement, ch.statut, ch.date_fin_prevue, c.nom as client_nom
      FROM espoir_chantiers ch LEFT JOIN clients c ON ch.client_id = c.id
      WHERE ch.statut IN ('en_cours','retard','planifie')
      ORDER BY ch.avancement DESC LIMIT 5
    `);

    const alertes = await db.allAsync('SELECT * FROM espoir_alertes ORDER BY lu ASC, id DESC LIMIT 6');

    const activite = await db.allAsync(`
      SELECT a.action, a.detail, a.created_at, u.prenom || ' ' || u.nom as user_nom
      FROM espoir_activite a LEFT JOIN utilisateurs u ON a.user_id = u.id
      ORDER BY a.id DESC LIMIT 6
    `);

    res.json({ ok: true, kpis, derniers_devis, chantiers, alertes, activite });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.patch('/alerte/:id/lue', requireAuth, async (req, res) => {
  await db.runAsync('UPDATE espoir_alertes SET lu = 1 WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
