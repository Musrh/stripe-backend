// ================= IMPORTS =================
import express from "express";
import cors from "cors";
import Stripe from "stripe";
import dotenv from "dotenv";
import admin from "firebase-admin";
import bodyParser from "body-parser";

dotenv.config();
const app = express();
app.use(cors({ origin: "*" }));

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

// ================= STRIPE =================
if (!process.env.STRIPE_SECRET_KEY) {
  console.error("❌ STRIPE_SECRET_KEY manquant !");
  process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ================= STRIPE WEBHOOK =================
app.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    try {
      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const metadata = session.metadata
          ? JSON.parse(session.metadata.data)
          : {};

        await db.collection("commandes").add({
          email: session.customer_email,
          items: metadata.items || [],
          montant: session.amount_total / 100,
          adresse: metadata.adresseLivraison || "",
          paymentMethod: "stripe",
          sessionId: session.id,
          status: "paid",
          createdAt: new Date(),
        });

        console.log("✅ Commande Stripe enregistrée");
      }

      res.json({ received: true });
    } catch (err) {
      console.error("❌ Webhook Stripe error:", err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
);

// ⚠️ JSON parser APRÈS webhook
app.use(express.json());

// ================= CREATE STRIPE SESSION =================
app.post("/create-stripe-session", async (req, res) => {
  try {
    const { items, email, adresseLivraison } = req.body;

    if (!items || !items.length) {
      return res.status(400).json({ error: "Panier vide" });
    }

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

  } catch (error) {
    console.error("❌ Stripe session error:", error);
    res.status(500).json({ error: error.message });
  }
});


// ================= ROUTE AFFILIATION =================
app.get("/go/:slug", async (req, res) => {
  try {
    const slug = req.params.slug;

    const snap = await db
      .collection("affiliateProducts")
      .where("slug", "==", slug)
      .limit(1)
      .get();

    if (snap.empty) {
      return res.status(404).send("Produit introuvable");
    }

    const docRef = snap.docs[0];
    const data = docRef.data();

    // 🔥 Compteur clic
    await docRef.ref.update({
      clicks: admin.firestore.FieldValue.increment(1),
    });

    res.redirect(data.affiliateUrl);

  } catch (error) {
    console.error("❌ Erreur affilié:", error);
    res.status(500).send("Erreur serveur");
  }
});


// ================= START =================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log("🚀 Serveur principal WellShoppings sur port", PORT)
);
