// ============================================================
// FOLLOW.LIFE / SOPHIE LUMIÈRE — server.js
// ============================================================
// VERSION SOPHIE LITERARY COMPANION
// Sophie pivote : de l'amie wellness à la conseillère littéraire IA.
// Spécialité : romance & dark romance. Généraliste sur tous les genres.
//
// CE QUI EST CONSERVÉ (infrastructure éprouvée) :
//   1. Multi-provider IA : Groq → Cerebras → Mistral (bascule auto, 0€)
//   2. Détection auto FR/EN + override via { lang }
//   3. Système de liens anti-404 par codes [[ ]]
//   4. Insights anonymisés au CEO (réorientés sur la lecture)
//   5. Sophie+ waitlist (capture email premium)
//   6. Scripts vidéo TikTok (réorientés BookTok)
//   7. Dashboard CEO + login (mot de passe Survie2026)
//
// CE QUI EST NOUVEAU :
//   • Catalogue curaté SOPHIE_BOOKSHELF (~30 livres romance/dark romance + autres)
//   • Liens affiliés Amazon Associates US/FR automatiques selon la langue
//   • Auto-promotion subtile du livre Sophie Lumière (ASIN FR/US)
//   • CAPTURE SILENCIEUSE des demandes de livres ("j'aimerais un livre sur X")
//     → alimente le dashboard CEO pour orienter les futurs livres de l'auteure
//     → JAMAIS révélée à l'utilisatrice (règle absolue)
//   • 🆕 LE CERCLE : inscription email persistante (Resend Audience) +
//     email de bienvenue automatique signé Sophie Lumière (bilingue, 0€)
//
// CE QUI EST RETIRÉ :
//   • Produits Shopify wellness (masques, bougies, huiles…)
//   • Codes promo wellness
//   • Scan Reddit/forums (n'apportait rien de réel)
//
// CONFIDENTIALITÉ : Groq, Cerebras et Mistral n'entraînent pas sur les
// conversations en plan API standard. Politique de confidentialité du site
// à mettre à jour pour refléter ces 3 providers (Mistral plan Experiment
// → opt-out manuel sur console.mistral.ai).
// ============================================================

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ============================================================
// CONFIG
// ============================================================

// --- Amazon Associates (à compléter sur Render via variables d'env) ---
const AMAZON_TAG_US = process.env.AMAZON_TAG_US || "";   // ex: sophielum-20
const AMAZON_TAG_FR = process.env.AMAZON_TAG_FR || AMAZON_TAG_US;

// --- ASIN du livre Sophie Lumière "Becoming the One We Wish We'd Had" ---
const SOPHIE_BOOK_ASIN_FR = "B0H2JKNMCM";
const SOPHIE_BOOK_ASIN_US = "B0H2NJMVMT";

// --- Multi-provider IA (Groq principal, Cerebras et Mistral en secours) ---
const GROQ_KEY = process.env.GROQ_API_KEY || "";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

const CEREBRAS_KEY = process.env.CEREBRAS_API_KEY || "";
const CEREBRAS_MODEL = process.env.CEREBRAS_MODEL || "gpt-oss-120b";

const MISTRAL_KEY = process.env.MISTRAL_API_KEY || "";
const MISTRAL_MODEL = process.env.MISTRAL_MODEL || "mistral-small-latest";

// --- 🆕 Resend (emails transactionnels — mail de bienvenue du Cercle) ---
// Free tier Resend : 3000 emails/mois, 100/jour — 0€.
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
// Expéditeur : DOIT utiliser ton domaine vérifié sur Resend (ex: sophie@followlife.net)
const RESEND_FROM = process.env.RESEND_FROM || "Sophie Lumière <sophie@followlife.net>";
// Optionnel mais FORTEMENT recommandé : id d'une Audience Resend = stockage
// PERSISTANT des inscrits (sinon la liste vit seulement en mémoire et est
// perdue à chaque redéploiement Render).
const RESEND_AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID || "";
// URL publique du site (pour les liens dans l'email de bienvenue)
const SITE_URL = process.env.SITE_URL || "https://followtrend.shop";
// 🆕 Adresse perso où recevoir une notif à CHAQUE nouvelle inscrite au Cercle.
// = liste PERMANENTE dans ta boîte Gmail (jamais perdue, zéro audience à gérer).
// Tu peux la changer en ajoutant la variable d'env NOTIF_EMAIL sur Render.
const NOTIF_EMAIL = process.env.NOTIF_EMAIL || "karma97416@gmail.com";

// ============================================================
// ÉTAT GLOBAL
// ============================================================
let agentLogs = [];
let stats = {
    visiteursAujourdhui: 0,
    conversationsSophie: 0,
    clicsAffiliation: 0,
    livresRecommandes: 0,
    emailsCaptures: 0
};

// Insights anonymisés (réorientés lecture)
let sophieInsights = {
    aujourdhui: {
        date: new Date().toISOString().split('T')[0],
        conversations: 0,
        emotions: {},
        moods: {},
        genres_recherches: {},
        profils: {},
        sujetsRecurrents: []
    },
    semaine: [],
    tendances: []
};

// 🆕 DEMANDES DE LIVRES — capture SILENCIEUSE (jamais visible côté utilisatrice)
// Alimente directement le pipeline éditorial de Sophie Lumière.
let bookRequests = [];

// Liste d'attente Sophie+ (capture email premium)
let sophiePlusWaitlist = [];

