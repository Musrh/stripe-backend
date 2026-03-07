import express from "express";
const app = express();

app.use(express.json());

/* =========================
   STRIPE
========================= */
app.post("/create-stripe-session", async (req, res) => {

  const { items, email } = req.body;

  try {

    // ton code Stripe existant
    res.json({
      url: "https://checkout.stripe.com/test"
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }

});


/* =========================
   PAYPAL
========================= */
app.post("/create-paypal-order", async (req, res) => {

  const { items, email } = req.body;

  try {

    // logique PayPal (temporaire test)
    res.json({
      url: "https://www.paypal.com/checkoutnow?token=test"
    });

  } catch (err) {

    res.status(500).json({ error: err.message });

  }

});

app.listen(process.env.PORT || 3000);
