// server.js - Backend Stripe + Firestore stable pour Railway
const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const admin = require("firebase-admin");

const app = express();

// ---------------------
// 🔹 Variables d'environnement
// ---------------------
const {
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  FB_PROJECT_ID,
  FB_PRIVATE_KEY_ID,
  FB_PRIVATE_KEY,
  FB_CLIENT_EMAIL,
  FB_CLIENT_ID,
} = process.env;

// Vérification des variables
if (
  !STRIPE_SECRET_KEY ||
  !STRIPE_WEBHOOK_SECRET ||
  !FB_PROJECT_ID ||
  !FB_PRIVATE_KEY_ID ||
  !FB_PRIVATE_KEY ||
  !FB_CLIENT_EMAIL ||
  !FB_CLIENT_ID
) {
  console.error("❌ Une ou plusieurs variables d'environnement sont manquantes !");
  process.exit(1);
}

console.log("✅ Toutes les variables détectées");

// ---------------------
// 🔹 Init Stripe
// ---------------------
const stripe = new Stripe(STRIPE_SECRET_KEY);

// ---------------------
// 🔹 Init Firebase Admin
// ---------------------
try {
  admin.initializeApp({
    credential: admin.credential.cert({
      type: "service_account",
      project_id: FB_PROJECT_ID,
      private_key_id: FB_PRIVATE_KEY_ID,
      private_key: FB_PRIVATE_KEY.replace(/\\n/g, "\n"), // important !
      client_email: FB_CLIENT_EMAIL,
      client_id: FB_CLIENT_ID,
    }),
  });
} catch (err) {
  console.error("❌ Erreur Firebase :", err);
  process.exit(1);
}

const db = admin.firestore();

// ---------------------
// 🔹 Middleware
// ---------------------
app.use(
  cors({
    origin: "https://monprijet.vercel.app", // ou "*" temporairement pour tester
  })
);
app.use(express.json()); // JSON pour toutes les routes sauf webhook

// ---------------------
// 🧪 Route test
// ---------------------
app.get("/", (req, res) => res.send("✅ Backend Railway actif"));

// ---------------------
// 🛒 CREATE CHECKOUT SESSION
// ---------------------
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { cart, userId } = req.body;

    if (!cart || cart.length === 0)
      return res.status(400).json({ error: "Panier vide" });

    const line_items = cart.map((item) => ({
      price_data: {
        currency: "eur",
        product_data: { name: item.nom },
        unit_amount: Math.round(Number(item.prix) * 100),
      },
      quantity: item.quantity || 1,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items,
      mode: "payment",
      metadata: { items: JSON.stringify(cart), userId: userId || "anon" },
      success_url:
        "https://monprijet.vercel.app/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://monprijet.vercel.app/panier",
    });

    console.log("✅ Session Stripe créée :", session.id);
    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Erreur checkout :", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------
// 🔔 WEBHOOK STRIPE
// ---------------------
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("❌ Signature webhook invalide :", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      console.log("💰 Paiement confirmé :", session.id);

      try {
        const items = session.metadata.items
          ? JSON.parse(session.metadata.items)
          : [];
        await db.collection("orders").doc(session.id).set({
          userId: session.metadata.userId || "anon",
          items,
