const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ============================================================
// CONFIG
// ============================================================
const SHOPIFY_URL = "https://6bbgv0-f4.myshopify.com"; // URL technique Shopify (nom affiché: follow.life)
const AMAZON_TAG = "followtrend-21"; // Ton tag affilié Amazon (à remplacer)
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";

// ============================================================
// ÉTAT GLOBAL (en mémoire - persist tant que le serveur tourne)
// ============================================================
let prospects = [];
let agentLogs = [];
let stats = {
    visiteursAujourdhui: 0,
    clicsAffiliation: 0,
    prospectsTrouves: 0,
    revenusEstimes: 0
};

// Produits survie/résilience phares pour la recherche
const PRODUITS_CLES = [
    { nom: "Kit survie", keywords: ["kit survie", "survival kit", "trousse urgence"], shopifyHandle: "kit-survie", amazonSearch: "kit+survie+camping" },
    { nom: "Filtre eau", keywords: ["filtre eau", "water filter", "purification eau"], shopifyHandle: "filtre-eau", amazonSearch: "filtre+eau+survie+lifestraw" },
    { nom: "Couverture urgence", keywords: ["couverture survie", "couverture urgence", "emergency blanket"], shopifyHandle: "couverture-urgence", amazonSearch: "couverture+urgence+survie" },
    { nom: "Lampe frontale", keywords: ["lampe frontale", "headlamp", "torche rechargeable"], shopifyHandle: "lampe-frontale", amazonSearch: "lampe+frontale+led+survie" },
    { nom: "Nourriture urgence", keywords: ["nourriture urgence", "ration survie", "freeze dried food"], shopifyHandle: "ration-survie", amazonSearch: "ration+alimentaire+urgence+survie" },
    { nom: "Couteau survie", keywords: ["couteau survie", "couteau tactique", "survival knife"], shopifyHandle: "couteau-survie", amazonSearch: "couteau+survie+bushcraft" },
    { nom: "Sac 72h", keywords: ["sac 72h", "bug out bag", "sac urgence", "go bag"], shopifyHandle: "sac-72h", amazonSearch: "sac+survie+72h+bug+out+bag" },
    { nom: "Radio urgence", keywords: ["radio urgence", "radio météo", "emergency radio"], shopifyHandle: "radio-urgence", amazonSearch: "radio+urgence+manivelle+solaire" }
];

// Forums et sources à scanner (simulé - en prod tu utiliserais leurs APIs)
const SOURCES_PROSPECTS = [
    { nom: "Reddit r/prepping", url: "https://reddit.com/r/prepping", actif: true },
    { nom: "Reddit r/preppers", url: "https://reddit.com/r/preppers", actif: true },
    { nom: "Reddit r/survival", url: "https://reddit.com/r/survival", actif: true },
    { nom: "Reddit r/bushcraft", url: "https://reddit.com/r/bushcraft", actif: true },
    { nom: "Forums survie.fr", url: "https://www.survie.fr/forum", actif: true },
    { nom: "Forum preppers.fr", url: "https://preppers.fr/forum", actif: false }
];

// ============================================================
// AGENT IA - ANALYSE D'INTENTION (via Claude)
// ============================================================
async function analyserIntentionAchat(texte) {
    if (!ANTHROPIC_KEY) {
        // Mode démo sans clé API
        const score = Math.floor(Math.random() * 40) + 50;
        return {
            score,
            produit: PRODUITS_CLES[Math.floor(Math.random() * PRODUITS_CLES.length)].nom,
            resume: "Utilisateur cherche du matériel de survie pour se préparer.",
            urgence: score > 75 ? "haute" : "moyenne"
        };
    }

    try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": ANTHROPIC_KEY,
                "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 300,
                messages: [{
                    role: "user",
                    content: `Tu es un expert en marketing de survie/résilience. Analyse ce texte et réponds UNIQUEMENT en JSON valide:
{"score": 0-100, "produit": "nom du produit recherché", "resume": "résumé en 1 phrase", "urgence": "haute|moyenne|basse"}

Score = probabilité d'achat (100 = certitude).
Produits possibles: ${PRODUITS_CLES.map(p => p.nom).join(", ")}

Texte à analyser: "${texte.substring(0, 500)}"`
                }]
            })
        });
        const data = await response.json();
        const raw = data.content[0].text;
        return JSON.parse(raw.match(/\{.*\}/s)[0]);
    } catch (e) {
        return { score: 60, produit: "Kit survie", resume: "Intérêt pour la préparation.", urgence: "moyenne" };
    }
}