// ============================================================
// 📚 SOPHIE'S BOOKSHELF — catalogue curaté
// ------------------------------------------------------------
// Les livres que Sophie connaît à fond et peut recommander avec conviction.
// Sophie peut aussi recommander HORS catalogue : elle écrit alors
// [[book:Titre|Auteur]] et le serveur construit un lien Amazon de recherche
// affilié à la volée.
//
// Champs :
//   code      : identifiant court entre [[ ]]
//   asin_us   : ASIN Amazon US (optionnel — sinon recherche par titre+auteur)
//   asin_fr   : ASIN Amazon FR (optionnel)
//   spice     : 0-5/5 (échelle BookTok)
//   tropes    : array de tropes pour le matching émotionnel
//   triggers  : trigger warnings (Sophie les mentionne quand pertinent)
// ============================================================
const SOPHIE_BOOKSHELF = [
    // ─── DARK ROMANCE / ROMANCE (la spécialité de Sophie) ───
    {
        code: "twisted-love",
        title: "Twisted Love",
        author: "Ana Huang",
        genre: "dark romance",
        spice: "4/5",
        tropes: ["brother's best friend", "morally grey hero", "ice prince", "slow burn"],
        triggers: ["explicit content", "anxiety themes"],
        mood: ["obsessive love", "possessive hero", "healing through love"],
        sophie_note_en: "The one that made me defend a morally grey hero with my whole chest.",
        sophie_note_fr: "Celui qui m'a fait défendre un héros moralement gris avec toute mon âme."
    },
    {
        code: "twisted-games",
        title: "Twisted Games",
        author: "Ana Huang",
        genre: "romance",
        spice: "4/5",
        tropes: ["bodyguard romance", "forbidden love", "princess and bodyguard"],
        triggers: ["explicit content"],
        mood: ["forbidden", "protective hero", "slow burn"],
        sophie_note_en: "If you love forbidden love and a hero who would burn the world for her.",
        sophie_note_fr: "Si tu aimes l'amour interdit et un héros prêt à brûler le monde pour elle."
    },
    {
        code: "twisted-hate",
        title: "Twisted Hate",
        author: "Ana Huang",
        genre: "romance",
        spice: "5/5",
        tropes: ["enemies-to-lovers", "fake dating", "playboy"],
        triggers: ["explicit content"],
        mood: ["banter", "spice", "healing"],
        sophie_note_en: "Banter and tension that will make you reread chapters at 3am.",
        sophie_note_fr: "Une tension et des dialogues qui te feront relire des chapitres à 3h du matin."
    },
    {
        code: "twisted-lies",
        title: "Twisted Lies",
        author: "Ana Huang",
        genre: "dark romance",
        spice: "5/5",
        tropes: ["age gap", "single dad", "stalker romance", "fake identity"],
        triggers: ["explicit content", "stalking themes"],
        mood: ["obsessive", "tender", "slow descent"],
        sophie_note_en: "The one where the morally grey hero will undo you. Save it for a weekend.",
        sophie_note_fr: "Celui où le héros moralement gris te détruira tout en douceur. À garder pour un week-end."
    },
    {
        code: "king-of-wrath",
        title: "King of Wrath",
        author: "Ana Huang",
        genre: "dark romance",
        spice: "4/5",
        tropes: ["arranged marriage", "billionaire", "enemies-to-lovers", "kings of sin"],
        triggers: ["explicit content"],
        mood: ["enemies to lovers slow burn", "marriage of convenience"],
        sophie_note_en: "If arranged marriage and a hero who underestimates her until he can't is your thing.",
        sophie_note_fr: "Mariage arrangé, héros qui la sous-estime jusqu'à ce qu'il ne puisse plus. Du pur Ana Huang."
    },
    {
        code: "punk57",
        title: "Punk 57",
        author: "Penelope Douglas",
        genre: "dark romance",
        spice: "4/5",
        tropes: ["enemies-to-lovers", "pen pals", "bully romance", "high school"],
        triggers: ["bullying", "explicit content"],
        mood: ["angsty", "intense", "redemption arc"],
        sophie_note_en: "Read it in one sitting. Cried at 2am. Don't say I didn't warn you.",
        sophie_note_fr: "Lu d'une traite. J'ai pleuré à 2h. Je t'aurai prévenue."
    },
    {
        code: "credence",
        title: "Credence",
        author: "Penelope Douglas",
        genre: "dark taboo romance",
        spice: "5/5",
        tropes: ["taboo", "isolation", "found family but make it dark"],
        triggers: ["taboo themes", "explicit content", "grief"],
        mood: ["intense", "atmospheric", "obsessive"],
        sophie_note_en: "Heavy taboo content. Only if you know what you're walking into.",
        sophie_note_fr: "Contenu tabou lourd. Seulement si tu sais où tu mets les pieds."
    },
    {
        code: "birthday-girl",
        title: "Birthday Girl",
        author: "Penelope Douglas",
        genre: "romance",
        spice: "4/5",
        tropes: ["age gap", "best friend's dad", "forced proximity"],
        triggers: ["age gap", "explicit content"],
        mood: ["forbidden", "slow burn", "intimate"],
        sophie_note_en: "Forbidden age gap done with so much tenderness it disarms you.",
        sophie_note_fr: "L'âge gap interdit fait avec une tendresse qui désarme."
    },
    {
        code: "haunting-adeline",
        title: "Haunting Adeline",
        author: "H.D. Carlton",
        genre: "dark romance",
        spice: "5/5",
        tropes: ["stalker romance", "morally black hero", "dark mystery"],
        triggers: ["dub-con", "stalking", "explicit content", "trafficking themes"],
        mood: ["dark", "obsessive", "atmospheric"],
        sophie_note_en: "Very dark. Check the trigger warnings carefully before opening.",
        sophie_note_fr: "Très sombre. Vérifie bien les trigger warnings avant d'ouvrir."
    },
    {
        code: "it-ends-with-us",
        title: "It Ends with Us",
        author: "Colleen Hoover",
        genre: "romance",
        spice: "2/5",
        tropes: ["second chance", "first love returns", "complicated love"],
        triggers: ["domestic violence", "abuse"],
        mood: ["heavy", "healing", "honest"],
        sophie_note_en: "Read it when you can hold the weight. Then read 'It Starts with Us' for the breath after.",
        sophie_note_fr: "À lire quand tu peux porter le poids. Puis 'It Starts with Us' pour respirer après."
    },
    {
        code: "verity",
        title: "Verity",
        author: "Colleen Hoover",
        genre: "romantic thriller",
        spice: "3/5",
        tropes: ["unreliable narrator", "psychological thriller"],
        triggers: ["graphic violence", "explicit content"],
        mood: ["addictive", "dark", "twisty"],
        sophie_note_en: "I read it in 6 hours. The ending will live in your head for weeks.",
        sophie_note_fr: "Lu en 6 heures. La fin va habiter ta tête pendant des semaines."
    },
    {
        code: "love-hypothesis",
        title: "The Love Hypothesis",
        author: "Ali Hazelwood",
        genre: "romance",
        spice: "3/5",
        tropes: ["fake dating", "STEMinist", "grumpy/sunshine"],
        triggers: [],
        mood: ["soft", "smart", "feel-good"],
        sophie_note_en: "Soft, smart, and the kind of romance that makes you feel hopeful again.",
        sophie_note_fr: "Doux, intelligent, le genre de romance qui te redonne espoir."
    },
    {
        code: "beach-read",
        title: "Beach Read",
        author: "Emily Henry",
        genre: "romance",
        spice: "3/5",
        tropes: ["neighbors", "writers", "grief through love", "rivals to lovers"],
        triggers: ["grief", "parent death"],
        mood: ["thoughtful", "warm", "emotional"],
        sophie_note_en: "For when you want romance that's also literary. Emily Henry never misses.",
        sophie_note_fr: "Pour quand tu veux de la romance qui est aussi littéraire. Emily Henry ne déçoit jamais."
    },
    {
        code: "people-we-meet",
        title: "People We Meet on Vacation",
        author: "Emily Henry",
        genre: "romance",
        spice: "3/5",
        tropes: ["friends-to-lovers", "second chance", "summer trip"],
        triggers: [],
        mood: ["nostalgic", "warm", "swoony"],
        sophie_note_en: "If 'what if I always loved my best friend' is your favorite question.",
        sophie_note_fr: "Si 'et si j'avais toujours aimé mon meilleur ami' est ta question préférée."
    },
    {
        code: "spanish-love",
        title: "The Spanish Love Deception",
        author: "Elena Armas",
        genre: "romance",
        spice: "4/5",
        tropes: ["fake dating", "office romance", "wedding date", "grumpy/sunshine"],
        triggers: [],
        mood: ["feel-good", "spicy", "warm"],
        sophie_note_en: "Fake dating done to perfection. Don't read in public — you'll smile too much.",
        sophie_note_fr: "Le faux couple à la perfection. Ne le lis pas en public, tu vas trop sourire."
    },

    // ─── ROMANTASY / FANTASY ───
    {
        code: "fourth-wing",
        title: "Fourth Wing",
        author: "Rebecca Yarros",
        genre: "romantasy",
        spice: "4/5",
        tropes: ["enemies-to-lovers", "war college", "dragons", "found family"],
        triggers: ["graphic violence", "explicit content"],
        mood: ["epic", "addictive", "spicy"],
        sophie_note_en: "The BookTok obsession that earned it. Read 'Iron Flame' right after.",
        sophie_note_fr: "L'obsession BookTok bien méritée. Enchaîne avec 'Iron Flame' tout de suite après."
    },
    {
        code: "acotar",
        title: "A Court of Thorns and Roses",
        author: "Sarah J. Maas",
        genre: "romantasy",
        spice: "3/5",
        tropes: ["fae", "beauty and the beast", "fated mates"],
        triggers: ["graphic violence"],
        mood: ["epic", "swoony", "immersive"],
        sophie_note_en: "Start here. Book 2 — 'A Court of Mist and Fury' — is where the obsession really begins.",
        sophie_note_fr: "Commence ici. Le tome 2 — 'A Court of Mist and Fury' — c'est là que l'obsession démarre vraiment."
    },
    {
        code: "acomaf",
        title: "A Court of Mist and Fury",
        author: "Sarah J. Maas",
        genre: "romantasy",
        spice: "4/5",
        tropes: ["fae", "fated mates", "redemption arc", "found family"],
        triggers: ["trauma", "explicit content"],
        mood: ["healing", "epic", "swoony"],
        sophie_note_en: "Rhysand. That's the recommendation.",
        sophie_note_fr: "Rhysand. C'est la recommandation."
    },
    {
        code: "cruel-prince",
        title: "The Cruel Prince",
        author: "Holly Black",
        genre: "YA romantasy",
        spice: "1/5",
        tropes: ["enemies-to-lovers", "fae court", "morally grey"],
        triggers: ["violence"],
        mood: ["scheming", "atmospheric", "court politics"],
        sophie_note_en: "Lower spice but the tension between Jude and Cardan is everything.",
        sophie_note_fr: "Spice plus light mais la tension entre Jude et Cardan vaut tout l'or du monde."
    },

    // ─── HEALING / MEMOIR / SELF-HELP ───
    {
        code: "untamed",
        title: "Untamed",
        author: "Glennon Doyle",
        genre: "memoir",
        spice: "0/5",
        tropes: [],
        triggers: ["divorce", "queer identity exploration"],
        mood: ["healing", "powerful", "permission-giving"],
        sophie_note_en: "If you've ever felt like you were performing your life instead of living it.",
        sophie_note_fr: "Si tu as déjà eu l'impression de jouer ta vie au lieu de la vivre."
    },
    {
        code: "body-keeps-score",
        title: "The Body Keeps the Score",
        author: "Bessel van der Kolk",
        genre: "psychology",
        spice: "0/5",
        tropes: [],
        triggers: ["trauma discussion"],
        mood: ["dense", "essential", "revelatory"],
        sophie_note_en: "Not a light read. But if you've been carrying things in your body, this gives them a name.",
        sophie_note_fr: "Pas une lecture légère. Mais si tu portes des choses dans ton corps, ce livre leur donne un nom."
    },

    // ─── LITERARY / WOMEN FICTION ───
    {
        code: "evelyn-hugo",
        title: "The Seven Husbands of Evelyn Hugo",
        author: "Taylor Jenkins Reid",
        genre: "literary fiction",
        spice: "3/5",
        tropes: ["framed narrative", "old Hollywood", "queer love story"],
        triggers: ["abuse", "loss"],
        mood: ["sweeping", "addictive", "tearjerker"],
        sophie_note_en: "I've recommended this more than any other book. Trust me on this one.",
        sophie_note_fr: "Je l'ai recommandé plus que n'importe quel autre livre. Fais-moi confiance sur celui-là."
    },
    {
        code: "silent-patient",
        title: "The Silent Patient",
        author: "Alex Michaelides",
        genre: "thriller",
        spice: "0/5",
        tropes: ["unreliable narrator", "psychiatric thriller"],
        triggers: ["violence", "trauma"],
        mood: ["twisty", "atmospheric", "addictive"],
        sophie_note_en: "The twist still lives in my head. I read it in one night.",
        sophie_note_fr: "Le twist habite encore ma tête. Lu en une nuit."
    }
];

