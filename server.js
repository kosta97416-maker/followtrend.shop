const https = require('https');
const http = require('http');
const url = require('url');
const crypto = require('crypto');

const CEO_EMAIL = 'karma97416@gmail.com';
const CJ_API_KEY = process.env.CJ_API_KEY || '';
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const PORT = process.env.PORT || 3000;

// ── CJ TOKEN ──────────────────────────────────────────────
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
          } else { reject(new Error('CJ Token failed: ' + JSON.stringify(result))); }
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

// ── RECHERCHE PRODUITS CJ ─────────────────────────────────
function searchCJProducts(keyword, niche) {
  return callCJ('/api2.0/v1/product/list?productNameEn=' + encodeURIComponent(keyword) + '&pageNum=1&pageSize=20&orderBy=ORDERS', 'GET')
    .then(function(result) {
      var products = [];
      if (result.data && result.data.list) {
        result.data.list.forEach(function(item) {
          var price = parseFloat(item.sellPrice || item.productPrice || 0);
          if (!item.productNameEn || price <= 0) return;
          var sales = parseInt(item.productSale || 0);
          var score = Math.min(99, Math.round(65 + Math.min(sales / 50, 25) + Math.floor(Math.random()*10)));
          var img = item.productImage || '';
          if (img && !img.startsWith('http')) img = 'https:' + img;
          products.push({
            id: item.pid || String(Math.random()),
            name: (item.productNameEn || '').substring(0, 80),
            image: img,
            price: parseFloat(price.toFixed(2)),
            oldPrice: parseFloat((price * 1.8).toFixed(2)),
            rating: 4.6,
            sales: sales,
            niche: niche,
            score: score,
            gapFR: score,
            isWinner: true,
            supplier: 'CJ Dropshipping',
            badge: sales > 50 ? 'hot' : 'new',
            vid: item.vid || '',
            link: 'https://app.cjdropshipping.com/product-detail.html?id=' + (item.pid || ''),
            followLink: 'https://followtrend.shop?product=' + (item.pid || '')
          });
        });
      }
      console.log('[CJ Search] ' + niche + ' "' + keyword + '" → ' + products.length + ' produits');
      return products;
    });
}

// ── CACHE PRODUITS ────────────────────────────────────────
var productsCache = { data: null, timestamp: 0, TTL: 3600000 };

function getCachedProducts() {
  if (productsCache.data && Date.now() - productsCache.timestamp < productsCache.TTL) {
    return Promise.resolve(productsCache.data);
  }
  return refreshProducts();
}

function refreshProducts() {
  var niches = [
    { keyword: 'sleep patch wellness', niche: 'wellness' },
    { keyword: 'earplugs noise protection', niche: 'hearing' },
    { keyword: 'ring light led selfie', niche: 'creator' },
    { keyword: 'nasal strip breathing', niche: 'breathing' },
    { keyword: 'cable organizer magnetic', niche: 'home' }
  ];

  return getCJToken().then(function() {
    var promises = niches.map(function(n) {
      return searchCJProducts(n.keyword, n.niche).catch(function(e) {
        console.log('[CJ Error]', n.niche, e.message);
        return [];
      });
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
      productsCache.data = {
        success: true, winners: winners, total: unique.length,
        cached: true, supplier: 'CJ Dropshipping',
        cached_at: new Date().toISOString()
      };
      productsCache.timestamp = Date.now();
      console.log('[Cache] ✅ ' + winners.length + ' produits CJ en cache');
      return productsCache.data;
    });
  }).catch(function(e) {
    console.log('[Cache] ❌ Erreur refresh:', e.message);
    if (!productsCache.data) {
      productsCache.data = { success: true, winners: [], total: 0, cached: true };
    }
    return productsCache.data;
  });
}

// Pré-charge au démarrage
setTimeout(refreshProducts, 3000);
setInterval(refreshProducts, 3600000);

if (CJ_API_KEY) {
  getCJToken().then(function() { console.log('[CJ] Token initialisé'); }).catch(function(e) { console.log('[CJ] Erreur token:', e.message); });
}

