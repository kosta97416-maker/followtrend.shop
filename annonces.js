// ============================================================
// annonces.js — MODULE ÉCHANGE DE LIVRES (PostgreSQL)
// ------------------------------------------------------------
// Module autonome branché sur le server.js de Sophie Lumière.
// Stockage PERSISTANT des annonces de livres déposées par les lectrices
// dans PostgreSQL (Render Free), via la variable d'env DATABASE_URL.
//
// Branchement (une seule ligne dans server.js, avant express.static) :
//     require('./annonces')(app, agentLogs);
//
// Routes ajoutées :
//   POST   /api/annonces        → déposer une annonce
//   GET    /api/annonces        → lister les annonces actives
//   DELETE /api/annonces/:id    → retirer une annonce (CEO : ?auth=CEO_FOLLOW)
// ============================================================

const { Pool } = require('pg');

module.exports = function (app, agentLogs) {
    // agentLogs est optionnel (logs du dashboard). Filet si absent.
    if (!Array.isArray(agentLogs)) agentLogs = [];

    const DATABASE_URL = process.env.DATABASE_URL || "";
    let pool = null;

    if (DATABASE_URL) {
        pool = new Pool({
            connectionString: DATABASE_URL,
            // URL interne Render (host commençant par dpg-) : pas de SSL.
            // URL externe (.render.com complet) : SSL toléré.
            ssl: (DATABASE_URL.includes('.render.com') && !/@dpg-[^.]+-a[:/]/.test(DATABASE_URL))
                ? { rejectUnauthorized: false } : false
        });
        pool.on('error', (err) => console.error('Erreur pool PostgreSQL:', err.message));
    }

    // --- Création auto de la table au démarrage (idempotent) ---
    (async function initTable() {
        if (!pool) {
            console.log('⚠️ DATABASE_URL absent — page annonces désactivée (aucun stockage).');
            return;
        }
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS annonces (
                    id SERIAL PRIMARY KEY,
                    titre TEXT NOT NULL,
                    auteur TEXT,
                    etat TEXT,
                    prix TEXT,
                    ville TEXT,
                    contact TEXT NOT NULL,
                    site TEXT,
                    statut TEXT DEFAULT 'active',
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
            `);
            console.log('✅ Table annonces prête (PostgreSQL).');
        } catch (e) {
            console.error('Erreur création table annonces:', e.message);
        }
    })();

    // --- Helpers de nettoyage ---
    function clean(str, max) {
        if (str == null) return null;
        const s = String(str).trim();
        return s ? s.substring(0, max || 300) : null;
    }
    function cleanUrl(str) {
        if (!str) return null;
        let u = String(str).trim().substring(0, 300);
        if (!u) return null;
        if (!/^https?:\/\//i.test(u)) u = 'https://' + u; // tolère "maboutique.com"
        try { new URL(u); return u; } catch { return null; }
    }

    // ─── POST /api/annonces — déposer ───
    app.post('/api/annonces', async (req, res) => {
        if (!pool) return res.status(503).json({ ok: false, error: "Service annonces indisponible." });
        try {
            const b = req.body || {};
            const titre = clean(b.titre, 200);
            const contact = clean(b.contact, 300);
            if (!titre || !contact) {
                return res.status(400).json({ ok: false, error: "Le titre du livre et le moyen de contact sont obligatoires." });
            }
            const auteur = clean(b.auteur, 150);
            const etat = clean(b.etat, 40);
            const prix = clean(b.prix, 60);
            const ville = clean(b.ville, 120);
            const site = cleanUrl(b.site);

            const result = await pool.query(
                `INSERT INTO annonces (titre, auteur, etat, prix, ville, contact, site)
                 VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
                [titre, auteur, etat, prix, ville, contact, site]
            );
            agentLogs.unshift(`[${new Date().toLocaleTimeString('fr-FR')}] 📕 Nouvelle annonce : "${titre.substring(0, 40)}"`);
            res.json({ ok: true, id: result.rows[0].id });
        } catch (e) {
            console.error("Erreur POST /api/annonces:", e.message);
            res.status(500).json({ ok: false, error: "Impossible d'enregistrer l'annonce." });
        }
    });

    // ─── GET /api/annonces — lister ───
    app.get('/api/annonces', async (req, res) => {
        if (!pool) return res.json({ annonces: [] });
        try {
            const result = await pool.query(
                `SELECT id, titre, auteur, etat, prix, ville, contact, site, created_at
                 FROM annonces WHERE statut = 'active'
                 ORDER BY created_at DESC LIMIT 200`
            );
            res.json({ annonces: result.rows });
        } catch (e) {
            console.error("Erreur GET /api/annonces:", e.message);
            res.json({ annonces: [] });
        }
    });

    // ─── DELETE /api/annonces/:id — retirer (CEO uniquement) ───
    app.delete('/api/annonces/:id', async (req, res) => {
        if (!pool) return res.status(503).json({ ok: false });
        if (req.query.auth !== "CEO_FOLLOW") return res.status(403).json({ ok: false, error: "Non autorisé" });
        try {
            const id = parseInt(req.params.id, 10);
            if (isNaN(id)) return res.status(400).json({ ok: false });
            await pool.query(`UPDATE annonces SET statut = 'retiree' WHERE id = $1`, [id]);
            res.json({ ok: true });
        } catch (e) {
            console.error("Erreur DELETE /api/annonces:", e.message);
            res.status(500).json({ ok: false });
        }
    });

    console.log('📕 Module annonces branché (routes /api/annonces).');
};
