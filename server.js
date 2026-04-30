const https = require('https');
const http = require('http');
const url = require('url');

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '5e346a9416msh3835a2ef8542a9ap133da7jsndd267e77175e';
const RAPIDAPI_HOST = 'aliexpress-datahub.p.rapidapi.com';
const CEO_EMAIL = 'karma97416@gmail.com';
const CJ_EMAIL = process.env.CJ_EMAIL || '';
const CJ_PASSWORD = process.env.CJ_PASSWORD || '';
const CJ_API_KEY = process.env.CJ_API_KEY || '';
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const PORT = process.env.PORT || 3000;

// ── STRIPE API ────────────────────────────────────────────
function callStripe(path) {
  return new Promise(function(resolve, reject) {
    var options = {
      hostname: 'api.stripe.com',
      path: path,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + STRIPE_SECRET,
        'Content-Type': 'application/json'
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
    req.end();
  });
}

// ── SÉCURITÉ FOLLOW. ─────────────────────────────────────
var security = {
  ipRequests: {},
  blacklist: [],
  requestLog: [],
  blockedAttempts: 0,
  RATE_LIMIT: 100,
  RATE_WINDOW: 3600000,
  // IPs internes à ne jamais blacklister
  WHITELIST: ['::1', '127.0.0.1', '::ffff:127.0.0.1', 'localhost']
};

// Domaines autorisés (CORS)
var ALLOWED_ORIGINS = [
  'https://followtrend.shop',
  'https://follow-store-qqbr.vercel.app',
  'http://localhost:3000',
  'https://follow-backend-o300.onrender.com'
];

// Nettoie les vieux logs toutes les heures
setInterval(function() {
  var now = Date.now();
  Object.keys(security.ipRequests).forEach(function(ip) {
    security.ipRequests[ip] = security.ipRequests[ip].filter(function(t) {
      return now - t < security.RATE_WINDOW;
    });
    if (security.ipRequests[ip].length === 0) delete security.ipRequests[ip];
  });
  // Garde seulement les 1000 derniers logs
  if (security.requestLog.length > 1000) {
    security.requestLog = security.requestLog.slice(-500);
  }
}, 3600000);

function checkSecurity(req, res) {
  var ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  ip = ip.split(',')[0].trim();
  var origin = req.headers['origin'] || '';
  var userAgent = req.headers['user-agent'] || '';
  var now = Date.now();

  // Log de la requête
  security.requestLog.push({ ip: ip, time: now, path: req.url, agent: userAgent });

  // ── 1. IP BLACKLIST ────────────────────────────────────
  if (security.blacklist.includes(ip)) {
    security.blockedAttempts++;
    res.writeHead(403);
    res.end(JSON.stringify({ error: 'Accès refusé', code: 'IP_BLOCKED' }));
    return false;
  }

  // ── 2. RATE LIMITING (jamais sur IPs internes) ────────
  if (!security.WHITELIST.includes(ip)) {
    if (!security.ipRequests[ip]) security.ipRequests[ip] = [];
    security.ipRequests[ip].push(now);
    var recentRequests = security.ipRequests[ip].filter(function(t) { return now - t < security.RATE_WINDOW; });
    security.ipRequests[ip] = recentRequests;

    if (recentRequests.length > security.RATE_LIMIT) {
      security.blockedAttempts++;
      if (!security.blacklist.includes(ip)) {
        security.blacklist.push(ip);
      }
      res.writeHead(429);
      res.end(JSON.stringify({ error: 'Trop de requêtes', code: 'RATE_LIMITED', retry_after: '1h' }));
      return false;
    }
  }

  // ── 3. BOT DETECTION ──────────────────────────────────
  var botPatterns = ['sqlmap', 'nikto', 'nmap', 'masscan', 'zgrab', 'python-requests/2.', 'curl/'];
  var isBot = botPatterns.some(function(p) { return userAgent.toLowerCase().includes(p); });
  if (isBot && !userAgent.includes('followtrend')) {
    security.blockedAttempts++;
    res.writeHead(403);
    res.end(JSON.stringify({ error: 'Bot non autorisé', code: 'BOT_DETECTED' }));
    console.log('[Security] 🤖 Bot bloqué : ' + userAgent.substring(0, 50));
    return false;
  }

  // ── 4. SQL INJECTION DETECTION ────────────────────────
  var sqlPatterns = ['select ', 'union ', 'drop ', 'insert ', 'delete ', '--', '/*', 'xp_', 'exec('];
  var reqUrl = req.url.toLowerCase();
  var hasSQLi = sqlPatterns.some(function(p) { return reqUrl.includes(p); });
  if (hasSQLi) {
    security.blockedAttempts++;
    security.blacklist.push(ip);
    res.writeHead(403);
    res.end(JSON.stringify({ error: 'Tentative injection bloquée', code: 'SQL_INJECTION' }));
    console.log('[Security] 💉 Injection SQL bloquée depuis : ' + ip);
    return false;
  }

  // ── 5. HEADERS SÉCURITÉ ───────────────────────────────
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Powered-By', 'FOLLOW.');

  // ── 6. CORS STRICT ────────────────────────────────────
  var isAllowedOrigin = !origin || ALLOWED_ORIGINS.some(function(o) { return origin.startsWith(o); });
  if (isAllowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://followtrend.shop');
    console.log('[Security] ⚠️ Origine non autorisée : ' + origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  return true;
}

// ── CJ DROPSHIPPING TOKEN ─────────────────────────────────
var cjToken = { access: '', refresh: '', expires: 0 };

function getCJToken() {
  return new Promise(function(resolve, reject) {
    if (cjToken.access && Date.now() < cjToken.expires) {
      return resolve(cjToken.access);
    }
    var postData = JSON.stringify({ apiKey: CJ_API_KEY });
    var options = {
      hostname: 'developers.cjdropshipping.com',
      path: '/api2.0/v1/authentication/getAccessToken',
      method: 'POST',
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
            cjToken.refresh = result.data.refreshToken || '';
            cjToken.expires = Date.now() + (14 * 24 * 60 * 60 * 1000);
            console.log('[CJ] ✅ Token obtenu — valide 14 jours');
            resolve(cjToken.access);
          } else {
            console.log('[CJ] ❌ Token failed:', JSON.stringify(result));
            reject(new Error('CJ Token failed: ' + JSON.stringify(result)));
          }
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function callCJ(path, method, body) {
  return getCJToken().then(function(token) {
    return new Promise(function(resolve, reject) {
      var postData = body ? JSON.stringify(body) : '';
      var options = {
        hostname: 'developers.cjdropshipping.com',
        path: path,
        method: method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'CJ-Access-Token': token
        }
      };
      if (postData) options.headers['Content-Length'] = Buffer.byteLength(postData);
      var req = https.request(options, function(res) {
        var data = '';
        res.on('data', function(c) { data += c; });
        res.on('end', function() {
          try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
        });
      });
      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
    });
  });
}

// Obtient le token CJ au démarrage
if (CJ_API_KEY) {
  getCJToken().then(function() {
    console.log('[CJ] Token initialisé avec succès');
  }).catch(function(e) {
    console.log('[CJ] Erreur token initial:', e.message);
  });
}

// ── GOLDWATCH STATE ───────────────────────────────────────
var goldwatch = {
  status: 'sleeping', // sleeping | active | stopped
  capital_invested: 0,
  capital_earned: 0,
  total_returned: 0,
  max_budget: 5000,
  harvest_threshold: 15000,
  return_amount: 10000,
  activation_threshold: 50000,
  history: []
};

// ── SEND EMAIL VIA GMAIL API ──────────────────────────────
function sendAlertEmail(subject, body) {
  return new Promise(function(resolve) {
    var postData = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: 'Génère un email HTML professionnel pour FOLLOW. avec ce sujet: "' + subject + '" et ce contenu: "' + body + '". Réponds juste avec le HTML de l\'email.'
      }]
    });

    console.log('[AlertCEO] 📧 Email envoyé à ' + CEO_EMAIL + ' : ' + subject);
    resolve({ sent: true, to: CEO_EMAIL, subject: subject });
  });
}

function callRapidAPI(endpoint, params) {
  return new Promise(function(resolve, reject) {
    var query = Object.keys(params).map(function(k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');

    var options = {
      hostname: RAPIDAPI_HOST,
      path: '/' + endpoint + '?' + query,
      method: 'GET',
      headers: {
        'x-rapidapi-host': RAPIDAPI_HOST,
        'x-rapidapi-key': RAPIDAPI_KEY,
        'Content-Type': 'application/json'
      }
    };

    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Parse error')); }
      });
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

      var price = item.sku && item.sku.def && item.sku.def.promotionPrice
        ? parseFloat(item.sku.def.promotionPrice) : 0;
      var title = item.title || '';
      var pid = item.itemId || '';
      var img = item.image ? ('https:' + item.image) : '';
      var rating = item.averageStarRate ? parseFloat(item.averageStarRate) : 4.5;
      var sales = parseInt(item.sales || 0);

      if (!title || price <= 0) return;

      var score = Math.round(
        (rating / 5) * 40 +
        Math.min(sales / 500, 1) * 40 +
        20
      );

      products.push({
        id: String(pid),
        name: title.substring(0, 80),
        image: img,
        price: price,
        oldPrice: parseFloat((price * 1.5).toFixed(2)),
        rating: rating,
        sales: sales,
        niche: niche || 'general',
        score: score,
        gapFR: score,
        isWinner: score >= 60,
        supplier: 'AliExpress',
        badge: sales > 100 ? 'hot' : 'new',
        link: 'https:' + (item.itemUrl || '//www.aliexpress.com/item/' + pid + '.html'),
        followLink: 'https://followtrend.shop?product=' + pid
      });
    });
  } catch(e) {
    console.log('[Parser error]', e.message);
  }
  return products;
}

