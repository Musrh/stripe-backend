const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const admin = require("firebase-admin");

const app = express();
app.use(cors());
app.use(express.json());

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const { FB_PROJECT_ID, FB_PRIVATE_KEY, FB_CLIENT_EMAIL } = process.env;

if (!STRIPE_KEY || !FB_PROJECT_ID || !FB_PRIVATE_KEY || !FB_CLIENT_EMAIL) {
  throw new Error("❌ Variables manquantes !");
}

// Stripe
const stripe = new Stripe(STRIPE_KEY);

// Firebase
admin.initializeApp({
  credential: admin.credential.cert({
    type: "service_account",
    project_id: FB_PROJECT_ID,
    private_key: FB_PRIVATE_KEY, // si multi-ligne
    client_email: FB_CLIENT_EMAIL,
  }),
});

const db = admin.firestore();

// Route test
app.get("/", (req, res) => res.send("✅ Backend Railway actif"));

// Checkout session
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { cart, userId } = req.body;
    if (!cart || cart.length === 0) return res.status(400).json({ error: "Panier vide" });

    const line_items = cart.map(item => ({
      price_data: { currency: "eur", product_data: { name: item.nom }, unit_amount: Math.round(item.prix * 100) },
      quantity: item.quantity || 1,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items,
      mode: "payment",
      metadata: { items: JSON.stringify(cart), userId: userId || "anon" },
      success_url: "https://monprijet.vercel.app/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://monprijet.vercel.app/panier",
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Erreur checkout :", err);
    res.status(500).json({ error: err.message });
  }
});

// Lancement serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server running on port ${PORT}`));
