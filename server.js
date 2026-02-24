require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const admin = require('firebase-admin');

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ============================
// FIREBASE INIT
// ============================
admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  ),
});

const db = admin.firestore();

// ============================
// MIDDLEWARE
// ============================
app.use(cors());

// ============================
// 🚨 WEBHOOK (DOIT ÊTRE AVANT express.json())
// ============================
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("❌ Erreur signature webhook :", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log("✅ Webhook reçu :", event.type);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      try {
        await db.collection('commandes').add({
          stripeSessionId: session.id,
          email: session.customer_details?.email || null,
          montant: session.amount_total / 100,
          devise: session.currency,
          statut: 'payé',
          date: admin.firestore.FieldValue.serverTimestamp(),
          items: session.metadata?.items
            ? JSON.parse(session.metadata.items)
            : []
        });

        console.log("✅ Commande enregistrée Firestore");
      } catch (err) {
        console.error("❌ Erreur Firestore :", err);
      }
    }

    res.json({ received: true });
  }
);

// ============================
// JSON middleware après webhook
// ============================
app.use(express.json());

// ============================
// CREATE CHECKOUT SESSION
// ============================
app.post('/create-checkout-session', async (req, res) => {
  try {
    const items = req.body.items || [];

    if (!items.length)
      return res.status(400).json({ error: 'Panier vide' });

    const line_items = items.map(i => ({
      price_data: {
        currency: 'eur',
        product_data: { name: i.nom },
        unit_amount: i.prix * 100,
      },
      quantity: i.quantity,
    }));

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items,
      metadata: { items: JSON.stringify(items) },

      // ✅ REDIRECTION GITHUB PAGES
      success_url:
        'https://musrh.github.io/monprijet/#/success?session_id={CHECKOUT_SESSION_ID}',

      cancel_url:
        'https://musrh.github.io/monprijet/#/cancel',
    });

    console.log("✅ Session créée :", session.id);

    res.json({ url: session.url });

  } catch (err) {
    console.error("❌ Stripe error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================
// ROUTE POUR SUCCESS.VUE
// ============================
app.get('/api/checkout-session', async (req, res) => {
  try {
    const sessionId = req.query.session_id;

    if (!sessionId)
      return res.status(400).json({ error: "Session ID manquant" });

    const session = await stripe.checkout.sessions.retrieve(
      sessionId,
      { expand: ['line_items'] }
    );

    res.json({
      customer_email: session.customer_details?.email,
      amount_total: session.amount_total,
      items: session.line_items.data.map(item => ({
        id: item.id,
        name: item.description,
        quantity: item.quantity,
        amount: item.amount_total,
      })),
    });

  } catch (err) {
    console.error("❌ Erreur récupération session :", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================
// START SERVER
// ============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Serveur démarré sur port ${PORT}`)
);
