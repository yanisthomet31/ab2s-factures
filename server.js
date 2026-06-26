const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3738;
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Base de données ──────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function query(text, params) {
  const client = await pool.connect();
  try { return await client.query(text, params); }
  finally { client.release(); }
}

async function initDB() {
  await query(`
    CREATE TABLE IF NOT EXISTS factures (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      fournisseur TEXT NOT NULL,
      montant NUMERIC DEFAULT 0,
      periode DATE,
      action TEXT DEFAULT 'En attente',
      statut TEXT DEFAULT 'À traiter',
      detail TEXT,
      comment TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ Base de données initialisée');
}

// ─── Routes Factures ──────────────────────────────────
app.get('/api/factures', async (req, res) => {
  try {
    const { search, statut, action, mois, annee } = req.query;
    let text = 'SELECT * FROM factures WHERE 1=1';
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      const n = params.length;
      text += ` AND (fournisseur ILIKE $${n} OR "comment" ILIKE $${n})`;
    }
    if (statut) { params.push(statut); text += ` AND statut = $${params.length}`; }
    if (action) { params.push(action); text += ` AND action = $${params.length}`; }
    if (annee)  { params.push(annee);  text += ` AND EXTRACT(YEAR FROM periode) = $${params.length}`; }
    if (mois)   { params.push(mois);   text += ` AND TO_CHAR(periode,'YYYY-MM') = $${params.length}`; }

    text += ' ORDER BY periode DESC NULLS LAST, created_at DESC';
    const r = await query(text, params);
    res.json(r.rows);
  } catch(e) {
    console.error('GET /api/factures', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/factures/:id', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM factures WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Introuvable' });
    res.json(rows[0]);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/factures', async (req, res) => {
  try {
    const f = req.body;
    const { rows } = await query(`
      INSERT INTO factures (type, fournisseur, montant, periode, action, statut, detail, "comment")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [f.type, f.fournisseur, parseFloat(f.montant)||0, f.periode||null,
       f.action||'En attente', f.statut||'À traiter', f.detail||null, f.comment||null]);
    res.json({ id: rows[0].id });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/factures/:id', async (req, res) => {
  try {
    const f = req.body;
    await query(`
      UPDATE factures SET type=$1, fournisseur=$2, montant=$3, periode=$4,
        action=$5, statut=$6, detail=$7, "comment"=$8, updated_at=NOW()
      WHERE id=$9`,
      [f.type, f.fournisseur, parseFloat(f.montant)||0, f.periode||null,
       f.action, f.statut, f.detail||null, f.comment||null, req.params.id]);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/factures/:id', async (req, res) => {
  try {
    await query('DELETE FROM factures WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Import CSV ───────────────────────────────────────
app.post('/api/import/csv', upload.single('file'), async (req, res) => {
  try {
    const content = req.file.buffer.toString('utf8');
    const lines = content.split('\n').filter(l => l.trim());
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g,''));

    let imported = 0;
    for (let i = 1; i < lines.length; i++) {
      const vals = parseCSVLine(lines[i]);
      if (vals.length < 2) continue;

      const row = {};
      headers.forEach((h, idx) => row[h] = (vals[idx]||'').replace(/^"|"$/g,'').trim());

      const type = row['type'] || 'Autres';
      const fournisseur = row['fournisseur'] || row['supplier'] || '?';
      const montant = parseFloat(row['montant'] || row['amount'] || '0') || 0;
      const periode = parseDate(row['periode'] || row['date'] || row['period']);
      const action = row['action'] || 'En attente';
      const statut = row['statut'] || row['status'] || 'À traiter';
      const detail = row['detail'] || row['url'] || '';
      const comment = row['comment'] || row['commentaire'] || '';

      if (!fournisseur || fournisseur === '?') continue;

      await query(`
        INSERT INTO factures (type, fournisseur, montant, periode, action, statut, detail, "comment")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [type, fournisseur, montant, periode, action, statut, detail, comment]);
      imported++;
    }
    res.json({ ok: true, imported });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQuotes = !inQuotes; }
    else if (line[i] === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += line[i]; }
  }
  result.push(current);
  return result;
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0,10);
}

// ─── KPI ─────────────────────────────────────────────
app.get('/api/kpi', async (req, res) => {
  try {
    const { annee } = req.query;
    const where = annee ? `AND EXTRACT(YEAR FROM periode) = ${parseInt(annee)}` : '';
    const whereOnly = annee ? `WHERE EXTRACT(YEAR FROM periode) = ${parseInt(annee)}` : 'WHERE 1=1';

    // Totaux GLOBAUX (toutes années confondues — jamais filtrés)
    const [gTotR, gMontRecupR, gMontTraiterR, gMontImpossibleR, anneesR] = await Promise.all([
      query('SELECT COUNT(*) n FROM factures'),
      query("SELECT COALESCE(SUM(montant),0) s FROM factures WHERE statut='Récupérée'"),
      query("SELECT COALESCE(SUM(montant),0) s FROM factures WHERE statut IN ('À traiter','En cours')"),
      query("SELECT COALESCE(SUM(montant),0) s FROM factures WHERE statut='Impossible à récupérer'"),
      query(`SELECT DISTINCT EXTRACT(YEAR FROM periode)::int annee FROM factures
             WHERE periode IS NOT NULL ORDER BY annee DESC`)
    ]);

    // Stats ANNUELLES (filtrées par année si fournie)
    const [totR, traiterR, coursR, recupereesR, impossibleR,
           montTraiterR, montRecupR, montImpossibleR,
           typeR, statutR, moisR, moisStatutR] = await Promise.all([
      query(`SELECT COUNT(*) n FROM factures ${whereOnly}`),
      query(`SELECT COUNT(*) n FROM factures ${whereOnly} AND statut='À traiter'`),
      query(`SELECT COUNT(*) n FROM factures ${whereOnly} AND statut='En cours'`),
      query(`SELECT COUNT(*) n FROM factures ${whereOnly} AND statut='Récupérée'`),
      query(`SELECT COUNT(*) n FROM factures ${whereOnly} AND statut='Impossible à récupérer'`),
      query(`SELECT COALESCE(SUM(montant),0) s FROM factures ${whereOnly} AND statut IN ('À traiter','En cours')`),
      query(`SELECT COALESCE(SUM(montant),0) s FROM factures ${whereOnly} AND statut='Récupérée'`),
      query(`SELECT COALESCE(SUM(montant),0) s FROM factures ${whereOnly} AND statut='Impossible à récupérer'`),
      query(`SELECT type, COUNT(*) n, COALESCE(SUM(montant),0) montant FROM factures ${whereOnly} GROUP BY type ORDER BY n DESC`),
      query(`SELECT statut, COUNT(*) n FROM factures ${whereOnly} GROUP BY statut`),
      query(`SELECT TO_CHAR(periode,'YYYY-MM') mois, COUNT(*) n, COALESCE(SUM(montant),0) montant
             FROM factures ${whereOnly} AND periode IS NOT NULL
             GROUP BY mois ORDER BY mois ASC`),
      query(`SELECT TO_CHAR(periode,'YYYY-MM') mois, statut, COUNT(*) n, COALESCE(SUM(montant),0) montant
             FROM factures ${whereOnly} AND periode IS NOT NULL
             GROUP BY mois, statut ORDER BY mois ASC`)
    ]);

    res.json({
      // Globaux
      global_total: parseInt(gTotR.rows[0].n),
      global_montant_recupere: parseFloat(gMontRecupR.rows[0].s),
      global_montant_a_traiter: parseFloat(gMontTraiterR.rows[0].s),
      global_montant_impossible: parseFloat(gMontImpossibleR.rows[0].s),
      annees: anneesR.rows.map(r => r.annee),
      // Annuels
      total: parseInt(totR.rows[0].n),
      a_traiter: parseInt(traiterR.rows[0].n),
      en_cours: parseInt(coursR.rows[0].n),
      recuperees: parseInt(recupereesR.rows[0].n),
      impossibles: parseInt(impossibleR.rows[0].n),
      montant_a_traiter: parseFloat(montTraiterR.rows[0].s),
      montant_recupere: parseFloat(montRecupR.rows[0].s),
      montant_impossible: parseFloat(montImpossibleR.rows[0].s),
      par_type: typeR.rows,
      par_statut: statutR.rows,
      par_mois: moisR.rows,
      par_mois_statut: moisStatutR.rows
    });
  } catch(e) {
    console.error('GET /api/kpi', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Export CSV ───────────────────────────────────────
app.get('/api/export/csv', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM factures ORDER BY periode DESC');
    const headers = ['ID','Type','Fournisseur','Montant','Période','Action','Statut','Détail','Commentaire','Créé le'];
    const csv = [
      headers.join(';'),
      ...rows.map(r => [r.id, r.type, r.fournisseur, r.montant,
        r.periode ? r.periode.toISOString().slice(0,10) : '',
        r.action, r.statut, r.detail||'',
        `"${(r.comment||'').replace(/"/g,'""')}"`,
        r.created_at.toISOString().slice(0,10)].join(';'))
    ].join('\n');
    res.setHeader('Content-Type','text/csv;charset=utf-8');
    res.setHeader('Content-Disposition','attachment;filename="factures_ab2s.csv"');
    res.send('﻿' + csv);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Démarrage ────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('\n╔════════════════════════════════════════════╗');
    console.log('║   AB2S Sécurité — Suivi Factures          ║');
    console.log('╚════════════════════════════════════════════╝');
    console.log(`\n✅ Serveur démarré sur le port ${PORT}\n`);
  });
}).catch(err => {
  console.error('❌ Erreur DB:', err.message);
  process.exit(1);
});