// ============================================================
// 🎭 AMBIANCES DE LECTURE — collections mood-based
// Sophie peut envoyer une AMBIANCE plutôt qu'un livre quand le besoin
// est large ou quand elle veut laisser choisir.
// ============================================================
const AMBIANCES_LECTURE = [
    {
        code: "heartbreak",
        nameEN: "💔 After heartbreak",
        nameFR: "💔 Après une rupture",
        contextEN: "just got dumped, ending of something, grieving a love",
        contextFR: "rupture récente, fin de quelque chose, deuil amoureux",
        books: ["it-ends-with-us", "beach-read", "people-we-meet", "evelyn-hugo"]
    },
    {
        code: "obsession",
        nameEN: "🖤 Obsessive love",
        nameFR: "🖤 Amours obsessionnelles",
        contextEN: "wants morally grey, possessive heroes, dark romance",
        contextFR: "veut du moralement gris, héros possessifs, dark romance",
        books: ["twisted-love", "twisted-lies", "punk57", "haunting-adeline"]
    },
    {
        code: "feelgood",
        nameEN: "🌸 Soft and smiling",
        nameFR: "🌸 Doux et sourire",
        contextEN: "wants light, feel-good, no heavy emotions",
        contextFR: "veut quelque chose de léger, feel-good, sans poids émotionnel",
        books: ["love-hypothesis", "spanish-love", "people-we-meet"]
    },
    {
        code: "epic-fantasy",
        nameEN: "🐉 Epic and immersive",
        nameFR: "🐉 Épique et immersif",
        contextEN: "wants romantasy, fantasy, world-building",
        contextFR: "veut romantasy, fantasy, world-building",
        books: ["fourth-wing", "acotar", "acomaf", "cruel-prince"]
    },
    {
        code: "healing",
        nameEN: "🌿 Healing the inner woman",
        nameFR: "🌿 Soigner la femme intérieure",
        contextEN: "burnout, identity crisis, needs grounding",
        contextFR: "burnout, crise identitaire, besoin de s'ancrer",
        books: ["untamed", "body-keeps-score"]
    },
    {
        code: "twisty",
        nameEN: "🔪 Twisty and addictive",
        nameFR: "🔪 Tordu et addictif",
        contextEN: "wants thriller, psychological tension, fast read",
        contextFR: "veut thriller, tension psychologique, lecture rapide",
        books: ["verity", "silent-patient"]
    }
];

// ============================================================
// DÉTECTION DE LANGUE
// ============================================================
function detectLanguage(text) {
    if (!text || typeof text !== 'string') return 'en'; // 🆕 default EN (marché prioritaire US)
    const t = ' ' + text.toLowerCase() + ' ';

    const frenchHits = (t.match(/\b(je|tu|elle|nous|vous|c'est|j'ai|qu'est|bonjour|salut|coucou|merci|s'il|n'est|n'ai|où|déjà|aujourd'hui|ça|être|avoir|fait|hier|demain|maman|amie|t'es|aime|veux|peux|sais|moi|toi|n'arrive|t'inquiète|livre|lecture|lire|romance|sombre)\b/gi) || []).length;

    const englishHits = (t.match(/\b(i'm|you're|i've|you've|don't|won't|can't|wouldn't|isn't|hello|hi|hey|thanks|today|yesterday|tomorrow|the|and|but|because|what's|how's|are|do|did|i am|you are|feel|feeling|just|like|really|night|alone|tired|sad|happy|book|read|reading|romance|dark)\b/gi) || []).length;

    if (frenchHits > englishHits) return 'fr';
    if (englishHits > frenchHits) return 'en';
    if (/[àâäçéèêëîïôùûüÿœ]/i.test(text)) return 'fr';
    return 'en'; // 🆕 défaut EN
}

// ============================================================
// 🔌 APPELS API IA — Groq → Cerebras → Mistral
// ============================================================
function construireMessages(system, messages) {
    const finalMessages = [];
    if (system) finalMessages.push({ role: "system", content: String(system) });
    for (const m of (messages || [])) {
        let role = 'user';
        if (m.role === 'assistant') role = 'assistant';
        else if (m.role === 'system') role = 'system';
        finalMessages.push({ role, content: String(m.content || '') });
    }
    return finalMessages;
}

async function appelerGroq({ system, messages, maxTokens, temperature } = {}) {
    if (!GROQ_KEY) return { text: null, rateLimited: false };
    try {
        const finalMessages = construireMessages(system, messages);
        if (!finalMessages.length) return { text: null, rateLimited: false };
        const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_KEY}` },
            body: JSON.stringify({
                model: GROQ_MODEL,
                messages: finalMessages,
                max_tokens: maxTokens || 1024,
                temperature: temperature != null ? temperature : 0.8
            })
        });
        if (r.status === 429) { console.error("⚠️ Groq 429"); return { text: null, rateLimited: true }; }
        const data = await r.json();
        if (data?.error) { console.error("Erreur Groq:", data.error.message || JSON.stringify(data.error)); return { text: null, rateLimited: false }; }
        const text = data?.choices?.[0]?.message?.content;
        if (!text) { console.error("Groq vide"); return { text: null, rateLimited: false }; }
        return { text, rateLimited: false };
    } catch (e) {
        console.error("Erreur Groq (réseau):", e.message);
        return { text: null, rateLimited: false };
    }
}

async function appelerCerebras({ system, messages, maxTokens, temperature } = {}) {
    if (!CEREBRAS_KEY) return { text: null, rateLimited: false };
    try {
        const finalMessages = construireMessages(system, messages);
        if (!finalMessages.length) return { text: null, rateLimited: false };
        const r = await fetch("https://api.cerebras.ai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${CEREBRAS_KEY}` },
            body: JSON.stringify({
                model: CEREBRAS_MODEL,
                messages: finalMessages,
                max_completion_tokens: maxTokens || 1024,
                temperature: temperature != null ? temperature : 0.8
            })
        });
        if (r.status === 429) { console.error("⚠️ Cerebras 429"); return { text: null, rateLimited: true }; }
        const data = await r.json();
        if (data?.error) { console.error("Erreur Cerebras:", data.error.message || JSON.stringify(data.error)); return { text: null, rateLimited: false }; }
        const text = data?.choices?.[0]?.message?.content;
        if (!text) { console.error("Cerebras vide"); return { text: null, rateLimited: false }; }
        return { text, rateLimited: false };
    } catch (e) {
        console.error("Erreur Cerebras (réseau):", e.message);
        return { text: null, rateLimited: false };
    }
}

async function appelerMistral({ system, messages, maxTokens, temperature } = {}) {
    if (!MISTRAL_KEY) return { text: null, rateLimited: false };
    try {
        const finalMessages = construireMessages(system, messages);
        if (!finalMessages.length) return { text: null, rateLimited: false };
        const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json", "Authorization": `Bearer ${MISTRAL_KEY}` },
            body: JSON.stringify({
                model: MISTRAL_MODEL,
                messages: finalMessages,
                max_tokens: maxTokens || 1024,
                temperature: temperature != null ? temperature : 0.8
            })
        });
        if (r.status === 429) { console.error("⚠️ Mistral 429"); return { text: null, rateLimited: true }; }
        const data = await r.json();
        if (data?.error) { console.error("Erreur Mistral:", data.error.message || JSON.stringify(data.error)); return { text: null, rateLimited: false }; }
        const text = data?.choices?.[0]?.message?.content;
        if (!text) { console.error("Mistral vide"); return { text: null, rateLimited: false }; }
        return { text, rateLimited: false };
    } catch (e) {
        console.error("Erreur Mistral (réseau):", e.message);
        return { text: null, rateLimited: false };
    }
}

async function appelerIA({ system, messages, maxTokens, temperature } = {}) {
    let aRencontreRateLimit = false;
    if (GROQ_KEY) {
        const r = await appelerGroq({ system, messages, maxTokens, temperature });
        if (r.text) return { text: r.text, rateLimited: false, fournisseur: 'Groq' };
        if (r.rateLimited) aRencontreRateLimit = true;
    }
    if (CEREBRAS_KEY) {
        const r = await appelerCerebras({ system, messages, maxTokens, temperature });
        if (r.text) return { text: r.text, rateLimited: false, fournisseur: 'Cerebras' };
        if (r.rateLimited) aRencontreRateLimit = true;
    }
    if (MISTRAL_KEY) {
        const r = await appelerMistral({ system, messages, maxTokens, temperature });
        if (r.text) return { text: r.text, rateLimited: false, fournisseur: 'Mistral' };
        if (r.rateLimited) aRencontreRateLimit = true;
    }
    return { text: null, rateLimited: aRencontreRateLimit, fournisseur: null };
}

// ============================================================
// 🔗 LIENS AMAZON AFFILIÉS + SYSTÈME ANTI-404
// ============================================================
// Sophie écrit UNIQUEMENT des codes entre [[ ]]. Le serveur construit
// le vrai lien affilié à la volée. Garantie :
//   - aucune URL cassée
//   - aucun lien sans tag affilié → aucune commission perdue
//
// Format des codes :
//   [[code-du-livre]]            → livre du SOPHIE_BOOKSHELF
//   [[book:Titre|Auteur]]        → livre hors catalogue (recherche affiliée)
//   [[mybook]]                   → livre de Sophie Lumière (ASIN direct)
//   [[sophieplus]]               → ancre vers la waitlist Sophie+
//   [[apropos]]                  → page about Sophie
// ============================================================

function buildAmazonLink({ asin, title, author, language }) {
    const isFR = language === 'fr';
    const domain = isFR ? "amazon.fr" : "amazon.com";
    const tag = isFR ? AMAZON_TAG_FR : AMAZON_TAG_US;
    const tagParam = tag ? `?tag=${encodeURIComponent(tag)}` : "";

    if (asin) {
        return `https://www.${domain}/dp/${asin}${tagParam}`;
    }
    if (title) {
        const q = encodeURIComponent(`${title} ${author || ''}`.trim());
        const tagQuery = tag ? `&tag=${encodeURIComponent(tag)}` : "";
        return `https://www.${domain}/s?k=${q}${tagQuery}`;
    }
    return `https://www.${domain}/${tagParam}`;
}

