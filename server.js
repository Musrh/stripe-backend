import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import admin from "firebase-admin";
import bodyParser from "body-parser";
import paypal from "@paypal/checkout-server-sdk";

dotenv.config();

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(bodyParser.json());

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

// ================= PAYPAL =================
if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_SECRET) {
  console.error("❌ PayPal credentials manquants !");
}

const paypalEnvironment =
  process.env.PAYPAL_ENV === "production"
    ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_SECRET)
    : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_SECRET);

const paypalClient = new paypal.core.PayPalHttpClient(paypalEnvironment);
console.log(`💳 PayPal mode: ${process.env.PAYPAL_ENV?.toUpperCase() || "SANDBOX"}`);

// --- Stockage temporaire des commandes PayPal ---
const paypalOrdersStore = new Map();

// ================= CREATE PAYPAL ORDER =================
app.post("/create-paypal-order", async (req, res) => {
  try {
    const { items, email, adresseLivraison } = req.body;
    const total = items.reduce((sum, item) => sum + item.prix * item.quantity, 0).toFixed(2);

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: "CAPTURE",
      purchase_units: [{ amount: { currency_code: "EUR", value: total } }],
    });

    const order = await paypalClient.execute(request);

    // Stocker temporairement la commande pour la capture
    paypalOrdersStore.set(order.result.id, { items, email, adresseLivraison });

    // Récupérer URL d’approbation
    const approveUrl = order.result.links.find(l => l.rel === "approve")?.href;

    res.json({ approveUrl });
  } catch (error) {
    console.error("❌ PayPal create order error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ================= CAPTURE PAYPAL ORDER =================
app.post("/capture-paypal-order", async (req, res) => {
  try {
    const { orderId } = req.body;
    const storedOrder = paypalOrdersStore.get(orderId);

    if (!storedOrder) {
      return res.status(400).json({ error: "Commande PayPal introuvable" });
    }

    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});

    const capture = await paypalClient.execute(request);

    if (capture.result.status === "COMPLETED") {
      console.log("✅ Paiement PayPal confirmé");

      await db.collection("commandes").add({
        email: storedOrder.email,
        items: storedOrder.items,
        montant: capture.result.purchase_units[0].payments.captures[0].amount.value,
        adresse: storedOrder.adresseLivraison,
        paymentMethod: "paypal",
        status: "paid",
        orderId,
        createdAt: new Date(),
      });

      // Supprimer de la mémoire après capture
      paypalOrdersStore.delete(orderId);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("❌ PayPal capture error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ================= START SERVER =================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("🚀 Backend running on port", PORT));
