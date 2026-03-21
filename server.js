import express from "express";
import cors from "cors";
import Stripe from "stripe";
import dotenv from "dotenv";
import paypal from "@paypal/checkout-server-sdk";

dotenv.config();

const app = express();
app.use(express.json());

// ✅ CORS Railway / Vercel / Github Pages
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

// ================== STRIPE ==================

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.post("/create-stripe-session", async (req, res) => {
  try {
    const { items, email, adresseLivraison } = req.body;

    console.log("Stripe request reçu:", req.body);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      customer_email: email,
      line_items: items.map(item => ({
        price_data: {
          currency: "eur",
          product_data: {
            name: item.nom
          },
          unit_amount: Math.round(item.prix * 100)
        },
        quantity: item.quantity
      })),
      mode: "payment",
      success_url: "https://ton-site.com/success",
      cancel_url: "https://ton-site.com/cancel",
      metadata: {
        adresseLivraison
      }
    });

    res.json({ url: session.url });

  } catch (error) {
    console.error("Stripe error:", error);
    res.status(500).json({ error: error.message });
  }
});


// ================== PAYPAL ==================

const environment = new paypal.core.SandboxEnvironment(
  process.env.PAYPAL_CLIENT_ID,
  process.env.PAYPAL_CLIENT_SECRET
);

const paypalClient = new paypal.core.PayPalHttpClient(environment);

app.post("/create-paypal-order", async (req, res) => {
  try {
    const { items } = req.body;

    console.log("PayPal create order:", req.body);

    const total = items.reduce(
      (sum, item) => sum + item.prix * item.quantity,
      0
    ).toFixed(2);

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");

    request.requestBody({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: "EUR",
            value: total
          }
        }
      ]
    });

    const order = await paypalClient.execute(request);

    res.json({ id: order.result.id });

  } catch (error) {
    console.error("PayPal create error:", error);
    res.status(500).json({ error: error.message });
  }
});


app.post("/capture-paypal-order", async (req, res) => {
  try {
    const { orderId } = req.body;

    console.log("Capture PayPal:", orderId);

    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});

    const capture = await paypalClient.execute(request);

    res.json({ success: true, details: capture.result });

  } catch (error) {
    console.error("PayPal capture error:", error);
    res.status(500).json({ error: error.message });
  }
});


// ================== START SERVER ==================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Serveur démarré sur port", PORT);
});