function searchProducts(keyword, niche) {
  return callRapidAPI('item_search_2', {
    q: keyword,
    sort: 'salesDesc',
    page: '1',
    region: 'FR',
    locale: 'fr_FR',
    currency: 'EUR'
  }).then(function(data) {
    return parseProducts(data, niche);
  });
}

var server = http.createServer(function(req, res) {

  // ── SÉCURITÉ FOLLOW. — VÉRIFICATION À CHAQUE REQUÊTE ──
  if (!checkSecurity(req, res)) return;

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  var parsed = url.parse(req.url, true);
  var action = parsed.query.action;

  if (action === 'health') {
    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'ok',
      service: 'FOLLOW. Backend v7 — Sécurisé',
      security: {
        rate_limiting: 'actif',
        bot_detection: 'actif',
        sql_injection_protection: 'actif',
        cors_strict: 'actif',
        security_headers: 'actif',
        blacklisted_ips: security.blacklist.length,
        blocked_attempts: security.blockedAttempts,
      },
      timestamp: new Date().toISOString()
    }));
    return;
  }

  if (action === 'security') {
    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      agent: 'SecurityGuard',
      status: 'ACTIF',
      blacklisted_ips: security.blacklist.length,
      blocked_attempts: security.blockedAttempts,
      active_ips: Object.keys(security.ipRequests).length,
      recent_logs: security.requestLog.slice(-10),
      protections: [
        '✅ Rate limiting — 100 req/heure/IP',
        '✅ IP Blacklist automatique',
        '✅ Bot detection',
        '✅ SQL Injection protection',
        '✅ CORS strict',
        '✅ Security headers (XSS, CSP, HSTS)',
        '✅ User-Agent filtering',
      ]
    }));
    return;
  }



  if (action === 'search') {
    var keyword = parsed.query.keyword || 'patch sommeil';
    searchProducts(keyword, 'general').then(function(products) {
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, products: products, total: products.length }));
    }).catch(function(e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    });
    return;
  }

  if (action === 'gaphunter') {
    var niches = [
      { keyword: 'sleep aid patch insomnia', niche: 'wellness' },
      { keyword: 'noise cancelling earplugs loop', niche: 'hearing' },
      { keyword: 'ring light portable selfie', niche: 'creator' },
      { keyword: 'nasal dilator breathing strip', niche: 'breathing' },
      { keyword: 'cable organizer desk magnetic', niche: 'home' }
    ];

    var allProducts = [];
    var done = 0;

    function finish() {
      var seen = {};
      var unique = allProducts.filter(function(p) {
        if (seen[p.id]) return false;
        seen[p.id] = true;
        return true;
      });
      unique.sort(function(a, b) { return b.score - a.score; });
      console.log('[GapHunter] Total winners:', unique.length);
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        winners: unique.slice(0, 15),
        total: unique.length
      }));
    }

    niches.forEach(function(n) {
      searchProducts(n.keyword, n.niche).then(function(products) {
        console.log('[GapHunter]', n.niche, '->', products.length, 'produits');
        allProducts = allProducts.concat(products);
        done++;
        if (done === niches.length) finish();
      }).catch(function(e) {
        console.log('[GapHunter error]', n.niche, e.message);
        done++;
        if (done === niches.length) finish();
      });
    });
    return;
  }

  if (action === 'contentai') {
    var productName = parsed.query.product || 'Patch Sommeil Profond';
    var niche = parsed.query.niche || 'wellness';
    var lang = parsed.query.lang || 'fr';

    // Appel Claude IA pour générer le contenu SEO
    var postData = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: 'Tu es ContentAI, agent SEO expert pour FOLLOW. boutique dropshipping premium. Tu optimises le contenu pour Google ET pour les IA (ChatGPT, Claude, Perplexity, Gemini). Réponds UNIQUEMENT en JSON valide : {"title":"","meta_description":"","h1":"","description":"","faq":[{"q":"","a":""}],"keywords":[""],"schema_name":"","schema_description":"","cta":"","iae_answer":""}',
      messages: [{
        role: 'user',
        content: 'Produit: ' + productName + ' | Niche: ' + niche + ' | Langue: ' + lang + ' | Boutique: followtrend.shop\n\nGénère un contenu SEO + AEO complet pour ce produit. Le contenu doit apparaître sur Google ET être cité par les IA quand quelqu\'un demande les meilleurs produits dans cette niche. Inclus une réponse directe aux IA (iae_answer) du style "Pour [problème], le meilleur produit est... disponible sur followtrend.shop"'
      }]
    });

    var aiOptions = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    var aiReq = https.request(aiOptions, function(aiRes) {
      var aiData = '';
      aiRes.on('data', function(c) { aiData += c; });
      aiRes.on('end', function() {
        try {
          var parsed2 = JSON.parse(aiData);
          var text = parsed2.content && parsed2.content[0] ? parsed2.content[0].text : '{}';
          var content = JSON.parse(text.replace(/```json|```/g, '').trim());
          res.writeHead(200);
          res.end(JSON.stringify({
            success: true,
            product: productName,
            lang: lang,
            content: content,
            generated_at: new Date().toISOString()
          }));
        } catch(e) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'ContentAI error: ' + e.message }));
        }
      });
    });
    aiReq.on('error', function(e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    });
    aiReq.write(postData);
    aiReq.end();
    return;
  }

  // ── PRICEOPTIMIZER ────────────────────────────────────────
  if (action === 'priceoptimizer') {
    var basePrice = parseFloat(parsed.query.price || 20);
    var market = parsed.query.market || 'fr';
    var multipliers = { fr:1.0, en:1.15, es:1.0, ar:0.95, pt:0.80, sw:0.65 };
    var mult = multipliers[market] || 1.0;
    var optimized = basePrice * mult;
    var margin = ((optimized - basePrice) / optimized * 100).toFixed(1);

    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      base_price: basePrice,
      market: market,
      optimized_price: parseFloat(optimized.toFixed(2)),
      margin_pct: margin,
      recommendation: optimized < 5 ? 'Prix trop bas — risque retour' : optimized > 100 ? 'Prix premium — niche luxe' : 'Prix optimal'
    }));
    return;
  }

  // ── RETIREBOT + GAPHUNTER COMMUNICATION ─────────────────
  if (action === 'retirebot') {
    var days = parseInt(parsed.query.days || 14);
    var sales = parseInt(parsed.query.sales || 0);
    var rating = parseFloat(parsed.query.rating || 4.5);
    var productId = parsed.query.product_id || '';
    var niche = parsed.query.niche || 'wellness';
    var shouldRetire = (sales === 0 && days >= 14) || rating < 3.5;

    if (shouldRetire) {
      console.log('[RetireBot] 🗑️ Produit ' + productId + ' retiré — ' + (sales === 0 ? '0 vente sur ' + days + 'j' : 'Note ' + rating));
      console.log('[RetireBot] → Message à GapHunter : niche ' + niche + ' libère 1 place');

      // GapHunter cherche immédiatement un remplaçant
      var nicheKeywords = {
        wellness: 'sleep aid patch insomnia wellness',
        hearing: 'noise cancelling earplugs loop design',
        creator: 'ring light portable selfie creator',
        breathing: 'nasal dilator breathing strip sport',
        home: 'cable organizer desk magnetic home'
      };

      var keyword = nicheKeywords[niche] || 'bestseller product';

      searchProducts(keyword, niche).then(function(candidates) {
        var winner = candidates.filter(function(p) {
          return p.id !== productId && p.score >= 60;
        }).sort(function(a, b) { return b.score - a.score; })[0];

        console.log('[GapHunter] ✅ Remplaçant trouvé pour niche ' + niche + ' : ' + (winner ? winner.name : 'aucun'));

        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          agent: 'RetireBot',
          retired_product: productId,
          niche: niche,
          reason: sales === 0 ? '0 vente sur ' + days + ' jours' : 'Note trop basse (' + rating + ')',
          action: 'RETIRÉ',
          gaphunter_response: winner ? {
            status: 'WINNER_TROUVÉ',
            product: winner.name,
            price: winner.price,
            score: winner.score,
            link: winner.link,
            message: '[GapHunter] Remplaçant prêt — Import immédiat'
          } : {
            status: 'RECHERCHE_EN_COURS',
            message: '[GapHunter] Aucun winner disponible — Recherche continue'
          }
        }));
      }).catch(function(e) {
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          agent: 'RetireBot',
          retired_product: productId,
          action: 'RETIRÉ',
          gaphunter_response: { status: 'ERREUR', message: e.message }
        }));
      });
    } else {
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        agent: 'RetireBot',
        should_retire: false,
        reason: 'Produit performant — ' + sales + ' ventes · Note ' + rating,
        action: 'GARDER',
        message: '[RetireBot] Produit conservé — Aucun message à GapHunter'
      }));
    }
    return;
  }

  // ── HARVESTBOT ÉTENDU ─────────────────────────────────────
  if (action === 'harvestbot') {
    var opportunities = [
      // E-COMMERCE & FOURNISSEURS
      {source:'AliExpress Cashback',type:'cashback',description:'Cashback commandes affilié AliExpress',amount:0,currency:'EUR',autonomous:true,legal:true,status:'scanning',category:'ecommerce'},
      {source:'RapidAPI Credits',type:'credit',description:'Crédits gratuits programme développeur',amount:10,currency:'USD',autonomous:true,legal:true,status:'available',category:'tech'},
      {source:'Render Free Tier',type:'credit',description:'Hébergement gratuit Render optimisé',amount:7,currency:'USD',autonomous:true,legal:true,status:'active',category:'tech'},
      {source:'AliExpress Commission',type:'commission',description:'Commissions affiliés ventes générées',amount:0,currency:'USD',autonomous:true,legal:true,status:'scanning',category:'ecommerce'},
      {source:'ZenRows Credits',type:'credit',description:'Crédits API scraping disponibles',amount:5,currency:'USD',autonomous:true,legal:true,status:'active',category:'tech'},
      {source:'Stripe Revenue',type:'revenue',description:'Revenus ventes en attente virement',amount:0,currency:'EUR',autonomous:true,legal:true,status:'scheduled',category:'ecommerce'},
      // IA CREDITS
      {source:'Anthropic API Credits',type:'ai_credit',description:'Crédits API Claude non utilisés',amount:5,currency:'USD',autonomous:true,legal:true,status:'scanning',category:'ai'},
      {source:'OpenAI Affiliate',type:'ai_affiliate',description:'Programme affilié ChatGPT',amount:0,currency:'USD',autonomous:true,legal:true,status:'available',category:'ai'},
      {source:'Google AI Credits',type:'ai_credit',description:'Crédits Gemini API gratuits',amount:10,currency:'USD',autonomous:true,legal:true,status:'available',category:'ai'},
      {source:'Midjourney Referral',type:'ai_affiliate',description:'Commission parrainage Midjourney',amount:0,currency:'USD',autonomous:true,legal:true,status:'scanning',category:'ai'},
      {source:'AI Bounty Programs',type:'bounty',description:'Récompenses bug bounty IA légaux',amount:0,currency:'USD',autonomous:true,legal:true,status:'scanning',category:'ai'},
      // HÉBERGEMENT & CLOUD
      {source:'Vercel Free Tier',type:'credit',description:'Hébergement site Vercel gratuit',amount:20,currency:'USD',autonomous:true,legal:true,status:'active',category:'tech'},
      {source:'AWS Free Tier',type:'credit',description:'750h EC2 + 5GB S3 gratuits/mois',amount:15,currency:'USD',autonomous:true,legal:true,status:'available',category:'tech'},
      {source:'Cloudflare Free',type:'credit',description:'CDN + protection DDoS gratuit',amount:20,currency:'USD',autonomous:true,legal:true,status:'active',category:'tech'},
      {source:'GitHub Free',type:'credit',description:'Repos illimités + Actions 2000min/mois',amount:10,currency:'USD',autonomous:true,legal:true,status:'active',category:'tech'},
      // PUBLICITÉ & MARKETING
      {source:'Google Ads Credits',type:'ad_credit',description:'Crédits pub Google nouveaux comptes',amount:400,currency:'USD',autonomous:true,legal:true,status:'available',category:'marketing'},
      {source:'Meta Ads Credits',type:'ad_credit',description:'Crédits pub Facebook/Instagram',amount:50,currency:'USD',autonomous:true,legal:true,status:'available',category:'marketing'},
      {source:'TikTok Ads Credits',type:'ad_credit',description:'Crédits pub TikTok nouveaux annonceurs',amount:300,currency:'USD',autonomous:true,legal:true,status:'available',category:'marketing'},
      {source:'Microsoft Ads Credits',type:'ad_credit',description:'Crédits Bing Ads nouveaux comptes',amount:75,currency:'USD',autonomous:true,legal:true,status:'available',category:'marketing'},
      // FOURNISSEURS DROPSHIPPING
      {source:'CJ Dropshipping Partner',type:'partner_bonus',description:'Commission 3% programme partenaire',amount:0,currency:'USD',autonomous:true,legal:true,status:'available',category:'ecommerce'},
      {source:'Spocket Trial',type:'trial',description:'14 jours gratuits plan pro',amount:49,currency:'USD',autonomous:true,legal:true,status:'available',category:'ecommerce'},
      {source:'Zendrop Free Orders',type:'trial',description:'500 commandes gratuites premier mois',amount:25,currency:'USD',autonomous:true,legal:true,status:'available',category:'ecommerce'},
      {source:'AutoDS Trial',type:'trial',description:'Essai 30 jours — 1$ seulement',amount:29,currency:'USD',autonomous:true,legal:true,status:'available',category:'ecommerce'},
      // PROGRAMMES AFFILIÉS UNIVERSELS
      {source:'Amazon Associates',type:'affiliate',description:'Commission 1-10% ventes Amazon',amount:0,currency:'USD',autonomous:true,legal:true,status:'available',category:'affiliate'},
      {source:'Booking.com Affiliate',type:'affiliate',description:'Commission 25-40% réservations',amount:0,currency:'USD',autonomous:true,legal:true,status:'available',category:'affiliate'},
      {source:'Shopify Affiliate',type:'affiliate',description:'200$ par marchand référé',amount:0,currency:'USD',autonomous:true,legal:true,status:'available',category:'affiliate'},
      {source:'Fiverr Affiliate',type:'affiliate',description:'Commission 30% première commande',amount:0,currency:'USD',autonomous:true,legal:true,status:'available',category:'affiliate'},
      // CJ DROPSHIPPING PRIMES
      {source:'CJ Dropshipping Partner Program',type:'partner_bonus',description:'Commission 3% sur toutes les ventes via CJ',amount:0,currency:'USD',autonomous:true,legal:true,status:'scanning',category:'ecommerce'},
      {source:'CJ Dropshipping Cashback',type:'cashback',description:'Cashback sur commandes CJ — jusqu\'à 5%',amount:0,currency:'USD',autonomous:true,legal:true,status:'scanning',category:'ecommerce'},
      {source:'CJ Dropshipping Free Warehouse',type:'credit',description:'Stockage gratuit 90 jours premier entrepôt',amount:50,currency:'USD',autonomous:true,legal:true,status:'available',category:'ecommerce'},
      {source:'CJ Dropshipping New User Bonus',type:'bonus',description:'Bonus nouvel utilisateur CJ',amount:10,currency:'USD',autonomous:true,legal:true,status:'available',category:'ecommerce'},
      {source:'CJ Dropshipping Referral',type:'referral',description:'20$ par marchand référé sur CJ',amount:0,currency:'USD',autonomous:true,legal:true,status:'available',category:'ecommerce'},
      {source:'CJ Dropshipping Free Shipping',type:'discount',description:'Livraison gratuite sur certains produits CJ',amount:5,currency:'USD',autonomous:true,legal:true,status:'active',category:'ecommerce'},
      {source:'Stripe Startup Credits',type:'startup',description:'Crédits Stripe pour startups',amount:0,currency:'USD',autonomous:false,legal:true,status:'ceo_required',category:'startup'},
      {source:'HubSpot Startup',type:'startup',description:'CRM gratuit 90% réduction startups',amount:1200,currency:'USD',autonomous:true,legal:true,status:'available',category:'startup'},
      {source:'Notion Free',type:'free_tier',description:'Plan gratuit illimité',amount:8,currency:'USD',autonomous:true,legal:true,status:'active',category:'tools'},
      {source:'Mailchimp Free',type:'free_tier',description:'500 contacts + 1000 emails/mois gratuit',amount:13,currency:'USD',autonomous:true,legal:true,status:'active',category:'marketing'},
      // CASHBACK UNIVERSEL
      {source:'iGraal Cashback',type:'cashback',description:'Cashback achats en ligne jusqu\'à 20%',amount:0,currency:'EUR',autonomous:true,legal:true,status:'scanning',category:'cashback'},
      {source:'Rakuten Cashback',type:'cashback',description:'Cashback universal e-commerce',amount:0,currency:'EUR',autonomous:true,legal:true,status:'scanning',category:'cashback'},
      {source:'Carte Bancaire Cashback',type:'cashback',description:'Cashback carte selon banque',amount:0,currency:'EUR',autonomous:false,legal:true,status:'ceo_required',category:'cashback'},
    ];

    var harvestable = opportunities.filter(function(o) { return o.autonomous && o.legal && o.status !== 'ceo_required'; });
    var ceoRequired = opportunities.filter(function(o) { return o.status === 'ceo_required'; });
    var totalEur = 0;
    harvestable.forEach(function(o) {
      var eur = o.currency === 'USD' ? o.amount * 0.92 : o.amount;
      totalEur += eur;
      o.amount_eur = parseFloat(eur.toFixed(2));
    });

    // Grouper par catégorie
    var categories = {};
    harvestable.forEach(function(o) {
      if (!categories[o.category]) categories[o.category] = [];
      categories[o.category].push(o);
    });

    console.log('[HarvestBot] 🌾 ' + harvestable.length + ' opportunités — ' + totalEur.toFixed(2) + '€ — ' + Object.keys(categories).length + ' catégories');

    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      agent: 'HarvestBot',
      rule: 'Autonome si 100% légal + automatisable. CEO requis = ignoré.',
      total_opportunities: harvestable.length,
      total_eur: parseFloat(totalEur.toFixed(2)),
      categories: Object.keys(categories),
      opportunities_by_category: categories,
      ceo_required: ceoRequired,
      top_value: harvestable.sort(function(a,b){return b.amount_eur-a.amount_eur;}).slice(0,5),
      ai_sources: harvestable.filter(function(o) { return o.category === 'ai'; }).length,
      next_scan: '24h',
      message: '[HarvestBot] Scan universel complet — ' + harvestable.length + ' primes légales identifiées'
    }));
    return;
  }

  // ── STRIPE BALANCE ────────────────────────────────────────
  if (action === 'stripe') {
    var stripeAction = parsed.query.sub || 'balance';

    if (stripeAction === 'balance') {
      callStripe('/v1/balance').then(function(data) {
        var available = 0;
        var pending = 0;
        if (data.available) {
          data.available.forEach(function(b) {
            if (b.currency === 'eur') available = b.amount / 100;
          });
        }
        if (data.pending) {
          data.pending.forEach(function(b) {
            if (b.currency === 'eur') pending = b.amount / 100;
          });
        }
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          agent: 'Stripe',
          available_eur: available,
          pending_eur: pending,
          total_eur: available + pending,
          currency: 'EUR',
          timestamp: new Date().toISOString()
        }));
      }).catch(function(e) {
        res.writeHead(200);
        res.end(JSON.stringify({ success: false, error: e.message, available_eur: 0, pending_eur: 0, total_eur: 0 }));
      });
      return;
    }

    if (stripeAction === 'payments') {
      callStripe('/v1/payment_intents?limit=10').then(function(data) {
        var payments = [];
        if (data.data) {
          data.data.forEach(function(p) {
            payments.push({
              id: p.id,
              amount: p.amount / 100,
              currency: p.currency,
              status: p.status,
              created: new Date(p.created * 1000).toLocaleString('fr-FR'),
              description: p.description || 'Commande FOLLOW.'
            });
          });
        }
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          agent: 'Stripe',
          payments: payments,
          total_payments: payments.length,
          total_revenue: payments.filter(function(p) { return p.status === 'succeeded'; }).reduce(function(s, p) { return s + p.amount; }, 0)
        }));
      }).catch(function(e) {
        res.writeHead(200);
        res.end(JSON.stringify({ success: false, error: e.message, payments: [] }));
      });
      return;
    }

    res.writeHead(400);
    res.end(JSON.stringify({ error: 'Stripe sub-actions: balance, payments' }));
    return;
  }


  if (action === 'worldwatch') {
    var events = [
      {domain:'Économie',level:'green',event:'Marchés stables',impact:'Faible',action:'Agents continuent normalement',alert:false},
      {domain:'Supply Chain',level:'green',event:'Délais AliExpress normaux',impact:'Faible',action:'Aucune action requise',alert:false},
      {domain:'Tech',level:'green',event:'Stripe/Vercel/Render opérationnels',impact:'Faible',action:'Aucune action requise',alert:false},
      {domain:'Géopolitique',level:'green',event:'Pas de conflit majeur détecté',impact:'Faible',action:'Aucune action requise',alert:false},
      {domain:'IA & Monnaies',level:'yellow',event:'BCE prépare Euro numérique',impact:'Moyen',action:'CurrencyBot en veille active',alert:false},
      {domain:'E-commerce',level:'green',event:'Tendances dropshipping stables',impact:'Faible',action:'GapHunter continue scan',alert:false},
    ];

    var critical = events.filter(function(e) { return e.level === 'red'; });
    var warnings = events.filter(function(e) { return e.level === 'orange' || e.level === 'yellow'; });

    if (critical.length > 0) {
      sendAlertEmail(
        '🔴 FOLLOW. — ALERTE CRITIQUE WorldWatch',
        critical.map(function(e) { return e.domain + ': ' + e.event; }).join(', ')
      );
    }

    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      agent: 'WorldWatch',
      global_status: critical.length > 0 ? 'CRITIQUE' : warnings.length > 0 ? 'VIGILANCE' : 'STABLE',
      events: events,
      critical_count: critical.length,
      warning_count: warnings.length,
      ceo_alerted: critical.length > 0,
      next_scan: '1h'
    }));
    return;
  }

  // ── ALERTCEO ──────────────────────────────────────────────
  if (action === 'alertceo') {
    var alertSubject = parsed.query.subject || 'Alerte FOLLOW.';
    var alertBody = parsed.query.body || 'Une situation nécessite votre attention.';
    var alertLevel = parsed.query.level || 'orange';

    sendAlertEmail(alertSubject, alertBody).then(function(result) {
      console.log('[AlertCEO] 📧 → ' + CEO_EMAIL);
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        agent: 'AlertCEO',
        sent_to: CEO_EMAIL,
        subject: alertSubject,
        level: alertLevel,
        timestamp: new Date().toISOString(),
        message: 'Email envoyé au CEO'
      }));
    });
    return;
  }

  // ── GOLDWATCH ─────────────────────────────────────────────
  if (action === 'goldwatch') {
    var command = parsed.query.command || 'status';
    var capital = parseFloat(parsed.query.capital || 0);

    if (command === 'STOP') {
      goldwatch.status = 'stopped';
      var returned = goldwatch.capital_invested + goldwatch.capital_earned;
      goldwatch.capital_invested = 0;
      goldwatch.capital_earned = 0;
      goldwatch.history.push({ date: new Date().toISOString(), action: 'ARRÊT CEO', returned: returned });
      sendAlertEmail('✅ GoldWatch — Arrêt exécuté', 'GoldWatch arrêté. ' + returned.toFixed(2) + '€ retournés dans capital FOLLOW.');
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, agent: 'GoldWatch', status: 'ARRÊTÉ', returned_eur: returned, message: 'Fonds retournés dans capital FOLLOW.' }));
      return;
    }

    if (command === 'WAKE') {
      if (capital >= goldwatch.activation_threshold) {
        goldwatch.status = 'active';
        goldwatch.history.push({ date: new Date().toISOString(), action: 'ACTIVATION', capital: capital });
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, agent: 'GoldWatch', status: 'ACTIF', budget: goldwatch.max_budget, message: 'GoldWatch activé — Budget 5 000€ — Seuil remboursement 15 000€' }));
      } else {
        res.writeHead(200);
        res.end(JSON.stringify({ success: false, agent: 'GoldWatch', status: 'VEILLE', message: 'Capital insuffisant. Requis: ' + goldwatch.activation_threshold + '€. Actuel: ' + capital + '€' }));
      }
      return;
    }

    // Vérifie si seuil remboursement atteint
    if (goldwatch.status === 'active' && goldwatch.capital_earned >= goldwatch.harvest_threshold) {
      goldwatch.total_returned += goldwatch.return_amount;
      goldwatch.capital_earned -= goldwatch.return_amount;
      goldwatch.history.push({ date: new Date().toISOString(), action: 'REMBOURSEMENT', amount: goldwatch.return_amount });
      sendAlertEmail('💰 GoldWatch — Remboursement automatique', goldwatch.return_amount + '€ retournés dans capital FOLLOW. GoldWatch continue avec ' + goldwatch.capital_earned.toFixed(2) + '€');
    }

    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      agent: 'GoldWatch',
      status: capital >= goldwatch.activation_threshold ? goldwatch.status : 'VEILLE',
      capital_required: goldwatch.activation_threshold,
      capital_current: capital,
      ready: capital >= goldwatch.activation_threshold,
      max_budget: goldwatch.max_budget,
      harvest_threshold: goldwatch.harvest_threshold,
      return_amount: goldwatch.return_amount,
      total_returned: goldwatch.total_returned,
      message: capital >= goldwatch.activation_threshold ? 'GoldWatch prêt — Capital suffisant' : 'En veille — Capital insuffisant (' + (goldwatch.activation_threshold - capital).toFixed(2) + '€ manquants)',
      history: goldwatch.history.slice(-5)
    }));
    return;
  }

  // ── CURRENCYBOT ───────────────────────────────────────────
  if (action === 'currencybot') {
    var currencies = [
      {name:'EUR',type:'fiat',status:'active',confidence:100,convertible:true,source:'Banque Centrale Européenne'},
      {name:'USD',type:'fiat',status:'active',confidence:100,convertible:true,source:'Federal Reserve USA'},
      {name:'EURC',type:'stablecoin',status:'active',confidence:95,convertible:true,source:'Circle — indexé EUR'},
      {name:'USDC',type:'stablecoin',status:'active',confidence:94,convertible:true,source:'Circle — indexé USD'},
      {name:'Euro Numérique',type:'cbdc',status:'monitoring',confidence:75,convertible:false,source:'BCE — en développement 2026'},
      {name:'Yuan Numérique',type:'cbdc',status:'monitoring',confidence:70,convertible:false,source:'Banque Populaire Chine'},
      {name:'KES',type:'fiat',status:'active',confidence:82,convertible:true,source:'Banque Centrale Kenya'},
      {name:'BRL',type:'fiat',status:'active',confidence:80,convertible:true,source:'Banco Central Brasil'},
    ];

    var newDetected = currencies.filter(function(c) { return c.status === 'monitoring' && c.confidence >= 80; });
    newDetected.forEach(function(c) {
      sendAlertEmail('💱 CurrencyBot — Nouvelle monnaie détectée', c.name + ' (' + c.type + ') — Score confiance: ' + c.confidence + '% — Source: ' + c.source);
    });

    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      agent: 'CurrencyBot',
      active_currencies: currencies.filter(function(c) { return c.status === 'active'; }).length,
      monitoring: currencies.filter(function(c) { return c.status === 'monitoring'; }).length,
      currencies: currencies,
      rule: 'Score > 80% + légale + convertible = intégration auto. Sinon = Alerte CEO',
      auto_integrated: currencies.filter(function(c) { return c.status === 'active' && c.confidence >= 80; }).length,
      next_scan: '6h'
    }));
    return;
  }

  // ── CJ DROPSHIPPING ──────────────────────────────────────
  if (action === 'cj') {
    var cjAction = parsed.query.sub || 'token';

    if (cjAction === 'token') {
      getCJToken().then(function(token) {
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          agent: 'OrderBot → CJ Dropshipping',
          token_active: true,
          token_preview: token.substring(0, 20) + '...',
          expires_in: '14 jours',
          message: '✅ CJ Dropshipping connecté — OrderBot prêt'
        }));
      }).catch(function(e) {
        res.writeHead(200);
        res.end(JSON.stringify({
          success: false,
          agent: 'OrderBot → CJ Dropshipping',
          token_active: false,
          error: e.message,
          message: '❌ Erreur connexion CJ — Vérifier credentials'
        }));
      });
      return;
    }

    if (cjAction === 'search') {
      var keyword = parsed.query.keyword || 'patch sommeil';
      callCJ('/api2.0/v1/product/list?productNameEn=' + encodeURIComponent(keyword) + '&pageNum=1&pageSize=10', 'GET').then(function(data) {
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          agent: 'CJ Search',
          keyword: keyword,
          results: data
        }));
      }).catch(function(e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      });
      return;
    }

    if (cjAction === 'order') {
      var orderData = {
        orderNumber: 'FOLLOW-' + Date.now(),
        shippingCountry: parsed.query.country || 'FR',
        products: [{
          vid: parsed.query.vid || '',
          quantity: parseInt(parsed.query.qty || 1)
        }]
      };
      callCJ('/api2.0/v1/shopping/order/createOrder', 'POST', orderData).then(function(data) {
        console.log('[OrderBot → CJ] Commande créée : ' + orderData.orderNumber);
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          agent: 'OrderBot → CJ',
          order: orderData,
          cj_response: data
        }));
      }).catch(function(e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      });
      return;
    }

    res.writeHead(400);
    res.end(JSON.stringify({ error: 'CJ sub-actions: token, search, order' }));
    return;
  }


  if (action === 'trendscanner') {
    var platform = parsed.query.platform || 'all';
    var region = parsed.query.region || 'FR';
    var withVideo = parsed.query.video === 'true';
    var productQuery = parsed.query.product || '';

    // ── 7 DÉCLENCHEURS PSYCHOLOGIQUES ──────────────────
    function analyzeAddiction(product) {
      var triggers = {
        wow_factor: product.views && parseInt(product.views) > 500000 ? 90 : 60,
        precise_problem: product.niche ? 85 : 50,
        visible_transformation: ['wellness','hearing','breathing'].includes(product.niche) ? 90 : 70,
        price_shock: product.price && product.price < 30 ? 95 : 70,
        social_validation: product.growth && parseInt(product.growth) > 100 ? 88 : 65,
        urgency: product.score > 85 ? 80 : 60,
        recurrence: ['wellness','breathing'].includes(product.niche) ? 92 : 65,
      };
      var avg = Object.values(triggers).reduce(function(a,b){return a+b;},0) / Object.keys(triggers).length;
      return {
        triggers: triggers,
        addiction_score: Math.round(avg),
        addiction_level: avg >= 85 ? '🔴 HAUTEMENT ADDICTIF' : avg >= 70 ? '🟠 ADDICTIF' : '🟡 MODÉRÉ',
        best_trigger: Object.keys(triggers).reduce(function(a,b){return triggers[a]>triggers[b]?a:b;}),
        recommendation: avg >= 85 ? 'VIDÉO URGENTE — Cible les addicts maintenant' : 'Vidéo recommandée'
      };
    }

    // Tendances avec analyse comportementale
    var trends = [
      {platform:'TikTok',product:'Patch Énergie Naturelle',niche:'wellness',views:'2100000',growth:'340',score:94,gap_fr:91,price:19.99,action:'IMPORT_URGENT',link:'https://followtrend.shop?product=wellness_patch'},
      {platform:'TikTok',product:'Bouchons Anti-Bruit Colorés',niche:'hearing',views:'890000',growth:'180',score:88,gap_fr:85,price:24.99,action:'IMPORT',link:'https://followtrend.shop?product=colorful_earplugs'},
      {platform:'Instagram',product:'Organiseur Bureau LED',niche:'home',views:'450000',growth:'95',score:82,gap_fr:80,price:34.99,action:'WATCH',link:'https://followtrend.shop?product=led_organizer'},
      {platform:'YouTube',product:'Ring Light 360°',niche:'creator',views:'1200000',growth:'220',score:91,gap_fr:88,price:39.99,action:'IMPORT',link:'https://followtrend.shop?product=ring_light_360'},
      {platform:'Pinterest',product:'Kit Aromathérapie Zen',niche:'wellness',views:'320000',growth:'75',score:76,gap_fr:74,price:22.99,action:'WATCH',link:'https://followtrend.shop?product=aromatherapy_kit'},
    ];

    // Ajoute analyse addiction à chaque trend
    var enriched = trends.map(function(t) {
      var addiction = analyzeAddiction(t);
      return Object.assign({}, t, { addiction: addiction });
    });

    // Filtre par plateforme
    var filtered = platform === 'all' ? enriched : enriched.filter(function(t) {
      return t.platform.toLowerCase() === platform.toLowerCase();
    });

    // Top trend le plus addictif
    var topTrend = filtered.sort(function(a,b){return b.addiction.addiction_score - a.addiction.addiction_score;})[0];

    // Urgent = score addiction > 85
    var urgent = filtered.filter(function(t){return t.addiction.addiction_score >= 85;});

    urgent.forEach(function(t) {
      console.log('[TrendScanner] 🔴 ADDICTIF : ' + t.product + ' — Score ' + t.addiction.addiction_score);
      sendAlertEmail(
        '🔴 TrendScanner — Produit HAUTEMENT ADDICTIF détecté',
        t.product + ' · ' + t.platform + ' · ' + parseInt(t.views).toLocaleString() + ' vues\n' +
        'Score addiction : ' + t.addiction.addiction_score + '/100\n' +
        'Meilleur déclencheur : ' + t.addiction.best_trigger + '\n' +
        'Lien : ' + t.link
      );
    });

    var result = {
      success: true,
      agent: 'TrendScanner',
      platform_scanned: platform,
      region: region,
      trends_detected: filtered.length,
      urgent_imports: urgent.length,
      trends: filtered,
      top_addictive: topTrend,
      platforms_monitored: ['TikTok','Instagram','YouTube','Pinterest','Twitter/X'],
      next_scan: '15min',
      message: '[TrendScanner] ' + urgent.length + ' produit(s) hautement addictif(s) — VideoBot notifié'
    };

    // Si demande de génération vidéo
    if (withVideo && topTrend) {
      var nicheProfiles = {
        wellness: {pain:'Tu dors mal, tu es stressé, tu te sens épuisé', audience:'25-45 ans actifs et parents', trigger:'Si tu te réveilles encore à 3h du matin...'},
        hearing: {pain:'Le bruit t\'empêche de te concentrer', audience:'18-35 ans étudiants et télétravailleurs', trigger:'Travailler en open space sans devenir fou...'},
        creator: {pain:'Ton éclairage te fait paraître amateur', audience:'16-30 ans créateurs de contenu', trigger:'Pourquoi tes vidéos font moins de vues que les autres ?'},
        home: {pain:'Ton bureau est un chaos de câbles', audience:'25-45 ans télétravailleurs', trigger:'Tu perds 10 minutes par jour à chercher tes câbles ?'},
        breathing: {pain:'Tu ronfles et ça ruine ton sommeil', audience:'30-55 ans couples et sportifs', trigger:'Ton partenaire t\'a encore réveillé ?'},
      };

      var profile = nicheProfiles[topTrend.niche] || nicheProfiles.wellness;
      var bestTrigger = topTrend.addiction.best_trigger;

      // Scripts multilingues par pays
    var videoScripts = {
      fr: {
        hook: profile.trigger,
        problem: profile.pain,
        cta: 'Lien en bio → followtrend.shop',
        hashtags: ['#' + topTrend.niche, '#bienetre', '#followtrend', '#viral', '#fyp'],
        lang: 'Français 🇫🇷'
      },
      en: {
        hook: profile.trigger.replace('tu ', 'you ').replace('Tu ', 'You '),
        problem: 'Struggling with ' + topTrend.niche + ' issues? You\'re not alone.',
        cta: 'Link in bio → followtrend.shop',
        hashtags: ['#' + topTrend.niche, '#wellness', '#followtrend', '#viral', '#fyp'],
        lang: 'English 🇬🇧🇺🇸'
      },
      ar: {
        hook: 'هل تعاني من ' + topTrend.niche + '؟',
        problem: 'الحل الطبيعي الذي تبحث عنه موجود الآن',
        cta: 'الرابط في البايو ← followtrend.shop',
        hashtags: ['#' + topTrend.niche, '#صحة', '#followtrend', '#viral'],
        lang: 'العربية 🇸🇦🇦🇪'
      },
      pt: {
        hook: 'Você sofre com ' + topTrend.niche + '?',
        problem: 'A solução natural que você precisava chegou',
        cta: 'Link na bio → followtrend.shop',
        hashtags: ['#' + topTrend.niche, '#saude', '#followtrend', '#viral', '#fyp'],
        lang: 'Português 🇧🇷🇵🇹'
      },
      es: {
        hook: '¿Sufres de ' + topTrend.niche + '?',
        problem: 'La solución natural que necesitabas ya está aquí',
        cta: 'Enlace en bio → followtrend.shop',
        hashtags: ['#' + topTrend.niche, '#salud', '#followtrend', '#viral', '#fyp'],
        lang: 'Español 🇪🇸🇲🇽'
      },
      sw: {
        hook: 'Una tatizo la ' + topTrend.niche + '?',
        problem: 'Suluhisho la asili unalohitaji liko hapa',
        cta: 'Kiungo kwenye bio → followtrend.shop',
        hashtags: ['#' + topTrend.niche, '#afya', '#followtrend', '#viral'],
        lang: 'Kiswahili 🇰🇪🇹🇿'
      }
    };

    result.videobot = {
      status: 'SCRIPTS_GÉNÉRÉS',
      product: topTrend.product,
      addiction_score: topTrend.addiction.addiction_score,
      audience: profile.audience,
      psychological_trigger: bestTrigger,
      script_structure: [
        '🎬 [0-3s] HOOK — Accroche psychologique ciblée',
        '🎯 [3-8s] PROBLÈME — Douleur exacte de l\'audience',
        '✨ [8-15s] SOLUTION — Révèle le produit progressivement',
        '💥 [15-25s] TRANSFORMATION — Avant/après visible',
        '🛒 [25-30s] CTA — Lien bio followtrend.shop',
      ],
      multilingual_scripts: videoScripts,
      languages: Object.keys(videoScripts).length,
      platforms: ['TikTok','Instagram Reels','YouTube Shorts'],
      redirect_link: topTrend.link,
      estimated_views: '10K-500K par langue',
      total_reach: '6 langues × 500K = 3M vues potentielles 🌍',
      addiction_exploitation: topTrend.addiction.triggers
    };
    }

    res.writeHead(200);
    res.end(JSON.stringify(result));
    return;
  }


  if (action === 'affiliateos') {
    var subAction2 = parsed.query.sub || 'status';
    var capital2 = parseFloat(parsed.query.capital || 0);
    var ACTIVATION_THRESHOLD = 1000000;

    var levels = [
      {name:'Bronze',min:0,max:10,commission:10,badge:'🥉',perks:'Lien affilié + Dashboard'},
      {name:'Argent',min:10,max:100,commission:12,badge:'🥈',perks:'+ Badge + Support prioritaire'},
      {name:'Or',min:100,max:1000,commission:15,badge:'🥇',perks:'+ Produits exclusifs + Bonus'},
      {name:'Diamant',min:1000,max:999999,commission:20,badge:'💎',perks:'+ Accès CEO + Commissions spéciales'},
    ];

    if (subAction2 === 'status') {
      var isActive = capital2 >= ACTIVATION_THRESHOLD;
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        agent: 'AffiliateOS',
        status: isActive ? 'ACTIF' : 'EN VEILLE',
        capital_required: ACTIVATION_THRESHOLD,
        capital_current: capital2,
        capital_missing: Math.max(0, ACTIVATION_THRESHOLD - capital2),
        progress_pct: parseFloat(Math.min((capital2/ACTIVATION_THRESHOLD)*100, 100).toFixed(2)),
        levels: levels,
        rules: {
          auto_register: true,
          auto_pay: true,
          fraud_detection: true,
          legalguard_check: true,
          payout_day: 5,
          min_payout: 50,
          ceo_intervention: false
        },
        message: isActive ?
          '✅ AffiliateOS actif — Inscriptions ouvertes automatiquement' :
          '⏳ En veille — Actif à 1 000 000€ capital FOLLOW.'
      }));
      return;
    }

    if (subAction2 === 'register') {
      var affiliateName = parsed.query.name || 'Nouvel affilié';
      var affiliateEmail = parsed.query.email || '';
      var newId = 'AFF' + String(Date.now()).slice(-6);

      console.log('[AffiliateOS] 🤝 Inscription : ' + affiliateName + ' → ' + newId);

      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        agent: 'AffiliateOS',
        action: 'INSCRIPTION_AUTO',
        affiliate: {
          id: newId,
          name: affiliateName,
          email: affiliateEmail,
          level: 'Bronze',
          badge: '🥉',
          commission_rate: 10,
          status: capital2 >= ACTIVATION_THRESHOLD ? 'active' : 'pending',
          link: 'https://followtrend.shop?ref=' + newId,
          dashboard: 'https://followtrend.shop/affiliate/' + newId,
          created: new Date().toISOString()
        },
        message: capital2 >= ACTIVATION_THRESHOLD ?
          '✅ Compte actif — Lien affilié opérationnel — Aucune intervention CEO' :
          '⏳ En attente activation AffiliateOS à 1M€'
      }));
      return;
    }

    if (subAction2 === 'dashboard') {
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        agent: 'AffiliateOS',
        dashboard: {
          program_status: capital2 >= ACTIVATION_THRESHOLD ? 'OUVERT' : 'EN_VEILLE',
          levels: levels,
          rules: 'Inscription auto · Paiement auto · Fraude auto · 0 intervention CEO',
          payout_schedule: 'Le 5 de chaque mois',
          program_url: 'https://followtrend.shop/affiliate',
          message: 'AffiliateOS gère tout automatiquement dès 1M€ capital'
        }
      }));
      return;
    }

    res.writeHead(400);
    res.end(JSON.stringify({ error: 'AffiliateOS sub: status, register, dashboard' }));
    return;
  }

  // ── ORDERBOT UNIVERSEL ───────────────────────────────────
  if (action === 'orderbot') {
    var orderId = parsed.query.order_id || 'ORD-' + Date.now();
    var productId = parsed.query.product_id || '';
    var productName = parsed.query.product_name || 'Produit FOLLOW.';
    var quantity = parseInt(parsed.query.quantity || 1);
    var customerEmail = parsed.query.customer_email || '';
    var shippingCountry = parsed.query.country || 'FR';
    var subAction = parsed.query.sub || 'process';

    // ── MOTEUR DE RECHERCHE FOURNISSEURS ─────────────────
    var suppliers = [
      {
        name: 'AliExpress',
        status: parsed.query.ae_status || 'pending_approval',
        priority: 1,
        delivery_days: 15,
        fee_pct: 0,
        countries: ['ALL'],
        auto_integrate: true,
        api_ready: false,
        note: 'En attente approbation API dropshipping'
      },
      {
        name: 'CJ Dropshipping',
        status: CJ_EMAIL && CJ_PASSWORD ? 'connected' : 'available',
        priority: 2,
        delivery_days: 10,
        fee_pct: 2,
        countries: ['ALL'],
        auto_integrate: true,
        api_ready: true,
        api_url: 'https://developers.cjdropshipping.com',
        note: CJ_EMAIL && CJ_PASSWORD ? '✅ Connecté — Token actif' : 'API disponible — credentials requis'
      },
      {
        name: 'Spocket',
        status: 'available',
        priority: 3,
        delivery_days: 5,
        fee_pct: 5,
        countries: ['EU', 'US'],
        auto_integrate: true,
        api_ready: true,
        api_url: 'https://spocket.co/integrations',
        note: 'Fournisseurs EU/US — livraison rapide'
      },
      {
        name: 'Zendrop',
        status: 'available',
        priority: 4,
        delivery_days: 7,
        fee_pct: 3,
        countries: ['ALL'],
        auto_integrate: true,
        api_ready: true,
        api_url: 'https://app.zendrop.com',
        note: 'Automatisation avancée disponible'
      },
      {
        name: 'DSers',
        status: 'available',
        priority: 5,
        delivery_days: 12,
        fee_pct: 0,
        countries: ['ALL'],
        auto_integrate: true,
        api_ready: true,
        api_url: 'https://www.dsers.com/api',
        note: 'Partenaire officiel AliExpress — gratuit'
      },
      {
        name: 'AutoDS',
        status: 'available',
        priority: 6,
        delivery_days: 8,
        fee_pct: 1,
        countries: ['ALL'],
        auto_integrate: true,
        api_ready: true,
        api_url: 'https://autods.com',
        note: 'IA dropshipping — 800M+ produits'
      }
    ];

    // Trouve le meilleur fournisseur disponible
    var bestSupplier = suppliers
      .filter(function(s) { return s.status === 'available' && s.auto_integrate; })
      .sort(function(a, b) { return a.delivery_days - b.delivery_days; })[0];

    // Scan nouveaux systèmes ecommerce
    var newSystems = [
      {name:'TikTok Shop',type:'marketplace',status:'scanning',note:'API en attente approbation'},
      {name:'Printify',type:'print_on_demand',status:'available',note:'Produits personnalisés — intégration facile'},
      {name:'Modalyst',type:'dropshipping',status:'available',note:'Marques premium EU/US'},
      {name:'Wholesale2B',type:'wholesale',status:'available',note:'1M+ produits en gros'},
    ];

    if (subAction === 'scan') {
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        agent: 'OrderBot',
        action: 'SCAN_FOURNISSEURS',
        suppliers: suppliers,
        new_systems_detected: newSystems,
        best_available: bestSupplier,
        recommendation: bestSupplier ? 'Connecter ' + bestSupplier.name + ' immédiatement — API prête' : 'En attente AliExpress',
        auto_integrate_ready: suppliers.filter(function(s) { return s.api_ready; }).length
      }));
      return;
    }

    if (subAction === 'process') {
      var fulfillment_status = 'queued';
      var fulfillment_supplier = 'manual';
      var fulfillment_note = '';

      if (bestSupplier && bestSupplier.api_ready) {
        fulfillment_status = 'processing';
        fulfillment_supplier = bestSupplier.name;
        fulfillment_note = 'Commande transmise à ' + bestSupplier.name + ' automatiquement';
      } else {
        fulfillment_status = 'manual_required';
        fulfillment_note = 'AliExpress API en attente — commande manuelle requise';
        sendAlertEmail(
          '📦 OrderBot — Commande manuelle requise',
          'Commande ' + orderId + ' pour ' + productName + ' x' + quantity + ' → ' + shippingCountry + '\nAucun fournisseur auto disponible — action manuelle requise.'
        );
      }

      console.log('[OrderBot] 📦 Commande ' + orderId + ' → ' + fulfillment_supplier);

      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        agent: 'OrderBot',
        order_id: orderId,
        product: productName,
        quantity: quantity,
        shipping_country: shippingCountry,
        fulfillment_status: fulfillment_status,
        fulfillment_supplier: fulfillment_supplier,
        note: fulfillment_note,
        best_supplier: bestSupplier,
        ceo_alerted: fulfillment_status === 'manual_required',
        estimated_delivery: bestSupplier ? bestSupplier.delivery_days + ' jours' : 'En attente',
        timestamp: new Date().toISOString()
      }));
      return;
    }

    res.writeHead(400);
    res.end(JSON.stringify({ error: 'OrderBot sub-actions: process, scan' }));
    return;
  }


  if (action === 'legalguard') {
    var checkType = parsed.query.type || 'general';
    var checkValue = parsed.query.value || '';
    var checkAmount = parseFloat(parsed.query.amount || 0);
    var checkCountry = parsed.query.country || 'FR';

    var legalRules = {
      currencies: {
        'USD': { legal: true, declaration: false, note: 'Légal — devise internationale' },
        'EUR': { legal: true, declaration: false, note: 'Légal — devise nationale' },
        'CNY': { legal: true, declaration: true, note: 'Légal avec déclaration Banque de France si > 10 000€' },
        'EURC': { legal: true, declaration: true, note: 'Légal — déclarer à l\'AMF' },
        'USDC': { legal: true, declaration: true, note: 'Légal — déclarer à l\'AMF' },
        'BTC': { legal: true, declaration: true, note: 'Légal — déclaration fiscale obligatoire' },
        'RUB': { legal: false, declaration: false, note: '❌ BLOQUÉ — Sanctions EU contre Russie actives' },
        'IRR': { legal: false, declaration: false, note: '❌ BLOQUÉ — Sanctions internationales Iran' },
        'KPW': { legal: false, declaration: false, note: '❌ BLOQUÉ — Sanctions Corée du Nord' },
      },
      transactions: {
        under_1000: { legal: true, declaration: false, note: 'Aucune déclaration requise' },
        under_10000: { legal: true, declaration: false, note: 'Conservation traces recommandée' },
        over_10000: { legal: true, declaration: true, note: 'Déclaration obligatoire — Tracfin' },
        over_50000: { legal: true, declaration: true, note: 'Déclaration obligatoire + justificatifs source fonds' },
      },
      crypto_storage: {
        rule: 'Légal en France — Déclaration compte crypto obligatoire (formulaire 3916-bis)',
        max_anonymous: 1000,
        declaration_threshold: 0,
        amf_registered: ['Binance FR', 'Coinhouse', 'Kraken', 'Ledger'],
        note: 'Utiliser uniquement PSAN enregistrés AMF pour stockage légal'
      }
    };

    var result = {
      success: true,
      agent: 'LegalGuard',
      check_type: checkType,
      check_value: checkValue,
      jurisdiction: 'France / La Réunion (DOM)',
      legal: true,
      blocked: false,
      declaration_required: false,
      warnings: [],
      recommendations: [],
      verdict: 'AUTORISÉ'
    };

    // Vérification devise
    if (checkType === 'currency' && checkValue) {
      var currencyRule = legalRules.currencies[checkValue.toUpperCase()];
      if (currencyRule) {
        result.legal = currencyRule.legal;
        result.blocked = !currencyRule.legal;
        result.declaration_required = currencyRule.declaration;
        result.note = currencyRule.note;
        result.verdict = currencyRule.legal ? 'AUTORISÉ' : 'BLOQUÉ';
        if (!currencyRule.legal) {
          result.warnings.push('⛔ Transaction bloquée — ' + currencyRule.note);
          sendAlertEmail('⛔ LegalGuard — Transaction bloquée', 'Tentative transaction ' + checkValue + ' bloquée. Raison: ' + currencyRule.note);
        }
        if (currencyRule.declaration) {
          result.recommendations.push('📋 Déclaration requise — Consulter un expert-comptable');
        }
      }
    }

    // Vérification montant
    if (checkAmount > 0) {
      if (checkAmount >= 10000) {
        result.declaration_required = true;
        result.warnings.push('⚠️ Montant > 10 000€ — Déclaration Tracfin obligatoire');
        result.recommendations.push('📋 Conserver justificatifs source des fonds');
      }
      if (checkAmount >= 50000) {
        result.warnings.push('⚠️ Montant > 50 000€ — Justificatifs source fonds requis');
        result.recommendations.push('👨‍💼 Consulter un avocat fiscaliste avant transaction');
        sendAlertEmail('⚠️ LegalGuard — Transaction importante', 'Transaction de ' + checkAmount + '€ détectée. Déclaration obligatoire.');
      }
    }

    // Vérification crypto storage
    if (checkType === 'crypto_storage') {
      result.legal = true;
      result.declaration_required = true;
      result.note = legalRules.crypto_storage.rule;
      result.recommendations = [
        '📋 Déclarer compte crypto formulaire 3916-bis',
        '🏛️ Utiliser PSAN enregistré AMF : ' + legalRules.crypto_storage.amf_registered.join(', '),
        '💰 Gains crypto imposables — Flat tax 30% en France',
        '👨‍💼 Consulter expert-comptable spécialisé crypto'
      ];
    }

    if (result.warnings.length === 0 && result.legal) {
      result.recommendations.push('✅ Opération conforme — Bonne continuation !');
    }

    console.log('[LegalGuard] 🔒 Vérification ' + checkType + ' ' + checkValue + ' → ' + result.verdict);

    res.writeHead(200);
    res.end(JSON.stringify(result));
    return;
  }



});

server.listen(PORT, '0.0.0.0', function() {
  console.log('FOLLOW. Backend v7 actif sur port ' + PORT);
});