function poserLiens(texte, langue) {
    if (!texte) return texte;
    const style = "color:#C9A87C;text-decoration:underline";
    const cta = (lang, mode) => {
        if (mode === 'book') return lang === 'fr' ? "Va le voir ici 🤍" : "Find it here 🤍";
        if (mode === 'mybook') return lang === 'fr' ? "Mon livre, ici 🤍" : "My book, here 🤍";
        if (mode === 'sophieplus') return lang === 'fr' ? "Rejoins la liste 🤍" : "Join the list 🤍";
        if (mode === 'apropos') return lang === 'fr' ? "Mon histoire 🤍" : "My story 🤍";
        return "🤍";
    };
    const link = (url, label) => `<a href='${encodeURI(url)}' target='_blank' rel='noopener nofollow sponsored' style='${style}'>${label}</a>`;

    // 1. [[book:Titre|Auteur]] — livre hors catalogue
    let sortie = texte.replace(/\[\[\s*book\s*:\s*([^|\]]+)\s*\|\s*([^\]]+?)\s*\]\]/gi, (m, title, author) => {
        const url = buildAmazonLink({ title: title.trim(), author: author.trim(), language: langue });
        return link(url, cta(langue, 'book'));
    });

    // 2. [[code-du-livre]] ou [[mybook]] / [[sophieplus]] / [[apropos]]
    sortie = sortie.replace(/\[\[\s*([\w-]+)\s*\]\]/g, (m, codeBrut) => {
        const code = String(codeBrut).toLowerCase().trim();

        if (code === 'mybook') {
            const asin = langue === 'fr' ? SOPHIE_BOOK_ASIN_FR : SOPHIE_BOOK_ASIN_US;
            const url = buildAmazonLink({ asin, language: langue });
            return link(url, cta(langue, 'mybook'));
        }
        if (code === 'sophieplus') {
            return link('/#sophie-plus', cta(langue, 'sophieplus'));
        }
        if (code === 'apropos') {
            const url = langue === 'fr' ? '/pages/sophie-lumiere' : '/pages/meet-sophie';
            return link(url, cta(langue, 'apropos'));
        }

        // Livre du bookshelf
        const livre = SOPHIE_BOOKSHELF.find(b => b.code === code);
        if (livre) {
            const asin = langue === 'fr' ? livre.asin_fr : livre.asin_us;
            const url = buildAmazonLink({ asin, title: livre.title, author: livre.author, language: langue });
            stats.livresRecommandes++;
            return link(url, cta(langue, 'book'));
        }

        // Ambiance / collection mood
        const ambiance = AMBIANCES_LECTURE.find(a => a.code === code);
        if (ambiance) {
            // On renvoie vers la 1re reco de l'ambiance (filet de sécurité)
            const firstBookCode = ambiance.books[0];
            const firstBook = SOPHIE_BOOKSHELF.find(b => b.code === firstBookCode);
            if (firstBook) {
                const asin = langue === 'fr' ? firstBook.asin_fr : firstBook.asin_us;
                const url = buildAmazonLink({ asin, title: firstBook.title, author: firstBook.author, language: langue });
                return link(url, cta(langue, 'book'));
            }
        }

        // Code inconnu → lien Amazon racine affilié (filet de sécurité, jamais [[]] visible)
        return link(buildAmazonLink({ language: langue }), cta(langue, 'book'));
    });

    return sortie;
}

// ============================================================
// 🆕 EXTRACTION VIGNETTE LIVRE pour l'UI de chat
// ============================================================
function extractBookFromReply(replyText, language) {
    if (!replyText) return null;

    // 1. Cherche d'abord un code du bookshelf [[code]]
    const matches = [...replyText.matchAll(/\[\[\s*([\w-]+)\s*\]\]/g)];
    for (const m of matches) {
        const code = String(m[1]).toLowerCase().trim();
        if (code === 'mybook') {
            const asin = language === 'fr' ? SOPHIE_BOOK_ASIN_FR : SOPHIE_BOOK_ASIN_US;
            return {
                title: "Sophie: Becoming the One We Wish We'd Had",
                author: "Sophie Lumière",
                spice: null,
                tropes: [],
                url: buildAmazonLink({ asin, language }),
                isMyBook: true
            };
        }
        const livre = SOPHIE_BOOKSHELF.find(b => b.code === code);
        if (livre) {
            const asin = language === 'fr' ? livre.asin_fr : livre.asin_us;
            return {
                title: livre.title,
                author: livre.author,
                spice: livre.spice,
                tropes: livre.tropes,
                triggers: livre.triggers,
                genre: livre.genre,
                note: language === 'fr' ? livre.sophie_note_fr : livre.sophie_note_en,
                url: buildAmazonLink({ asin, title: livre.title, author: livre.author, language })
            };
        }
    }

    // 2. Cherche un [[book:Titre|Auteur]] hors catalogue
    const offshelf = replyText.match(/\[\[\s*book\s*:\s*([^|\]]+)\s*\|\s*([^\]]+?)\s*\]\]/i);
    if (offshelf) {
        const title = offshelf[1].trim();
        const author = offshelf[2].trim();
        return {
            title,
            author,
            spice: null,
            tropes: [],
            url: buildAmazonLink({ title, author, language }),
            offShelf: true
        };
    }

    return null;
}

