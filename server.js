// server.js complet pour Railway (Stripe + Firestore)
const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const admin = require("firebase-admin");

const app = express();
app.use(cors());

// ==========================
// 🔹 Vérification variables
// ==========================
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const {
  FB_PROJECT_ID,
  FB_PRIVATE_KEY_ID,
  FB_PRIVATE_KEY,
  FB_CLIENT_EMAIL,
  FB_CLIENT_ID,
} = process.env;

console.log("🔹 Vérification variables...");
console.log("STRIPE_KEY :", !!STRIPE_KEY);
console.log("STRIPE_WEBHOOK_SECRET :", !!STRIPE_WEBHOOK_SECRET);
console.log("FB_PROJECT_ID :", !!FB_PROJECT_ID);
console.log("FB_PRIVATE_KEY_ID :", !!FB_PRIVATE_KEY_ID);
console.log("FB_PRIVATE_KEY :", !!FB_PRIVATE_KEY);
console.log("FB_CLIENT_EMAIL :", !!FB_CLIENT_EMAIL);
console.log("FB_CLIENT_ID :", !!FB_CLIENT_ID);

if (!STRIPE_KEY || !STRIPE_WEBHOOK_SECRET)
  throw new Error("❌ Variables Stripe manquantes !");
if (!FB_PROJECT_ID || !FB_PRIVATE_KEY_ID || !FB_PRIVATE_KEY || !FB_CLIENT_EMAIL || !FB_CLIENT_ID)
  throw new Error("❌ Une ou plusieurs variables Firebase manquent !");

// ==========================
// 🔹 Init Stripe et Firebase
// ==========================
const stripe = new Stripe(STRIPE_KEY);

admin.initializeApp({
  credential: admin.credential.cert({
    type: "service_account",
    project_id: FB_PROJECT_ID,
    private_key_id: FB_PRIVATE_KEY_ID,
    private_key: FB_PRIVATE_KEY.replace(/\\n/g, "\n"), // conversion des \n
    client_email: FB_CLIENT_EMAIL,
    client_id: FB_CLIENT_ID,
  }),
});

const db = admin.firestore();

// ==========================
// 🧪 Route test
// ==========================
app.get("/", (req, res) => res.send("✅ Backend Railway actif"));

// ==========================
// 🛒 CREATE CHECKOUT SESSION
// ==========================
app.post("/create-checkout-session", express.json(), async (req, res) => {
  try {
    const { cart, userId } = req.body;
    if (!cart || cart.length === 0) return res.status(400).json({ error: "Panier vide" });

    const line_items = cart.map(item => {
      const amount = Math.round(Number(item.prix) * 100);
      if (isNaN(amount)) throw new Error("Prix invalide pour " + item.nom);
      return {
        price_data: {
          currency: "eur",
          product_data: { name: item.nom },
          unit_amount: amount,
        },
        quantity: item.quantity || 1,
      };
    });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items,
      mode: "payment",
      metadata: { items: JSON.stringify(cart), userId: userId || "anon" },
      success_url: "https://monprijet.vercel.app/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://monprijet.vercel.app/panier",
    });

    console.log("✅ Session Stripe créée :", session.id);
    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Erreur checkout :", err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// 🔔 WEBHOOK STRIPE
// ==========================
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("❌ Signature webhook invalide :", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    console.log("💰 Paiement confirmé :", session.id);

    try {
      const items = session.metadata.items ? JSON.parse(session.metadata.items) : [];
      await db.collection("orders").doc(session.id).set({
        userId: session.metadata.userId || "anon",
        items,
