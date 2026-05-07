const express = require('express');
const cors = require('cors');
const app = express();

// Autorise Vercel à parler à Render
app.use(cors());
app.use(express.json({ limit: '50mb' }));

let currentOrder = "<h1>EN ATTENTE D'INSTRUCTIONS CEO</h1>";

// Réception de l'ordre
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

// Distribution aux agents
app.get('/api/get-order', (req, res) => res.status(200).send(currentOrder));

// Stats de sécurité
app.get('/api/stats', (req, res) => res.json({ shopify: "1250.00", amazon: "450.00", ai: "85.00" }));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Serveur actif sur port ${PORT}`));
