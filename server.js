require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const admin = require('firebase-admin');

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ============================
// FIREBASE INIT
// ============================
admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  ),
});

const db = admin.firestore();

// ============================
// CORS pour GitHub Pages
// ============================
app.use(cors({
  origin: "https://musrh.github.io", // ton frontend
}));

// ============================
// WEBHOOK Stripe (avant express.json)
// ============================
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("❌ Erreur signature webhook :", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log("✅ Webhook reçu :", event.type);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      try {
        await db.collection('commandes').add({
          stripeSessionId: session.id,
          email: session.customer_details?.email || null
