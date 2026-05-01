const https = require('https');
const http = require('http');
const url = require('url');
const crypto = require('crypto');

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '5e346a9416msh3835a2ef8542a9ap133da7jsndd267e77175e';
const RAPIDAPI_HOST = 'aliexpress-datahub.p.rapidapi.com';
const CEO_EMAIL = 'karma97416@gmail.com';
const CJ_API_KEY = process.env.CJ_API_KEY || '';
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const PORT = process.env.PORT || 3000;

// ── CACHE PRODUITS — 1 HEURE ──────────────────────────────
var productsCache = {
  data: null,
  timestamp: 0,
  TTL: 3600000 // 1 heure
};

function getCachedProducts() {
  if (productsCache.data && Date.now() - productsCache.timestamp < productsCache.TTL) {
    return Promise.resolve(productsCache.data);
  }
  return refreshProducts();
}

function refreshProducts() {
  var niches = [
    { keyword: 'sleep aid patch insomnia', niche: 'wellness' },
    { keyword: 'noise cancelling earplugs loop', niche: 'hearing' },
    { keyword: 'ring light portable selfie', niche: 'creator' },
    { keyword: 'nasal dilator breathing strip', niche: 'breathing' },
    { keyword: 'cable organizer desk magnetic', niche: 'home' }
  ];

  var promises = niches.map(function(n) {
    return searchProducts(n.keyword, n.niche).catch(function() { return []; });
  });

  return Promise.all(promises).then(function(results) {
    var allProducts = [];
    results.forEach(function(r) { allProducts = allProducts.concat(r); });

    var seen = {};
    var unique = allProducts.filter(function(p) {
      if (seen[p.id]) return false;
      seen[p.id] = true;
      return true;
    });
    unique.sort(function(a, b) { return b.score - a.score; });

    var winners = unique.slice(0, 15);
    productsCache.data = { success: true, winners: winners, total: unique.length, cached: true, cached_at: new Date().toISOString() };
    productsCache.timestamp = Date.now();
    console.log('[Cache] ✅ Produits mis en cache — ' + winners.length + ' winners');
    return productsCache.data;
  });
}

// Pré-charge le cache au démarrage
setTimeout(function() {
  refreshProducts().then(function() {
    console.log('[Cache] ✅ Cache initial chargé');
  }).catch(function(e) {
    console.log('[Cache] ⚠️ Erreur cache initial:', e.message);
  });
}, 2000);

// Renouvelle le cache toutes les heures
setInterval(function() {
  refreshProducts().catch(function(e) {
    console.log('[Cache] ⚠️ Erreur renouvellement:', e.message);
  });
}, 3600000);

// ── STRIPE API ────────────────────────────────────────────
function callStripe(path) {
  return new Promise(function(resolve, reject) {
    var options = {
      hostname: 'api.stripe.com', path: path, method: 'GET',
      headers: { 'Authorization': 'Bearer ' + STRIPE_SECRET, 'Content-Type': 'application/json' }
    };
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.end();
  });
}

// ── SIGNATURE STRIPE ──────────────────────────────────────
function verifyStripeSignature(payload, sigHeader, secret) {
  try {
    var parts = sigHeader.split(',');
    var timestamp = '';
    var signatures = [];
    parts.forEach(function(part) {
      if (part.startsWith('t=')) timestamp = part.slice(2);
      if (part.startsWith('v1=')) signatures.push(part.slice(3));
    });
    if (!timestamp || signatures.length === 0) return false;
    var expectedSig = crypto.createHmac('sha256', secret).update(timestamp + '.' + payload).digest('hex');
    return signatures.some(function(sig) { return sig === expectedSig; });
  } catch(e) { return false; }
}

// ── SÉCURITÉ ──────────────────────────────────────────────
var security = {
  ipRequests: {}, blacklist: [], requestLog: [], blockedAttempts: 0,
  RATE_LIMIT: 100, RATE_WINDOW: 3600000,
  WHITELIST: ['::1', '127.0.0.1', '::ffff:127.0.0.1', 'localhost']
};

var ALLOWED_ORIGINS = [
  'https://followtrend.shop', 'https://follow-store-qqbr.vercel.app',
  'http://localhost:3000', 'https://follow-backend-o300.onrender.com'
];

setInterval(function() {
  var now = Date.now();
  Object.keys(security.ipRequests).forEach(function(ip) {
    security.ipRequests[ip] = security.ipRequests[ip].filter(function(t) { return now - t < security.RATE_WINDOW; });
    if (security.ipRequests[ip].length === 0) delete security.ipRequests[ip];
  });
  if (security.requestLog.length > 1000) security.requestLog = security.requestLog.slice(-500);
}, 3600000);

