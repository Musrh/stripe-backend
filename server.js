require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const admin = require('firebase-admin');
const fetch = require('node-fetch');

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PORT = process.env.PORT || 3000;

// ----------------------------
// FIREBASE INIT
// ----------------------------
admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  ),
});

const db = admin.firestore();

// ----------------------------
// PAYPAL CONFIG
// ----------------------------
const PAYPAL_API =
  process.env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

// ----------------------------
// CORS
// ----------------------------
app.use(cors({
  origin: "https://musrh.github.io",
  methods: ["GET","POST"],
  allowedHeaders: ["Content-Type"]
}));

// ----------------------------
// WEBHOOK STRIPE
// ----------------------------
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

      console.error("Webhook error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);

    }

    if (event.type === 'checkout.session.completed') {

      const session = event.data.object;

      await db.collection('commandes').add({
        stripeSessionId: session.id,
        email: session.customer_details?.email || null,
        montant: session.amount_total / 100,
        devise: session.currency,
        paiement: "stripe",
        statut: "payé",
        date: admin.firestore.FieldValue.serverTimestamp(),
        items: session.metadata?.items
          ? JSON.parse(session.metadata.items)
          : []
      });

      console.log("Commande Stripe enregistrée");

    }

    res.json({ received: true });

  }
);

// ----------------------------
// JSON middleware
// ----------------------------
app.use(express.json());

// ----------------------------
// STRIPE CHECKOUT
// ----------------------------
app.post('/create-checkout-session', async (req, res) => {

  try {

    const items = req.body.items;

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

      success_url:
        'https://musrh.github.io/Monprijet/#/success',

      cancel_url:
        'https://musrh.github.io/Monprijet/#/cancel',

    });

    res.json({ url: session.url });

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: err.message });

  }

});

// ----------------------------
// PAYPAL CREATE ORDER
// ----------------------------
app.post('/create-paypal-order', async (req, res) => {

  try {

    const items = req.body.items;

    const total = items.reduce(
      (sum, i) => sum + i.prix * i.quantity,
      0
    );

    // token PayPal
    const auth = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {

      method: "POST",

      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization":
          "Basic " +
          Buffer.from(
            process.env.PAYPAL_CLIENT_ID +
              ":" +
              process.env.PAYPAL_SECRET
          ).toString("base64"),
      },

      body: "grant_type=client_credentials",

    });

    const authData = await auth.json();

    const order = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {

      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authData.access_token}`,
      },

      body: JSON.stringify({

        intent: "CAPTURE",

        purchase_units: [
          {
            amount: {
              currency_code: "EUR",
              value: total.toFixed(2),
            },
          },
        ],
      }),

    });

    const orderData = await order.json();

    res.json(orderData);

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: err.message });

  }

});

// ----------------------------
// PAYPAL CAPTURE
// ----------------------------
app.post('/capture-paypal-order', async (req, res) => {

  try {

    const { orderID, items } = req.body;

    const auth = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {

      method: "POST",

      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization":
          "Basic " +
          Buffer.from(
            process.env.PAYPAL_CLIENT_ID +
              ":" +
              process.env.PAYPAL_SECRET
          ).toString("base64"),
      },

      body: "grant_type=client_credentials",

    });

    const authData = await auth.json();

    const capture = await fetch(
      `${PAYPAL_API}/v2/checkout/orders/${orderID}/capture`,
      {

        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authData.access_token}`,
        },

      }
    );

    const captureData = await capture.json();

    // sauvegarde Firestore
    await db.collection('commandes').add({

      paypalOrderId: orderID,
      paiement: "paypal",
      statut: "payé",
      date: admin.firestore.FieldValue.serverTimestamp(),
      items

    });

    console.log("Commande PayPal enregistrée");

    res.json(captureData);

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: err.message });

  }

});

// ----------------------------
// START SERVER
// ----------------------------
app.listen(PORT, () => {
  console.log(`Serveur démarré sur port ${PORT}`);
});
