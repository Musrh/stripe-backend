const express = require("express");
const Stripe = require("stripe");
const admin = require("firebase-admin");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ==========================
// 🔐 Stripe
// ==========================
const stripe = Stripe("sk_test_51T20K6AwgHqDmd0FodOOJlt0IJo3k3DDysC4Guj5ictyhvEFqP2xdzseyIe78EtW2Xn29Hy9fWY47cBqD2ZYqedw00Uib6Ksqv");

// ==========================
// 🔥 Firebase (clé complète via template string)
// ==========================
const firebasePrivateKey = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDponLcXoWxLn6X
HscujFx0JJcT3vPBr3Mn9DfBKCWZofB0NCp6p92egwrYOtXCUjUDnrMGTVeipbR0
GtNvAAr8oz0cAaIQc3LHHBZP/mRkEarllXJCwwh9A5czVfMOZ6F7/CbKoHZ8pynt
d25y1vCyiPxgduJjmgAldL2bwUhZGp9VknuFk7ICQ3kqrog0o0ikSlxxQUOkEa6g
wW1JG43r7PXcr898sw2EpjjTf4jo9Di/qWCwYbmdLe3Mawuby6WhziKrtCThV8YU
1UkGSNq07Uo64ngBC0RhwZZ+c/BWT3eSB9Q1GeUOUICi+MxEcB9ja83ND+qfVM6N
An3kYJbbAgMBAAECggEAWfdcvKBHYhmx1JadA784EN9QL+4wNlrOAMopuB8yD22N
DupRm0bN7+6tO+O4EaqfUIQJkzkwMGkXyofT+E/vayae7wxv8F7MiYC21Nn0pZYq
FVtNkwjQWXeK/1EvFdJxHDHWbDuLNOgYHKHbbax4Jn/ak3jkJ4+TU9kW9IXiyrBZ
vki/zfU6uvzYGLsg9raIrMHKGNpUHX/874zP9XbkUAHe/6Dn5FhiYWSZngZm91xW
49CJJqNVsKEWHajyLgrlt1vxl5p3/8d0sYvn+kxS+yydK0rrJqKR3tjoJdgFAyb7
fJvCTs3juuOiOkzfi+1eCLsPs+a6kTzE4kfQht9hvQKBgQD+sQshWneWXzVdhCC/
kUWnTNH95piAoheZ1/b85Qm7HFV0dGNy6ac34cSngC9NnGaZPlWkzJ5GrCfQ5zHr
uTuHi11YZKLdXlebF57hzIASzCr+quT7EnFxLvWkddjiDFhyjb/6twhEIMmAK0Hy
0GOgLX6fAY6N3oqmaP5akY7tpQKBgQDq1bZQKg3x6YzjKF6wJaAXDNX2+YJKcpRo
fMtQ/1NcfeuZeWG+uwqW7uKxjUGF2uQoyGrRKkEpJNy3t13L/78fU+Q8H6hEaQMY
QhRRquW79aVgSFjXOTu/x0wn7nFIvLRFOkEs95PEIUDQZU1C/nCReAtbXkPPAXby
+F/fWftKfwKBgB1wK0Asq7vmv01S01IxIWLn/zGgsKnVknLGwpaShqBo8vul5ETI
+vn7j3Zo247V8AnwaYfF2tmCVovP3TZIz7eoBR8NasG5gNi9TzD8KSWDEckjyZm3
lQMnEV9z+6CNGsAK4FDDTSJKw9+boGDHc2x1Nbh9PpPpUA9R/WxMfL+9AoGAAsM+
4NSN03G+8ZExA/t9VagWAFDRIpUUf+Iv9iT60xS8J9MQvlCvADWRPyt9QNjhZEVv
VESd/aDsY9DpbpP0qKaxAbARp7Rgj/F/EbLj/wEVz/sp6GZI+KmckL+yX3uw1zun
NqM2/tCxVYJLlWUu59c0sv955r6KqrMXVaZWWXsCgYEA5SkiJhLDW+YBgJihDPXM
yYZgn59AGIgSEzvoOq86TDN9sBkej3CKctIFX2C2U5EILrB9ebnFYZMV3jgC3r+V
57M3G6hW9v+gXMbIjMq2nfATrWKp86DOw1G9Zj/M3DL8E8G02wo6oB4mbLvdFgRd
VHyy1I23+rdIiKoJvzjF0Ks=
-----END PRIVATE KEY-----`;

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: "formations-29d0f",
    clientEmail: "firebase-adminsdk-fbsvc@formations-29d0f.iam.gserviceaccount.com",
    privateKey: firebasePrivateKey,
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
