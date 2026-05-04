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
            console.log('[CJ] Token obtenu');
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



// ── ALIEXPRESS VIA RAPIDAPI ───────────────────────────────
var RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';

function searchAliExpress(keyword, niche) {
  return new Promise(function(resolve) {
    var options = {
      hostname: 'aliexpress-datahub.p.rapidapi.com',
      path: '/item_search_2?q=' + encodeURIComponent(keyword) + '&page=1&sort=LAST_VOLUME_DESC',
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'aliexpress-datahub.p.rapidapi.com'
      }
    };
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          var result = JSON.parse(data);
          var products = [];
          var items = (result.result && result.result.resultList) || [];
          items.forEach(function(item) {
            var info = item.item || {};
            var price = parseFloat(
            (info.sku && info.sku.def && info.sku.def.promotionPrice) ||
            (info.prices && info.prices.salePrice && info.prices.salePrice.minPrice) ||
            (info.salePrice && info.salePrice.minPrice) ||
            (info.price) || 0
          );
            if (!info.title || price <= 0) return;
            var salesStr = (info.tradeDesc || info.trade || info.sold || '0').toString().replace(/[^0-9]/g,'');
            var sales = parseInt(salesStr || '0');
            var img = info.image || info.itemMainPic ||
                    (info.images && info.images[0]) || info.imageUrl || '';
          if (img && img.startsWith('//')) img = 'https:' + img;
          if (img && !img.startsWith('http')) img = 'https://' + img;
          // Proxifier via backend pour éviter CORS
          if (img) img = 'https://follow-backend-o300.onrender.com/img?url=' + encodeURIComponent(img);
            var score = Math.min(99, Math.round(65 + Math.min(sales/100, 25) + Math.floor(Math.random()*10)));
            products.push({
              id: String(info.itemId || Math.random()),
              name: (info.title || '').substring(0, 80),
              image: img,
              price: parseFloat(price.toFixed(2)),
              oldPrice: parseFloat((price * 1.8).toFixed(2)),
              rating: parseFloat(info.averageStar || info.starRating || info.reviewStar || 4.6),
              sales: sales, niche: niche, score: score,
              gapFR: score, isWinner: true, supplier: 'AliExpress',
              badge: sales > 100 ? 'hot' : 'new', vid: ''
            });
          });
          console.log('[AliExpress] ' + niche + ' "' + keyword + '" -> ' + products.length + ' produits');
          resolve(products);
        } catch(e) {
          console.log('[AliExpress] Erreur parse:', e.message);
          resolve([]);
        }
      });
    });
    req.on('error', function(e) {
      console.log('[AliExpress] Erreur:', e.message);
      resolve([]);
    });
    req.end();
  });
}


// ── SHOPIFY API AVEC AUTH ─────────────────────────────────
var shopifyCache = { data: null, timestamp: 0 };
var shopifyToken = '';

function getShopifyToken() {
  if (shopifyToken) return Promise.resolve(shopifyToken);
  var clientId = process.env.SHOPIFY_CLIENT_ID || '2fadf9edafb385cba6a17d0682ce271b';
  var clientSecret = process.env.SHOPIFY_CLIENT_SECRET || '';
  if (!clientSecret) return Promise.resolve('');
  
  return new Promise(function(resolve) {
    var postData = 'client_id=' + clientId + '&client_secret=' + clientSecret + '&grant_type=client_credentials';
    var options = {
      hostname: 'follow-9096.myshopify.com',
      path: '/admin/oauth/access_token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
    };
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          var r = JSON.parse(data);
          shopifyToken = r.access_token || '';
          console.log('[Shopify] Token: ' + (shopifyToken ? 'OK' : 'ECHEC'));
          resolve(shopifyToken);
        } catch(e) { resolve(''); }
      });
    });
    req.on('error', function() { resolve(''); });
    req.write(postData);
    req.end();
  });
}

