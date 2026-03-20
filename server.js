import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import paypal from "@paypal/checkout-server-sdk";
import Stripe from "stripe";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Firestore
initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();

// PayPal
const paypalEnv = new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);
const paypalClient = new paypal.core.PayPalHttpClient(paypalEnv);

// Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Créer commande PayPal
app.post("/create-paypal-order", async (req, res) => {
  const { items, email, adresse } = req.body;
  const total = items.reduce((sum, p) => sum + p.prix * p.quantity, 0).toFixed(2);

  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer("return=representation");
  request.requestBody({
    intent: "CAPTURE",
    purchase_units: [{
      amount: { currency_code: "EUR", value: total, breakdown: { item_total: { currency_code: "EUR", value: total } } },
      items: items.map(p => ({ name: p.nom, unit_amount: { currency_code: "EUR", value: p.prix }, quantity: p.quantity })),
      shipping: {
        address: {
          address_line_1: adresse.adresse1,
          address_line_2: adresse.adresse2 || "",
          admin_area_2: adresse.ville,
          postal_code: adresse.codePostal,
          country_code: adresse.pays
        }
      }
    }],
    application_context: { shipping_preference: "SET_PROVIDED_ADDRESS" }
  });

  const order = await paypalClient.execute(request);
  res.json({ id: order.result.id });
});

// Capturer PayPal
app.post("/capture-paypal-order", async (req, res) => {
  const { orderId, items, user, adresse } = req.body;
  const request = new paypal.orders.OrdersCaptureRequest(orderId);
  request.requestBody({});
  const capture = await paypalClient.execute(request);

  // Sauvegarde dans Firestore
  await db.collection("orders").add({
    user: user.email,
    items,
    adresse,
    paymentMethod: "paypal",
    status: "paid",
    date: new Date()
  });

  res.json(capture.result);
});

// Créer session Stripe
app.post("/create-stripe-session", async (req, res) => {
  const { items, email, adresse } = req.body;

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: items.map(p => ({
      price_data: { currency: 'eur', product_data: { name: p.nom }, unit_amount: Math.round(p.prix*100) },
      quantity: p.quantity
    })),
    mode: 'payment',
    success_url: 'https://ton-site.com/success',
    cancel_url: 'https://ton-site.com/cancel',
    customer_email: email,
    metadata: { adresse: JSON.stringify(adresse), items: JSON.stringify(items) }
  });

  res.json({ url: session.url });
});

app.listen(3000, () => console.log("Server running on port 3000"));
