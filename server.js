require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const admin = require('firebase-admin');

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// 🔥 FIREBASE INIT
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

const db = admin.firestore();

app.use(cors());
app.use(express.json());

// ✅ CREATE CHECKOUT SESSION
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
            unit_amount: 2000,
          },
          quantity: 1,
        },
      ],
      success_url: 'https://monprijet.vercel.app/success',
      cancel_url: 'https://monprijet.vercel.app/cancel',
    });

    res.json({ url: session.url });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ⚡ WEBHOOK STRIPE
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.log("Webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // 🎉 Paiement réussi
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    try {
      await db.collection('commandes').add({
        stripeSessionId: session.id,
        email: session.customer_details?.email || null,
        montant: session.amount_total,
        devise: session.currency,
        statut: 'payé',
        date: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log("Commande enregistrée !");
    } catch (err) {
      console.error("Erreur Firestore :", err);
    }
  }

  res.json({ received: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Serveur lancé"));