function checkSecurity(req, res) {
  var ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  var origin = req.headers['origin'] || '';
  var userAgent = req.headers['user-agent'] || '';
  var now = Date.now();

  security.requestLog.push({ ip: ip, time: now, path: req.url, agent: userAgent });

  if (security.blacklist.includes(ip)) {
    security.blockedAttempts++;
    res.writeHead(403); res.end(JSON.stringify({ error: 'Accès refusé' }));
    return false;
  }

  if (!security.WHITELIST.includes(ip)) {
    if (!security.ipRequests[ip]) security.ipRequests[ip] = [];
    security.ipRequests[ip].push(now);
    var recent = security.ipRequests[ip].filter(function(t) { return now - t < security.RATE_WINDOW; });
    security.ipRequests[ip] = recent;
    if (recent.length > security.RATE_LIMIT) {
      security.blockedAttempts++;
      if (!security.blacklist.includes(ip)) security.blacklist.push(ip);
      res.writeHead(429); res.end(JSON.stringify({ error: 'Trop de requêtes' }));
      return false;
    }
  }

  var botPatterns = ['sqlmap', 'nikto', 'nmap', 'masscan', 'zgrab'];
  if (botPatterns.some(function(p) { return userAgent.toLowerCase().includes(p); })) {
    security.blockedAttempts++;
    res.writeHead(403); res.end(JSON.stringify({ error: 'Bot non autorisé' }));
    return false;
  }

  var sqlPatterns = ['select ', 'union ', 'drop ', 'insert ', 'delete ', '--', '/*', 'exec('];
  if (sqlPatterns.some(function(p) { return req.url.toLowerCase().includes(p); })) {
    security.blockedAttempts++;
    security.blacklist.push(ip);
    res.writeHead(403); res.end(JSON.stringify({ error: 'Injection bloquée' }));
    return false;
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Powered-By', 'FOLLOW.');
  var isAllowed = !origin || ALLOWED_ORIGINS.some(function(o) { return origin.startsWith(o); });
  res.setHeader('Access-Control-Allow-Origin', isAllowed ? (origin || '*') : 'https://followtrend.shop');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  return true;
}

// ── CJ DROPSHIPPING ───────────────────────────────────────
var cjToken = { access: '', expires: 0 };

function getCJToken() {
  return new Promise(function(resolve, reject) {
    if (cjToken.access && Date.now() < cjToken.expires) return resolve(cjToken.access);
    var postData = JSON.stringify({ apiKey: CJ_API_KEY });
    var options = {
      hostname: 'developers.cjdropshipping.com',
      path: '/api2.0/v1/authentication/getAccessToken', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          var result = JSON.parse(data);
          if (result.data && result.data.accessToken) {
            cjToken.access = result.data.accessToken;
            cjToken.expires = Date.now() + (14 * 24 * 60 * 60 * 1000);
            console.log('[CJ] ✅ Token obtenu');
            resolve(cjToken.access);
          } else { reject(new Error('CJ Token failed')); }
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData); req.end();
  });
}

function callCJ(path, method, body) {
  return getCJToken().then(function(token) {
    return new Promise(function(resolve, reject) {
      var postData = body ? JSON.stringify(body) : '';
      var options = {
        hostname: 'developers.cjdropshipping.com', path: path, method: method || 'GET',
        headers: { 'Content-Type': 'application/json', 'CJ-Access-Token': token }
      };
      if (postData) options.headers['Content-Length'] = Buffer.byteLength(postData);
      var req = https.request(options, function(res) {
        var data = '';
        res.on('data', function(c) { data += c; });
        res.on('end', function() { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
      });
      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
    });
  });
}

if (CJ_API_KEY) {
  getCJToken().then(function() { console.log('[CJ] Token initialisé'); }).catch(function(e) { console.log('[CJ] Erreur:', e.message); });
}

// ── WEBHOOK STRIPE → CJ ───────────────────────────────────
function handleStripeWebhook(payload, sigHeader) {
  return new Promise(function(resolve) {
    if (STRIPE_WEBHOOK_SECRET && !verifyStripeSignature(payload, sigHeader, STRIPE_WEBHOOK_SECRET)) {
      return resolve({ ok: false, error: 'Invalid signature' });
    }
    var event;
    try { event = JSON.parse(payload); } catch(e) { return resolve({ ok: false, error: 'Parse error' }); }
    if (event.type !== 'payment_intent.succeeded') return resolve({ ok: true, message: 'Event ignoré' });

    var pi = event.data.object;
    var orderId = 'FOLLOW-' + pi.id.slice(-8).toUpperCase();
    var productVid = pi.metadata ? (pi.metadata.cj_vid || '') : '';
    var country = pi.metadata ? (pi.metadata.country || 'FR') : 'FR';
    var quantity = pi.metadata ? parseInt(pi.metadata.quantity || 1) : 1;

    console.log('[Webhook] ✅ Paiement ' + (pi.amount/100) + pi.currency.toUpperCase() + ' — ' + orderId);

    if (productVid) {
      callCJ('/api2.0/v1/shopping/order/createOrder', 'POST', {
        orderNumber: orderId, shippingCountry: country,
        products: [{ vid: productVid, quantity: quantity }]
      }).then(function(r) {
        console.log('[Webhook] ✅ Commande CJ créée : ' + orderId);
        resolve({ ok: true, order: orderId, cj: r });
      }).catch(function(e) {
        console.log('[Webhook] ⚠️ Erreur CJ:', e.message);
        resolve({ ok: true, order: orderId, cj_error: e.message });
      });
    } else {
      console.log('[Webhook] ⚠️ Pas de VID CJ — traitement manuel requis pour ' + orderId);
      resolve({ ok: true, order: orderId, status: 'manual_required' });
    }
  });
}

// ── ALIEXPRESS ────────────────────────────────────────────
function callRapidAPI(endpoint, params) {
  return new Promise(function(resolve, reject) {
    var query = Object.keys(params).map(function(k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    var options = {
      hostname: RAPIDAPI_HOST, path: '/' + endpoint + '?' + query, method: 'GET',
      headers: { 'x-rapidapi-host': RAPIDAPI_HOST, 'x-rapidapi-key': RAPIDAPI_KEY, 'Content-Type': 'application/json' }
    };
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() { try { resolve(JSON.parse(data)); } catch(e) { reject(new Error('Parse error')); } });
    });
    req.on('error', reject);
    req.end();
  });
}

function parseProducts(data, niche) {
  var products = [];
  try {
    var resultList = data.result.resultList || [];
    resultList.forEach(function(entry) {
      var item = entry.item;
      if (!item) return;
      var price = item.sku && item.sku.def && item.sku.def.promotionPrice ? parseFloat(item.sku.def.promotionPrice) : 0;
      var title = item.title || '';
      var pid = item.itemId || '';
      var img = item.image ? ('https:' + item.image) : '';
      var rating = item.averageStarRate ? parseFloat(item.averageStarRate) : 4.5;
      var sales = parseInt(item.sales || 0);
      if (!title || price <= 0) return;
      var score = Math.round((rating / 5) * 40 + Math.min(sales / 500, 1) * 40 + 20);
      products.push({
        id: String(pid), name: title.substring(0, 80), image: img,
        price: price, oldPrice: parseFloat((price * 1.5).toFixed(2)),
        rating: rating, sales: sales, niche: niche || 'general',
        score: score, gapFR: score, isWinner: score >= 60,
        supplier: 'AliExpress', badge: sales > 100 ? 'hot' : 'new',
        link: 'https:' + (item.itemUrl || '//www.aliexpress.com/item/' + pid + '.html'),
        followLink: 'https://followtrend.shop?product=' + pid
      });
    });
  } catch(e) { console.log('[Parser error]', e.message); }
  return products;
}

function searchProducts(keyword, niche) {
  return callRapidAPI('item_search_2', { q: keyword, sort: 'salesDesc', page: '1', region: 'FR', locale: 'fr_FR', currency: 'EUR' })
    .then(function(data) { return parseProducts(data, niche); });
}

// ── GOLDWATCH ─────────────────────────────────────────────
var goldwatch = {
  status: 'sleeping', capital_invested: 0, capital_earned: 0, total_returned: 0,
  max_budget: 5000, harvest_threshold: 15000, return_amount: 10000, activation_threshold: 50000
};

function sendAlertEmail(subject, body) {
  return new Promise(function(resolve) {
    console.log('[AlertCEO] 📧 → ' + CEO_EMAIL + ' : ' + subject);
    resolve({ sent: true });
  });
}

// ── SERVEUR ───────────────────────────────────────────────
var server = http.createServer(function(req, res) {

  // Health check Render
  if (req.url === '/' || req.url === '/ping') {
    res.writeHead(200); res.end('OK');
    return;
  }

  // Webhook Stripe
  if (req.url === '/webhook' && req.method === 'POST') {
    var rawBody = '';
    req.on('data', function(chunk) { rawBody += chunk; });
    req.on('end', function() {
      handleStripeWebhook(rawBody, req.headers['stripe-signature'] || '').then(function(result) {
        res.writeHead(result.ok ? 200 : 400);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
      });
    });
    return;
  }

  if (!checkSecurity(req, res)) return;
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  var parsed = url.parse(req.url, true);
  var action = parsed.query.action;

  // ── HEALTH ────────────────────────────────────────────
  if (action === 'health') {
    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'ok', service: 'FOLLOW. Backend v8 — Cache actif',
      webhook: STRIPE_WEBHOOK_SECRET ? '✅ Configuré' : '⚠️ Non configuré',
      cj: cjToken.access ? '✅ Connecté' : '⚠️ Non connecté',
      cache: productsCache.data ? '✅ ' + productsCache.data.winners.length + ' produits en cache' : '⏳ Chargement...',
      timestamp: new Date().toISOString()
    }));
    return;
  }

  // ── GAPHUNTER — retourne le cache instantanément ──────
  if (action === 'gaphunter') {
    getCachedProducts().then(function(data) {
      res.writeHead(200);
      res.end(JSON.stringify(data));
    }).catch(function(e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    });
    return;
  }

  // ── SEARCH ────────────────────────────────────────────
  if (action === 'search') {
    var keyword = parsed.query.keyword || 'patch sommeil';
    searchProducts(keyword, 'general').then(function(products) {
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, products: products, total: products.length }));
    }).catch(function(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
    return;
  }

  // ── STRIPE ────────────────────────────────────────────
  if (action === 'stripe') {
    var sub = parsed.query.sub || 'balance';
    if (sub === 'balance') {
      callStripe('/v1/balance').then(function(data) {
        var available = 0, pending = 0;
        if (data.available) data.available.forEach(function(b) { if (b.currency === 'eur') available = b.amount / 100; });
        if (data.pending) data.pending.forEach(function(b) { if (b.currency === 'eur') pending = b.amount / 100; });
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, available_eur: available, pending_eur: pending, total_eur: available + pending }));
      }).catch(function(e) { res.writeHead(200); res.end(JSON.stringify({ success: false, error: e.message, available_eur: 0, pending_eur: 0, total_eur: 0 })); });
      return;
    }
    if (sub === 'payments') {
      callStripe('/v1/payment_intents?limit=10').then(function(data) {
        var payments = data.data ? data.data.map(function(p) { return { id: p.id, amount: p.amount/100, currency: p.currency, status: p.status, created: new Date(p.created*1000).toLocaleString('fr-FR') }; }) : [];
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, payments: payments, total_revenue: payments.filter(function(p){return p.status==='succeeded';}).reduce(function(s,p){return s+p.amount;},0) }));
      }).catch(function(e) { res.writeHead(200); res.end(JSON.stringify({ success: false, error: e.message, payments: [] })); });
      return;
    }
    res.writeHead(400); res.end(JSON.stringify({ error: 'Stripe sub: balance, payments' }));
    return;
  }

  // ── CJ ────────────────────────────────────────────────
  if (action === 'cj') {
    var cjSub = parsed.query.sub || 'token';
    if (cjSub === 'token') {
      getCJToken().then(function(token) {
        res.writeHead(200); res.end(JSON.stringify({ success: true, token_active: true, token_preview: token.substring(0,20)+'...' }));
      }).catch(function(e) { res.writeHead(200); res.end(JSON.stringify({ success: false, error: e.message })); });
      return;
    }
    if (cjSub === 'order') {
      var orderData = { orderNumber: 'FOLLOW-' + Date.now(), shippingCountry: parsed.query.country || 'FR', products: [{ vid: parsed.query.vid || '', quantity: parseInt(parsed.query.qty || 1) }] };
      callCJ('/api2.0/v1/shopping/order/createOrder', 'POST', orderData).then(function(data) {
        res.writeHead(200); res.end(JSON.stringify({ success: true, order: orderData, cj_response: data }));
      }).catch(function(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
      return;
    }
    res.writeHead(400); res.end(JSON.stringify({ error: 'CJ sub: token, order' }));
    return;
  }

  // ── WORLDWATCH ────────────────────────────────────────
  if (action === 'worldwatch') {
    var events = [
      {domain:'Économie',level:'green',event:'Marchés stables',impact:'Faible'},
      {domain:'Supply Chain',level:'green',event:'Délais AliExpress normaux',impact:'Faible'},
      {domain:'Tech',level:'green',event:'Stripe/Vercel/Render opérationnels',impact:'Faible'},
      {domain:'Géopolitique',level:'green',event:'Pas de conflit majeur',impact:'Faible'},
      {domain:'IA & Monnaies',level:'yellow',event:'BCE prépare Euro numérique',impact:'Moyen'},
      {domain:'E-commerce',level:'green',event:'Tendances dropshipping stables',impact:'Faible'},
    ];
    var critical = events.filter(function(e) { return e.level === 'red'; });
    var warnings = events.filter(function(e) { return e.level === 'yellow'; });
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, agent: 'WorldWatch', global_status: critical.length > 0 ? 'CRITIQUE' : warnings.length > 0 ? 'VIGILANCE' : 'STABLE', events: events, next_scan: '1h' }));
    return;
  }

  // ── TRENDSCANNER ──────────────────────────────────────
  if (action === 'trendscanner') {
    var trends = [
      {platform:'TikTok',product:'Patch Énergie Naturelle',niche:'wellness',views:'2100000',score:94,price:19.99,action:'IMPORT_URGENT'},
      {platform:'TikTok',product:'Bouchons Anti-Bruit Colorés',niche:'hearing',views:'890000',score:88,price:24.99,action:'IMPORT'},
      {platform:'Instagram',product:'Organiseur Bureau LED',niche:'home',views:'450000',score:82,price:34.99,action:'WATCH'},
      {platform:'YouTube',product:'Ring Light 360°',niche:'creator',views:'1200000',score:91,price:39.99,action:'IMPORT'},
    ];
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, agent: 'TrendScanner', trends_detected: trends.length, urgent_imports: 1, trends: trends, next_scan: '15min' }));
    return;
  }

  // ── HARVESTBOT ────────────────────────────────────────
  if (action === 'harvestbot') {
    var opps = [
      {source:'Google Ads Credits',amount:400,currency:'USD',status:'available',category:'marketing'},
      {source:'TikTok Ads Credits',amount:300,currency:'USD',status:'available',category:'marketing'},
      {source:'HubSpot Startup',amount:1200,currency:'USD',status:'available',category:'startup'},
      {source:'CJ Dropshipping Free Warehouse',amount:50,currency:'USD',status:'available',category:'ecommerce'},
      {source:'Vercel Free Tier',amount:20,currency:'USD',status:'active',category:'tech'},
      {source:'Cloudflare Free',amount:20,currency:'USD',status:'active',category:'tech'},
      {source:'Microsoft Ads Credits',amount:75,currency:'USD',status:'available',category:'marketing'},
      {source:'Meta Ads Credits',amount:50,currency:'USD',status:'available',category:'marketing'},
      {source:'Spocket Trial',amount:49,currency:'USD',status:'available',category:'ecommerce'},
      {source:'AWS Free Tier',amount:15,currency:'USD',status:'available',category:'tech'},
    ];
    var totalEur = 0;
    opps.forEach(function(o) { var eur = o.amount * 0.92; totalEur += eur; o.amount_eur = parseFloat(eur.toFixed(2)); });
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, agent: 'HarvestBot', total_opportunities: opps.length, total_eur: parseFloat(totalEur.toFixed(2)), opportunities: opps, next_scan: '24h' }));
    return;
  }

  // ── ALERTCEO ──────────────────────────────────────────
  if (action === 'alertceo') {
    sendAlertEmail(parsed.query.subject || 'Alerte FOLLOW.', parsed.query.body || '').then(function() {
      res.writeHead(200); res.end(JSON.stringify({ success: true, sent_to: CEO_EMAIL, timestamp: new Date().toISOString() }));
    });
    return;
  }

  // ── GOLDWATCH ─────────────────────────────────────────
  if (action === 'goldwatch') {
    var capital = parseFloat(parsed.query.capital || 0);
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, agent: 'GoldWatch', status: capital >= goldwatch.activation_threshold ? 'ACTIF' : 'VEILLE', capital_required: goldwatch.activation_threshold, capital_current: capital, max_budget: goldwatch.max_budget }));
    return;
  }

  // ── CURRENCYBOT ───────────────────────────────────────
  if (action === 'currencybot') {
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, agent: 'CurrencyBot', currencies: [{name:'EUR',status:'active'},{name:'USD',status:'active'},{name:'EURC',status:'active'},{name:'USDC',status:'active'}], next_scan: '6h' }));
    return;
  }

  // ── LEGALGUARD ────────────────────────────────────────
  if (action === 'legalguard') {
    var val = (parsed.query.value || '').toUpperCase();
    var blocked = ['RUB','IRR','KPW'].includes(val);
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, agent: 'LegalGuard', legal: !blocked, blocked: blocked, verdict: blocked ? 'BLOQUÉ' : 'AUTORISÉ', jurisdiction: 'France / La Réunion (DOM)' }));
    return;
  }

  // ── SECURITY ──────────────────────────────────────────
  if (action === 'security') {
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, agent: 'SecurityGuard', status: 'ACTIF', blacklisted_ips: security.blacklist.length, blocked_attempts: security.blockedAttempts }));
    return;
  }

  // ── RETIREBOT ─────────────────────────────────────────
  if (action === 'retirebot') {
    var sales = parseInt(parsed.query.sales || 0);
    var rating = parseFloat(parsed.query.rating || 4.5);
    var shouldRetire = (sales === 0 && parseInt(parsed.query.days||14) >= 14) || rating < 3.5;
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, agent: 'RetireBot', should_retire: shouldRetire, action: shouldRetire ? 'RETIRÉ' : 'GARDER' }));
    return;
  }

  // ── ORDERBOT ──────────────────────────────────────────
  if (action === 'orderbot') {
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, agent: 'OrderBot', fulfillment_supplier: 'CJ Dropshipping', estimated_delivery: '10 jours', timestamp: new Date().toISOString() }));
    return;
  }

  // ── AFFILIATEOS ───────────────────────────────────────
  if (action === 'affiliateos') {
    var cap2 = parseFloat(parsed.query.capital || 0);
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, agent: 'AffiliateOS', status: cap2 >= 1000000 ? 'ACTIF' : 'EN VEILLE', capital_required: 1000000 }));
    return;
  }

  // ── PRICEOPTIMIZER ────────────────────────────────────
  if (action === 'priceoptimizer') {
    var base = parseFloat(parsed.query.price || 20);
    var market = parsed.query.market || 'fr';
    var mult = {fr:1.0,en:1.15,es:1.0,ar:0.95,pt:0.80,sw:0.65}[market]||1.0;
    var opt = parseFloat((base*mult).toFixed(2));
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, base_price: base, market: market, optimized_price: opt, recommendation: opt < 5 ? 'Prix trop bas' : opt > 100 ? 'Prix premium' : 'Prix optimal' }));
    return;
  }

  // ── CONTENTAI ─────────────────────────────────────────
  if (action === 'contentai') {
    var productName = parsed.query.product || 'Produit FOLLOW.';
    var postData = JSON.stringify({
      model: 'claude-sonnet-4-20250514', max_tokens: 1000,
      system: 'Tu es ContentAI SEO pour FOLLOW. Réponds UNIQUEMENT en JSON : {"title":"","meta_description":"","h1":"","description":"","faq":[{"q":"","a":""}],"keywords":[""],"cta":"","iae_answer":""}',
      messages: [{ role: 'user', content: 'Produit: ' + productName + ' | Boutique: followtrend.shop | Langue: ' + (parsed.query.lang||'fr') }]
    });
    var aiReq = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(postData) }
    }, function(aiRes) {
      var aiData = '';
      aiRes.on('data', function(c) { aiData += c; });
      aiRes.on('end', function() {
        try {
          var r = JSON.parse(aiData);
          var text = r.content && r.content[0] ? r.content[0].text : '{}';
          var content = JSON.parse(text.replace(/```json|```/g,'').trim());
          res.writeHead(200); res.end(JSON.stringify({ success: true, product: productName, content: content }));
        } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
      });
    });
    aiReq.on('error', function(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
    aiReq.write(postData); aiReq.end();
    return;
  }

  // 404
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Action inconnue', available: ['health','gaphunter','search','stripe','cj','worldwatch','trendscanner','harvestbot','alertceo','goldwatch','currencybot','legalguard','security','retirebot','orderbot','affiliateos','priceoptimizer','contentai'] }));
});

server.listen(PORT, '0.0.0.0', function() {
  console.log('FOLLOW. Backend v8 actif sur port ' + PORT);
  console.log('[Cache] ⏳ Pré-chargement produits en cours...');
  console.log('[Webhook] ✅ Stripe webhook prêt sur /webhook');
});
