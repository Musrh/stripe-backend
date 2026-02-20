// server.js minimaliste pour debug Railway
const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const admin = require("firebase-admin");

const app = express();
app.use(cors());

// ==========================
// 🔹 Vérification variables Stripe
// ==========================
const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

console.log("🔹 Vérification Stripe variables");
console.log("STRIPE_SECRET_KEY :", !!stripeKey);
console.log("STRIPE_WEBHOOK_SECRET :", !!stripeWebhookSecret);

if (!stripeKey || !stripeWebhookSecret) {
  throw new Error("❌ Variables Stripe manquantes !");
}

const stripe = new Stripe(stripeKey);

// ==========================
// 🔹 Vérification variables Firebase
// ==========================
const {
  FB_PROJECT_ID,
  FB_PRIVATE_KEY_ID,
  FB_PRIVATE_KEY,
  FB_CLIENT_EMAIL,
  FB_CLIENT_ID,
} = process.env;

console.log("🔹 Vérification Firebase variables");
console.log("FB_PROJECT_ID :", !!FB_PROJECT_ID);
console.log("FB_PRIVATE_KEY_ID :", !!FB_PRIVATE_KEY_ID);
console.log("FB_PRIVATE_KEY :", !!FB_PRIVATE_KEY);
console.log("FB_CLIENT_EMAIL :", !!FB_CLIENT_EMAIL);
console.log("FB_CLIENT_ID :", !!FB_CLIENT_ID);

if (!FB_PROJECT_ID || !FB_PRIVATE_KEY_ID || !FB_PRIVATE_KEY || !FB_CLIENT_EMAIL || !FB_CLIENT_ID) {
  throw new Error("❌ Une ou plusieurs variables Firebase manquent !");
}

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

// ==========================
// 🧪 ROUTE TEST
// ==========================
app.get("/", (req, res) => res.send("✅ Backend Railway actif"));

// ==========================
// 🚀 Lancement serveur
// ==========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
