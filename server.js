import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import paypal from "@paypal/checkout-server-sdk";

dotenv.config();
const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// ✅ Config PayPal
const paypalEnv =
  process.env.PAYPAL_ENV === "production"
    ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
    : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);

const paypalClient = new paypal.core.PayPalHttpClient(paypalEnv);

// 🔹 Créer ordre PayPal
app.post("/create-paypal-order", async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: "Aucun item fourni" });

    const total = items.reduce((sum, i) => sum + i.prix * i.quantity, 0).toFixed(2);

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: "CAPTURE",
      purchase_units: [{ amount: { currency_code: "EUR", value: total } }],
    });

    const order = await paypalClient.execute(request);
    const approveUrl = order.result.links.find(l => l.rel === "approve").href;

    res.json({ id: order.result.id, approveUrl });
  } catch (err) {
    console.error("❌ PayPal create order error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🔹 Capturer ordre PayPal
app.post("/capture-paypal-order", async (req, res) => {
  try {
    const { orderId, email, items } = req.body;
    if (!orderId) return res.status(400).json({ error: "orderId manquant" });

    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});
    const capture = await paypalClient.execute(request);

    if (capture.result.status === "COMPLETED") {
      console.log("✅ Paiement PayPal complété pour", email);
      res.json({ success: true, capture });
    } else {
      res.status(400).json({ error: "Paiement non complété" });
    }
  } catch (err) {
    console.error("❌ PayPal capture error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(8080, () => console.log("🚀 Backend PayPal en route sur port 8080"));