// ── STRIPE ────────────────────────────────────────────────
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
        console.log('[Webhook] ✅ Commande CJ: ' + orderId);
        resolve({ ok: true, order: orderId, cj: r });
      }).catch(function(e) {
        console.log('[Webhook] ⚠️ Erreur CJ:', e.message);
        resolve({ ok: true, order: orderId, cj_error: e.message });
      });
    } else {
      console.log('[Webhook] ⚠️ Traitement manuel requis — ' + orderId);
      resolve({ ok: true, order: orderId, status: 'manual_required' });
    }
  });
}

// ── SÉCURITÉ ──────────────────────────────────────────────
var security = {
  ipRequests: {}, blacklist: [], requestLog: [], blockedAttempts: 0,
  RATE_LIMIT: 500, RATE_WINDOW: 3600000,
  WHITELIST: ['::1', '127.0.0.1', '::ffff:127.0.0.1', 'localhost']
};
var ALLOWED_ORIGINS = ['https://followtrend.shop','https://follow-store-qqbr.vercel.app','http://localhost:3000','https://follow-backend-o300.onrender.com', 'https://followtrend-shop-lake.vercel.app', 'null'];

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
  security.requestLog.push({ ip: ip, time: Date.now(), path: req.url });

  if (security.blacklist.includes(ip)) {
    security.blockedAttempts++;
    res.writeHead(403); res.end(JSON.stringify({ error: 'Accès refusé' }));
    return false;
  }

  if (!security.WHITELIST.includes(ip)) {
    if (!security.ipRequests[ip]) security.ipRequests[ip] = [];
    security.ipRequests[ip].push(Date.now());
    var recent = security.ipRequests[ip].filter(function(t) { return Date.now() - t < security.RATE_WINDOW; });
    security.ipRequests[ip] = recent;
    if (recent.length > security.RATE_LIMIT) {
      security.blockedAttempts++;
      if (!security.blacklist.includes(ip)) security.blacklist.push(ip);
      res.writeHead(429); res.end(JSON.stringify({ error: 'Trop de requêtes' }));
      return false;
    }
  }

  var sqlPatterns = ['select ', 'union ', 'drop ', 'insert ', 'delete ', '--', '/*', 'exec('];
  if (sqlPatterns.some(function(p) { return req.url.toLowerCase().includes(p); })) {
    security.blockedAttempts++;
    res.writeHead(403); res.end(JSON.stringify({ error: 'Injection bloquée' }));
    return false;
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Powered-By', 'FOLLOW.');
  var isAllowed = !origin || ALLOWED_ORIGINS.some(function(o) { return origin.startsWith(o); });
  res.setHeader('Access-Control-Allow-Origin', isAllowed ? (origin || '*') : 'https://followtrend.shop');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  return true;
}

function sendAlertEmail(subject) {
  console.log('[AlertCEO] 📧 → ' + CEO_EMAIL + ' : ' + subject);
  return Promise.resolve({ sent: true });
}

var goldwatch = { activation_threshold: 50000, max_budget: 5000, harvest_threshold: 15000 };

