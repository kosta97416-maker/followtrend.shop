const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
const PORT = process.env.PORT || 3000;

// Auth key (vous pouvez la mettre en variable d'environnement)
const AUTH_KEY = process.env.AUTH_KEY || "CEO_FOLLOW";

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Helper : décoder l'ordre
function decodeOrder(encoded) {
    try {
        const decoded = decodeURIComponent(Buffer.from(encoded, 'base64').toString('ascii'));
        return decoded;
    } catch(e) {
        throw new Error("Format d'encodage invalide");
    }
}

// Exécution du code dans un navigateur headless (version robuste Render)
async function executeOrderInBrowser(htmlCode) {
    let browser = null;
    let logsCapture = [];

    try {
        // Configuration critique pour Render
        const executablePath = await chromium.executablePath();
        
        browser = await puppeteer.launch({
            args: [
                ...chromium.args,
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process' // parfois nécessaire sur les environnements conteneurisés
            ],
            defaultViewport: chromium.defaultViewport,
            executablePath: executablePath,
            headless: 'new', // forcé pour Render
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        
        // Capture console
        page.on('console', msg => {
            const text = `[CONSOLE.${msg.type()}] ${msg.text()}`;
            logsCapture.push(text);
            console.log(text);
        });
        
        page.on('pageerror', err => {
            logsCapture.push(`[PAGE_ERROR] ${err.message}`);
        });

        const fullHtml = `
            <!DOCTYPE html>
            <html>
            <head><meta charset="UTF-8"><base target="_blank"></head>
            <body style="background:#000;color:#0f0;font-family:monospace;">
                ${htmlCode}
            </body>
            </html>
        `;

        await page.setContent(fullHtml, { waitUntil: 'networkidle0', timeout: 10000 });
        
        // Laisser le temps aux scripts asynchrones
        await new Promise(resolve => setTimeout(resolve, 6000));
        
        logsCapture.push(`✔ Exécution terminée avec succès`);
        await browser.close();
        
        return { success: true, logs: logsCapture };
        
    } catch (err) {
        if (browser) await browser.close().catch(e => null);
        logsCapture.push(`❌ ERREUR : ${err.message}`);
        return { success: false, logs: logsCapture, error: err.message };
    }
}

// Endpoint de déploiement
app.post('/api/deploy', async (req, res) => {
    const { order, auth } = req.body;

    if (auth !== AUTH_KEY) {
        return res.status(403).json({ status: 'error', error: 'Accès non autorisé' });
    }
    
    if (!order) {
        return res.status(400).json({ status: 'error', error: 'Aucun ordre fourni' });
    }
    
    let decodedCode;
    try {
        decodedCode = decodeOrder(order);
        if(decodedCode.length < 5) throw new Error("Code trop court");
    } catch(e) {
        return res.status(400).json({ status: 'error', error: 'Décodage invalide: ' + e.message });
    }
    
    console.log(`[Déploiement] Ordre reçu (${decodedCode.length} caractères)`);
    
    const execResult = await executeOrderInBrowser(decodedCode);
    
    if (execResult.success) {
        return res.json({
            status: 'executed',
            message: 'Ordre exécuté sur les agents',
            logs: execResult.logs.slice(-8)
        });
    } else {
        return res.status(500).json({
            status: 'failed',
            error: execResult.error || 'Échec exécution',
            logs: execResult.logs
        });
    }
});

// Route santé
app.get('/health', (req, res) => {
    res.json({ status: 'FOLLOW_HQ opérationnel', timestamp: Date.now() });
});

// Démarrage avec gestion d'erreur explicite
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🔥 FOLLOW_HQ Backend lancé sur port ${PORT}`);
}).on('error', (err) => {
    console.error('❌ Erreur au démarrage du serveur:', err);
    process.exit(1);
});
