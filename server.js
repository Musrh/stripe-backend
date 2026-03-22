import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Stripe from "stripe";
import admin from "firebase-admin";
import bodyParser from "body-parser";
import paypal from "@paypal/checkout-server-sdk";

dotenv.config();

const app = express();
app.use(cors());

// 🔥 IMPORTANT POUR STRIPE WEBHOOK
app.use(
  "/webhook",
  bodyParser.raw({ type: "application/json" })
);

app.use(express.json());

/* =====================================================
   🔥 FIREBASE
===================================================== */
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
console.log("✅ Firebase connecté");

/* =====================================================
   🔥 STRIPE
===================================================== */
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ✅ Création session Stripe
app.post("/create-stripe-session", async (req, res) => {
  try {
    const { items, email, adresseLivraison } = req.body;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: email,
      line_items: items.map((item) => ({
        price_data: {
          currency: "eur",
          product_data: {
            name: item.nom,
            images: item.images || [],
          },
          unit_amount: item.prix * 100,
        },
        quantity: item.quantity,
      })),
      metadata: {
        data: JSON.stringify({
          items,
          adresseLivraison,
        }),
      },
      success_url:
        "https://wellshoppings.com/#/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://wellshoppings.com/#/cancel",
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("❌ Stripe session error:", error);
    res.status(500).json({ error: "Erreur Stripe" });
  }
});

// ✅ Webhook Stripe sécurisé
app.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Webhook Stripe error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    const metadata = JSON.parse(session.metadata.data);

    await db.collection("commandes").add({
      email: session.customer_email,
      items: metadata.items,
      adresseLivraison: metadata.adresseLivraison,
      montant: session.amount_total / 100,
      paiement: "stripe",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log("✅ Commande Stripe enregistrée");
  }

  res.json({ received: true });
});

/* =====================================================
   🔥 PAYPAL CONFIG DYNAMIQUE
===================================================== */

const isLive = process.env.PAYPAL_ENV === "live";

const paypalEnvironment = isLive
  ? new paypal.core.LiveEnvironment(
      process.env.PAYPAL_CLIENT_ID,
      process.env.PAYPAL_SECRET
    )
  : new paypal.core.SandboxEnvironment(
      process.env.PAYPAL_CLIENT_ID,
      process.env.PAYPAL_SECRET
    );

const paypalClient = new paypal.core.PayPalHttpClient(paypalEnvironment);

console.log(`💳 PayPal mode: ${isLive ? "LIVE" : "SANDBOX"}`);

/* =====================================================
   🔥 CREATE PAYPAL ORDER
===================================================== */

app.post("/create-paypal-order", async (req, res) => {
  try {
    const { items } = req.body;

    const total = items.reduce(
      (sum, item) => sum + item.prix * item.quantity,
      0
    );

    const request = new paypal.orders.OrdersCreateRequest();
    request.requestBody({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: "EUR",
            value: total.toFixed(2),
          },
        },
      ],
    });

    const order = await paypalClient.execute(request);

    res.json({ id: order.result.id });
  } catch (error) {
    console.error("❌ PayPal create error:", error);
    res.status(500).json({ error: "Erreur PayPal create" });
  }
});

/* =====================================================
   🔥 CAPTURE PAYPAL ORDER
===================================================== */

app.post("/capture-paypal-order", async (req, res) => {
  try {
    const { orderId, email, adresseLivraison, items } = req.body;

    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});

    const capture = await paypalClient.execute(request);

    if (capture.result.status === "COMPLETED") {
      const total = items.reduce(
        (sum, item) => sum + item.prix * item.quantity,
        0
      );

      await db.collection("commandes").add({
        email,
        items,
        adresseLivraison,
        montant: total,
        paiement: "paypal",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log("✅ Commande PayPal enregistrée");

      res.json({ success: true });
    } else {
      res.status(400).json({ success: false });
    }
  } catch (error) {
    console.error("❌ PayPal capture error:", error);
    res.status(500).json({ error: "Erreur PayPal capture" });
  }
});

/* =====================================================
   🚀 START SERVER
===================================================== */

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