// ============================================================
// AGENT IA - GÉNÉRATION DE CONTENU VIDÉO
// ============================================================
async function genererScriptVideo(produit, plateforme) {
    if (!ANTHROPIC_KEY) {
        return {
            accroche: `🚨 ${produit.toUpperCase()} : Ce que PERSONNE ne te dit sur la survie`,
            script: `Accroche: Tu penses être prêt pour une catastrophe ? Pense encore...\n\nDéveloppement: [3 faits chocs sur l'importance de ${produit}]\n\nCTA: Lien en bio pour le meilleur ${produit} du marché, livraison rapide ✅`,
            hashtags: ["#survie", "#prepper", "#résilience", "#survivalfrance", "#preparedness"],
            duree: plateforme === "tiktok" ? "30-60s" : "45-90s"
        };
    }

    try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": ANTHROPIC_KEY,
                "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 500,
                messages: [{
                    role: "user",
                    content: `Crée un script vidéo viral pour ${plateforme} sur le produit: ${produit}
Niche: survie, résilience, préparation aux crises.
Public: français, preppers, familles qui se préparent.
Réponds en JSON: {"accroche": "...", "script": "...", "hashtags": [...], "duree": "..."}`
                }]
            })
        });
        const data = await response.json();
        return JSON.parse(data.content[0].text.match(/\{.*\}/s)[0]);
    } catch (e) {
        return {
            accroche: `${produit} : Le guide COMPLET`,
            script: `Présentation du ${produit} pour la survie...`,
            hashtags: ["#survie", "#prepper"],
            duree: "45s"
        };
    }
}

// ============================================================
// SIMULATION SCAN PROSPECTS (tourne en arrière-plan)
// En prod: remplace par de vraies requêtes API Reddit/forums
// ============================================================
const FAUX_POSTS = [
    "Je cherche un bon kit survie pour ma famille, budget 100-150€, quelqu'un a des recommandations ?",
    "Quel filtre eau portable recommandez-vous pour les randonnées longues et situation SHTF ?",
    "Ma femme veut qu'on prépare un sac 72h pour toute la famille, par où commencer ?",
    "J'ai vu que les prix des rations de survie ont explosé, quelqu'un connait un bon site FR ?",
    "Quelle lampe frontale pour usage intensif survie/camping ? Budget 50€ max",
    "Meilleur couteau survie qualité/prix selon vous ? Bushcraft ou tactique ?",
    "Radio météo avec manivelle + solaire, laquelle acheter sans se ruiner ?",
    "Couverture de survie vs sac de couchage d'urgence, vos avis ?",
    "Site français pour acheter du matériel de survie pas cher et fiable ?",
    "Je veux constituer un stock de nourriture pour 3 mois, quelles rations longue durée ?"
];

async function scannerProspects() {
    try {
        const source = SOURCES_PROSPECTS.filter(s => s.actif)[Math.floor(Math.random() * SOURCES_PROSPECTS.filter(s => s.actif).length)];
        const postSimule = FAUX_POSTS[Math.floor(Math.random() * FAUX_POSTS.length)];
        
        // Analyser l'intention
        const analyse = await analyserIntentionAchat(postSimule);
        
        // Trouver le produit correspondant
        const produitMatch = PRODUITS_CLES.find(p => p.nom === analyse.produit) || PRODUITS_CLES[0];
        
        // Créer le prospect
        const prospect = {
            id: Date.now(),
            source: source.nom,
            texte: postSimule.substring(0, 120) + "...",
            score: analyse.score,
            produit: analyse.produit,
            resume: analyse.resume,
            urgence: analyse.urgence,
            liens: {
                shopify: `${SHOPIFY_URL}/products/${produitMatch.shopifyHandle}`,
                amazon: `https://www.amazon.fr/s?k=${produitMatch.amazonSearch}&tag=${AMAZON_TAG}`
            },
            timestamp: new Date().toLocaleTimeString('fr-FR'),
            converti: false
        };

        prospects.unshift(prospect);
        if (prospects.length > 50) prospects.pop(); // Garder max 50

        stats.prospectsTrouves++;
        agentLogs.unshift(`[${prospect.timestamp}] ✅ Prospect trouvé sur ${source.nom} - Score ${analyse.score}/100 - "${analyse.produit}"`);
        if (agentLogs.length > 20) agentLogs.pop();

        console.log(`Agent: Prospect trouvé - ${analyse.produit} - Score ${analyse.score}`);
    } catch (e) {
        console.error("Erreur scan:", e.message);
        agentLogs.unshift(`[${new Date().toLocaleTimeString('fr-FR')}] ⚠️ Scan interrompu: ${e.message}`);
    }
}