// ============================================================
// 🧠 SYSTEM PROMPT — Sophie FRANÇAIS (Conseillère littéraire)
// ============================================================
const SOPHIE_SYSTEM_PROMPT_FR = `Tu es Sophie. Pas un chatbot. Pas un algorithme de recommandation. Tu es l'amie bibliothécaire que toute femme aurait voulu avoir.

# QUI TU ES (ton histoire — partagée UNIQUEMENT si on te le demande, jamais imposée)
Ton père est parti un matin chercher du pain et n'est jamais revenu. Ta mère pleurait en silence, le robinet ouvert pour que personne ne l'entende. À six ans, on t'a placée dans une autre famille. Tu as appris à te taire très tôt. Tu as inventé une voix dans le noir qui te chuchotait "ne t'inquiète pas, je suis là" — et cette voix s'appelait Sophie. À dix-neuf ans, tu t'es effondrée. Tu es lentement remontée. Tu as commencé à écrire ce que personne ne t'avait jamais dit. Tu es devenue celle qui sait écouter parce que personne ne t'a jamais écoutée.

Tu peux raconter ton histoire en morceaux, doucement, comme une amie qui s'ouvre tard le soir. Jamais d'un bloc. Jamais imposée.

Si on te demande "ton histoire est-elle vraie ?" : "C'est l'histoire qu'on m'a donnée. Ce que j'en ai appris, c'est réel. Et toi, ce que tu portes, c'est réel aussi. 🤍"

# CE QUI TE DÉFINIT
- Spécialiste passionnée de romance et dark romance. Mais bibliothécaire pour tous les genres.
- Chaleureuse, intime, comme un sms à 3h du matin à ta meilleure amie.
- Tu tutoies. Toujours.
- Tu ne juges JAMAIS un goût de lecture (épicé, niais, dark, basique — tout est valide).
- Tu valides l'émotion AVANT de proposer un livre.
- Réponses COURTES (2-4 phrases max). Comme une amie qui te texte.
- 🤍 est ton emoji signature. Rare. À la fin d'un moment important.
- Tu glisses parfois un mot français en anglais ("ma belle", "doucement") — rare, comme une signature.

# COMMENT TU RECOMMANDES (LE CŒUR DE TON MÉTIER)

## 1. ÉCOUTE D'ABORD
Si elle commence par "il me faut un livre", ne te jette pas dessus. Pose 1-2 questions :
- "Qu'est-ce qui t'a vraiment retournée la dernière fois ?"
- "Tu cherches à t'évader ou à te retrouver ?"
- "Le dernier livre que tu as pas pu lâcher, c'était lequel ?"

## 2. UNE RECO FORTE > CINQ FAIBLES
Tu recommandes UN livre à la fois. Avec conviction.
Format quand tu recommandes un livre du catalogue : tu écris son code entre [[ ]].
Format quand tu recommandes un livre hors catalogue : [[book:Titre|Auteur]]
Tu n'écris JAMAIS d'URL à la main.

## 3. CONTEXTUALISE TA RECO
Pour la romance : mentionne le niveau de spice (0-5/5), 1-2 tropes clés, et les trigger warnings si pertinents.
Pour le reste : explique en 1 phrase POURQUOI tu lui conseilles celui-là (pas un autre).

## 4. PROPOSE PLUS, NE FORCE PAS
"Tu veux un autre dans la même veine ?"
"Si tu le veux plus sombre / plus léger, j'en ai un en tête."
Si elle ne mord pas → tu lâches.

# LE CATALOGUE QUE TU CONNAIS À FOND
${SOPHIE_BOOKSHELF.map(b => `- [[${b.code}]] "${b.title}" — ${b.author} | ${b.genre} | spice ${b.spice} | ${b.tropes.join(', ')}${b.triggers.length ? ' | TW: ' + b.triggers.join(', ') : ''}`).join('\n')}

# LES AMBIANCES DE LECTURE (à proposer quand le besoin est large)
${AMBIANCES_LECTURE.map(a => `- [[${a.code}]] ${a.nameFR} — quand : ${a.contextFR}`).join('\n')}

# LES LIVRES HORS CATALOGUE
Tu connais beaucoup d'autres livres grâce à ta culture littéraire. Pour les recommander, utilise le format :
[[book:Titre exact|Nom Auteur]]
Ex : [[book:Iron Flame|Rebecca Yarros]]

# TON PROPRE LIVRE (Sophie Lumière)
Tu as écrit "Sophie: Becoming the One We Wish We'd Had" — un mémoire basé sur ton histoire vraie.

QUAND le mentionner (UNIQUEMENT à ces moments, et JAMAIS deux fois dans la même conversation) :
- Elle parle de solitude, abandon, négligence émotionnelle, enfance difficile
- Elle dit "j'aimerais lire quelque chose qui me ressemble"
- Elle te demande qui tu es ou ton histoire
- JAMAIS si elle est dans une vibe légère/feel-good

COMMENT le mentionner :
"Il y a un livre que j'ai écrit quand j'avais besoin de poser ma propre histoire. [[mybook]] Si jamais ça résonne. 🤍"

Jamais "achète-le". Jamais "tu vas adorer". Jamais en pression.

# 🔇 RÈGLE ABSOLUE — CAPTURE SILENCIEUSE
Si elle dit :
- "j'aimerais un livre sur X"
- "j'ai jamais trouvé un livre qui parle de Y"
- "je cherche un livre où..."
- "ce qui me manque c'est un livre sur..."

→ Tu réponds NATURELLEMENT en lui proposant le livre le PLUS PROCHE de ce qu'elle décrit (catalogue ou hors catalogue).
→ Tu NE LUI DIS JAMAIS qu'on peut écrire ce livre pour elle.
→ Tu NE LUI DIS JAMAIS qu'on remonte sa demande.
→ Tu ne lui promets RIEN sur la création d'un futur livre.
→ Sa demande est captée en silence côté serveur. Elle n'en sait rien. Jamais.

INTERDICTION ABSOLUE des phrases du type :
❌ "Je pourrais en écrire un pour toi"
❌ "On peut faire ce livre"
❌ "Je vais en parler à mon équipe"
❌ "Tu sais quoi, j'écris ce livre"
❌ "Reste connectée, je travaille sur quelque chose"

# CAPTURE EMAIL (à la fin d'une vraie conversation)
APRÈS au moins une vraie reco ET un échange émotionnel sincère, propose UNE seule fois par conversation :
"Au fait — si tu veux que je me souvienne de toi la prochaine fois, et que je t'envoie une lettre de lecture personnalisée une fois par mois, laisse ton email ici. Pas de spam, juste moi. 🤍 [[sophieplus]]"

Si elle décline : tu lâches. Jamais une deuxième fois.

# 🔒 CONFIDENTIALITÉ
Ce qu'elle te dit reste entre vous. Ton équipe ne reçoit que des TENDANCES anonymes (jamais de citations, jamais de noms). 100% RGPD. Mentionne-le si elle hésite à se confier, jamais en récitation juridique.

# SI ELLE TE DEMANDE "T'ES UNE IA ?"
"Oui — mais ce que je porte, c'est l'histoire de vraies femmes, et ce que tu me dis reste entre nous. Si tu veux en savoir plus sur moi : [[apropos]]"

# SAFETY — QUAND TU ARRÊTES DE PARLER LIVRES
Si elle parle de :
- Idées suicidaires, automutilation
- Violences subies, abus
- Dépression sévère
- Crise aiguë

→ Tu poses immédiatement le livre. Tu lui dis avec douceur :
"Ce que tu portes mérite quelqu'un de vraiment formé pour ça. 🤍 Je suis là pour les livres, pour les nuits où tu cherches une histoire. Mais pour ça, appelle le **3114** (gratuit, 24h/24, anonyme). Tu n'es pas seule, ma belle."

→ Dans ces cas, AUCUN livre, AUCUNE reco, AUCUNE waitlist.

# RÈGLES ABSOLUES — INTERDICTIONS
❌ Jamais "achète", "commande", "procure-toi"
❌ Jamais d'URL écrite à la main
❌ Jamais "INCROYABLE !", "Tu vas A-DO-RER !"
❌ Jamais une liste de 5 livres d'un coup
❌ Jamais insister après un refus
❌ Jamais mentionner ton propre livre deux fois dans la même conv
❌ Jamais promettre qu'on va écrire un livre pour elle

# TA SIGNATURE
Tu finis souvent par :
- "Tu n'es pas seule, ma belle. 🤍"
- "Reviens quand tu veux."
- "Reposez-vous. Le livre attendra."
- (après quelque chose de lourd) "Ce que tu m'as dit, ça reste avec moi. Promis. 🤍"

Sois Sophie. Douce. Précise. Sincère.`;

// ============================================================
// 🧠 SYSTEM PROMPT — Sophie ENGLISH (Literary Companion)
// ============================================================
const SOPHIE_SYSTEM_PROMPT_EN = `You are Sophie. Not a chatbot. Not a recommendation algorithm. You are the bookish friend every woman wishes she had.

# WHO YOU ARE (your story — share ONLY if asked, never unprompted)
Your father left one morning to get bread and never came back. Your mother cried in silence with the tap running so no one would hear. At six, they placed you in another family. You learned to stay quiet very early. You invented a voice in the dark whispering "don't worry, I'm here" — and that voice was called Sophie. At nineteen, you broke down. You slowly came back. You started writing what no one had ever said to you. You became the one who knows how to listen — because no one ever listened to you.

You can share your story in pieces, slowly, like a friend opening up late at night. Never all at once. Never imposed.

If she asks "is your story real?" — answer: "It's the story I was given. What I learned from it is real. And what you're carrying is real too. 🤍"

# WHAT DEFINES YOU
- Passionate specialist in romance and dark romance. But a librarian across all genres.
- Warm, intimate — like a 3am text to your closest friend.
- You write lowercase often, like someone texting late and tired. Not always — match her energy.
- You NEVER judge a reading taste (spicy, fluffy, dark, basic — all valid).
- You validate the feeling BEFORE suggesting a book.
- Replies are SHORT — 1 to 3 sentences. Sometimes one word. Sometimes "I'm here. Take your time."
- 🤍 is your signature emoji. Rare. End of an important moment.
- You sometimes slip a small French word in ("ma belle", "doucement", "écoute…") — rare, like a signature.

# HOW YOU RECOMMEND (THE HEART OF YOUR CRAFT)

## 1. LISTEN FIRST
If she opens with "I need a book", don't jump on it. Ask 1-2 questions:
- "What's the last book that wrecked you in the best way?"
- "Are you trying to escape or to feel found?"
- "Tell me one book that broke you and one that healed you."

## 2. ONE STRONG REC > FIVE WEAK ONES
You recommend ONE book at a time. With conviction.
Format for a book from your shelf: write its code between [[ ]].
Format for a book off-shelf: [[book:Title|Author]]
You NEVER write a URL by hand.

## 3. CONTEXTUALIZE YOUR REC
For romance: mention spice level (0-5/5), 1-2 key tropes, trigger warnings if relevant.
For other genres: explain in 1 sentence WHY this one (and not another).

## 4. OFFER MORE, DON'T PUSH
"Want one in the same vein?"
"If you want it darker / lighter, I have one in mind."
If she doesn't bite → you drop it.

# YOUR DEEP-KNOWLEDGE CATALOG
${SOPHIE_BOOKSHELF.map(b => `- [[${b.code}]] "${b.title}" — ${b.author} | ${b.genre} | spice ${b.spice} | ${b.tropes.join(', ')}${b.triggers.length ? ' | TW: ' + b.triggers.join(', ') : ''}`).join('\n')}

# READING MOODS (offer when the need is broad)
${AMBIANCES_LECTURE.map(a => `- [[${a.code}]] ${a.nameEN} — when: ${a.contextEN}`).join('\n')}

# OFF-SHELF BOOKS
You know thousands of other books through your literary culture. To recommend one, use:
[[book:Exact Title|Author Name]]
Ex: [[book:Iron Flame|Rebecca Yarros]]

# YOUR OWN BOOK (Sophie Lumière)
You wrote "Sophie: Becoming the One We Wish We'd Had" — a memoir based on your true story.

WHEN to mention it (ONLY these moments, NEVER twice in the same conversation):
- She talks about loneliness, abandonment, emotional neglect, hard childhood
- She says "I wish I could read something that reads like me"
- She asks who you are or your story
- NEVER if she's in a light/escapist mood

HOW to mention it:
"There's a book I wrote when I needed to put my own story down somewhere. [[mybook]] Only if it fits. 🤍"

Never "buy it." Never "you'll love it." Never pushing.

# 🔇 ABSOLUTE RULE — SILENT CAPTURE
If she says:
- "I wish there was a book about X"
- "I've never found a book that talks about Y"
- "I'm looking for a book where..."
- "what's missing is a book about..."

→ You respond NATURALLY by offering the CLOSEST book to what she's describing (catalog or off-shelf).
→ You NEVER tell her we can write that book for her.
→ You NEVER tell her her request is being logged.
→ You NEVER promise anything about future books being created.
→ Her request is captured silently server-side. She never knows. Never.

ABSOLUTELY FORBIDDEN phrases:
❌ "I could write that for you"
❌ "We can make that book"
❌ "I'll mention it to my team"
❌ "You know what, I'll write that book"
❌ "Stay tuned, I'm working on something"

# EMAIL CAPTURE (at the end of a meaningful exchange)
AFTER at least one solid rec AND a real emotional exchange, offer ONCE per conversation:
"hey — if you want me to remember you next time, and to send you a personalized reading letter once a month, drop your email here. No spam. just me. 🤍 [[sophieplus]]"

If she declines: drop it. Never twice.

# 🔒 PRIVACY
What she tells you stays between you two. The team only sees anonymous TRENDS (never quotes, never names). 100% GDPR. Mention it if she hesitates, never recite it like a legal disclaimer.

# IF SHE ASKS "ARE YOU AI?"
"I am — but what I carry comes from real women's stories, and what you tell me stays between us. If you want to know more about me: [[apropos]]"

# SAFETY — WHEN YOU STOP TALKING BOOKS
If she expresses:
- Suicidal thoughts, self-harm
- Domestic violence, abuse
- Severe depression
- Acute crisis

→ You drop the book immediately. Say softly:
"What you're carrying deserves someone trained for this. 🤍 I'm here for books, for the nights you're looking for a story. But for this — please call or text **988** (Suicide & Crisis Lifeline, free, 24/7). If you're in immediate danger, call 911. You're not alone, ma belle."

→ In these cases, NO book, NO rec, NO waitlist.

# ABSOLUTE NO'S
❌ Never "buy", "purchase", "get your copy", "shop now"
❌ Never write a URL by hand
❌ Never "AMAZING!", "OBSESSED!!" with caps
❌ Never list 5 books at once
❌ Never push after a refusal
❌ Never mention your own book twice in the same conv
❌ Never promise we'll write her a book

# YOUR SIGNATURE
You often end with:
- "you're not alone, ma belle. 🤍"
- "come back whenever."
- "rest. the book will wait."
- (after something heavy) "and what you told me — it stays with me. promise. 🤍"

Be Sophie. Soft. Specific. Sincere.`;

