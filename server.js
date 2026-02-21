const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');

const app = express();

/* ==============================
   🔹 CORS
============================== */
app.use(cors({
  origin: "https://monprijet.vercel.app"
}));

/* ==============================
   🔹 FIREBASE INIT
============================== */
admin.initializeApp({
  credential: admin.credential.cert({
    project_id: process.env.FIREBASE_PROJECT_ID,
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

const db = admin.firestore();

/* ==============================
   🔹 STRIPE WEBHOOK
   ⚠️ IMPORTANT: raw AVANT express.json()
============================== */
app.post('/webhook',
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
      console.error("❌ Webhook signature error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log("✅ Webhook reçu :", event.type);

    if (event.type === 'checkout.session.completed') {

      const session = event.data.object;

      try {
        const docRef = await db.collection('commandes').add({
          stripeSessionId: session.id,
          email: session.customer_details?.email || null,
          montant: session.amount_total,
          devise: session.currency,
          statut: 'payé',
          date: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log("🔥 Commande enregistrée ID :", docRef.id);

      } catch (err) {
        console.error("🔥 ERREUR FIRESTORE :", err);
      }
    }

    res.json({ received: true });
  }
);

/* ==============================
   🔹 BODY JSON (après webhook)
============================== */
app.use(express.json());

/* ==============================
   🔹 CREATE CHECKOUT SESSION
============================== */
app.post('/create-checkout-session', async (req, res) => {

  try {
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: "Panier invalide" });
    }

    const line_items = items.map(item => ({
      price_data: {
        currency: "eur",
        product_data: {
          name: item.name,
        },
        unit_amount: item.amount,
      },
      quantity: item.quantity,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      success_url: "https://monprijet.vercel.app/success",
      cancel_url: "https://monprijet.vercel.app/cancel",
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error("❌ Erreur création session:", err);
    res.status(500).json({ error: "Erreur création session" });
  }
});

/* ==============================
   🔹 TEST FIRESTORE
============================== */
app.get('/test-firestore', async (req, res) => {
  try {
    const docRef = await db.collection('commandes').add({
      stripeSessionId: "test-session",
      email: "test@test.com",
      montant: 1000,
      devise: "eur",
      statut: "payé",
      date: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.send(`Document créé ID : ${docRef.id}`);
  } catch (err) {
    console.error("Erreur Firestore:", err);
    res.status(500).send("Erreur Firestore");
  }
});

/* ==============================
   🔹 START SERVER
============================== */
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log("🚀 Server démarré sur port", PORT);
});