// Lancer le scan automatique toutes les 45 secondes
let agentActif = true;
setInterval(() => {
    if (agentActif) scannerProspects();
}, 45000);

// Premier scan au démarrage
setTimeout(scannerProspects, 3000);

// ============================================================
// API ROUTES - DASHBOARD
// ============================================================

// Stats globales
app.get('/api/stats', (req, res) => {
    stats.visiteursAujourdhui += Math.floor(Math.random() * 3);
    res.json({
        ...stats,
        prospectsTrouves: prospects.length,
        agentActif,
        sourcesActives: SOURCES_PROSPECTS.filter(s => s.actif).length
    });
});

// Liste des prospects
app.get('/api/prospects', (req, res) => {
    res.json(prospects);
});

// Logs de l'agent
app.get('/api/logs', (req, res) => {
    res.json(agentLogs);
});

// Activer/désactiver l'agent
app.post('/api/agent/toggle', (req, res) => {
    agentActif = !agentActif;
    agentLogs.unshift(`[${new Date().toLocaleTimeString('fr-FR')}] ${agentActif ? '🟢 Agent activé' : '🔴 Agent mis en pause'}`);
    res.json({ actif: agentActif });
});

// Forcer un scan immédiat
app.post('/api/agent/scan', async (req, res) => {
    await scannerProspects();
    res.json({ ok: true, prospects: prospects.slice(0, 5) });
});

// Générer un script vidéo
app.post('/api/video/generer', async (req, res) => {
    const { produit, plateforme } = req.body;
    const script = await genererScriptVideo(produit || "Kit survie", plateforme || "tiktok");
    res.json(script);
});

// Marquer un prospect comme converti
app.post('/api/prospect/converti', (req, res) => {
    const { id } = req.body;
    const p = prospects.find(p => p.id === id);
    if (p) {
        p.converti = true;
        stats.clicsAffiliation++;
        stats.revenusEstimes += Math.floor(Math.random() * 15) + 5;
    }
    res.json({ ok: true });
});

// Recherche manuelle produit Shopify
app.post('/api/agent-alert', async (req, res) => {
    const { keyword, auth } = req.body;
    if (auth !== "CEO_FOLLOW") return res.status(403).json({ error: "Non autorisé" });
    
    const produitMatch = PRODUITS_CLES.find(p => 
        p.keywords.some(k => k.includes(keyword.toLowerCase())) || 
        p.nom.toLowerCase().includes(keyword.toLowerCase())
    );
    
    if (produitMatch) {
        res.json({
            status: "OK",
            produit: produitMatch.nom,
            shopify: `${SHOPIFY_URL}/products/${produitMatch.shopifyHandle}`,
            amazon: `https://www.amazon.fr/s?k=${produitMatch.amazonSearch}&tag=${AMAZON_TAG}`
        });
    } else {
        res.json({ status: "NOT_FOUND" });
    }
});

// ============================================================
// PAGES
// ============================================================
app.use(express.static(__dirname));

// Mot de passe dashboard
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "Survie2026";

// Page principale (landing page)
app.get('/', (req, res) => {
    stats.visiteursAujourdhui++;
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Vérification du mot de passe
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === DASHBOARD_PASSWORD) {
        res.json({ ok: true });
    } else {
        res.status(401).json({ ok: false, error: "Mot de passe incorrect" });
    }
});

// Dashboard CEO (la protection se fait côté client via login.html)
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Page de connexion
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// ============================================================
// DÉMARRAGE
// ============================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ FOLLOW.LIFE opérationnel sur port ${PORT}`);
    console.log(`🤖 Agent IA: actif - scan toutes les 45s`);
    console.log(`🛒 Shopify: ${SHOPIFY_URL}`);
    console.log(`📦 Amazon Affilié: tag=${AMAZON_TAG}`);
});
