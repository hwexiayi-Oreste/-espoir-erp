const sqlite3 = require('sqlite3').verbose();
const bcrypt  = require('bcryptjs');
const path    = require('path');
const fs      = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'espoir.db');
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}

const db = new sqlite3.Database(DB_PATH);

db.runAsync = (sql, p) => new Promise((res, rej) => {
  db.run(sql, p || [], function(e) { if (e) rej(e); else res({ lastID: this.lastID }); });
});
db.getAsync = (sql, p) => new Promise((res, rej) => {
  db.get(sql, p || [], (e, r) => { if (e) rej(e); else res(r); });
});
db.allAsync = (sql, p) => new Promise((res, rej) => {
  db.all(sql, p || [], (e, r) => { if (e) rej(e); else res(r); });
});
db.execAsync = (sql) => new Promise((res, rej) => {
  db.exec(sql, (e) => { if (e) rej(e); else res(); });
});

async function initDB() {
  await db.runAsync('PRAGMA foreign_keys = ON');

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS utilisateurs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT, prenom TEXT, email TEXT UNIQUE,
      mot_de_passe TEXT, role TEXT DEFAULT 'technicien',
      actif INTEGER DEFAULT 1, telephone TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    );
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT, secteur TEXT, ville TEXT,
      telephone TEXT, email TEXT,
      contact_nom TEXT, contact_poste TEXT,
      statut TEXT DEFAULT 'actif', notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS devis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT UNIQUE, client_id INTEGER,
      service TEXT, montant_ht REAL DEFAULT 0,
      tva REAL DEFAULT 18, montant_ttc REAL DEFAULT 0,
      statut TEXT DEFAULT 'brouillon',
      date_emission TEXT, date_validite TEXT,
      chef_projet TEXT, description TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS chantiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT UNIQUE, nom TEXT,
      client_id INTEGER, type_service TEXT,
      lieu TEXT, chef_chantier TEXT,
      date_debut TEXT, date_fin_prevue TEXT,
      avancement INTEGER DEFAULT 0,
      budget REAL DEFAULT 0, depense REAL DEFAULT 0,
      statut TEXT DEFAULT 'planifie', notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS alertes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT, titre TEXT, message TEXT,
      lien_type TEXT, lien_id INTEGER,
      lu INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS activite (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, action TEXT, detail TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const row = await db.getAsync('SELECT COUNT(*) as n FROM utilisateurs');
  if (row.n === 0) {
    console.log('Insertion des donnees initiales...');
    await seedData();
    console.log('Base de donnees prete.');
  }
}

