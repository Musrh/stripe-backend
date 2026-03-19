// ===============================
// 🚀 SERVER PRODUCTION FINAL
// ===============================

import express from "express";
import cors from "cors";
import Stripe from "stripe";
import admin from "firebase-admin";
import paypal from "@paypal/checkout-server-sdk";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// ===============================
// 🔥 FIREBASE
// ===============================
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ===============================
// 💳 STRIPE
// ===============================
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ===============================
// 🅿️ PAYPAL
// ===============================
const paypalEnv =
  process.env.PAYPAL_ENV === "live"
    ? new paypal.core.LiveEnvironment(
        process.env.PAYPAL_CLIENT_ID,
        process.env.PAYPAL_SECRET
      )
    : new paypal.core.SandboxEnvironment(
        process.env.PAYPAL_CLIENT_ID,
        process.env.PAYPAL_SECRET
      );

const paypalClient = new paypal.core.PayPalHttpClient(paypalEnv);

// ===============================
// 🌍 CORS
// ===============================
app.use(
  cors({
    origin: "https://wellshoppings.com",
    methods: ["GET", "POST"],
  })
);

// =======================================================
// ⚠️ STRIPE WEBHOOK (RAW BODY OBLIGATOIRE)
// =======================================================
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("⚠️ Webhook error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log("✅ Webhook Stripe vérifié");

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      try {
        const items = JSON.parse(session.metadata.items || "[]");

        const transformedItems = await transformItems(items);

        const orderData = {
          stripeSessionId: session.id,
          email: session.customer_details?.email || null,
          montant: session.amount_total / 100,
          devise: session.currency,
          statut: "payé",
          date: admin.firestore.FieldValue.serverTimestamp(),
          items: transformedItems,

          // 🔥 Nouvelle adresse structurée
          adresse: {
            address1: session.metadata.address1 || "",
            address2: session.metadata.address2 || "",
            ville: session.metadata.ville || "",
            codePostal: session.metadata.codePostal || "",
            pays: session.metadata.pays || "",
          },
        };

        await db.collection("commandes").add(orderData);
        console.log("✅ Commande Stripe enregistrée");

        await sendOrderToPrintful(orderData);

      } catch (err) {
        console.error("❌ Erreur traitement Stripe:", err);
      }
    }

    res.json({ received: true });
  }
);

// ===============================
// JSON POUR LES AUTRES ROUTES
// ===============================
app.use(express.json());

// ===============================
// 🔹 TRANSFORM ITEMS → VARIANT_ID
// ===============================
async function transformItems(items) {
  const transformed = [];

  for (const item of items) {
    const produitDoc = await db
      .collection("PrintfulProducts")
      .doc(item.id.toString())
      .get();

    if (!produitDoc.exists) continue;

    const produit = produitDoc.data();

    const variant = produit.variants.find(
      (v) =>
        v.color === item.couleur &&
        v.size === item.taille
    );

    transformed.push({
      nom: item.nom,
      quantity: item.quantity,
      variant_id: variant?.id || null,
    });
  }

  return transformed;
}

// ===============================
// 🔹 ENVOI À PRINTFUL
// ===============================
async function sendOrderToPrintful(order) {
  try {
    const response = await fetch(
      "https://printfulpasscommandes-production.up.railway.app/sendtoprintful/test",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(order),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ Printful error:", data);
      return false;
    }

    console.log("✅ Commande envoyée à Printful");
    return true;

  } catch (err) {
    console.error("❌ Printful exception:", err.message);
    return false;
  }
}

// ===============================
// 💳 CREATE STRIPE SESSION
// ===============================
app.post("/create-stripe-session", async (req, res) => {
  const {
    items,
    email,
    address1,
    address2,
    ville,
    codePostal,
    pays
  } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: items.map(i => ({
        price_data: {
          currency: "eur",
          product_data: { name: i.nom },
          unit_amount: i.prix * 100,
        },
        quantity: i.quantity,
      })),
      metadata: {
        items: JSON.stringify(items),
        email,
        address1,
        address2,
        ville,
        codePostal,
        pays
      },
      success_url: "https://wellshoppings.com/#/success",
      cancel_url: "https://wellshoppings.com/#/cancel",
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error("❌ Stripe session error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// 🚀 START SERVER
// ===============================
const PORT = process.env.PORT || 8080;

app.listen(PORT, () =>
  console.log(`🚀 Backend payments running on port ${PORT}`)
);
