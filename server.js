const express = require("express");
const Stripe = require("stripe");
const admin = require("firebase-admin");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

// ==========================
// 🔐 Stripe
// ==========================
const stripe = Stripe("sk_test_51T20K6AwgHqDmd0FodOOJlt0IJo3k3DDysC4Guj5ictyhvEFqP2xdzseyIe78EtW2Xn29Hy9fWY47cBqD2ZYqedw00Uib6Ksqv");

// ==========================
// 🔥 Firebase (clé directement)
// ==========================
const firebasePrivateKey = "-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADAN...END PRIVATE KEY-----\\n";

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: "formations-29d0f",
    clientEmail: "firebase-adminsdk-fbsvc@formations-29d0f.iam.gserviceaccount.com",
    privateKey: firebasePrivateKey.replace(/\\n/g, "\n"),
  }),
});

const db = admin.firestore();

// ==========================
// 🛒 Créer une session Stripe
// ==========================
app.post("/create-checkout-session", async (req, res) => {
  const { items, email } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: email,
      line_items: items.map((item) => ({
        price_data: {
          currency: "usd",
          product_data: { name: item.name },
          unit_amount: item.price * 100,
        },
        quantity: item.quantity,
      })),
      // ✅ Redirection vers ton frontend Vercel
      success_url: `https://monprijet.vercel.app/panier?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://monprijet.vercel.app/panier?cancelled=true`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Erreur création session:", err);
    res.status(500).json({ error: "Impossible de créer la session" });
  }
});

// ==========================
// ✅ Confirmer paiement et enregistrer commande
// ==========================
app.post("/confirm-payment", async (req, res) => {
  const { session_id } = req.body;

  if (!session_id) return res.status(400).json({ error: "session_id manquant" });

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status === "paid") {
      const orderRef = db.collection("orders").doc(session.id);
      const existing = await orderRef.get();

      if (!existing.exists) {
        await orderRef.set({
          stripeSessionId: session.id,
          paymentIntent: session.payment_intent,
          customerEmail: session.customer_details?.email || null,
          amount: session.amount_total / 100,
          currency: session.currency,
          status: "paid",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log("✅ Commande enregistrée :", session.id);
      } else {
        console.log("⚠️ Commande déjà existante :", session.id);
      }

      return res.json({ success: true });
    } else {
      return res.status(400).json({ success: false, message: "Paiement non confirmé" });
    }
  } catch (err) {
    console.error("Erreur confirmation paiement:", err);
    return res.status(500).json({ error: "Erreur confirmation paiement" });
  }
});

// ==========================
// 🌍 Route test
// ==========================
app.get("/", (req, res) => {
  res.send("🚀 Server OK");
});

// ==========================
// 🚀 Lancer le serveur
// ==========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