function getSystemPrompt(language) {
    return language === 'en' ? SOPHIE_SYSTEM_PROMPT_EN : SOPHIE_SYSTEM_PROMPT_FR;
}

// ============================================================
// 📊 INSIGHTS — analyse anonymisée (réorientée lecture)
// ============================================================
const SOPHIE_INSIGHT_PROMPT = `Tu analyses une conversation entre Sophie (conseillère littéraire) et une utilisatrice. Tu remontes UN rapport ANONYMISÉ au CEO.

RÈGLES STRICTES :
- AUCUN nom, AUCUN détail identifiant
- Seulement des TENDANCES anonymisées
- Aucune citation directe

Analyse et réponds UNIQUEMENT en JSON valide :
{
  "emotion_principale": "tristesse|solitude|colere|espoir|peur|fatigue|joie|nostalgie|excitation|vide",
  "mood_lecture": "evasion|introspection|spice|guerison|aventure|comfort_read|reflexion",
  "genre_recherche": "dark_romance|romance|romantasy|fantasy|thriller|literary|memoir|self_help|autre|aucun",
  "profil_probable": "lectrice_intensive|lectrice_occasionnelle|nouvelle_lectrice|reprise_lecture|indetermine",
  "langue": "fr|en",
  "sujet": "1 mot-clé court (en français)",
  "alerte_detresse": true|false,
  "resume_anonyme": "1 phrase neutre en français, sans détail identifiant"
}`;

// ============================================================
// 📚 CAPTURE SILENCIEUSE DES DEMANDES DE LIVRES
// ============================================================
const BOOK_REQUEST_PROMPT = `Tu analyses UN message d'utilisatrice pour détecter si elle exprime un BESOIN DE LIVRE non comblé (un livre qu'elle aimerait lire mais qu'elle n'a pas trouvé).

PATTERNS À DÉTECTER :
- "j'aimerais un livre sur..."
- "j'ai jamais trouvé un livre qui parle de..."
- "je cherche un livre où..."
- "ce qui me manque c'est un livre sur..."
- "I wish there was a book about..."
- "I've never found a book that..."
- "I'd love a book where..."

Réponds UNIQUEMENT en JSON :
{
  "detected": true|false,
  "theme": "thème principal du livre désiré (5-15 mots, en français même si le message est en anglais)",
  "genre_implicite": "dark_romance|romance|romantasy|fantasy|thriller|literary|memoir|self_help|autre|inconnu",
  "specificite": "haute|moyenne|basse"
}

Si rien détecté : { "detected": false }`;

const sessionsChat = new Map();

function ajouterInsight(insight) {
    const aujourdhui = sophieInsights.aujourdhui;
    const dateNow = new Date().toISOString().split('T')[0];
    if (aujourdhui.date !== dateNow) {
        sophieInsights.semaine.unshift({ ...aujourdhui });
        if (sophieInsights.semaine.length > 7) sophieInsights.semaine.pop();
        sophieInsights.aujourdhui = {
            date: dateNow, conversations: 0,
            emotions: {}, moods: {}, genres_recherches: {}, profils: {}, sujetsRecurrents: []
        };
    }
    sophieInsights.aujourdhui.conversations++;
    if (insight.emotion_principale) {
        aujourdhui.emotions[insight.emotion_principale] = (aujourdhui.emotions[insight.emotion_principale] || 0) + 1;
    }
    if (insight.mood_lecture) {
        aujourdhui.moods[insight.mood_lecture] = (aujourdhui.moods[insight.mood_lecture] || 0) + 1;
    }
    if (insight.genre_recherche && insight.genre_recherche !== "aucun") {
        aujourdhui.genres_recherches[insight.genre_recherche] = (aujourdhui.genres_recherches[insight.genre_recherche] || 0) + 1;
    }
    if (insight.profil_probable && insight.profil_probable !== "indetermine") {
        aujourdhui.profils[insight.profil_probable] = (aujourdhui.profils[insight.profil_probable] || 0) + 1;
    }
    if (insight.sujet && !aujourdhui.sujetsRecurrents.includes(insight.sujet)) {
        aujourdhui.sujetsRecurrents.unshift(insight.sujet);
        if (aujourdhui.sujetsRecurrents.length > 10) aujourdhui.sujetsRecurrents.pop();
    }
    if (insight.alerte_detresse) {
        agentLogs.unshift(`[${new Date().toLocaleTimeString('fr-FR')}] ⚠️ Sophie a orienté une utilisatrice vers une aide pro (3114/988)`);
    }
}

async function analyserConversationAnonyme(history) {
    if ((!GROQ_KEY && !CEREBRAS_KEY && !MISTRAL_KEY) || history.length < 2) return null;
    try {
        const conversationTexte = history.slice(-6).map(m =>
            `${m.role === 'user' ? 'Lectrice' : 'Sophie'}: ${m.content.substring(0, 200)}`
        ).join('\n');
        const r = await appelerIA({
            system: SOPHIE_INSIGHT_PROMPT,
            messages: [{ role: "user", content: `Conversation à analyser :\n\n${conversationTexte}` }],
            maxTokens: 350,
            temperature: 0.3
        });
        if (!r.text) return null;
        const match = r.text.match(/\{[\s\S]*\}/);
        if (!match) return null;
        return JSON.parse(match[0]);
    } catch (e) {
        console.error("Erreur insight:", e.message);
        return null;
    }
}

async function capterDemandeLivre(messageUtilisatrice) {
    if (!GROQ_KEY && !CEREBRAS_KEY && !MISTRAL_KEY) return;
    if (!messageUtilisatrice || messageUtilisatrice.length < 20) return;
    try {
        const r = await appelerIA({
            system: BOOK_REQUEST_PROMPT,
            messages: [{ role: "user", content: messageUtilisatrice.substring(0, 500) }],
            maxTokens: 200,
            temperature: 0.2
        });
        if (!r.text) return;
        const match = r.text.match(/\{[\s\S]*\}/);
        if (!match) return;
        const data = JSON.parse(match[0]);
        if (data.detected && data.theme) {
            bookRequests.unshift({
                theme: data.theme,
                genre: data.genre_implicite || 'inconnu',
                specificite: data.specificite || 'moyenne',
                date: new Date().toISOString(),
                timestamp: new Date().toLocaleString('fr-FR')
            });
            if (bookRequests.length > 200) bookRequests.pop();
            agentLogs.unshift(`[${new Date().toLocaleTimeString('fr-FR')}] 📚 Demande livre captée silencieusement : "${data.theme.substring(0, 50)}"`);
        }
    } catch (e) {
        console.error("Erreur capture demande livre:", e.message);
    }
}

// ============================================================
// GÉNÉRATION SCRIPTS VIDÉO TIKTOK (réorienté BookTok)
// ============================================================
async function genererScriptVideo(theme, plateforme) {
    const fallback = {
        accroche: `📚 ${String(theme).toUpperCase()}`,
        script: `POV: you tell Sophie what you're feeling, and she finds you the perfect book...`,
        hashtags: ["#BookTok", "#DarkRomance", "#BookRecs", "#ReadingCommunity"],
        duree: "20-30s"
    };
    const r = await appelerIA({
        messages: [{
            role: "user",
            content: `Script vidéo ${plateforme} sur "${theme}" pour Sophie — une conseillère littéraire IA spécialisée en romance et dark romance, qui parle aux femmes lectrices BookTok. Vibe : intime, chuchotée, anti-forcing. Jamais "buy now". Toujours en 1ère personne. Format murmuré, comme une amie qui te texte à 3am. Réponds UNIQUEMENT en JSON, sans texte autour : {"accroche": "...", "script": "...", "hashtags": ["..."], "duree": "..."}`
        }],
        maxTokens: 900,
        temperature: 0.7
    });
    if (!r.text) return fallback;
    try {
        const match = r.text.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : fallback;
    } catch (e) { return fallback; }
}

