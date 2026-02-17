
const express = require("express")
const cors = require("cors")
const Stripe = require("stripe")

const app = express()

// Autoriser toutes les requêtes depuis ton frontend (StackBlitz)
app.use(cors())
app.use(express.json())

// 🔒 Clé secrète Stripe (à mettre dans Render / Railway / autre)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// Route test pour vérifier que le backend fonctionne
app.get("/", (req, res) => {
  res.send("Backend Stripe fonctionne ✅")
})

// Route pour créer la session de paiement
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { cart } = req.body

    if (!cart || cart.length === 0) {
      return res.status(400).json({ error: "Panier vide" })
    }

    // Création de la session Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: cart.map(item => ({
        price_data: {
          currency: "eur",
          product_data: { name: item.nom },
          unit_amount: item.prix * 100 // prix en centimes
        },
        quantity: item.quantity
      })),
      mode: "payment",
      success_url: "https://TON_FRONTEND/success",
      cancel_url: "https://TON_FRONTEND/panier"
    })

    // Retourner l'URL Stripe au frontend
    res.json({ url: session.url })

  } catch (error) {
    console.error("Erreur paiement :", error)
    res.status(500).json({ error: error.message })
  }
})

// Démarrage du serveur
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
