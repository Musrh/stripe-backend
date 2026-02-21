require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// ✅ IMPORTANT
app.use(cors());
app.use(express.json());

// ==============================
// CREATE CHECKOUT SESSION
// ==============================
app.post("/create-checkout-session", async (req, res) => {
  try {

    console.log("Données reçues :", req.body);

    const items = req.body.items;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "Panier vide" });
    }

    const line_items = items.map(item => ({
      price_data: {
        currency: "eur",
        product_data: {
          name: item.nom
        },
        unit_amount: item.prix * 100
      },
      quantity: item.quantity
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items,
      success_url: "https://monprijet.vercel.app/success",
      cancel_url: "https://monprijet.vercel.app/cancel"
    });

    console.log("Session créée :", session.id);

    res.json({ url: session.url });

  } catch (error) {
    console.error("ERREUR :", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ==============================
// START SERVER
// ==============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Serveur démarré sur port", PORT);
});