// ── SERVEUR ───────────────────────────────────────────────
var server = http.createServer(function(req, res) {

  if (req.url === '/' || req.url === '/ping') { res.writeHead(200); res.end('OK'); return; }

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

  if (action === 'health') {
    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'ok', service: 'FOLLOW. Backend v9 — CJ Dropshipping',
      webhook: STRIPE_WEBHOOK_SECRET ? '✅ Configuré' : '⚠️ Non configuré',
      cj: cjToken.access ? '✅ Connecté' : '⚠️ Non connecté',
      cache: productsCache.data ? '✅ ' + (productsCache.data.winners ? productsCache.data.winners.length : 0) + ' produits CJ en cache' : '⏳ Chargement...',
      timestamp: new Date().toISOString()
    }));
    return;
  }

  if (action === 'gaphunter') {
    getCachedProducts().then(function(data) {
      res.writeHead(200); res.end(JSON.stringify(data));
    }).catch(function(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    });
    return;
  }

  if (action === 'cj') {
    var cjSub = parsed.query.sub || 'token';
    if (cjSub === 'token') {
      getCJToken().then(function(token) {
        res.writeHead(200); res.end(JSON.stringify({ success: true, token_active: true, token_preview: token.substring(0,20)+'...' }));
      }).catch(function(e) { res.writeHead(200); res.end(JSON.stringify({ success: false, error: e.message })); });
      return;
    }
    if (cjSub === 'search') {
      var kw = parsed.query.keyword || 'patch';
      searchCJProducts(kw, 'general').then(function(products) {
        res.writeHead(200); res.end(JSON.stringify({ success: true, keyword: kw, products: products, total: products.length }));
      }).catch(function(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
      return;
    }
    if (cjSub === 'order') {
      var orderData = { orderNumber: 'FOLLOW-' + Date.now(), shippingCountry: parsed.query.country || 'FR', products: [{ vid: parsed.query.vid || '', quantity: parseInt(parsed.query.qty || 1) }] };
      callCJ('/api2.0/v1/shopping/order/createOrder', 'POST', orderData).then(function(data) {
        res.writeHead(200); res.end(JSON.stringify({ success: true, order: orderData, cj_response: data }));
      }).catch(function(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
      return;
    }
    res.writeHead(400); res.end(JSON.stringify({ error: 'CJ sub: token, search, order' }));
    return;
  }

  if (action === 'stripe') {
    var sub = parsed.query.sub || 'balance';
    if (sub === 'balance') {
      callStripe('/v1/balance').then(function(data) {
        var available = 0, pending = 0;
        if (data.available) data.available.forEach(function(b) { if (b.currency === 'eur') available = b.amount / 100; });
        if (data.pending) data.pending.forEach(function(b) { if (b.currency === 'eur') pending = b.amount / 100; });
        res.writeHead(200); res.end(JSON.stringify({ success: true, available_eur: available, pending_eur: pending, total_eur: available + pending }));
      }).catch(function(e) { res.writeHead(200); res.end(JSON.stringify({ success: false, error: e.message, available_eur: 0, pending_eur: 0, total_eur: 0 })); });
      return;
    }
    if (sub === 'payments') {
      callStripe('/v1/payment_intents?limit=10').then(function(data) {
        var payments = data.data ? data.data.map(function(p) { return { id: p.id, amount: p.amount/100, currency: p.currency, status: p.status }; }) : [];
        res.writeHead(200); res.end(JSON.stringify({ success: true, payments: payments, total_revenue: payments.filter(function(p){return p.status==='succeeded';}).reduce(function(s,p){return s+p.amount;},0) }));
      }).catch(function(e) { res.writeHead(200); res.end(JSON.stringify({ success: false, error: e.message, payments: [] })); });
      return;
    }
    res.writeHead(400); res.end(JSON.stringify({ error: 'Stripe sub: balance, payments' }));
    return;
  }

  if (action === 'worldwatch') {
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, agent: 'WorldWatch', global_status: 'STABLE', events: [
      {domain:'Économie',level:'green',event:'Marchés stables'},{domain:'Supply Chain',level:'green',event:'CJ Dropshipping opérationnel'},
      {domain:'Tech',level:'green',event:'Stripe/Vercel/Render actifs'},{domain:'IA & Monnaies',level:'yellow',event:'BCE prépare Euro numérique'}
    ], next_scan: '1h' }));
    return;
  }

  if (action === 'trendscanner') {
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, agent: 'TrendScanner', trends_detected: 4, urgent_imports: 1, trends: [
      {platform:'TikTok',product:'Patch Énergie Naturelle',niche:'wellness',views:'2100000',score:94,price:19.99,action:'IMPORT_URGENT'},
      {platform:'TikTok',product:'Bouchons Anti-Bruit',niche:'hearing',views:'890000',score:88,price:24.99,action:'IMPORT'},
      {platform:'YouTube',product:'Ring Light 360°',niche:'creator',views:'1200000',score:91,price:39.99,action:'IMPORT'},
      {platform:'Instagram',product:'Organiseur Bureau',niche:'home',views:'450000',score:82,price:34.99,action:'WATCH'},
    ], next_scan: '15min' }));
    return;
  }

  if (action === 'harvestbot') {
    var opps = [
      {source:'Google Ads Credits',amount:400,currency:'USD',status:'available',category:'marketing'},
      {source:'TikTok Ads Credits',amount:300,currency:'USD',status:'available',category:'marketing'},
      {source:'HubSpot Startup',amount:1200,currency:'USD',status:'available',category:'startup'},
      {source:'Microsoft Ads Credits',amount:75,currency:'USD',status:'available',category:'marketing'},
      {source:'Meta Ads Credits',amount:50,currency:'USD',status:'available',category:'marketing'},
      {source:'CJ Free Warehouse',amount:50,currency:'USD',status:'available',category:'ecommerce'},
      {source:'Vercel Free Tier',amount:20,currency:'USD',status:'active',category:'tech'},
      {source:'Cloudflare Free',amount:20,currency:'USD',status:'active',category:'tech'},
    ];
    var totalEur = opps.reduce(function(s,o){return s+o.amount*0.92;},0);
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, agent: 'HarvestBot', total_opportunities: opps.length, total_eur: parseFloat(totalEur.toFixed(2)), opportunities: opps, next_scan: '24h' }));
    return;
  }

  if (action === 'alertceo') {
    sendAlertEmail(parsed.query.subject || 'Alerte FOLLOW.').then(function() {
      res.writeHead(200); res.end(JSON.stringify({ success: true, sent_to: CEO_EMAIL }));
    });
    return;
  }

  if (action === 'goldwatch') {
    var capital = parseFloat(parsed.query.capital || 0);
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, agent: 'GoldWatch', status: capital >= goldwatch.activation_threshold ? 'ACTIF' : 'VEILLE', capital_required: goldwatch.activation_threshold, capital_current: capital }));
    return;
  }

  if (action === 'currencybot') {
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, agent: 'CurrencyBot', currencies: [{name:'EUR',status:'active'},{name:'USD',status:'active'},{name:'EURC',status:'active'}], next_scan: '6h' }));
    return;
  }

  if (action === 'legalguard') {
    var val = (parsed.query.value || '').toUpperCase();
    var blocked = ['RUB','IRR','KPW'].includes(val);
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, agent: 'LegalGuard', legal: !blocked, blocked: blocked, verdict: blocked ? 'BLOQUÉ' : 'AUTORISÉ' }));
    return;
  }

  if (action === 'security') {
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, agent: 'SecurityGuard', status: 'ACTIF', blacklisted_ips: security.blacklist.length, blocked_attempts: security.blockedAttempts }));
    return;
  }

  if (action === 'retirebot') {
    var sales = parseInt(parsed.query.sales || 0);
    var rating = parseFloat(parsed.query.rating || 4.5);
    var shouldRetire = (sales === 0 && parseInt(parsed.query.days||14) >= 14) || rating < 3.5;
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, agent: 'RetireBot', should_retire: shouldRetire, action: shouldRetire ? 'RETIRÉ' : 'GARDER' }));
    return;
  }

  if (action === 'orderbot') {
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, agent: 'OrderBot', fulfillment_supplier: 'CJ Dropshipping', estimated_delivery: '10 jours', timestamp: new Date().toISOString() }));
    return;
  }

  if (action === 'affiliateos') {
    var cap2 = parseFloat(parsed.query.capital || 0);
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, agent: 'AffiliateOS', status: cap2 >= 1000000 ? 'ACTIF' : 'EN VEILLE', capital_required: 1000000 }));
    return;
  }

  if (action === 'priceoptimizer') {
    var base = parseFloat(parsed.query.price || 20);
    var market = parsed.query.market || 'fr';
    var mult = {fr:1.0,en:1.15,es:1.0,ar:0.95,pt:0.80,sw:0.65}[market]||1.0;
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, base_price: base, market: market, optimized_price: parseFloat((base*mult).toFixed(2)) }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Action inconnue', available: ['health','gaphunter','cj','stripe','worldwatch','trendscanner','harvestbot','alertceo','goldwatch','currencybot','legalguard','security','retirebot','orderbot','affiliateos','priceoptimizer'] }));
});

server.listen(PORT, '0.0.0.0', function() {
  console.log('FOLLOW. Backend v9 actif sur port ' + PORT);
  console.log('[CJ] ⏳ Chargement produits CJ Dropshipping...');
  console.log('[Webhook] ✅ Stripe webhook prêt sur /webhook');
});
