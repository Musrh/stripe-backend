import express from "express";
import cors from "cors";
import Stripe from "stripe";
import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// ⚠️ IMPORTANT : webhook AVANT express.json()
app.use("/webhook", express.raw({ type: "application/json" }));

app.use(express.json());

app.use(
  cors({
    origin: "https://wellshoppings.com",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

// ----------------------------
// 🔥 FIREBASE
// ----------------------------
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ----------------------------
// 💳 STRIPE
// ----------------------------
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// =====================================================
// 🔔 STRIPE WEBHOOK
// =====================================================
app.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("⚠️ Webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    try {
      const items = session.metadata?.items
        ? JSON.parse(session.metadata.items)
        : [];

      const adresse = session.metadata?.adresseLivraison
        ? JSON.parse(session.metadata.adresseLivraison)
        : {};

      await db.collection("commandes").add({
        stripeSessionId: session.id,
        email: session.customer_details?.email || null,
        adresse: {
          address1: adresse.address1 || "",
          address2: adresse.address2 || "",
          ville: adresse.ville || "",
          codePostal: adresse.codePostal || "",
          pays: adresse.pays || "",
        },
        montant: session.amount_total / 100,
        devise: session.currency,
        statut: "payé",
        envoyePrintful: false,
        date: admin.firestore.FieldValue.serverTimestamp(),
        items: items,
      });

      console.log("✅ Commande Stripe enregistrée avec adresse + items");
    } catch (err) {
      console.error("❌ Erreur enregistrement Firestore:", err);
    }
  }

  res.json({ received: true });
});

// =====================================================
// 💳 CREATE STRIPE SESSION
// =====================================================
app.post("/create-stripe-session", async (req, res) => {
  const { items, adresseLivraison, email } = req.body;

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
      metadata: {
        items: JSON.stringify(items),
        adresseLivraison: JSON.stringify(adresseLivraison),
      },
      success_url: "https://wellshoppings.com/#/success",
      cancel_url: "https://wellshoppings.com/#/cancel",
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Stripe session error:", err);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// 🚀 START SERVER
// =====================================================
const PORT = process.env.PORT || 8080;

app.listen(PORT, () =>
  console.log(`🚀 Backend payments running on port ${PORT}`)
);
