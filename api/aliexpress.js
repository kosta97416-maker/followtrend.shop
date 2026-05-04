const axios = require('axios');

// Fonction pour récupérer un produit via ZenRows (pour pas être bloqué par Ali)
async function fetchAliProduct(url) {
    const zenrowsApiKey = process.env.ZENROWS_API_KEY;
    const proxyUrl = `https://api.zenrows.com/v1/?key=${zenrowsApiKey}&url=${encodeURIComponent(url)}&js_render=true`;
    
    const response = await axios.get(proxyUrl);
    // Ici l'IA (tes agents) peut extraire le titre, prix, image du HTML reçu
    return response.data; 
}

// Fonction pour envoyer à Shopify
async function sendToShopify(productData) {
    const shopifyUrl = `https://${process.env.SHOPIFY_STORE_NAME}.myshopify.com/admin/api/2024-01/products.json`;
    
    const body = {
        product: {
            title: productData.title,
            body_html: productData.description,
            vendor: "Follow Trend Empire",
            images: [{ src: productData.imageUrl }],
            variants: [{ price: productData.price }]
        }
    };

    return await axios.post(shopifyUrl, body, {
        headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_PASSWORD }
    });
}
