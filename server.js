// server.js
const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const admin = require("firebase-admin");

const app = express();
app.use(cors());

// ==========================
// 🔐 STRIPE
// ==========================
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY manquante !");
}
if (!process.env.STRIPE_WEBHOOK_SECRET) {
  throw new Error("STRIPE_WEBHOOK_SECRET manquante !");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ==========================
// 🔥 FIREBASE ADMIN
// ==========================
if (
  !process.env.FB_PROJECT_ID ||
  !process.env.FB_PRIVATE_KEY_ID ||
  !process.env.FB_PRIVATE_KEY ||
  !process.env.FB_CLIENT_EMAIL ||
  !process.env.FB_CLIENT_ID
) {
  throw new Error("Une ou plusieurs variables Firebase manquent !");
}

admin.initializeApp({
  credential: admin.credential.cert({
    type: "service_account",
    project_id: process.env.FB_PROJECT_ID,
    private_key_id: process.env.FB_PRIVATE_KEY_ID,
    private_key: process.env.FB_PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: process.env.FB_CLIENT_EMAIL,
    client_id: process.env.FB_CLIENT_ID,
  }),
});

const db = admin.firestore();

// ==========================
// 🧪 ROUTE TEST
// ==========================
app.get("/", (req, res) => {
  res.send("Backend Railway actif ✅");
});

// ==========================
// 🛒 CREATE CHECKOUT SESSION
// ==========================
app.post("/create-checkout-session", express.json(), async (req, res) => {
  try {
    const { cart, userId } = req.body;

    if (!cart || cart.length === 0) {
      return res.status(400).json({ error: "Panier vide" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: cart.map((item) => ({
        price_data: {
          currency: "eur",
          product_data: { name: item.nom },
          unit_amount: Math.round(item.prix * 100),
        },
        quantity: item.quantity || 1,
      })),
      mode: "payment",
      metadata: {
        items: JSON.stringify(cart),
        userId: userId || "anon",
      },
      success_url:
        "https://monprijet.vercel.app/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://monprijet.vercel.app/panier",
    });

    console.log("✅ Session Stripe créée :", session.id);
    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Erreur création session:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// 🔔 WEBHOOK STRIPE
// ==========================
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
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("❌ Webhook signature invalide :", err.message);
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
          amount: session.amount_total / 100,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log("📦 Commande enregistrée dans Firestore :", session.id);
      } catch (err) {
        console.error("❌ Erreur Firestore :", err);
      }
    }

    res.json({ received: true });
  }
);

// ==========================
// 🚀 START SERVER
// ==========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