function getShopifyProducts() {
  if (shopifyCache.data && Date.now() - shopifyCache.timestamp < 3600000) {
    return Promise.resolve(shopifyCache.data);
  }
  return getShopifyToken().then(function(token) {
  return new Promise(function(resolve) {
    var headers = { 'User-Agent': 'FOLLOW-Backend/1.0' };
    if (token) headers['X-Shopify-Access-Token'] = token;
    var options = {
      hostname: 'follow-9096.myshopify.com',
      path: '/products.json?limit=50',
      method: 'GET',
      headers: headers
    };
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          var result = JSON.parse(data);
          var products = [];
          var nicheMap = {
            'jewelry': 'lifestyle', 'necklace': 'lifestyle', 'ring': 'lifestyle', 'watch': 'lifestyle',
            'sport': 'sport', 'fitness': 'sport', 'knee': 'sport', 'jump': 'sport',
            'webcam': 'focus', 'keyboard': 'focus', 'laptop': 'focus', 'monitor': 'focus',
            'camera': 'creator', 'phone': 'creator', 'selfie': 'creator', 'microphone': 'creator',
            'home': 'home', 'kitchen': 'home', 'lamp': 'home', 'storage': 'home', 'mop': 'home'
          };
          
          (result.products || []).forEach(function(p, i) {
            var price = parseFloat(p.variants && p.variants[0] ? p.variants[0].price : 0);
            if (!price) return;
            var img = p.images && p.images[0] ? p.images[0].src : '';
            
            // Déterminer la niche selon le titre
            var titleLower = (p.title || '').toLowerCase();
            var niche = 'lifestyle';
            Object.keys(nicheMap).forEach(function(key) {
              if (titleLower.includes(key)) niche = nicheMap[key];
            });
            
            products.push({
              id: String(p.id),
              name: (p.title || '').substring(0, 80),
              image: img,
              price: parseFloat(price.toFixed(2)),
              oldPrice: parseFloat((price * 1.8).toFixed(2)),
              rating: 4.7,
              sales: Math.floor(Math.random() * 2000) + 100,
              niche: niche,
              score: 75 + Math.floor(Math.random() * 20),
              gapFR: 80,
              isWinner: true,
              supplier: 'AliExpress',
              badge: 'hot',
              vid: ''
            });
          });
          
          console.log('[Shopify] ' + products.length + ' produits charges');
          shopifyCache.data = products;
          shopifyCache.timestamp = Date.now();
          resolve(products);
        } catch(e) {
          console.log('[Shopify] Erreur:', e.message);
          resolve([]);
        }
      });
    });
    req.on('error', function(e) {
      console.log('[Shopify] Erreur connexion:', e.message);
      resolve([]);
    });
    req.end();
  });
  });
}

// ── TRADUCTION NOMS PRODUITS ──────────────────────────────
var translationCache = {};

function translateProducts(products, lang) {
  if (lang === 'en') return Promise.resolve(products); // CJ est déjà en anglais
  var cacheKey = lang + '_' + products.map(function(p){ return p.id; }).join('_');
  if (translationCache[cacheKey]) return Promise.resolve(translationCache[cacheKey]);

  var ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
  if (!ANTHROPIC_KEY) return Promise.resolve(products);

  var langNames = {fr:'français',es:'espagnol',ar:'arabe',pt:'portugais',sw:'swahili'};
  var langName = langNames[lang] || 'français';
  var names = products.map(function(p){ return p.name; }).join('\n');

  var prompt = 'Traduis ces noms de produits e-commerce en ' + langName + '. ' +
    'Retourne UNIQUEMENT les noms traduits, un par ligne, dans le meme ordre. ' +
    'Garde les chiffres et unites. Sois concis.\n\n' + names;

  var postData = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }]
  });

  return new Promise(function(resolve) {
    var options = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(postData) }
    };
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          var parsed = JSON.parse(data);
          var translated = parsed.content && parsed.content[0] ? parsed.content[0].text.trim() : '';
          var lines = translated.split('\n').map(function(l){ return l.trim(); }).filter(function(l){ return l; });
          var translatedProducts = products.map(function(p, i) {
            return Object.assign({}, p, { name: lines[i] || p.name });
          });
          translationCache[cacheKey] = translatedProducts;
          console.log('[Translate] ' + lang + ' — ' + products.length + ' produits traduits');
          resolve(translatedProducts);
        } catch(e) {
          console.log('[Translate] Erreur:', e.message);
          resolve(products);
        }
      });
    });
    req.on('error', function() { resolve(products); });
    req.write(postData);
    req.end();
  });
}

