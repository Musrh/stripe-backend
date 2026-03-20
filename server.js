import express from "express";
import cors from "cors";
import Stripe from "stripe";
import admin from "firebase-admin";
import paypal from "@paypal/checkout-server-sdk";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// =============================
// 🔥 FIREBASE
// =============================
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// =============================
// 🌍 CORS
// =============================
app.use(
  cors({
    origin: "https://wellshoppings.com",
    methods: ["GET", "POST"],
  })
);

// ======================================================
// 🚨 STRIPE WEBHOOK (DOIT ÊTRE AVANT express.json())
// ======================================================
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

    console.log("✅ Webhook reçu :", event.type);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const items = session.metadata?.items
        ? JSON.parse(session.metadata.items)
        : [];

      const adresse = session.metadata?.adresse
        ? JSON.parse(session.metadata.adresse)
        : {};

      await db.collection("commandes").add({
        stripeSessionId: session.id,
        email: session.customer_details?.email || session.metadata?.email || "",
        adresse: adresse,
        montant: session.amount_total / 100,
        devise: session.currency,
        statut: "payé",
        date: admin.firestore.FieldValue.serverTimestamp(),
        items: items,
        envoyePrintful: false,
      });

      console.log("✅ Commande Stripe enregistrée Firestore");
    }

    res.json({ received: true });
  }
);

// ======================================================
// 🔥 ENSUITE express.json() POUR LE RESTE
// ======================================================
app.use(express.json());

// =============================
// 💳 CREATE STRIPE SESSION
// =============================
app.post("/create-stripe-session", async (req, res) => {
  const { items, email, adresse } = req.body;

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
        items: JSON.stringify(items),      // ⚠️ IMPORTANT
        adresse: JSON.stringify(adresse),  // ⚠️ IMPORTANT
        email: email || "",
      },
      success_url: "https://wellshoppings.com/#/success",
      cancel_url: "https://wellshoppings.com/#/cancel",
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Stripe session error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =============================
// 🅿️ PAYPAL CONFIG
// =============================
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

// =============================
// 🅿️ CREATE PAYPAL ORDER
// =============================
app.post("/create-paypal-order", async (req, res) => {
  const { items } = req.body;

  const total = items
    .reduce((sum, i) => sum + i.prix * i.quantity, 0)
    .toFixed(2);

  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer("return=representation");

  request.requestBody({
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: {
          currency_code: "EUR",
          value: total,
        },
      },
    ],
  });

  try {
    const order = await paypalClient.execute(request);
    res.json({ id: order.result.id });
  } catch (err) {
    console.error("❌ PayPal create order error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =============================
// 🅿️ CAPTURE PAYPAL ORDER
// =============================
app.post("/capture-paypal-order", async (req, res) => {
  const { orderId, items, user, adresse } = req.body;

  try {
    const capture = await paypalClient.execute(
      new paypal.orders.OrdersCaptureRequest(orderId)
    );

    await db.collection("commandes").add({
      paypalOrderId: orderId,
      email: user?.email || "",
      adresse: adresse || {},
      montant:
        capture.result.purchase_units[0].payments.captures[0].amount.value,
      devise:
        capture.result.purchase_units[0].payments.captures[0].amount.currency_code,
      statut: "payé",
      date: admin.firestore.FieldValue.serverTimestamp(),
      items: items,
      envoyePrintful: false,
    });

    console.log("✅ Commande PayPal enregistrée Firestore");

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Capture PayPal error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =============================
// 🚀 START SERVER
// =============================
const PORT = process.env.PORT || 8080;

app.listen(PORT, () =>
  console.log(`🚀 Backend payments running on port ${PORT}`)
);
