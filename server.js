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
// 🔹 Fonction envoi vers Printful Service
// ----------------------------
async function sendOrderToPrintful(order) {
  try {
    console.log("📤 Envoi vers Printful :", order);

    const response = await fetch(
      "https://printfulpasscommandes-production.up.railway.app/create-order",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ order }),
      }
    );

    const data = await response.json();

    console.log("📥 Réponse Printful Service :", data);

    if (!response.ok || !data.success) {
      console.error("❌ Erreur Printful Service :", data.message);
      return null;
    }

    return data.data?.result?.id || null;
  } catch (err) {
    console.error("❌ Erreur appel Printful :", err.message);
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
      return res.status(400).send(`Webhook Error`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const items = session.metadata?.items
        ? JSON.parse(session.metadata.items)
        : [];

      const orderForPrintful = {
        nomClient: session.customer_details?.name || "Client",
        adresse: session.customer_details?.address?.line1 || "",
        ville: session.customer_details?.address?.city || "",
        pays: session.customer_details?.address?.country || "",
        codePostal: session.customer_details?.address?.postal_code || "",
        items,
      };

      const printfulOrderId = await sendOrderToPrintful(orderForPrintful);

      await db.collection("commandes").add({
        stripeSessionId: session.id,
        email: session.customer_details?.email || null,
        adresseLivraison: session.metadata?.adresseLivraison || "",
        montant: session.amount_total / 100,
        devise: session.currency,
        statut: "payé",
        printfulOrderId,
        date: admin.firestore.FieldValue.serverTimestamp(),
        items,
      });

      console.log("✅ Commande Stripe enregistrée + envoyée à Printful");
    }

    res.json({ received: true });
  }
);

// ----------------------------
// JSON middleware
// ----------------------------
app.use(express.json());

// ----------------------------
// 🅿️ CAPTURE PAYPAL
// ----------------------------
app.post("/capture-paypal-order", async (req, res) => {
  const { orderId, user, items, adresseLivraison } = req.body;

  try {
    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});
    const capture = await paypalClient.execute(request);

    const orderForPrintful = {
      nomClient: user?.name || user?.email || "Client",
      adresse: adresseLivraison || "",
      ville: "",
      pays: "FR",
      codePostal: "",
      items,
    };

    const printfulOrderId = await sendOrderToPrintful(orderForPrintful);

    await db.collection("commandes").add({
      paypalOrderId: orderId,
      email: user?.email || null,
      adresseLivraison,
      montant:
        capture.result.purchase_units[0].payments.captures[0].amount.value,
      devise:
        capture.result.purchase_units[0].payments.captures[0].amount.currency_code,
      statut: "payé",
      printfulOrderId,
      date: admin.firestore.FieldValue.serverTimestamp(),
      items,
    });

    console.log("✅ PayPal enregistré + envoyé à Printful");

    res.json({ success: true });
  } catch (err) {
    console.error("❌ PayPal error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Backend payments running on port ${PORT}`)
);
