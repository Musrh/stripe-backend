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
// ⚠️ WEBHOOK STRIPE
// ----------------------------
// ⚡ Pour Stripe webhook, req.body doit être raw (Buffer) pour vérifier la signature
app.use(
  "/webhook",
  express.raw({ type: "application/json" })
);

// ----------------------------
// 🌐 JSON pour toutes les autres routes
// ----------------------------
app.use(express.json());

// ----------------------------
// 🔥 FIREBASE
// ----------------------------
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
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
    console.log(
      `✅ Commande envoyée à Printful avec succès. Printful order ID: ${data.data?.result?.id}`
    );
    return true;
  } catch (err) {
    console.error("❌ Error sending order to Printful:", err.message);
    return false;
  }
}

// ----------------------------
// 🔹 Fonction pour transformer les items et ajouter variant_id
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
      variant_id: variant?.id || item.id, // fallback sur id
      id: undefined, // on supprime id pour éviter confusion
    });
  }
  return transformed;
}

// ----------------------------
// 🔔 STRIPE WEBHOOK
// ----------------------------
app.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body, // ⚠️ req.body brut grâce à express.raw()
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
      const transformedItems = await transformItems(items);

      // 🔹 Enregistrement Firestore
      await db.collection("commandes").add({
        stripeSessionId: session.id,
        email: session.customer_details?.email || session.metadata?.email || null,
        adresse: {
          address1: session.metadata?.adresse1 || "",
          address2: session.metadata?.adresse2 || "",
          ville: session.metadata?.ville || "",
          codePostal: session.metadata?.codePostal || "",
          pays: session.metadata?.pays || "FR",
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
        adresse1: session.metadata?.adresse1 || "",
        adresse2: session.metadata?.adresse2 || "",
        ville: session.metadata?.ville || "",
        codePostal: session.metadata?.codePostal || "",
        pays: session.metadata?.pays || "FR",
        items: transformedItems,
      };
      await sendOrderToPrintful(orderForPrintful);
    } catch (err) {
      console.error("❌ Firestore Stripe error:", err);
    }
  }

  res.json({ received: true });
});

// ----------------------------
// 💳 CREATE STRIPE SESSION
// ----------------------------
app.post("/create-stripe-session", async (req, res) => {
  const { items, adresse, email } = req.body;

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
        ...adresse,
        email,
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
// 🅿️ PAYPAL (création + capture)
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
  const { orderId, user, items, adresse } = req.body;

  try {
    const capture = await paypalClient.execute(
      new paypal.orders.OrdersCaptureRequest(orderId).requestBody({})
    );

    const transformedItems = await transformItems(items);

    await db.collection("commandes").add({
      paypalOrderId: orderId,
      email: user.email,
      adresse,
      montant: capture.result.purchase_units[0].payments.captures[0].amount.value,
      devise: capture.result.purchase_units[0].payments.captures[0].amount.currency_code,
      statut: "payé",
      date: admin.firestore.FieldValue.serverTimestamp(),
      items: transformedItems,
    });
    console.log("✅ Commande PayPal enregistrée avec variant_id");

    const orderForPrintful = {
      nomClient: user.name || user.email || "Client",
      ...adresse,
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
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Backend payments running on port ${PORT}`));
