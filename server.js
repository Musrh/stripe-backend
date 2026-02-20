const express = require("express");
const Stripe = require("stripe");
const admin = require("firebase-admin");
const bodyParser = require("body-parser");

const app = express();

// =============================
// 🔎 Vérification variables
// =============================

function checkEnv(name) {
  if (!process.env[name]) {
    console.error(`❌ Variable manquante: ${name}`);
    return false;
  }
  return true;
}

const envOk =
  checkEnv("STRIPE_SECRET_KEY") &&
  checkEnv("STRIPE_WEBHOOK_SECRET") &&
  checkEnv("FIREBASE_PROJECT_ID") &&
  checkEnv("FIREBASE_CLIENT_EMAIL") &&
  checkEnv("FIREBASE_PRIVATE_KEY");

if (!envOk) {
  console.error("🚨 Vérifie tes variables Railway !");
}

// =============================
// 💳 Stripe
// =============================

const stripe = process.env.STRIPE_SECRET_KEY
  ? Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// =============================
// 🔥 Firebase
// =============================

if (process.env.FIREBASE_PRIVATE_KEY) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.apps.length ? admin.firestore() : null;

// =============================
// 🎯 Webhook Stripe
// =============================

app.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    if (!stripe || !db) {
