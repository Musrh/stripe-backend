// server.js
const express = require("express")
const cors = require("cors")
const Stripe = require("stripe")

const app = express()
app.use(cors())
app.use(express.json())

if (!process.env.STRIPE_SECRET_KEY) {
  console.error("❌ STRIPE_SECRET_KEY manquante !")
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

app.get("/", (req, res) => {
  res.json({ message: "Backend Railway actif ✅" })
})

app.post("/create-checkout-session", async (req, res) => {
  try {
    const { cart } = req.body

    if (!cart || cart.length === 0) {
      return res.status(400).json({ error: "Panier vide" })
    }

    console.log("Panier reçu :", cart)

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: cart.map(item => ({
        price_data: {
          currency: "eur",
          product_data: { name: item.nom },
          unit_amount: Math.round(Number(item.prix) * 100)
        },
        quantity: item.quantity
      })),
      mode: "payment",

      // 🔹 URLs publiques StackBlitz avec ton projet
      success_url: "https://stackblitz.com/edit/vitejs-vite-lr7cus3k?file=src/pages/Success.vue",
      cancel_url: "https://stackblitz.com/edit/vitejs-vite-lr7cus3k?file=src/pages/Panier.vue"
    })

    res.json({ url: session.url })

  } catch (error) {
    console.error("Erreur paiement :", error)
    res.status(500).json({ error: error.message })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`)
})