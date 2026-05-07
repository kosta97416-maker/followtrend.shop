const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// --- LOGIQUE DE STOCKAGE ---
let currentOrder = "<h1>EN ATTENTE D'INSTRUCTIONS CEO</h1>";
let currentStats = { shopify: "1250.00", amazon: "450.00", ai: "85.00" };

// --- ROUTES API ---
app.post('/api/deploy', (req, res) => {
    const { order, auth } = req.body;
    if (auth !== "CEO_FOLLOW") return res.sendStatus(403);
    try {
        currentOrder = decodeURIComponent(atob(order));
        res.status(200).json({ status: "SUCCESS" });
    } catch (err) {
        res.status(500).json({ status: "ERROR" });
    }
});

app.get('/api/get-order', (req, res) => res.status(200).send(currentOrder));
app.get('/api/stats', (req, res) => res.json(currentStats));

// --- SERVRE L'INTERFACE HTML ---
// Cette ligne envoie ton fichier index.html quand on visite l'URL de Render
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`PLATEFORME FOLLOW LIVE SUR PORT ${PORT}`));
