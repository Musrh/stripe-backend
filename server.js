// server.js
const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const admin = require("firebase-admin");

const app = express();

// -------------------------
// 🔹 Variables d'environnement
// -------------------------
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const {
  FB_PROJECT_ID,
  FB_PRIVATE_KEY,
  FB_CLIENT_EMAIL,
} = process.env;

// -------------------------
// 🔹 Vérification variables
// -------------------------
if (!STRIPE_KEY || !STRIPE_WEBHOOK_SECRET) {
  throw new Error("❌ Variables Stripe manquantes !");
}

if (!FB_PROJECT_ID || !FB_PRIVATE_KEY || !FB_CLIENT_EMAIL) {
  throw new Error("❌ Variables Firebase manquantes !");
}

console.log("✅ Toutes les variables détectées");

// -------------------------
// 🔹 Init Stripe
// -------------------------
const stripe = new Stripe(STRIPE_KEY);

// -------------------------
// 🔹 Init Firebase
// -------------------------
admin.initializeApp({
  credential: admin.credential.cert({
    type: "service_account",
    project_id: FB_PROJECT_ID,
    private_key: FB_PRIVATE_KEY, // ⚠️ Multi-ligne propre dans Railway
    client_email: FB_CLIENT_EMAIL,
  }),
});

const db = admin.firestore();

// -------------------------
// 🔹 Middleware
// -------------------------
app.use(cors({ origin: "https://monprijet.vercel.app" }));
app.use(express.json());

// -------------------------
// 🧪 Route test
// -------------------------
app.get("/", (req, res) => res.send("✅ Backend Railway actif"));

// -------------------------
// 🛒 CREATE CHECKOUT SESSION
// -------------------------
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { cart, userId } = req.body;
    if (!cart || cart.length === 0) return res.status(400).json({ error: "Panier vide" });

    const line_items = cart.map(item => ({
      price_data: {
        currency: "eur",
        product_data: { name: item.nom },
        unit_amount: Math.round(Number(item.prix) * 100),
      },
      quantity: item.quantity ||
