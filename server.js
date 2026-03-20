//server.js bon
// server.js
import express from "express";
import cors from "cors";
import Stripe from "stripe";
import admin from "firebase-admin";
import paypal from "@paypal/checkout-server-sdk";
import dotenv from "dotenv";

dotenv.config();
const app = express();

// ----------------------------
// Firestore
// ----------------------------
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ----------------------------
// Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ----------------------------
// PayPal
const paypalEnv =
  process.env.PAYPAL_ENV === "live"
    ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_SECRET)
    : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_SECRET);

const paypalClient = new paypal.core.PayPalHttpClient(paypalEnv);

// ----------------------------
// CORS pour GitHub Pages
// ----------------------------
app.use(
  cors({
    origin: "https://musrh.github.io",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type"],
  })
);

// ----------------------------
// Webhook Stripe (express.raw!)
app.post(
  "/webhook",
  express.raw({ type: "application/json" }), // ⚠️ requis par Stripe
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error("⚠️ Webhook signature error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      try {
        await db.collection("commandes").add({
          stripeSessionId: session.id,
          email: session.customer_details?.email || null,
          montant: session.amount_total / 100,
          devise: session.currency,
          statut: "payé",
          date: admin.firestore.FieldValue.serverTimestamp(),
          items: session.metadata?.items ? JSON.parse(session.metadata.items) : [],
        });
        console.log("✅ Commande Stripe enregistrée dans Firestore");
      } catch (err) {
        console.error("❌ Erreur Firestore Stripe :", err);
      }
    }

    res.json({ received: true });
  }
);

// ----------------------------
// Middleware JSON pour les autres routes
app.use(express.json());

// ----------------------------
// CREATE STRIPE CHECKOUT SESSION
app.post("/create-stripe-session", async (req, res) => {
  const items = req.body.items || [];
  try {
    const line_items = items.map((i) => ({
      price_data: {
        currency: "eur",
        product_data: { name: i.nom },
        unit_amount: i.prix * 100,
      },
      quantity: i.quantity,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items,
      mode: "payment",
      metadata: { items: JSON.stringify(items) },
      success_url: "https://musrh.github.io/Monprijet/#/success",
      cancel_url: "https://musrh.github.io/Monprijet/#/cancel",
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------
// CREATE PAYPAL ORDER
app.post("/create-paypal-order", async (req, res) => {
  const items = req.body.items || [];
  const total = items.reduce((sum, i) => sum + i.prix * i.quantity, 0).toFixed(2);

  console.log("Commande PayPal:", items);

  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer("return=representation");
  request.requestBody({
    intent: "CAPTURE",
    purchase_units: [{ amount: { currency_code: "EUR", value: total } }],
  });

  try {
    const order = await paypalClient.execute(request);
    res.json({ id: order.result.id });
  } catch (err) {
    console.error("PayPal create order error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------
// CAPTURE PAYPAL ORDER
app.post("/capture-paypal-order", async (req, res) => {
  const { orderId, user, items } = req.body;
  try {
    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});
    const capture = await paypalClient.execute(request);

    await db.collection("commandes").add({
      paypalOrderId: orderId,
      email: user.email,
      montant: capture.result.purchase_units[0].payments.captures[0].amount.value,
      devise: capture.result.purchase_units[0].payments.captures[0].amount.currency_code,
      statut: "payé",
      date: admin.firestore.FieldValue.serverTimestamp(),
      items,
    });

    res.json({ capture });
    console.log("✅ Commande PayPal enregistrée dans Firestore");
  } catch (err) {
    console.error("Capture PayPal error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------
// START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Backend payments running on port ${PORT}`));
