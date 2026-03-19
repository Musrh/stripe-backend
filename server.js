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

// ----------------------------
// 🔹 Transformer les items pour Printful
// ----------------------------
async function transformItems(items) {
  const transformed = [];
  for (const item of items) {
    const produitDoc = await db
      .collection("PrintfulProducts")
      .doc(item.id.toString())
      .get();

    if (!produitDoc.exists) {
      console.warn(`⚠️ Produit Printful introuvable: ${item.nom}`);
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
    }

    transformed.push({
      ...item,
      variant_id: variant?.id || null,
      id: undefined, // supprime id pour éviter confusion
    });
  }
  return transformed;
}

// ----------------------------
// 🔹 Envoyer commande à Printful
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
// 💳 CREATE STRIPE SESSION
// ----------------------------
app.post("/create-stripe-session", async (req, res) => {
  const { items, email, adresseLivraison } = req.body;

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
        email,
        adresseLivraison: JSON.stringify(adresseLivraison),
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
        const items = session.metadata?.items
          ? JSON.parse(session.metadata.items)
          : [];

        const adresseLivraison = session.metadata?.adresseLivraison
          ? JSON.parse(session.metadata.adresseLivraison)
          : {};

        const transformedItems = await transformItems(items);

        // 🔹 Firestore
        await db.collection("commandes").add({
          stripeSessionId: session.id,
          email: session.customer_details?.email || session.metadata?.email || null,
          adresse: {
            address1: adresseLivraison.address1 || "",
            address2: adresseLivraison.address2 || "",
            ville: adresseLivraison.ville || "",
            codePostal: adresseLivraison.codePostal || "",
            pays: adresseLivraison.pays || "",
          },
          montant: session.amount_total / 100,
          devise: session.currency,
          statut: "payé",
          date: admin.firestore.FieldValue.serverTimestamp(),
          items: transformedItems,
        });

        console.log("✅ Commande Stripe enregistrée avec variant_id");

        // 🔹 Envoi à Printful
        const orderForPrintful = {
          nomClient:
            session.customer_details?.name || session.customer_details?.email || "Client",
          adresse: adresseLivraison.address1 || "",
          address2: adresseLivraison.address2 || "",
          ville: adresseLivraison.ville || "",
          codePostal: adresseLivraison.codePostal || "",
          pays: adresseLivraison.pays || "FR",
          items: transformedItems,
        };

        await sendOrderToPrintful(orderForPrintful);
      } catch (err) {
        console.error("❌ Firestore Stripe error:", err);
      }
    }

    res.json({ received: true });
  }
);

// ----------------------------
// 🅿️ PAYPAL
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

app.post("/capture-paypal-order", async (req, res) => {
  const { orderId, user, items, adresseLivraison } = req.body;

  try {
    const capture = await paypalClient.execute(
      new paypal.orders.OrdersCaptureRequest(orderId).requestBody({})
    );

    const transformedItems = await transformItems(items);

    // 🔹 Firestore
    await db.collection("commandes").add({
      paypalOrderId: orderId,
      email: user.email,
      adresse: {
        address1: adresseLivraison.address1 || "",
        address2: adresseLivraison.address2 || "",
        ville: adresseLivraison.ville || "",
        codePostal: adresseLivraison.codePostal || "",
        pays: adresseLivraison.pays || "",
      },
      montant: capture.result.purchase_units[0].payments.captures[0].amount.value,
      devise: capture.result.purchase_units[0].payments.captures[0].amount.currency_code,
      statut: "payé",
      date: admin.firestore.FieldValue.serverTimestamp(),
      items: transformedItems,
    });

    console.log("✅ Commande PayPal enregistrée avec variant_id");

    // 🔹 Envoi à Printful
    const orderForPrintful = {
      nomClient: user.name || user.email || "Client",
      adresse: adresseLivraison.address1 || "",
      address2: adresseLivraison.address2 || "",
      ville: adresseLivraison.ville || "",
      codePostal: adresseLivraison.codePostal || "",
      pays: adresseLivraison.pays || "FR",
      items: transformedItems,
    };

    await sendOrderToPrintful(orderForPrintful);

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
app.listen(PORT, () =>
  console.log(`🚀 Backend payments running on port ${PORT}`)
);
