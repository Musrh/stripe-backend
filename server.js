// server.js
import express from "express";
import cors from "cors";
import Stripe from "stripe";
import dotenv from "dotenv";
import paypal from "@paypal/checkout-server-sdk";
import admin from "firebase-admin";
import bodyParser from "body-parser";

dotenv.config();
const app = express();
app.use(cors({ origin: "*" }));

// ================= FIREBASE =================
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT manquant !");
  process.exit(1);
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
console.log("✅ Firebase connecté");

// ================= STRIPE =================
if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
  console.error("❌ Stripe keys manquantes !");
  process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ---------------- Webhook Stripe ----------------
// ⚠️ bodyParser.raw pour le webhook uniquement
app.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    try {
      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const metadata = session.metadata ? JSON.parse(session.metadata.data) : {};

        await db.collection("commandes").add({
          email: session.customer_email,
          items: metadata.items || [],
          montant: session.amount_total / 100,
          adresse: metadata.adresseLivraison || "",
          paymentMethod: "stripe",
          sessionId: session.id,
          status: "paid",
          createdAt: new Date(),
        });

        console.log("✅ Commande Stripe confirmée dans Firestore");
      }

      res.json({ received: true });
    } catch (err) {
      console.error("❌ Webhook Stripe error:", err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
);

// ================= Autres routes JSON =================
app.use(express.json()); // Pour toutes les autres routes

// Création session Stripe
app.post("/create-stripe-session", async (req, res) => {
  try {
    const { items, email, adresseLivraison } = req.body;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      customer_email: email,
      line_items: items.map((item) => ({
        price_data: {
          currency: "eur",
          product_data: { name: item.nom },
          unit_amount: Math.round(item.prix * 100),
        },
        quantity: item.quantity,
      })),
      mode: "payment",
      success_url:
        "https://wellshoppings.com/#/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://wellshoppings.com/#/cancel",
      metadata: {
        data: JSON.stringify({ items, adresseLivraison }),
      },
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("❌ Erreur création session Stripe :", error);
    res.status(500).json({ error: error.message });
  }
});

// ================= PAYPAL =================
if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
  console.error("❌ PayPal credentials manquants !");
}

const paypalEnvironment =
  process.env.PAYPAL_ENV === "production"
    ? new paypal.core.LiveEnvironment(
        process.env.PAYPAL_CLIENT_ID,
        process.env.PAYPAL_CLIENT_SECRET
      )
    : new paypal.core.SandboxEnvironment(
        process.env.PAYPAL_CLIENT_ID,
        process.env.PAYPAL_CLIENT_SECRET
      );

const paypalClient = new paypal.core.PayPalHttpClient(paypalEnvironment);

// Création ordre PayPal
app.post("/create-paypal-order", async (req, res) => {
  try {
    const { items } = req.body;
    const total = items
      .reduce((sum, item) => sum + item.prix * item.quantity, 0)
      .toFixed(2);

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: "CAPTURE",
      purchase_units: [{ amount: { currency_code: "EUR", value: total } }],
    });

    const order = await paypalClient.execute(request);
    res.json({ id: order.result.id, approveUrl: order.result.links.find(l => l.rel === "approve").href });
  } catch (error) {
    console.error("❌ PayPal create order error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Capture ordre PayPal
app.post("/capture-paypal-order", async (req, res) => {
  try {
    const { orderId, email, adresseLivraison, items } = req.body;

    if (!items || items.length === 0) {
      console.warn("⚠️ Aucun item reçu pour cette commande PayPal !");
    }

    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});
    const capture = await paypalClient.execute(request);

    if (capture.result.status === "COMPLETED") {
      console.log("✅ Paiement PayPal confirmé");

      await db.collection("commandes").add({
        email,
        items: items || [],
        montant: capture.result.purchase_units[0].payments.captures[0].amount.value,
        adresse: adresseLivraison,
        paymentMethod: "paypal",
        status: "paid",
        createdAt: new Date(),
      });

      console.log("✅ Commande PayPal enregistrée dans Firestore");
    }

    res.json({ success: true });
  } catch (error) {
    console.error("❌ PayPal capture error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ================= START =================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("🚀 Serveur démarré sur port", PORT));
