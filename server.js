const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// --- CONFIGURATION ---
const SHOPIFY_URL = "https://6bbgv0-f4.myshopify.com";

// Mémoire vive du Dashboard
let currentOrder = `<div style="text-align:center; padding:20px; color:#555;"><h3>SYSTÈME EN VEILLE</h3><p>Prêt pour analyse...</p></div>`;
let currentStats = { shopify: "0.00", amazon: "0.00", ai: "0.00" };

// --- 🧠 AGENT LOGISTIQUE (RECHERCHE INTELLIGENTE) ---
async function findProductOnShopify(keyword) {
    try {
        // Le paramètre ?v= force Shopify à nous donner les derniers noms modifiés
        const response = await fetch(`${SHOPIFY_URL}/products.json?v=${Date.now()}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const data = await response.json();
        const products = data.products || [];

        const search = keyword.toLowerCase().trim();
        console.log(`[IA] Recherche de : "${search}" parmi ${products.length} produits`);

        // STRATÉGIE DE RECHERCHE PAR PRIORITÉ :
        
        // 1. Priorité au TITRE (Évite les erreurs comme la lampe torche)
        let match = products.find(p => p.title.toLowerCase().includes(search));

        // 2. Si rien dans le titre, on cherche dans les TAGS
        if (!match) {
            match = products.find(p => (p.tags || "").toLowerCase().includes(search));
        }

        // 3. En dernier recours, dans la DESCRIPTION (mais de façon stricte)
        if (!match) {
            match = products.find(p => {
                const body = (p.body_html || "").toLowerCase();
                // On cherche le mot avec des espaces autour pour éviter "Water" dans "Waterproof"
                return body.includes(" " + search + " ");
            });
        }

        return match;
    } catch (error) {
        console.error("Erreur Scan Shopify:", error);
        return null;
    }
}

// --- 📡 ROUTE ALERTE (Bouton Tester l'IA) ---
app.post('/api/agent-alert', async (req, res) => {
    const { keyword, user_issue, auth } = req.body;

    if (auth !== "CEO_FOLLOW") {
        return res.status(403).json({ error: "Accès refusé" });
    }

    // On utilise le mot-clé tapé par le CEO
    const product = await findProductOnShopify(keyword);

    if (product) {
        currentOrder = `
            <div style="background:#000; color:#00ff00; border:2px solid #00ff00; padding:15px; border-radius:10px; font-family:sans-serif;">
                <div style="font-size:0.7em; margin-bottom:5px; opacity:0.6;">RÉSULTAT ANALYSE ✅</div>
                <h3 style="margin:0; text-transform:uppercase;">${product.title}</h3>
                <div style="display:flex; gap:15px; margin-top:10px; background:#111; padding:10px; border-radius:5px;">
                    <img src="${product.images[0]?.src || ''}" style="width:70px; height:70px; object-fit:cover; border:1px solid #333;">
                    <div>
                        <span style="display:block; color:white; font-size:1.1em; font-weight:bold;">${product.variants[0]?.price}€</span>
                        <span style="color:#888; font-size:0.8em;">Stock : OK</span>
                        <a href="${SHOPIFY_URL}/products/${product.handle}" target="_blank" style="display:block; margin-top:5px; color:#00ff00; text-decoration:none; font-size:0.8em;">🔗 VOIR SUR SHOP</a>
                    </div>
                </div>
            </div>
        `;
        res.json({ status: "SUCCESS" });
    } else {
        currentOrder = `
            <div style="border: 1px solid #ff4444; padding: 15px; background: #111; color: #ff4444; border-radius:10px;">
                <h3 style="margin:0;">⚠️ AUCUN MATCH</h3>
                <p>Le mot "${keyword}" n'existe pas dans le catalogue.</p>
            </div>
        `;
        res.json({ status: "NOT_FOUND" });
    }
});

// --- ROUTES DASHBOARD ---
app.get('/api/get-order', (req, res) => res.send(currentOrder));

app.get('/api/stats', (req, res) => res.json(currentStats));

app.post('/api/update-stats', (req, res) => {
    if (req.body.auth === "CEO_FOLLOW") {
        currentStats = { ...currentStats, ...req.body.stats };
        res.sendStatus(200);
    } else {
        res.sendStatus(403);
    }
});

app.use(express.static(__dirname));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// LANCEMENT
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(` SERVEUR CEO FOLLOW ACTIF SUR PORT ${PORT}`);
    console.log(`=========================================`);
});
