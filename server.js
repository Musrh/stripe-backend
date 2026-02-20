// server.js - Stripe + Firestore (Railway)
const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const admin = require("firebase-admin");

const app = express();

// ---------------------
// 🔹 Variables d'environnement
// ---------------------
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const {
  FB_PROJECT_ID,
  FB_PRIVATE_KEY_ID,
  FB_PRIVATE_KEY,
  FB_CLIENT_EMAIL,
  FB_CLIENT_ID,
} = process.env;

// Vérification des variables
if (!STRIPE_KEY || !STRIPE_WEBHOOK_SECRET)
  throw new Error("❌ Variables Stripe manquantes !");
if (!FB_PROJECT_ID || !FB_PRIVATE_KEY_ID || !FB_PRIVATE_KEY || !FB_CLIENT_EMAIL || !FB_CLIENT_ID)
  throw new Error("❌ Une ou plusieurs variables Firebase manquent !");

console.log("✅ Toutes les variables détectées");

// ---------------------
// 🔹 Init Stripe et Firebase
// ---------------------
const stripe = new Stripe(STRIPE_KEY);

admin.initializeApp({
  credential: admin.credential.cert({
    type: "service_account",
    project_id: FB_PROJECT_ID,
    private_key_id: FB_PRIVATE_KEY_ID,
    private_key: FB_PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: FB_CLIENT_EMAIL,
    client_id: FB_CLIENT_ID,
  }),
});

const db = admin.firestore();

// ---------------------
// 🔹 Middleware
// ---------------------
app.use(cors());
app.use(express.json()); // pour POST /create-checkout-session

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

    const line_items = cart.map((item) => {
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
      success_url:
        "https://monprijet.vercel.app/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://monprijet.vercel.app/panier",
