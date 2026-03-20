import express from "express";
import cors from "cors";
import Stripe from "stripe";
import admin from "firebase-admin";
import paypal from "@paypal/checkout-server-sdk";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// 🔥 FIREBASE
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// 🔥 CORS
app.use(
  cors({
    origin: "https://wellshoppings.com",
    methods: ["GET", "POST"],
  })
);

// =====================================
// 🚨 WEBHOOK DOIT ÊTRE AVANT express.json()
// =====================================
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body, // ⚠️ RAW BODY
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("⚠️ Webhook signature error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log("✅ Webhook reçu:", event.type);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      await db.collection("commandes").add({
        stripeSessionId: session.id,
        email: session.customer_details?.email || "",
        montant: session.amount_total / 100,
        statut: "payé",
        date: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log("✅ Commande Stripe enregistrée Firestore");
    }

    res.json({ received: true });
  }
);

// =====================================
// 🔥 ENSUITE SEULEMENT express.json()
// =====================================
app.use(express.json());