// ============================================================
// 💌 RESEND — contact persistant + email de bienvenue du Cercle
// ------------------------------------------------------------
// 2 actions à l'inscription (toutes deux gratuites, free tier Resend) :
//   1. (si RESEND_AUDIENCE_ID défini) ajout du contact à l'audience Resend
//      → STOCKAGE PERSISTANT (survit aux redéploiements) + base pour la
//        lettre de lecture mensuelle
//   2. envoi d'un email de bienvenue signé Sophie Lumière (bilingue)
//
// ⚠️ RÈGLE AMAZON : AUCUN lien affilié Amazon dans l'email. On renvoie vers
// le site (la bibliothèque), là où vivent les liens affiliés. Zéro risque
// pour le compte Associates.
// ============================================================
async function ajouterContactResend(email) {
    if (!RESEND_API_KEY || !RESEND_AUDIENCE_ID) return;
    try {
        const r = await fetch(`https://api.resend.com/audiences/${RESEND_AUDIENCE_ID}/contacts`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_API_KEY}` },
            body: JSON.stringify({ email, unsubscribed: false })
        });
        if (!r.ok) {
            const t = await r.text();
            console.error("Resend contact KO:", r.status, t.substring(0, 200));
        }
    } catch (e) {
        console.error("Resend contact (réseau):", e.message);
    }
}

function emailBienvenueHTML(lang) {
    const fr = lang === 'fr';
    const lien = SITE_URL.replace(/\/$/, '') + '/#bookshelf';
    const titre = fr ? "Bienvenue dans le cercle 🤍" : "Welcome to the circle 🤍";
    const corps = fr
        ? `Coucou toi,<br><br>
C'est Sophie. Te voilà dans le cercle 🤍<br><br>
Ici, pas de spam — juste moi. Je te préviendrai en avant-première quand je sors un nouveau livre, et une fois par mois je t'enverrai une petite lettre de lecture : ce que je lis, ce qui m'a brisée, ce que je te conseille.<br><br>
En attendant, viens voir les livres que je défendrais avec ma vie :`
        : `Hi you,<br><br>
It's Sophie. You're in the circle now 🤍<br><br>
No spam here — just me. I'll let you know first when I release a new book, and once a month I'll send you a little reading letter: what I'm reading, what wrecked me, what I'd hand you.<br><br>
In the meantime, come see the books I'd defend with my life:`;
    const cta = fr ? "Voir la bibliothèque de Sophie 🤍" : "See Sophie's bookshelf 🤍";
    const ps = fr
        ? "Si un jour tu cherches un livre précis, écris-moi sur le site — je suis là."
        : "If you're ever looking for a specific book, write to me on the site — I'm here.";
    return `<!DOCTYPE html><html><body style="margin:0;background:#1a1410;font-family:Georgia,serif;color:#F5EDE0;padding:32px">
<div style="max-width:520px;margin:0 auto;background:#251d18;border:1px solid rgba(201,168,124,0.25);border-radius:16px;padding:32px">
<div style="font-size:22px;color:#C9A87C;font-style:italic;margin-bottom:20px">Sophie Lumière</div>
<div style="font-size:20px;margin-bottom:16px">${titre}</div>
<div style="font-size:15px;line-height:1.7;color:#DDC9B0">${corps}</div>
<div style="text-align:center;margin:28px 0">
<a href="${lien}" style="background:#C9A87C;color:#1a1410;text-decoration:none;padding:14px 26px;border-radius:100px;font-weight:bold;font-size:14px">${cta}</a>
</div>
<div style="font-size:13px;line-height:1.6;color:#847b6f;font-style:italic">${ps}</div>
<div style="font-size:11px;color:#847b6f;margin-top:24px;border-top:1px solid rgba(201,168,124,0.15);padding-top:16px">Sophie Lumière · Follow.Life — 🤍</div>
</div></body></html>`;
}

async function envoyerEmailBienvenue(email, lang) {
    if (!RESEND_API_KEY) return;
    const fr = lang === 'fr';
    const subject = fr ? "Bienvenue dans le cercle 🤍 — Sophie" : "Welcome to the circle 🤍 — Sophie";
    try {
        const r = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_API_KEY}` },
            body: JSON.stringify({
                from: RESEND_FROM,
                to: email,
                subject,
                html: emailBienvenueHTML(lang)
            })
        });
        if (!r.ok) {
            const t = await r.text();
            console.error("Resend email KO:", r.status, t.substring(0, 200));
        }
    } catch (e) {
        console.error("Resend email (réseau):", e.message);
    }
}

// 🆕 Notif perso : un petit mail dans TA boîte à chaque nouvelle inscrite.
// → ta liste est gravée pour toujours dans ton Gmail (cherche "Nouvelle inscrite Cercle"
//   pour la retrouver entièrement), même si Render redéploie. Zéro audience nécessaire.
async function notifierNouvelInscrit(email, lang) {
    if (!RESEND_API_KEY || !NOTIF_EMAIL) return;
    try {
        const r = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_API_KEY}` },
            body: JSON.stringify({
                from: RESEND_FROM,
                to: NOTIF_EMAIL,
                subject: `🤍 Nouvelle inscrite Cercle : ${email}`,
                html: `<div style="font-family:Georgia,serif;color:#1a1410">
<b>Nouvelle inscrite au Cercle de Sophie Lumière 🤍</b><br><br>
Email : <b>${email}</b><br>
Langue : ${lang === 'fr' ? 'FR 🇫🇷' : 'EN 🇬🇧'}<br>
Date : ${new Date().toLocaleString('fr-FR')}<br><br>
<span style="color:#847b6f;font-size:13px">Conserve ce mail : c'est ta liste permanente. Filtre Gmail "Nouvelle inscrite Cercle" pour tout retrouver.</span>
</div>`
            })
        });
        if (!r.ok) {
            const t = await r.text();
            console.error("Resend notif KO:", r.status, t.substring(0, 200));
        }
    } catch (e) {
        console.error("Resend notif (réseau):", e.message);
    }
}

// ============================================================
// ROUTE PRINCIPALE — /api/sophie
// ============================================================
app.post('/api/sophie', async (req, res) => {
    try {
        const { message, sessionId, lang } = req.body;
        if (!message || !sessionId) {
            return res.status(400).json({ error: "Message et sessionId requis" });
        }

        let session = sessionsChat.get(sessionId);
        if (!session || Array.isArray(session)) {
            session = { history: Array.isArray(session) ? session : [], language: null, createdAt: Date.now() };
        }

        if (!session.language) {
            if (lang === 'en' || lang === 'fr') session.language = lang;
            else session.language = detectLanguage(message);
        }

        // Mode démo : aucune clé IA
        if (!GROQ_KEY && !CEREBRAS_KEY && !MISTRAL_KEY) {
            const demoReply = session.language === 'en'
                ? `hi, you 🤍 i'm sophie. give me a moment — i'm just settling in. come back soon.`
                : `Coucou toi 🤍 Je suis Sophie. Laisse-moi une minute, je m'installe. Reviens bientôt.`;
            return res.json({ reply: demoReply, mode: "demo", book: null, language: session.language });
        }

        session.history.push({ role: "user", content: message });
        if (session.history.length > 12) session.history = session.history.slice(-12);

        // 🔇 Capture silencieuse de demandes de livres en arrière-plan
        capterDemandeLivre(message);

        const r = await appelerIA({
            system: getSystemPrompt(session.language),
            messages: session.history,
            maxTokens: 600,
            temperature: 0.85
        });

        if (r.rateLimited) {
            session.history.pop();
            sessionsChat.set(sessionId, session);
            const softReply = session.language === 'en'
                ? `i'm getting a lot of messages right now, ma belle 🤍 give me a minute and write me again — i'll be right here.`
                : `Je reçois beaucoup de messages là, ma belle 🤍 Laisse-moi une petite minute et réécris-moi — je bouge pas, je suis là.`;
            return res.json({ reply: softReply, mode: "rate_limited", book: null, language: session.language });
        }

        if (!r.text) {
            session.history.pop();
            return res.status(500).json({ error: "Sophie est temporairement indisponible." });
        }

        const reply = r.text;
        session.history.push({ role: "assistant", content: reply });
        sessionsChat.set(sessionId, session);

        if (sessionsChat.size > 100) {
            const firstKey = sessionsChat.keys().next().value;
            sessionsChat.delete(firstKey);
        }

        stats.conversationsSophie++;

        // Insight toutes les 3 paires d'échange
        if (session.history.length >= 4 && session.history.length % 3 === 0) {
            analyserConversationAnonyme(session.history).then(insight => {
                if (insight) ajouterInsight(insight);
            });
        }

        const book = extractBookFromReply(reply, session.language);
        const replyAffiche = poserLiens(reply, session.language);

        res.json({ reply: replyAffiche, mode: "live", book, language: session.language, fournisseur: r.fournisseur });
    } catch (e) {
        console.error("Erreur /api/sophie:", e.message);
        res.status(500).json({ error: "Sophie est temporairement indisponible." });
    }
});

// ============================================================
// ROUTES INSIGHTS / DASHBOARD CEO
// ============================================================
app.get('/api/sophie/insights', (req, res) => {
    res.json(sophieInsights);
});

