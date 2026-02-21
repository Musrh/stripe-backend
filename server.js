// ----------------------------
// CREATE CHECKOUT SESSION
// ----------------------------
app.post('/create-checkout-session', async (req, res) => {
  try {

    console.log("🛒 Données reçues :", req.body);

    const items = req.body.items || [];

    if (!items.length) {
      return res.status(400).json({ error: 'Panier vide' });
    }

    const line_items = items.map(i => ({
      price_data: {
        currency: 'eur',
        product_data: { 
          name: i.nom // ✅ correspond à ton panier
        },
        unit_amount: i.prix * 100 // ✅ Stripe demande centimes
      },
      quantity: i.quantity
    }));

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items,
      success_url: 'https://monprijet.vercel.app/success',
      cancel_url: 'https://monprijet.vercel.app/cancel',
    });

    console.log("✅ Session Stripe créée :", session.id);

    res.json({ url: session.url });

  } catch (error) {
    console.error("❌ Erreur création session:", error);
    res.status(500).json({ error: error.message });
  }
});
