import bodyParser from "body-parser";

// Webhook Stripe (doit être en raw)
app.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
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
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      try {
        const items = session.metadata.items
          ? JSON.parse(session.metadata.items)
          : [];

        const adresseLivraison = session.metadata.adresseLivraison
          ? JSON.parse(session.metadata.adresseLivraison)
          : {};

        // 🔹 Enregistrement dans Firestore
        await db.collection("commandes").add({
          stripeSessionId: session.id,
          email: session.customer_details?.email || session.metadata?.email || null,
          adresseLivraison,
          montant: session.amount_total / 100,
          devise: session.currency,
          statut: "payé",
          date: admin.firestore.FieldValue.serverTimestamp(),
          items,
        });

        console.log("✅ Commande Stripe enregistrée avec items et adresse");
      } catch (err) {
        console.error("❌ Firestore Stripe error:", err);
      }
    }

    res.json({ received: true });
  }
);