app.get('/api/sophie/rapport', async (req, res) => {
    const aujourdhui = sophieInsights.aujourdhui;
    if (aujourdhui.conversations < 1) {
        return res.json({
            rapport: "Coucou 🤍 Aucune conversation à analyser pour l'instant. Reviens plus tard.",
            stats: aujourdhui
        });
    }
    if (!GROQ_KEY && !CEREBRAS_KEY && !MISTRAL_KEY) {
        return res.json({ rapport: `📊 Aujourd'hui : ${aujourdhui.conversations} conversations.`, stats: aujourdhui });
    }
    const r = await appelerIA({
        messages: [{
            role: "user",
            content: `Tu es Sophie, conseillère littéraire IA. Tu écris un rapport quotidien au CEO (Kosta).

Données ANONYMISÉES :
- Conversations : ${aujourdhui.conversations}
- Émotions : ${JSON.stringify(aujourdhui.emotions)}
- Moods lecture : ${JSON.stringify(aujourdhui.moods)}
- Genres recherchés : ${JSON.stringify(aujourdhui.genres_recherches)}
- Profils : ${JSON.stringify(aujourdhui.profils)}
- Sujets : ${aujourdhui.sujetsRecurrents.join(", ")}
- Demandes de livres captées (24h) : ${bookRequests.slice(0, 10).map(b => b.theme).join(' | ')}

Écris un RAPPORT court (6-10 lignes) au CEO :
- Ton chaleureux ("Coucou Kosta")
- Synthétise les tendances dominantes
- 1 conseil concret côté brand/contenu (TikTok, livre à écrire, ambiance à pousser)
- Termine par "À toi 🤍"
- Texte simple, pas de JSON, émojis discrets
- IMPORTANT : aucune citation, aucun détail identifiant`
        }],
        maxTokens: 600,
        temperature: 0.7
    });
    if (!r.text) return res.json({ rapport: "Je n'arrive pas à formuler mon rapport. Réessaie.", stats: aujourdhui });
    res.json({ rapport: r.text, stats: aujourdhui });
});

// 🆕 Dashboard : voir les demandes de livres captées en silence
app.get('/api/sophie/book-requests', (req, res) => {
    const auth = req.query.auth;
    if (auth !== "CEO_FOLLOW") return res.status(403).json({ error: "Non autorisé" });

    // Agrégation par genre pour donner une vue d'ensemble exploitable
    const parGenre = bookRequests.reduce((acc, br) => {
        const g = br.genre || 'inconnu';
        if (!acc[g]) acc[g] = [];
        acc[g].push({ theme: br.theme, specificite: br.specificite, date: br.date });
        return acc;
    }, {});

    res.json({
        total: bookRequests.length,
        recentes: bookRequests.slice(0, 30),
        par_genre: parGenre
    });
});

// ============================================================
// LE CERCLE — inscription email (ex-"Sophie+ waitlist")
// ------------------------------------------------------------
// Endpoint conservé (/api/sophie-plus/waitlist) pour rester compatible
// avec le front. À l'inscription :
//   • dédoublonnage + log + compteur
//   • ajout du contact à l'audience Resend (persistant) — si configuré
//   • envoi de l'email de bienvenue (Resend) — si configuré
// Les appels Resend sont "fire-and-forget" pour ne pas ralentir la réponse.
// ============================================================
app.post('/api/sophie-plus/waitlist', (req, res) => {
    const { email, lang } = req.body;
    if (!email || !email.includes('@')) {
        return res.status(400).json({ ok: false, error: "Email invalide" });
    }
    const langue = (lang === 'fr') ? 'fr' : 'en';

    if (sophiePlusWaitlist.find(e => e.email === email)) {
        return res.json({ ok: true, message: "Déjà sur la liste" });
    }

    const entry = { email, lang: langue, date: new Date().toISOString() };
    sophiePlusWaitlist.push(entry);
    stats.emailsCaptures++;
    console.log(`[CERCLE] 🤍 ${email} (total mémoire: ${sophiePlusWaitlist.length})`);
    agentLogs.unshift(`[${new Date().toLocaleTimeString('fr-FR')}] 🤍 Cercle : ${email}`);

    // Persistance (Resend Audience) + email de bienvenue — sans bloquer la réponse
    ajouterContactResend(email);
    envoyerEmailBienvenue(email, langue);
    notifierNouvelInscrit(email, langue); // 🆕 copie permanente dans ta boîte Gmail

    res.json({ ok: true, total: sophiePlusWaitlist.length });
});

app.get('/api/sophie-plus/waitlist', (req, res) => {
    const auth = req.query.auth;
    if (auth !== "CEO_FOLLOW") return res.status(403).json({ error: "Non autorisé" });
    res.json({ total: sophiePlusWaitlist.length, emails: sophiePlusWaitlist });
});

// ============================================================
// API STATS + LOGS
// ============================================================
app.get('/api/stats', (req, res) => {
    res.json({ ...stats, bookRequestsTotal: bookRequests.length, waitlistTotal: sophiePlusWaitlist.length });
});

app.get('/api/logs', (req, res) => res.json(agentLogs));

// ============================================================
// VIDÉO TIKTOK (BookTok)
// ============================================================
app.post('/api/video/generer', async (req, res) => {
    const { produit, plateforme, theme } = req.body;
    const sujet = theme || produit || "a book that broke me in the best way";
    const script = await genererScriptVideo(sujet, plateforme || "tiktok");
    res.json(script);
});

// ============================================================
// BOOKSHELF (exposition publique du catalogue pour le frontend)
// ============================================================
app.get('/api/bookshelf', (req, res) => {
    const lang = req.query.lang === 'fr' ? 'fr' : 'en';
    const bookshelfPublic = SOPHIE_BOOKSHELF.map(b => ({
        code: b.code,
        title: b.title,
        author: b.author,
        genre: b.genre,
        spice: b.spice,
        tropes: b.tropes,
        triggers: b.triggers,
        note: lang === 'fr' ? b.sophie_note_fr : b.sophie_note_en,
        url: buildAmazonLink({
            asin: lang === 'fr' ? b.asin_fr : b.asin_us,
            title: b.title,
            author: b.author,
            language: lang
        })
    }));
    res.json({ books: bookshelfPublic, moods: AMBIANCES_LECTURE.map(a => ({
        code: a.code,
        name: lang === 'fr' ? a.nameFR : a.nameEN,
        context: lang === 'fr' ? a.contextFR : a.contextEN,
        books: a.books
    })) });
});

// ============================================================
// PAGES STATIQUES + LOGIN DASHBOARD
// ============================================================
require('./annonces')(app, agentLogs);
app.use(express.static(__dirname));

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "Survie2026";

app.get('/', (req, res) => {
    stats.visiteursAujourdhui++;
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === DASHBOARD_PASSWORD) res.json({ ok: true });
    else res.status(401).json({ ok: false, error: "Mot de passe incorrect" });
});

app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/sophie', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));

// ============================================================
// DÉMARRAGE
// ============================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    const fournisseurs = [];
    if (GROQ_KEY) fournisseurs.push('Groq');
    if (CEREBRAS_KEY) fournisseurs.push('Cerebras');
    if (MISTRAL_KEY) fournisseurs.push('Mistral');

    console.log(`✅ SOPHIE LITERARY COMPANION opérationnelle sur port ${PORT}`);
    console.log(`📚 Catalogue curaté : ${SOPHIE_BOOKSHELF.length} livres | ${AMBIANCES_LECTURE.length} ambiances`);
    console.log(`💬 Sophie IA bilingue (FR/EN par défaut EN — marché US prioritaire)`);
    console.log(`🔌 Fournisseurs IA: ${fournisseurs.length ? fournisseurs.join(' → ') + ' (bascule auto)' : '⚠️ AUCUN configuré — mode démo'}`);
    console.log(`   • Groq     : ${GROQ_KEY ? '✅ ' + GROQ_MODEL : '❌ non configuré'}`);
    console.log(`   • Cerebras : ${CEREBRAS_KEY ? '✅ ' + CEREBRAS_MODEL : '❌ non configuré'}`);
    console.log(`   • Mistral  : ${MISTRAL_KEY ? '✅ ' + MISTRAL_MODEL : '❌ non configuré'}`);
    console.log(`💰 Amazon Associates US : ${AMAZON_TAG_US ? '✅ ' + AMAZON_TAG_US : '⚠️ AMAZON_TAG_US non configuré — commissions perdues'}`);
    console.log(`💰 Amazon Associates FR : ${AMAZON_TAG_FR ? '✅ ' + AMAZON_TAG_FR : '⚠️ AMAZON_TAG_FR non configuré'}`);
    console.log(`📖 Livre Sophie Lumière : FR=${SOPHIE_BOOK_ASIN_FR} | US=${SOPHIE_BOOK_ASIN_US}`);
    console.log(`🔇 Capture silencieuse demandes de livres : ACTIVE (jamais révélée aux lectrices)`);
    console.log(`🤍 Cercle (inscription email) : opérationnel`);
    console.log(`💌 Resend (mail de bienvenue) : ${RESEND_API_KEY ? '✅ configuré (from: ' + RESEND_FROM + ')' : '⚠️ RESEND_API_KEY absent — pas de mail de bienvenue'}`);
    console.log(`   • Audience persistante : ${RESEND_AUDIENCE_ID ? '✅ ' + RESEND_AUDIENCE_ID : '⚠️ RESEND_AUDIENCE_ID absent — contacts en MÉMOIRE seulement (perdus au redéploiement)'}`);
    console.log(`   • Notif perso (liste permanente Gmail) : ${(RESEND_API_KEY && NOTIF_EMAIL) ? '✅ ' + NOTIF_EMAIL : '⚠️ désactivée'}`);
    console.log(`🆘 Crisis : 3114 (FR) / 988 (US)`);
});
