const express = require("express");
const Stripe = require("stripe");
const admin = require("firebase-admin");
const bodyParser = require("body-parser");

const app = express();

// ==========================
// Vérification variables
// ==========================

function checkEnv(name) {
  if (!process.env[name]) {
    console.error(`❌ Variable manquante: ${name}`);
    return false;
  }
  return true;
}

checkEnv("STRIPE_SECRET_KEY");
checkEnv("STRIPE_WEBHOOK_SECRET");
checkEnv("FIREBASE_PROJECT_ID");
checkEnv("FIREBASE_CLIENT_EMAIL");
checkEnv("FIREBASE_PRIVATE_KEY");

// ==========================
// Stripe
// ==========================

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// ==========================
// Firebase
// ==========================

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
      : undefined,
  }),
});

const db = admin.firestore();

// ==========================
// Webhook Stripe
// ==========================

app.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        endpointSecret
      );
    } catch (err) {
      console.error("❌ Signature invalide:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
