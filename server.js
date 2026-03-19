// server.js
import express from "express";
import cors from "cors";
import Stripe from "stripe";
import admin from "firebase-admin";
import paypal from "@paypal/checkout-server-sdk";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

// ----------------------------
// 🔥 FIREBASE
// ----------------------------
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// ----------------------------
// 💳 STRIPE
// ----------------------------
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ----------------------------
// 🅿️ PAYPAL
// ----------------------------
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

// ----------------------------
// 🌍 CORS
// ----------------------------
app.use(
  cors({
    origin: "https://wellshoppings.com",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

// ==========================================================
// 🔹 TRANSFORM ITEMS → AJOUT VARIANT_ID
// ==========================================================
async function transformItems(items) {
  const transformed = [];

  for (const item of items) {
    const produitDoc = await db
      .collection("PrintfulProducts")
      .doc(item.id.toString())
      .get();

    if (!produitDoc.exists) {
      console.warn(`⚠️ Produit introuvable: ${item.nom}`);
      continue;
    }

    const produit = produitDoc.data();

    const variant = produit.variants.find(
      (v) => v.color === item.couleur && v.size === item.taille
    );

    if (!variant) {
      console.warn(
        `⚠️ Variant introuvable pour ${item.nom} - ${item.couleur}/${item.taille}`
      );
      continue;
    }

    transformed.push({
      name: item.nom,
      quantity: item.quantity,
      variant_id: variant.id,
    });
  }

  console.log("📦 Items transformés pour Printful:", transformed);

  return transformed;
}

// ==========================================================
// 🔹 ENVOI À PRINTFUL
// ==========================================================
async function sendOrderToPrintful(order) {
  try {
    console.log("📤 Envoi vers Printful:", order);

    const response = await fetch(
      "https://printfulpasscommandes-production.up.railway.app/create-order",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(order),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ Printful Error:", data);
      return false;
    }

    console.log("✅ Printful confirmation:", data);
    return true;

  } catch (err) {
    console.error("❌ Erreur Printful:", err.message);
    return false;
  }
}

// ==========================================================
// 💳 CREATE STRIPE SESSION
// ==========================================================
app.post("/create-stripe-session", async (req, res) => {
  const { items, adresseLivraison, email } = req.body;

  try {
    const line_items = items.map((i) => ({
      price_data: {
        currency: "eur",
        product_data: { name: i.nom },
        unit_amount: i.prix * 100,
      },
      quantity: i.quantity,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items,
      mode: "payment",
      metadata: {
        items: JSON.stringify(items),
        adresseLivraison: JSON.stringify(adresseLivraison),
        email: email || "",
      },
      success_url: "https://wellshoppings.com/#/success",
      cancel_url: "https://wellshoppings.com/#/cancel",
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error("❌ Stripe error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================================
// 🔔 STRIPE WEBHOOK
// ==========================================================
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
      return res.status(400).send();
    }

    if (event.type === "checkout.session.completed") {

      const session = event.data.object;

      const items = JSON.parse(session.metadata.items || "[]");
      const adresse = JSON.parse(session.metadata.adresseLivraison || "{}");

      const transformedItems = await transformItems(items);

      await db.collection("commandes").add({
        stripeSessionId: session.id,
        email: session.customer_details?.email || session.metadata.email,
        adresseLivraison: adresse,
        montant: session.amount_total / 100,
        devise: session.currency,
        statut: "payé",
        date: admin.firestore.FieldValue.serverTimestamp(),
        items: transformedItems,
      });

      await sendOrderToPrintful({
        recipient: {
          name: adresse.nom,
          address1: adresse.address1,
          address2: adresse.address2 || "",
          city: adresse.city,
          zip: adresse.zip,
          country_code: adresse.country_code,
        },
        items: transformedItems,
      });

      console.log("✅ Stripe → Printful OK");
    }

    res.json({ received: true });
  }
);

// ==========================================================
// 🅿️ CAPTURE PAYPAL
// ==========================================================
app.post("/capture-paypal-order", async (req, res) => {

  const { orderId, user, items, adresseLivraison } = req.body;

  try {
    await paypalClient.execute(
      new paypal.orders.OrdersCaptureRequest(orderId).requestBody({})
    );

    const transformedItems = await transformItems(items);

    await db.collection("commandes").add({
      paypalOrderId: orderId,
      email: user.email,
      adresseLivraison,
      statut: "payé",
      date: admin.firestore.FieldValue.serverTimestamp(),
      items: transformedItems,
    });

    await sendOrderToPrintful({
      recipient: {
        name: adresseLivraison.nom,
        address1: adresseLivraison.address1,
        address2: adresseLivraison.address2 || "",
        city: adresseLivraison.city,
        zip: adresseLivraison.zip,
        country_code: adresseLivraison.country_code,
      },
      items: transformedItems,
    });

    console.log("✅ PayPal → Printful OK");

    res.json({ success: true });

  } catch (err) {
    console.error("❌ PayPal capture error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================================
// 🚀 START SERVER
// ==========================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Backend payments running on port ${PORT}`)
);
