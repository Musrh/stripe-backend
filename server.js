import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Stripe from "stripe";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/* =========================
   TEST
========================= */

app.get("/", (req, res) => {
  res.send("Backend Paiement OK");
});


/* =========================
   STRIPE
========================= */

app.post("/create-stripe-session", async (req, res) => {

  try {

    const { items, email } = req.body;

    const session = await stripe.checkout.sessions.create({

      payment_method_types: ["card"],

      line_items: items.map(p => ({
        price_data: {
          currency: "eur",
          product_data: {
            name: p.nom
          },
          unit_amount: Math.round(p.prix * 100)
        },
        quantity: p.quantity
      })),

      mode: "payment",

      success_url: "https://ton-site/success",
      cancel_url: "https://ton-site/panier",

      customer_email: email

    });

    res.json({ url: session.url });

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: err.message });

  }

});


/* =========================
   PAYPAL (simulation test)
========================= */

app.post("/create-paypal-order", async (req, res) => {

  try {

    const { items } = req.body;

    console.log("Commande PayPal:", items);

    // Simulation redirection PayPal
    res.json({
      url: "https://www.paypal.com/checkoutnow?token=test"
    });

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: err.message });

  }

});


/* =========================
   PORT Railway
========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
