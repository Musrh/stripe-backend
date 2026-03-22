import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import paypal from "@paypal/checkout-server-sdk";

dotenv.config();
const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// 🔹 Config PayPal Sandbox / Live
const paypalEnv =
  process.env.PAYPAL_ENV === "production"
    ? new paypal.core.LiveEnvironment(
        process.env.PAYPAL_CLIENT_ID,
        process.env.PAYPAL_CLIENT_SECRET
      )
    : new paypal.core.SandboxEnvironment(
        process.env.PAYPAL_CLIENT_ID,
        process.env.PAYPAL_CLIENT_SECRET
      );

const paypalClient = new paypal.core.PayPalHttpClient(paypalEnv);

// ---------------- CREATE PAYPAL ORDER ----------------
app.post("/create-paypal-order", async (req, res) => {
  try {
    const { items, email, adresseLivraison } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: "Aucun item fourni" });

    const total = items.reduce((sum, i) => sum + i.prix * i.quantity, 0).toFixed(2);

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: { currency_code: "EUR", value: total },
          description: "Commande WellShoppings",
          custom_id: email,
        },
      ],
      application_context: {
        brand_name: "WellShoppings",
        landing_page: "BILLING",
        user_action: "PAY_NOW",
        return_url: process.env.PAYPAL_RETURN_URL, // dynamique
        cancel_url: process.env.PAYPAL_CANCEL_URL, // dynamique
      },
    });

    const order = await paypalClient.execute(request);
    const approveUrl = order.result.links.find((l) => l.rel === "approve").href;

    res.json({ id: order.result.id, approveUrl });
  } catch (err) {
    console.error("❌ PayPal create order error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------- CAPTURE PAYPAL ORDER ----------------
app.post("/capture-paypal-order", async (req, res) => {
  try {
    const { orderId, email, items, adresseLivraison } = req.body;
    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});
    const capture = await paypalClient.execute(request);

    if (capture.result.status === "COMPLETED") {
      console.log(
        "✅ Paiement PayPal capturé:",
        email,
        "Montant:",
        capture.result.purchase_units[0].payments.captures[0].amount.value
      );
      // Ici tu peux enregistrer la commande dans Firestore ou DB
      return res.json({ success: true });
    }

    res.status(400).json({ error: "Paiement non complété" });
  } catch (err) {
    console.error("❌ PayPal capture error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("🚀 PayPal backend démarré sur port", PORT));
