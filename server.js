require('dotenv').config();

const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(cors());
app.use(express.json());

app.post('/create-checkout-session', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: 'Produit test',
            },
            unit_amount: 2000, // 20.00 €
          },
          quantity: 1,
        },
      ],
      success_url: 'https://monprijet.vercel.app/success',
      cancel_url: 'https://monprijet.vercel.app/cancel',
    });

    // ✅ NOUVELLE MÉTHODE 2026
    res.json({ url: session.url });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