async function seedData() {
  const h = p => bcrypt.hashSync(p, 10);

  const users = [
    ['Gbedo',    'Moussa',    'admin@espoir.bj',      h('admin123'), 'admin',     '+229 01 94 00 00 01'],
    ['Akpovi',   'Directeur', 'directeur@espoir.bj',  h('dir123'),   'directeur', '+229 01 94 00 00 02'],
    ['Agbossou', 'Fernande',  'comptable@espoir.bj',  h('compta123'),'comptable', '+229 01 94 00 00 03'],
    ['Togbe',    'Kafil',     'technique@espoir.bj',  h('tech123'),  'technicien','+229 01 94 00 00 04'],
    ['Adjoumani','Kofi',      'client@espoir.bj',     h('client123'),'client',    '+229 01 97 12 34 56'],
  ];
  for (const u of users)
    await db.runAsync('INSERT INTO utilisateurs (nom,prenom,email,mot_de_passe,role,telephone) VALUES (?,?,?,?,?,?)', u);

  const clients = [
    ['Groupe Agro Benin',          'Agro-alimentaire','Cotonou',      '+229 01 94 50 21 00','mbocossa@agrobenin.bj',  'Marie-Claire Bocossa','PDG',              'actif',   'Client strategique.'],
    ['LogiTrans SARL',             'Logistique',      'Cotonou',      '+229 01 97 12 34 56','kadjou@logitrans.bj',   'Kofi Adjoumani',      'Directeur General','actif',   'Premier client construction metallique.'],
    ['BeninElec SA',               'Energie',         'Abomey-Calavi','+229 01 95 44 78 90','shounsinou@beninelec.bj','Samuel Hounsinou',   'Resp. Technique',  'actif',   'Specialiste projets energie.'],
    ['PortCargo International SA', 'Logistique',      'Cotonou',      '+229 01 98 23 45 67','jpakpovi@portcargo.bj', 'Jean-Paul Akpovi',    'Dir. Operations',  'actif',   'Nouveau client strategique.'],
    ['Ministere des Travaux Publics','Public',         'Cotonou',      '+229 01 20 00 10 00','marches@mtp.gouv.bj',  'Dir. Marches Publics','Direction',        'actif',   'Partenaire institutionnel.'],
    ['Ciments du Benin SA',        'Industrie',       'Onigbolo',     '+229 01 23 45 67 89','ifarouk@cimbenin.bj',  'Ibrahim Farouk',      'DGA',              'inactif', 'En attente renouvellement.'],
    ['Energie Plus Benin',         'Energie',         'Parakou',      '+229 01 65 43 21 00','rdossou@energieplus.bj','Rodrigue Dossou',     'Dir. Technique',   'prospect','Devis en evaluation.'],
    ['Horizon BTP SARL',           'BTP',             'Bohicon',      '+229 01 55 66 77 88','czinsou@horizonbtp.bj', 'Clement Zinsou',     'Gerant',           'prospect','Nouveau prospect.'],
  ];
  for (const c of clients)
    await db.runAsync('INSERT INTO clients (nom,secteur,ville,telephone,email,contact_nom,contact_poste,statut,notes) VALUES (?,?,?,?,?,?,?,?,?)', c);

  const devis = [
    ['DEV-2025-091',8,'Genie Civil',           18200000,18,21476000, 'en_attente',   '2025-05-14','2025-06-14','Ing. Pierre Aikpon','Terrassement fondations batiment R+2.',1],
    ['DEV-2025-090',4,'Manutention',            74000000,18,87320000, 'envoye',       '2025-05-12','2025-06-12','Ing. Kafil Togbe',  'Installation 4 portiques portuaires.',1],
    ['DEV-2025-089',2,'Transport',              38500000,18,45430000, 'expire_bientot','2025-04-30','2025-05-16','Resp. Transport',  'Transport materiaux 12 mois.',1],
    ['DEV-2025-088',5,'Genie Civil',           210000000,18,247800000,'envoye',       '2025-05-08','2025-07-08','Ing. Adrien Dossou','Construction pont RN2 portee 60m.',1],
    ['DEV-2025-087',7,'Construction Metallique',56800000,18,67024000, 'en_attente',   '2025-05-05','2025-06-05','Ing. Marcel Hounsa','Hangar industriel 3200 m2.',1],
    ['DEV-2025-081',1,'Genie Civil',            52000000,18,61360000, 'accepte',      '2025-04-20','2025-05-20','Ing. Pascal Aikpon','Fondations siege social 2200 m2.',1],
    ['DEV-2025-079',3,'Manutention',            14200000,18,16756000, 'accepte',      '2025-04-15','2025-05-15','Ing. Kafil Togbe',  'Installation groupes electrogenes 80T.',1],
    ['DEV-2025-074',6,'Transport',              29500000,18,34810000, 'expire',       '2025-04-02','2025-05-02','Resp. Transport',  'Transport clinker Onigbolo-Cotonou.',1],
  ];
  for (const d of devis)
    await db.runAsync('INSERT INTO devis (reference,client_id,service,montant_ht,tva,montant_ttc,statut,date_emission,date_validite,chef_projet,description,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', d);

  const chantiers = [
    ['CH-028','Complexe Industriel Port-Nord', 2,'Construction Metallique','Cotonou Zone Portuaire','Ing. Kafil Togbe',   '2025-02-01','2025-06-30',72, 98500000, 72300000,'en_cours','Retard J+4.'],
    ['CH-031','Zone Franche Logistique Est',   4,'Genie Civil',           'Seme-Podji',            'Ing. Pascal Aikpon', '2025-03-10','2025-11-30',38,420000000,158000000,'en_cours','Dans les delais.'],
    ['CH-029','Pont RN2 Echangeur Sud',        5,'Genie Civil',           'Parakou',               'Ing. Adrien Dossou', '2025-06-01','2026-02-28',15,210000000, 12000000,'planifie','Demarrage juin 2025.'],
    ['CH-025','Hangar Agricole Bohicon',       1,'Construction Metallique','Bohicon',               'Ing. Marcel Hounsa', '2025-01-15','2025-05-31',89, 52000000, 47500000,'en_cours','Livraison fin mai.'],
    ['CH-032','Siege CEB Nouvelle Aile',       3,'Genie Civil',           'Cotonou',               'Ing. Rodrigue Kpade','2025-06-15','2026-03-30', 5,124000000,  4500000,'planifie','Demarrage juin 2025.'],
    ['CH-030','Route Lokossa-Aplahoue',        5,'Genie Civil',           'Lokossa',               'Ing. Faustin Akpovo','2025-02-20','2025-08-31',45, 85000000, 42000000,'retard',  'Retard pluies mars.'],
  ];
  for (const c of chantiers)
    await db.runAsync('INSERT INTO chantiers (reference,nom,client_id,type_service,lieu,chef_chantier,date_debut,date_fin_prevue,avancement,budget,depense,statut,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', c);

  const alertes = [
    ['danger', 'Chantier Port-Nord : retard J+4',   'Livraison charpente repoussee - action requise', null,null,0],
    ['warning','Devis DEV-2025-089 expire dans 48h', 'LogiTrans SARL - 38,5M FCFA',                   null,null,0],
    ['success','Devis DEV-2025-081 accepte',          'Groupe Agro Benin - 52M FCFA',                  null,null,0],
    ['info',   'Camion TG-4 : maintenance planifiee', 'Controle technique le 16/05',                   null,null,0],
    ['warning','Nouveau client enregistre',           'Horizon BTP SARL',                              null,null,1],
  ];
  for (const a of alertes)
    await db.runAsync('INSERT INTO alertes (type,titre,message,lien_type,lien_id,lu) VALUES (?,?,?,?,?,?)', a);

  const acts = [
    [1,'Devis cree',      'DEV-2025-091 - Horizon BTP - 18,2M FCFA'],
    [4,'Rapport chantier','CH-028 Port-Nord - Avancement 72%'],
    [1,'Facture reglee',  'FAC-2025-044 - BeninElec SA - 7,8M FCFA'],
    [2,'Contrat signe',   'Zone Franche Est - 124M FCFA - 18 mois'],
    [1,'Vehicule affecte','TG-7 - CH-031 - Transport materiaux'],
    [3,'Facture emise',   'FAC-2025-045 - PortCargo - 12,4M FCFA'],
  ];
  for (const a of acts)
    await db.runAsync('INSERT INTO activite (user_id,action,detail) VALUES (?,?,?)', a);
}

const ready = initDB().catch(err => {
  console.error('Erreur base de donnees:', err.message);
  process.exit(1);
});

module.exports = { db, ready };
