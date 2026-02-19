const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const admin = require("firebase-admin");
const bodyParser = require("body-parser");
const fs = require("fs");

const app = express();
app.use(cors());

// 🔹 Middleware général pour les routes JSON
app.use((req, res, next) => {
  if (req.originalUrl === "/webhook") {
    next(); // webhook ne doit pas parser ici
  } else {
    express.json()(req, res, next);
  }
});

// 🔹 Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// 🔹 Firebase Admin
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(fs.readFileSync("./serviceAccountKey.json", "utf-8"));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const db = admin.firestore();

// 🔹 Route test
app.get("/", (req, res) => res.send("Backend Railway actif ✅"));

// 🔹 Création session Stripe
app.post("/create-checkout-session", async (req, res) => {
  const { cart, userId } = req.body;
  if (!cart || cart.length === 0) return res.status(400).json({ error: "Panier vide" });

  try {
    const metadata = { items: JSON.stringify(cart), userId: userId || "anon" };
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: cart.map(item => ({
        price_data: {
          currency: "eur",
          product_data: { name: item.nom },
          unit_amount: Math.round(item.prix * 100),
        },
        quantity: item.quantity || 1,
      })),
      mode: "payment",
      metadata,
      success_url: "https://monprijet.vercel.app/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://monprijet.vercel.app/panier",
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 🔹 Webhook Stripe
app.post("/webhook", bodyParser.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    console.log("Paiement confirmé :", session.id);
    try {
      const items = session.metadata.items ? JSON.parse(session.metadata.items) : [];
      const userId = session.metadata.userId || "anon";
      await db.collection("orders").doc(session.id).set({
        userId,
        items,
        amount: session.amount_total / 100,
        createdAt: admin.firestore.Timestamp.now(),
      });
      console.log("Commande enregistrée :", session.id);
    } catch (err) {
      console.error("Erreur Firestore :", err.message);
    }
  }

  res.json({ received: true });
});

// 🔹 Démarrage serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));
