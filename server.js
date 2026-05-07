const express = require('express');
const cors = require('cors');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const SHOPIFY_URL = "https://6bbgv0-f4.myshopify.com";
const SHOPIFY_CATALOG = `${SHOPIFY_URL}/products.json`;

let currentOrder = `<div style="text-align:center; padding:20px; color:#555;"><h3>IA EN ATTENTE D'ANALYSE</h3></div>`;
let currentStats = { shopify: "0.00", amazon: "0.00", ai: "0.00" };

// --- 🤖 FONCTION D'INTELLIGENCE (AGENT LOGISTIQUE AVANCÉ) ---
async function findProductOnShopify(rawInput) {
    try {
        const response = await fetch(SHOPIFY_CATALOG, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const data = await response.json();
        if (!data.products) return null;

        // Nettoyage de l'entrée (On enlève les articles inutiles)
        const input = rawInput.toLowerCase()
            .replace(/(le |la |les |un |une |des |pour |comment )/g, "")
            .trim();

        // LOGIQUE DE COMPRÉHENSION :
        // Si l'utilisateur dit "Allume feu", l'IA sait qu'il cherche aussi "Fire" ou "Magnesium"
        const keywords = {
            "feu": ["fire", "starter", "allume", "lighter", "magnesium", "étincelle"],
            "eau": ["water", "purifier", "filter", "paille", "straw", "purification"],
            "froid": ["blanket", "couverture", "survie", "heat", "chaud"],
            "manger": ["food", "ration", "mre", "repas", "cuisson"],
            "sac": ["bag", "backpack", "tactique", "survie"]
        };

        let termsToSearch = [input];
        // On cherche si un concept de survie est présent dans la phrase
        for (let concept in keywords) {
            if (input.includes(concept)) {
                termsToSearch = [...termsToSearch, ...keywords[concept]];
            }
        }

        console.log("[IA LOGISTIQUE] Recherche de ces concepts :", termsToSearch);

        return data.products.find(p => {
            const description = (p.title + " " + (p.body_html || "")).toLowerCase();
            return termsToSearch.some(term => description.includes(term));
        });

    } catch (error) {
        console.error("Erreur IA Logistique:", error);
        return null;
    }
}

app.post('/api/agent-alert', async (req, res) => {
    const { keyword, platform, user_issue, auth } = req.body;
    if (auth !== "CEO_FOLLOW") return res.sendStatus(403);

    // L'IA analyse la phrase complète reçue (user_issue) au lieu du simple mot-clé
    const product = await findProductOnShopify(user_issue || keyword);

    if (product) {
        currentOrder = `
            <div style="border: 2px solid #00ff00; padding: 15px; background: #000; color: #00ff00; border-radius: 8px; font-family: sans-serif;">
                <div style="margin-bottom:10px; font-size:0.7em; color:#888;">ANALYSE IA : INTENTION DÉTECTÉE ✅</div>
                <h3 style="margin:0; color:#00ff00;">🎯 MATCH : ${product.title}</h3>
                <div style="display:flex; gap:10px; margin-top:10px; background:#111; padding:10px;">
                    <img src="${product.images?.[0]?.src || ''}" style="width:60px; height:60px; object-fit:cover;">
                    <div>
                        <span style="display:block; color:white; font-weight:bold;">${product.variants[0]?.price}€</span>
                        <a href="${SHOPIFY_URL}/products/${product.handle}" target="_blank" style="color:#00ff00; text-decoration:none; font-size:0.8em;">🔗 Voir sur le Shop</a>
                    </div>
                </div>
            </div>
        `;
        res.json({ status: "SUCCESS" });
    } else {
        currentOrder = `<div style="border: 1px solid #444; padding:15px; color:#888;">IA : Aucun produit correspondant à cette situation.</div>`;
        res.json({ status: "NOT_FOUND" });
    }
});

// --- ROUTES STANDARDS ---
app.get('/api/get-order', (req, res) => res.send(currentOrder));
app.get('/api/stats', (req, res) => res.json(currentStats));
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`CERVEAU IA ACTIF`));
