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

// ----------------------------
// 🔹 Fonction pour envoyer commande à Printful
// ----------------------------
async function sendOrderToPrintful(order) {
  try {
    const response = await fetch(
      "https://printfulpasscommandes-production.up.railway.app/create-order",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order }),
      }
    );

    const data = await response.json();

    if (!response.ok || !data.success) {
      console.error("❌ Printful order failed:", data.message || data);
      return false;
    }

    console.log("✅ Commande envoyée à Printful:", data.data);
    return true;
  } catch (err) {
    console.error("❌ Error sending order to Printful:", err.message);
    return false;
  }
}

// ----------------------------
// 🔹 Fonction pour récupérer variant_id si produit Printful
async function getVariantId(productId, size, color) {
  try {
    const doc = await db.collection("PrintfulProducts").doc(String(productId)).get();
    if (!doc.exists) return null;

    const product = doc.data();
    const variant = product.variants.find(
      v => v.size === size && v.color === color
    );
    return variant ? variant.id : null;
  } catch (err) {
    console.error("❌ Erreur getVariantId:", err);
    return null;
  }
}

// ----------------------------
// 🔔 STRIPE WEBHOOK
// ----------------------------
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
      console.error("⚠️ Webhook signature error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      try {
        const itemsRaw = session.metadata?.items
          ? JSON.parse(session.metadata.items)
          : [];

        // 🔹 Cherche variant_id pour chaque produit Printful
        const items = await Promise.all(
          itemsRaw.map(async i => {
            if (i.source === "Printful") {
              const variant_id = await getVariantId(i.id, i.taille, i.couleur);
              return { ...i, variant_id };
            }
            return i;
          })
        );

        // 🔹 Enregistrement dans Firestore
        await db.collection("commandes").add({
          stripeSessionId: session.id,
          email: session.customer_details?.email || session.metadata?.email || null,
          adresseLivraison: session.metadata?.adresseLivraison || "",
          montant: session.amount_total / 100,
          devise: session.currency,
          statut: "payé",
          date: admin.firestore.FieldValue.serverTimestamp(),
          items,
        });
        console.log("✅ Commande Stripe enregistrée avec adresse");

        // 🔹 Envoi à Printful si produits Printful
        const printfulItems = items.filter(i => i.source === "Printful" && i.variant_id);
        if (printfulItems.length > 0) {
          const orderForPrintful = {
            nomClient: session.customer_details?.name || "Client",
            adresse: session.customer_details?.address?.line1 || "",
            ville: session.customer_details?.address?.city || "",
            pays: session.customer_details?.address?.country || "FR",
            codePostal: session.customer_details?.address?.postal_code || "",
            items: printfulItems.map(i => ({
              variant_id: i.variant_id,
              quantity: i.quantity
            })),
          };
          await sendOrderToPrintful(orderForPrintful);
        }

      } catch (err) {
        console.error("❌ Firestore Stripe error:", err);
      }
    }

    res.json({ received: true });
  }
);

// ----------------------------
// JSON Middleware (après webhook)
app.use(express.json());

// ----------------------------
// 💳 CREATE STRIPE SESSION
// ----------------------------
app.post("/create-stripe-session", async (req, res) => {
  const { items, adresseLivraison, email } = req.body;

  try {
    const line_items = items.map(i => ({
      price_data: { currency: "eur", product_data: { name: i.nom }, unit_amount: i.prix * 100 },
      quantity: i.quantity,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items,
      mode: "payment",
      metadata: {
        items: JSON.stringify(items),
        adresseLivraison: adresseLivraison || "",
        email: email || "",
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

// ----------------------------
// 🅿️ CREATE PAYPAL ORDER
// ----------------------------
app.post("/create-paypal-order", async (req, res) => {
  const { items } = req.body;

  const total = items.reduce((sum, i) => sum + i.prix * i.quantity, 0).toFixed(2);

  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer("return=representation");
  request.requestBody({
    intent: "CAPTURE",
    purchase_units: [{ amount: { currency_code: "EUR", value: total } }],
  });

  try {
    const order = await paypalClient.execute(request);
    res.json({ id: order.result.id });
  } catch (err) {
    console.error("❌ PayPal create order error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------
// 🅿️ CAPTURE PAYPAL ORDER
// ----------------------------
app.post("/capture-paypal-order", async (req, res) => {
  const { orderId, user, items, adresseLivraison } = req.body;

  try {
    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});
    const capture = await paypalClient.execute(request);

    // 🔹 Cherche variant_id pour produits Printful
    const itemsWithVariant = await Promise.all(
      items.map(async i => {
        if (i.source === "Printful") {
          const variant_id = await getVariantId(i.id, i.taille, i.couleur);
          return { ...i, variant_id };
        }
        return i;
      })
    );

    await db.collection("commandes").add({
      paypalOrderId: orderId,
      email: user.email,
      adresseLivraison: adresseLivraison || "",
      montant: capture.result.purchase_units[0].payments.captures[0].amount.value,
      devise: capture.result.purchase_units[0].payments.captures[0].amount.currency_code,
      statut: "payé",
      date: admin.firestore.FieldValue.serverTimestamp(),
      items: itemsWithVariant,
    });
    console.log("✅ Commande PayPal enregistrée avec adresse");

    // 🔹 Envoi à Printful si produits Printful
    const printfulItems = itemsWithVariant.filter(i => i.source === "Printful" && i.variant_id);
    if (printfulItems.length > 0) {
      const orderForPrintful = {
        nomClient: user.name || user.email || "Client",
        adresse: adresseLivraison || "",
        ville: "", // optionnel
        pays: "FR", // par défaut
        codePostal: "",
        items: printfulItems.map(i => ({ variant_id: i.variant_id, quantity: i.quantity })),
      };
      await sendOrderToPrintful(orderForPrintful);
    }

    res.json({ success: true });

  } catch (err) {
    console.error("❌ Capture PayPal error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------
// 🚀 START SERVER
// ----------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Backend payments running on port ${PORT}`));
