import express from "express";
import cors from "cors";
import Stripe from "stripe";
import admin from "firebase-admin";
import paypal from "@paypal/checkout-server-sdk";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

// 🔹 FIREBASE
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// 🔹 STRIPE
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// 🔹 PAYPAL
const paypalEnv =
  process.env.PAYPAL_ENV === "live"
    ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_SECRET)
    : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_SECRET);
const paypalClient = new paypal.core.PayPalHttpClient(paypalEnv);

// 🔹 CORS
app.use(cors({ origin: "https://wellshoppings.com", methods: ["GET", "POST"], allowedHeaders: ["Content-Type"] }));

// 🔹 CREATE STRIPE SESSION
app.post("/create-stripe-session", async (req, res) => {
  const { items, email, adresseLivraison } = req.body;
  try {
    const line_items = items.map((i) => ({
      price_data: { currency: "eur", product_data: { name: i.nom }, unit_amount: i.prix * 100 },
      quantity: i.quantity,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items,
      mode: "payment",
      metadata: { items: JSON.stringify(items), email, adresseLivraison: JSON.stringify(adresseLivraison) },
      success_url: "https://wellshoppings.com/#/success",
      cancel_url: "https://wellshoppings.com/#/cancel",
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Stripe session error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🔹 CREATE PAYPAL ORDER
app.post("/create-paypal-order", async (req, res) => {
  const { items, adresseLivraison, email } = req.body;
  const total = items.reduce((sum, i) => sum + i.prix * i.quantity, 0).toFixed(2);

  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer("return=representation");
  request.requestBody({ intent: "CAPTURE", purchase_units: [{ amount: { currency_code: "EUR", value: total } }] });

  try {
    const order = await paypalClient.execute(request);
    // 🔹 Firestore enregistrement
    await db.collection("commandes").add({ email, adresseLivraison, items, montant: total, statut: "en attente", date: admin.firestore.FieldValue.serverTimestamp() });
    res.json({ id: order.result.id });
  } catch (err) {
    console.error("❌ PayPal create order error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🔹 CAPTURE PAYPAL ORDER
app.post("/capture-paypal-order", async (req, res) => {
  const { orderId, items, user, adresseLivraison } = req.body;
  try {
    const capture = await paypalClient.execute(new paypal.orders.OrdersCaptureRequest(orderId).requestBody({}));
    await db.collection("commandes").add({
      paypalOrderId: orderId,
      email: user.email,
      adresseLivraison,
      items,
      montant: capture.result.purchase_units[0].payments.captures[0].amount.value,
      devise: capture.result.purchase_units[0].payments.captures[0].amount.currency_code,
      statut: "payé",
      date: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ success: true });
  } catch (err) {
    console.error("❌ PayPal capture error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🚀 START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Backend payments running on port ${PORT}`));
