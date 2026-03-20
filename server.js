import express from "express";
import cors from "cors";
import Stripe from "stripe";
import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();
const app = express();

// Stripe doit être AVANT express.json()
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
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
      return res.status(400).send(`Webhook Error`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const items = JSON.parse(session.metadata.items || "[]");
      const adresse = JSON.parse(session.metadata.adresse || "{}");

      await admin.firestore().collection("commandes").add({
        stripeSessionId: session.id,
        email: session.customer_details?.email,
        adresse: {
          address1: adresse.address1 || "",
          address2: adresse.address2 || "",
          ville: adresse.ville || "",
          codePostal: adresse.codePostal || "",
          pays: adresse.pays || "",
        },
        montant: session.amount_total / 100,
        devise: session.currency,
        statut: "payé",
        envoyePrintful: false,
        date: admin.firestore.FieldValue.serverTimestamp(),
        items,
      });

      console.log("✅ Commande enregistrée avec adresse complète");
    }

    res.json({ received: true });
  }
);

// express.json après webhook
app.use(express.json());

app.use(cors({ origin: "https://wellshoppings.com" }));

// Firebase
admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  ),
});

// CREATE STRIPE SESSION
app.post("/create-stripe-session", async (req, res) => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const { items, adresseLivraison, email } = req.body;

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: items.map((i) => ({
      price_data: {
        currency: "eur",
        product_data: { name: i.nom },
        unit_amount: i.prix * 100,
      },
      quantity: i.quantity,
    })),
    mode: "payment",
    metadata: {
      items: JSON.stringify(items),
      adresse: JSON.stringify(adresseLivraison),
      email,
    },
    success_url: "https://wellshoppings.com/#/success",
    cancel_url: "https://wellshoppings.com/#/cancel",
  });

  res.json({ url: session.url });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log(`🚀 Backend payments running on port ${PORT}`)
);
