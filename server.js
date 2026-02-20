const express = require("express");
const Stripe = require("stripe");
const admin = require("firebase-admin");
const bodyParser = require("body-parser");

const app = express();

// ============================
// 🔐 Vérification variables
// ============================

if (
  !process.env.STRIPE_SECRET_KEY ||
  !process.env.STRIPE_WEBHOOK_SECRET ||
  !process.env.FIREBASE_PROJECT_ID ||
  !process.env.FIREBASE_CLIENT_EMAIL ||
  !process.env.FIREBASE_PRIVATE_KEY
) {
  throw new Error("❌ Une variable d'environnement est manquante");
}

// ============================
// 💳 Stripe
// ============================

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// ============================
// 🔥 Firebase
// ============================

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});

const db = admin.firestore();

// ============================
// 🎯 WEBHOOK STRIPE
// ============================

app.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        endpointSecret
      );
    } catch (err) {
      console.error("❌ Signature invalide:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // ✅ Paiement réussi
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      try {
        // Éviter doublon
        const existing = await db.collection("orders").doc(session.id).get();
        if (existing.exists) {
          console.log("⚠️ Commande déjà enregistrée");
          return res.json({ received: true });
        }

        await db.collection("orders").doc(session.id).set({
          stripeSessionId: session.id,
          paymentIntent: session.payment_intent,
          customerEmail: session.customer_details?.email || null,
          amount: session.amount_total / 100,
          currency: session.currency,
          status: "paid",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log("✅ Commande enregistrée dans Firestore");
      } catch (error) {
        console.error("❌ Erreur Firestore:", error);
      }
    }

    res.json({ received: true });
  }
);

// ============================
// 🌍 Route test
// ============================

app.get("/", (req, res) => {
  res.send("🚀 Server OK");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
