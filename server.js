import express from "express";
import cors from "cors";
import Stripe from "stripe";
import dotenv from "dotenv";
import paypal from "@paypal/checkout-server-sdk";
import admin from "firebase-admin";

dotenv.config();

const app = express();
app.use(cors({ origin: "*" }));

// IMPORTANT: Stripe webhook doit être AVANT express.json()
app.post(
  "/stripe-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

      const event = stripe.webhooks.constructEvent(
        req.body,
        req.headers["stripe-signature"],
        process.env.STRIPE_WEBHOOK_SECRET
      );

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const metadata = JSON.parse(session.metadata.data);

        await admin.firestore().collection("commandes").add({
          email: session.customer_email,
          items: metadata.items,
          adresse: metadata.adresseLivraison,
          montant: session.amount_total / 100,
          paymentMethod: "stripe",
          sessionId: session.id,
          status: "paid",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log("✅ Stripe enregistré dans Firestore");
      }

      res.json({ received: true });
    } catch (err) {
      console.error("❌ Webhook Stripe error:", err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
);

// JSON après webhook
app.use(express.json());

/* ================= FIREBASE ================= */

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT manquant");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  ),
});

const db = admin.firestore();
console.log("✅ Firebase connecté");

/* ================= STRIPE ================= */

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
  } catch (err) {
    console.error("❌ Stripe error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= PAYPAL ================= */

if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_SECRET) {
  console.error("❌ PayPal credentials manquants");
}

const paypalEnvironment =
  process.env.PAYPAL_ENV === "production"
    ? new paypal.core.LiveEnvironment(
        process.env.PAYPAL_CLIENT_ID,
        process.env.PAYPAL_SECRET
      )
    : new paypal.core.SandboxEnvironment(
        process.env.PAYPAL_CLIENT_ID,
        process.env.PAYPAL_SECRET
      );

console.log("💳 PayPal mode:", process.env.PAYPAL_ENV?.toUpperCase());

const paypalClient = new paypal.core.PayPalHttpClient(paypalEnvironment);

/* ===== CREATE ORDER ===== */

app.post("/create-paypal-order", async (req, res) => {
  try {
    const { items } = req.body;

    const total = items
      .reduce((sum, item) => sum + item.prix * item.quantity, 0)
      .toFixed(2);

    const request = new paypal.orders.OrdersCreateRequest();
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
      application_context: {
        return_url: "https://wellshoppings.com/#/success",
        cancel_url: "https://wellshoppings.com/#/cancel",
      },
    });

    const order = await paypalClient.execute(request);

    const approveLink = order.result.links.find(
      (link) => link.rel === "approve"
    );

    res.json({
      id: order.result.id,
      approveUrl: approveLink.href,
    });
  } catch (err) {
    console.error("❌ PayPal create error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ===== CAPTURE ORDER ===== */

app.post("/capture-paypal-order", async (req, res) => {
  try {
    const { orderId, email, adresseLivraison, items } = req.body;

    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});

    const capture = await paypalClient.execute(request);

    if (capture.result.status === "COMPLETED") {
      await db.collection("commandes").add({
        email,
        items,
        adresse: adresseLivraison,
        montant:
          capture.result.purchase_units[0].payments.captures[0].amount.value,
        paymentMethod: "paypal",
        orderId,
        status: "paid",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log("✅ PayPal enregistré dans Firestore");
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ PayPal capture error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= START ================= */

const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log("🚀 Backend running on port", PORT)
);
