// server.js - Backend complet Stripe + Affiliation
import express from "express";
import cors from "cors";
import Stripe from "stripe";
import dotenv from "dotenv";
import admin from "firebase-admin";
import bodyParser from "body-parser";

dotenv.config();
const app = express();
app.use(cors({ origin: "*" }));

// 🔹 Pour toutes les routes sauf webhook
app.use((req, res, next) => {
  if (req.originalUrl === "/webhook") return next();
  express.json()(req, res, next);
});

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

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2023-08-16" });

// ---------------- Webhook Stripe ----------------
app.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }), // ❗ raw body obligatoire
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
        const metadata = session.metadata?.data ? JSON.parse(session.metadata.data) : {};

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

        console.log("✅ Commande Stripe confirmée dans Firestore");
      }

      res.json({ received: true });
    } catch (err) {
      console.error("❌ Webhook Stripe error:", err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
);

// ================= CRÉATION SESSION STRIPE =================
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
      success_url: `${process.env.FRONTEND_URL}/#/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/#/cancel`,
      metadata: {
        data: JSON.stringify({ items, adresseLivraison }),
      },
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("❌ Erreur création session Stripe :", error);
    res.status(500).json({ error: error.message });
  }
});

// ================= AFFILIATION =================
// Ajouter un produit affilié
app.post("/admin/affiliate-product", async (req, res) => {
  try {
    const { slug, affiliateUrl, title, image } = req.body;
    if (!slug || !affiliateUrl || !title) {
      return res.status(400).json({ error: "Champs obligatoires manquants" });
    }

    await db.collection("affiliateProducts").doc(slug).set({
      slug,
      affiliateUrl,
      title,
      image: image || "",
      clicks: 0,
      createdAt: new Date(),
    });

    res.json({ success: true, message: "Produit affilié ajouté !" });
  } catch (error) {
    console.error("❌ Erreur ajout affilié:", error);
    res.status(500).json({ error: error.message });
  }
});

// Redirection vers le lien affilié
app.get("/go/:slug", async (req, res) => {
  try {
    const slug = req.params.slug;
    const docRef = db.collection("affiliateProducts").doc(slug);
    const snap = await docRef.get();

    if (!snap.exists) return res.status(404).send("Produit introuvable");

    const data = snap.data();

    await docRef.update({ clicks: admin.firestore.FieldValue.increment(1) });
    res.redirect(data.affiliateUrl);
  } catch (error) {
    console.error("❌ Erreur redirection affilié:", error);
    res.status(500).send("Erreur serveur");
  }
});

// Récupérer tous les produits affiliés
app.get("/affiliate-products", async (req, res) => {
  try {
    const snap = await db.collection("affiliateProducts").get();
    const products = snap.docs.map((doc) => doc.data());
    res.json(products);
  } catch (error) {
    console.error("❌ Erreur récupération affiliés:", error);
    res.status(500).json({ error: error.message });
  }
});

// ================= START SERVER =================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("🚀 Serveur démarré sur port", PORT));
