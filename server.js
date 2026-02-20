const express = require("express");
const Stripe = require("stripe");
const admin = require("firebase-admin");
const bodyParser = require("body-parser");

const app = express();

// ==========================
// 🔎 Vérification des variables d'environnement
// ==========================

function checkEnv(name) {
  if (!process.env[name]) {
    console.error(`❌ Variable manquante: ${name}`);
    return false;
  }
  return true;
}

const envOk =
  checkEnv("STRIPE_SECRET_KEY") &&
  checkEnv("STRIPE_WEBHOOK_SECRET") &&
  checkEnv("FIREBASE_PROJECT_ID") &&
  checkEnv("FIREBASE_CLIENT_EMAIL") &&
  checkEnv("FIREBASE_PRIVATE_KEY");

if (!envOk) {
  console.error("🚨 Vérifie tes variables Railway !");
}

// ==========================
// 💳 Stripe
// ==========================
const stripe = process.env.STRIPE_SECRET_KEY
  ? Stripe(process.env.STRIPE_SECRET_KEY)
  : null;
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// ==========================
// 🔥 Firebase
// ==========================
if (process.env.FIREBASE_PRIVATE_KEY) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.apps.length ? admin.firestore() : null;

// ==========================
// 🎯 Webhook Stripe
// ==========================
app.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    if (!stripe || !db) {
      return res.status(500).send("Configuration serveur invalide");
    }

    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error("❌ Signature invalide:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      try {
        const orderRef = db.collection("orders").doc(session.id);
        const existing = await orderRef.get();

        if (!existing.exists) {
          await orderRef.set({
            stripeSessionId: session.id,
            paymentIntent: session.payment_intent,
            customerEmail: session.customer_details?.email || null,
            amount: session.amount_total / 100,
            currency: session.currency,
            status: "paid",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log("✅ Commande enregistrée !");
        } else {
          console.log("⚠️ Commande déjà existante");
        }
      } catch (error) {
        console.error("❌ Erreur Firestore:", error);
      }
    }

    res.json({ received: true });
  }
);

// ==========================
// 🌍 Route test
// ==========================
app.get("/", (req, res) => {
  res.send("🚀 Server OK");
});

// ==========================
// 🚀 Lancer le serveur
// ==========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
