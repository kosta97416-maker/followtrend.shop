const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

let order = "<h1>WAITING CEO ORDER</h1>";

app.post('/api/deploy', (req, res) => {
    if(req.body.auth !== "CEO_FOLLOW") return res.sendStatus(403);
    order = decodeURIComponent(atob(req.body.order));
    res.sendStatus(200);
});

app.get('/api/get-order', (req, res) => res.send(order));
app.get('/api/stats', (req, res) => res.json({shopify: "0.00", amazon: "0.00", ai: "0.00"}));

app.listen(process.env.PORT || 3000);
