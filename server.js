// server.js
import express from "express";
import Stripe from "stripe";
import cors from "cors";

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY); // ta clé secrète

app.use(cors());
app.use(express.json());

// Créer une session Checkout
app.post("/create-checkout-session", async (req, res) => {
  const { items } = req.body; // [{price: "price_xxx", quantity: 1}]

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: items,
      mode: "payment",
      success_url: "https://vitejs-vite-qmttwwvi.vercel.app/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://vitejs-vite-qmttwwvi.vercel.app/cancel",
    });

    res.json({ url: session.url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));