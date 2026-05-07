const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const SHOPIFY_URL = "https://6bbgv0-f4.myshopify.com";

// --- BASE DE CONNAISSANCE (Synonymes) ---
const KNOWLEDGE = {
    "feu": ["fire", "starter", "magnesium", "allume", "briquet"],
    "eau": ["water", "filter", "purifier", "straw", "paille"],
    "sac": ["bag", "backpack", "survie", "kit"]
};

let currentOrder = "<h1>SYSTÈME PRÊT</h1>";

async function getShopifyProducts() {
    try {
        const response = await fetch(`${SHOPIFY_URL}/products.json`);
        const data = await response.json();
        return data.products || [];
    } catch (e) {
        console.error("ERREUR ACCÈS SHOPIFY:", e);
        return [];
    }
}

app.post('/api/agent-alert', async (req, res) => {
    const { keyword, user_issue, auth } = req.body;
    if (auth !== "CEO_FOLLOW") return res.sendStatus(403);

    const query = (user_issue || keyword || "").toLowerCase();
    const products = await getShopifyProducts();

    // On prépare les mots à chercher (Input + Synonymes)
    let searchTerms = [query];
    for (let key in KNOWLEDGE) {
        if (query.includes(key)) searchTerms = [...searchTerms, ...KNOWLEDGE[key]];
    }

    // RECHERCHE
    const found = products.find(p => {
        const text = (p.title + p.body_html + p.handle).toLowerCase();
        return searchTerms.some(term => text.includes(term));
    });

    if (found) {
        currentOrder = `
            <div style="background:#000; color:#00ff00; border:2px solid #00ff00; padding:15px; border-radius:10px;">
                <h3>🎯 PRODUIT TROUVÉ</h3>
                <p><b>${found.title}</b></p>
                <img src="${found.images[0]?.src}" style="width:100%; max-width:100px;">
                <br>
                <a href="${SHOPIFY_URL}/products/${found.handle}" target="_blank" style="color:#00ff00;">LIEN PRODUIT</a>
            </div>
        `;
        res.json({ status: "OK" });
    } else {
        currentOrder = `<div style="color:orange;">IA : Rien trouvé pour "${query}". Vérifie l'orthographe ou le catalogue.</div>`;
        res.json({ status: "NOT_FOUND" });
    }
});

app.get('/api/get-order', (req, res) => res.send(currentOrder));
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(process.env.PORT || 10000, () => console.log("SERVEUR ONLINE"));