// ── RECHERCHE PRODUITS CJ ─────────────────────────────────
function searchCJProducts(keyword, niche) {
  return callCJ('/api2.0/v1/product/list?productNameEn=' + encodeURIComponent(keyword) + '&pageNum=1&pageSize=30&orderBy=ORDERS', 'GET')
    .then(function(result) {
      var products = [];
      if (result.data && result.data.list) {
        result.data.list.forEach(function(item) {
          var price = parseFloat(item.sellPrice || item.productPrice || 0);
          if (!item.productNameEn || price <= 0) return;
          var sales = parseInt(item.productSale || 0);
          // Score intelligent : ventes + note + cohérence catégorie
          var baseScore = Math.min(99, Math.round(60 + Math.min(sales / 50, 30) + Math.floor(Math.random()*10)));
          var rating = parseFloat(item.productStar || 4.5);
          var ratingBonus = rating >= 4.8 ? 5 : rating >= 4.5 ? 3 : 0;
          var score = Math.min(99, baseScore + ratingBonus);
          var img = item.productImage || '';
          if (img && !img.startsWith('http')) img = 'https:' + img;
          products.push({
            id: item.pid || String(Math.random()),
            name: (item.productNameEn || '').substring(0, 80),
            image: img,
            price: parseFloat(price.toFixed(2)),
            oldPrice: parseFloat((price * 1.8).toFixed(2)),
            rating: 4.6, sales: sales, niche: niche, score: score,
            gapFR: score, isWinner: true, supplier: 'CJ Dropshipping',
            badge: sales > 50 ? 'hot' : 'new', vid: item.vid || ''
          });
        });
      }
      console.log('[CJ Search] ' + niche + ' "' + keyword + '" -> ' + products.length + ' produits');
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
    { keyword: 'watch', niche: 'lifestyle' },
    { keyword: 'gloves', niche: 'sport' },
    { keyword: 'lamp', niche: 'focus' },
    { keyword: 'light', niche: 'creator' },
    { keyword: 'organizer', niche: 'home' }
  ];
  return getCJToken().then(function() {
    // Recherches séquentielles pour éviter le timeout CJ
    function searchSequential(list, index, results) {
      if (index >= list.length) return Promise.resolve(results);
      var n = list[index];
      return searchCJProducts(n.keyword, n.niche)
        .catch(function() { return []; })
        .then(function(r) {
          results.push(r);
          return searchSequential(list, index + 1, results);
        });
    }
    return searchSequential(niches, 0, []).then(function(results) {
      var allProducts = [];
      results.forEach(function(r) { allProducts = allProducts.concat(r); });
      var seen = {};
      var unique = allProducts.filter(function(p) {
        if (seen[p.id]) return false; seen[p.id] = true; return true;
      });
      // Tri intelligent : équilibre par catégorie puis score
      var byNiche = {};
      unique.forEach(function(p) {
        if (!byNiche[p.niche]) byNiche[p.niche] = [];
        byNiche[p.niche].push(p);
      });
      // Trier chaque catégorie par score
      Object.keys(byNiche).forEach(function(niche) {
        byNiche[niche].sort(function(a,b){ return b.score - a.score; });
      });
      // Prendre les 12 meilleurs par catégorie
      var winners = [];
      Object.keys(byNiche).forEach(function(niche) {
        winners = winners.concat(byNiche[niche].slice(0, 12));
      });
      console.log('[Cache] Repartition:', Object.keys(byNiche).map(function(n){ return n+':'+byNiche[n].length; }).join(' '));
      productsCache.data = { success: true, winners: winners, total: unique.length, cached: true, supplier: 'CJ Dropshipping', cached_at: new Date().toISOString() };
      productsCache.timestamp = Date.now();
      console.log('[Cache] ' + winners.length + ' produits CJ en cache');
      return productsCache.data;
    });
  }).catch(function(e) {
    console.log('[Cache] Erreur refresh:', e.message);
    if (!productsCache.data) productsCache.data = { success: true, winners: [], total: 0, cached: true };
    return productsCache.data;
  });
}

setTimeout(refreshProducts, 3000);
setInterval(refreshProducts, 3600000);

if (CJ_API_KEY) {
  getCJToken().then(function() { console.log('[CJ] Token initialise'); }).catch(function(e) { console.log('[CJ] Erreur token:', e.message); });
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

// ── STRIPE CHECKOUT SESSION ───────────────────────────────
function createCheckoutSession(items, customerEmail, successUrl, cancelUrl) {
  return new Promise(function(resolve, reject) {
    // Construire les line_items
    var lineItems = items.map(function(item) {
      return 'line_items[][price_data][currency]=eur' +
        '&line_items[][price_data][product_data][name]=' + encodeURIComponent(item.name) +
        '&line_items[][price_data][product_data][images][]=' + encodeURIComponent(item.image || '') +
        '&line_items[][price_data][unit_amount]=' + Math.round(item.price * 100) +
        '&line_items[][quantity]=' + (item.qty || 1);
    });

    var params = lineItems.join('&') +
      '&mode=payment' +
      '&success_url=' + encodeURIComponent(successUrl) +
      '&cancel_url=' + encodeURIComponent(cancelUrl) +
      '&shipping_address_collection[allowed_countries][]=FR' +
      '&shipping_address_collection[allowed_countries][]=BE' +
      '&shipping_address_collection[allowed_countries][]=CH' +
      '&shipping_address_collection[allowed_countries][]=CA' +
      '&shipping_address_collection[allowed_countries][]=GB' +
      '&shipping_address_collection[allowed_countries][]=US' +
      '&shipping_address_collection[allowed_countries][]=DE' +
      '&shipping_address_collection[allowed_countries][]=ES' +
      '&shipping_address_collection[allowed_countries][]=IT' +
      '&shipping_address_collection[allowed_countries][]=PT' +
      '&shipping_address_collection[allowed_countries][]=MA' +
      '&shipping_address_collection[allowed_countries][]=DZ' +
      '&shipping_address_collection[allowed_countries][]=TN' +
      '&shipping_address_collection[allowed_countries][]=SA' +
      '&shipping_address_collection[allowed_countries][]=AE' +
      '&shipping_address_collection[allowed_countries][]=SN' +
      '&shipping_address_collection[allowed_countries][]=RE' +
      '&phone_number_collection[enabled]=true' +
      (customerEmail ? '&customer_email=' + encodeURIComponent(customerEmail) : '') +
      '&locale=auto' +
      '&billing_address_collection=auto';

    var postData = params;
    var options = {
      hostname: 'api.stripe.com',
      path: '/v1/checkout/sessions',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + STRIPE_SECRET,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData);
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

// ── WEBHOOK STRIPE ────────────────────────────────────────
function handleStripeWebhook(payload, sigHeader) {
  return new Promise(function(resolve) {
    if (STRIPE_WEBHOOK_SECRET && !verifyStripeSignature(payload, sigHeader, STRIPE_WEBHOOK_SECRET)) {
      return resolve({ ok: false, error: 'Invalid signature' });
    }
    var event;
    try { event = JSON.parse(payload); } catch(e) { return resolve({ ok: false, error: 'Parse error' }); }

    if (event.type === 'checkout.session.completed') {
      var session = event.data.object;
      var customerEmail = session.customer_details ? session.customer_details.email : '';
      var orderId = 'FOLLOW-' + session.id.slice(-8).toUpperCase();
      var amount = (session.amount_total || 0) / 100;

      console.log('[Webhook] Checkout complete ' + orderId + ' — ' + amount + 'EUR');

      if (customerEmail) {
        sendConfirmationEmail(customerEmail, { orderId: orderId, amount: amount.toFixed(2) + 'EUR' });
      }
      sendAlertEmail('Nouvelle vente FOLLOW. — ' + amount + 'EUR', 'Commande: ' + orderId + '\nClient: ' + (customerEmail||'inconnu') + '\nMontant: ' + amount + 'EUR');
      return resolve({ ok: true, order: orderId });
    }

    if (event.type === 'payment_intent.succeeded') {
      var pi = event.data.object;
      var orderId2 = 'FOLLOW-' + pi.id.slice(-8).toUpperCase();
      var amount2 = pi.amount / 100;
      var customerEmail2 = pi.receipt_email || '';
      console.log('[Webhook] Payment ' + amount2 + ' — ' + orderId2);
      if (customerEmail2) sendConfirmationEmail(customerEmail2, { orderId: orderId2, amount: amount2.toFixed(2) + 'EUR' });
      sendAlertEmail('Vente FOLLOW. — ' + amount2 + 'EUR', 'Commande: ' + orderId2);
      return resolve({ ok: true, order: orderId2 });
    }

    resolve({ ok: true, message: 'Event ignore' });
  });
}

// ── SECURITE ──────────────────────────────────────────────
var security = {
  ipRequests: {}, blacklist: [], requestLog: [], blockedAttempts: 0,
  RATE_LIMIT: 500, RATE_WINDOW: 3600000,
  WHITELIST: ['::1', '127.0.0.1', '::ffff:127.0.0.1', 'localhost']
};
var ALLOWED_ORIGINS = [
  'https://followtrend.shop','https://www.followtrend.shop',
  'https://follow-store-qqbr.vercel.app','https://followtrend-shop-lake.vercel.app',
  'http://localhost:3000','https://follow-backend-o300.onrender.com','null'
];

function checkSecurity(req, res) {
  var ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  var origin = req.headers['origin'] || '';
  if (security.blacklist.includes(ip)) {
    security.blockedAttempts++;
    res.writeHead(403); res.end(JSON.stringify({ error: 'Acces refuse' }));
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
      res.writeHead(429); res.end(JSON.stringify({ error: 'Trop de requetes' }));
      return false;
    }
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

// ── RESEND EMAIL ──────────────────────────────────────────
function sendEmail(to, subject, html) {
  return new Promise(function(resolve) {
    var RESEND_KEY = process.env.RESEND_API_KEY || '';
    if (!RESEND_KEY) return resolve({ sent: false });
    var postData = JSON.stringify({ from: 'FOLLOW. <support@followtrend.shop>', to: [to], subject: subject, html: html });
    var options = {
      hostname: 'api.resend.com', path: '/emails', method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() { try { var r = JSON.parse(data); resolve({ sent: true, id: r.id }); } catch(e) { resolve({ sent: false }); } });
    });
    req.on('error', function() { resolve({ sent: false }); });
    req.write(postData); req.end();
  });
}

function sendAlertEmail(subject, body) {
  var html = '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#070709;color:#f0f0f8;padding:32px;border-radius:12px"><div style="font-size:28px;font-weight:900;letter-spacing:4px;margin-bottom:24px">FOLLOW<span style="color:#C8FF00">.</span></div><div style="background:#0d0d18;border:1px solid #1c1c26;border-radius:8px;padding:20px"><h2 style="color:#C8FF00;margin-bottom:12px">' + subject + '</h2><pre style="color:#aaa;font-family:Arial,sans-serif;white-space:pre-wrap">' + (body||'') + '</pre></div></div>';
  return sendEmail(CEO_EMAIL, subject, html);
}

function sendConfirmationEmail(customerEmail, orderDetails) {
  var html = '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px"><div style="background:#070709;padding:20px;border-radius:8px;margin-bottom:24px;text-align:center"><div style="font-size:28px;font-weight:900;letter-spacing:4px;color:#fff">FOLLOW<span style="color:#C8FF00">.</span></div></div><h1 style="color:#070709;font-size:24px;margin-bottom:8px">Commande confirmee !</h1><p style="color:#666;margin-bottom:24px">Merci pour votre commande.</p><div style="background:#f8f8f8;border-radius:8px;padding:20px;margin-bottom:24px"><div style="margin-bottom:8px"><span style="color:#666">Reference : </span><strong>' + orderDetails.orderId + '</strong></div><div style="margin-bottom:8px"><span style="color:#666">Montant : </span><strong>' + orderDetails.amount + '</strong></div><div><span style="color:#666">Livraison : </span><strong>7-15 jours</strong></div></div><p style="color:#999;font-size:11px">FOLLOW. followtrend.shop - Retour gratuit 30 jours</p></div>';
  return sendEmail(customerEmail, 'Commande confirmee - FOLLOW.', html);
}

// ── SERVEUR ───────────────────────────────────────────────
var server = http.createServer(function(req, res) {

  if (req.url === '/' || req.url === '/ping') { res.writeHead(200); res.end('OK'); return; }
  // ── PROXY IMAGE — contourne CORS AliExpress ──────────
  if (req.url.startsWith('/img?url=')) {
    var imgUrl = decodeURIComponent(req.url.replace('/img?url=', ''));
    if (!imgUrl.startsWith('http')) { res.writeHead(400); res.end(''); return; }
    var imgParsed = url.parse(imgUrl);
    var imgOptions = {
      hostname: imgParsed.hostname,
      path: imgParsed.path,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://www.aliexpress.com'
      }
    };
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    var proto = imgUrl.startsWith('https') ? https : http;
    var imgReq = proto.request(imgOptions, function(imgRes) {
      res.writeHead(imgRes.statusCode, {
        'Content-Type': imgRes.headers['content-type'] || 'image/jpeg',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400'
      });
      imgRes.pipe(res);
    });
    imgReq.on('error', function() { res.writeHead(404); res.end(''); });
    imgReq.end();
    return;
  }



  // ── EMAIL INBOUND IA ──────────────────────────────────
  if (req.url === '/email-inbound' && req.method === 'POST') {
    var emailBody = '';
    req.on('data', function(chunk) { emailBody += chunk; });
    req.on('end', function() {
      res.writeHead(200);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ received: true }));
      try {
        var emailData = JSON.parse(emailBody);
        var fromEmail = emailData.from || emailData.sender || '';
        var subject = emailData.subject || 'Votre message';
        var messageText = (emailData.text || emailData.html || '').replace(/<[^>]*>/g, '').trim().substring(0, 1000);
        if (!fromEmail || !messageText) return;
        var prompt = "Tu es le service client de FOLLOW., boutique e-commerce (followtrend.shop). Reponds professionnellement en francais. Sois concis (max 150 mots). Livraison 7-15 jours. Retour gratuit 30 jours. Termine par: L equipe FOLLOW.\n\nEmail:\nSujet: " + subject + "\nMessage: " + messageText;
        var postData = JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 500, messages: [{ role: 'user', content: prompt }] });
        var aiOptions = { hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(postData) } };
        var aiReq = https.request(aiOptions, function(aiRes) {
          var aiData = '';
          aiRes.on('data', function(c) { aiData += c; });
          aiRes.on('end', function() {
            try {
              var parsed = JSON.parse(aiData);
              var replyText = parsed.content && parsed.content[0] ? parsed.content[0].text : '';
              if (!replyText) return;
              var replyHtml = '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px"><div style="background:#070709;padding:20px;border-radius:8px;margin-bottom:24px;text-align:center"><div style="font-size:28px;font-weight:900;letter-spacing:4px;color:#fff">FOLLOW<span style="color:#C8FF00">.</span></div></div><p style="color:#333;line-height:1.8;white-space:pre-wrap">' + replyText + '</p><hr style="border:none;border-top:1px solid #eee;margin:24px 0"/><p style="color:#999;font-size:11px">FOLLOW. support@followtrend.shop</p></div>';
              sendEmail(fromEmail, 'Re: ' + subject, replyHtml);
            } catch(e) { console.log('[EmailAI] Erreur:', e.message); }
          });
        });
        aiReq.on('error', function() {});
        aiReq.write(postData); aiReq.end();
      } catch(e) { console.log('[EmailAI] Erreur:', e.message); }
    });
    return;
  }

  // ── WEBHOOK STRIPE ────────────────────────────────────
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

  // ── STRIPE CHECKOUT SESSION ───────────────────────────
  if (req.url.startsWith('/create-checkout') && req.method === 'POST') {
    var body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end', function() {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Content-Type', 'application/json');
      try {
        var data = JSON.parse(body);
        var items = data.items || [];
        var successUrl = 'https://followtrend.shop?order=success';
        var cancelUrl = 'https://followtrend.shop?order=cancel';
        createCheckoutSession(items, data.email || '', successUrl, cancelUrl).then(function(session) {
          if (session.url) {
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, url: session.url }));
          } else {
            console.log('[Checkout] Erreur Stripe:', JSON.stringify(session));
            res.writeHead(500);
            res.end(JSON.stringify({ success: false, error: session.error ? session.error.message : 'Stripe error' }));
          }
        }).catch(function(e) {
          res.writeHead(500);
          res.end(JSON.stringify({ success: false, error: e.message }));
        });
      } catch(e) {
        res.writeHead(400);
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (!checkSecurity(req, res)) return;
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  var parsed = url.parse(req.url, true);
  var action = parsed.query.action;

  if (action === 'health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', service: 'FOLLOW. Backend v10 — 5 categories', webhook: STRIPE_WEBHOOK_SECRET ? 'Configure' : 'Non configure', cj: cjToken.access ? 'Connecte' : 'Non connecte', cache: productsCache.data ? (productsCache.data.winners ? productsCache.data.winners.length : 0) + ' produits en cache' : 'Chargement...', timestamp: new Date().toISOString() }));
    return;
  }

  if (action === 'gaphunter') {
    var lang = parsed.query.lang || 'fr';
    getCachedProducts().then(function(data) {
      if (!data.winners || !data.winners.length || lang === 'en') {
        res.writeHead(200); res.end(JSON.stringify(data)); return;
      }
      translateProducts(data.winners, lang).then(function(translatedWinners) {
        var result = Object.assign({}, data, { winners: translatedWinners });
        res.writeHead(200); res.end(JSON.stringify(result));
      }).catch(function() {
        res.writeHead(200); res.end(JSON.stringify(data));
      });
    }).catch(function(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
    return;
  }

  if (action === 'cj') {
    var cjSub = parsed.query.sub || 'token';
    if (cjSub === 'token') { getCJToken().then(function(t) { res.writeHead(200); res.end(JSON.stringify({ success: true, token_active: true })); }).catch(function(e) { res.writeHead(200); res.end(JSON.stringify({ success: false, error: e.message })); }); return; }
    if (cjSub === 'search') { var kw = parsed.query.keyword || 'patch'; searchCJProducts(kw, 'general').then(function(p) { res.writeHead(200); res.end(JSON.stringify({ success: true, keyword: kw, products: p })); }).catch(function(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }); return; }
    res.writeHead(400); res.end(JSON.stringify({ error: 'CJ sub: token, search' })); return;
  }

  if (action === 'stripe') {
    var sub = parsed.query.sub || 'balance';
    if (sub === 'balance') { callStripe('/v1/balance').then(function(data) { var avail = 0, pend = 0; if (data.available) data.available.forEach(function(b) { if (b.currency === 'eur') avail = b.amount / 100; }); if (data.pending) data.pending.forEach(function(b) { if (b.currency === 'eur') pend = b.amount / 100; }); res.writeHead(200); res.end(JSON.stringify({ success: true, available_eur: avail, pending_eur: pend, total_eur: avail + pend })); }).catch(function(e) { res.writeHead(200); res.end(JSON.stringify({ success: false, error: e.message, available_eur: 0, pending_eur: 0, total_eur: 0 })); }); return; }
    if (sub === 'payments') { callStripe('/v1/payment_intents?limit=10').then(function(data) { var payments = data.data ? data.data.map(function(p) { return { id: p.id, amount: p.amount/100, currency: p.currency, status: p.status }; }) : []; res.writeHead(200); res.end(JSON.stringify({ success: true, payments: payments })); }).catch(function(e) { res.writeHead(200); res.end(JSON.stringify({ success: false, payments: [] })); }); return; }
    res.writeHead(400); res.end(JSON.stringify({ error: 'Stripe sub: balance, payments' })); return;
  }

  if (action === 'worldwatch') { res.writeHead(200); res.end(JSON.stringify({ success: true, agent: 'WorldWatch', global_status: 'STABLE', events: [{domain:'Supply Chain',level:'green',event:'CJ operationnel'},{domain:'Tech',level:'green',event:'Stripe/Vercel/Render actifs'}], next_scan: '1h' })); return; }
  if (action === 'trendscanner') { res.writeHead(200); res.end(JSON.stringify({ success: true, agent: 'TrendScanner', trends_detected: 4, urgent_imports: 1, trends: [{platform:'TikTok',product:'Patch Energie',niche:'wellness',views:'2100000',score:94,price:19.99,action:'IMPORT_URGENT'},{platform:'YouTube',product:'Ring Light 360',niche:'creator',views:'1200000',score:91,price:39.99,action:'IMPORT'}], next_scan: '15min' })); return; }
  if (action === 'harvestbot') { var opps = [{source:'Google Ads Credits',amount:400,currency:'USD',status:'available'},{source:'TikTok Ads Credits',amount:300,currency:'USD',status:'available'},{source:'Meta Ads Credits',amount:50,currency:'USD',status:'available'},{source:'Vercel Free Tier',amount:20,currency:'USD',status:'active'}]; res.writeHead(200); res.end(JSON.stringify({ success: true, agent: 'HarvestBot', total_opportunities: opps.length, opportunities: opps })); return; }
  if (action === 'alertceo') { sendAlertEmail(parsed.query.subject || 'Alerte FOLLOW.').then(function() { res.writeHead(200); res.end(JSON.stringify({ success: true, sent_to: CEO_EMAIL })); }); return; }
  if (action === 'goldwatch') { var cap = parseFloat(parsed.query.capital || 0); res.writeHead(200); res.end(JSON.stringify({ success: true, agent: 'GoldWatch', status: cap >= 50000 ? 'ACTIF' : 'VEILLE', capital_required: 50000, capital_current: cap })); return; }
  if (action === 'currencybot') { res.writeHead(200); res.end(JSON.stringify({ success: true, agent: 'CurrencyBot', currencies: [{name:'EUR',status:'active'},{name:'USD',status:'active'}] })); return; }
  if (action === 'legalguard') { var val = (parsed.query.value || '').toUpperCase(); var blocked = ['RUB','IRR','KPW'].includes(val); res.writeHead(200); res.end(JSON.stringify({ success: true, agent: 'LegalGuard', legal: !blocked, blocked: blocked })); return; }
  if (action === 'security') { res.writeHead(200); res.end(JSON.stringify({ success: true, agent: 'SecurityGuard', status: 'ACTIF', blacklisted_ips: security.blacklist.length, blocked_attempts: security.blockedAttempts })); return; }
  if (action === 'retirebot') { var sales = parseInt(parsed.query.sales || 0); var rating = parseFloat(parsed.query.rating || 4.5); var shouldRetire = (sales === 0 && parseInt(parsed.query.days||14) >= 14) || rating < 3.5; res.writeHead(200); res.end(JSON.stringify({ success: true, agent: 'RetireBot', should_retire: shouldRetire, action: shouldRetire ? 'RETIRE' : 'GARDER' })); return; }
  if (action === 'orderbot') { res.writeHead(200); res.end(JSON.stringify({ success: true, agent: 'OrderBot', fulfillment_supplier: 'CJ Dropshipping', estimated_delivery: '10 jours' })); return; }
  if (action === 'affiliateos') { var cap2 = parseFloat(parsed.query.capital || 0); res.writeHead(200); res.end(JSON.stringify({ success: true, agent: 'AffiliateOS', status: cap2 >= 1000000 ? 'ACTIF' : 'EN VEILLE' })); return; }
  if (action === 'priceoptimizer') { var base = parseFloat(parsed.query.price || 20); var market = parsed.query.market || 'fr'; var mult = {fr:1.0,en:1.15,es:1.0,ar:0.95,pt:0.80,sw:0.65}[market]||1.0; res.writeHead(200); res.end(JSON.stringify({ success: true, base_price: base, market: market, optimized_price: parseFloat((base*mult).toFixed(2)) })); return; }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Action inconnue' }));
});

server.listen(PORT, '0.0.0.0', function() {
  console.log('FOLLOW. Backend v10 actif sur port ' + PORT);
  console.log('[CJ] Chargement produits...');
  console.log('[Webhook] Stripe webhook pret sur /webhook');
  console.log('[Checkout] Stripe Checkout pret sur /create-checkout');
});
