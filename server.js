const express = require("express")
const cors = require("cors")
const Stripe = require("stripe")

const app = express()

app.use(cors())
app.use(express.json())

if (!process.env.STRIPE_SECRET_KEY) {
  console.error("❌ STRIPE_SECRET_KEY manquante dans Railway !")
  process.exit(1)
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// Route test
app.get("/", (req, res) => {
  res.json({ message: "Backend Railway actif ✅" })
})

// Création session
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { cart } = req.body

    if (!cart || cart.length === 0) {
      return res.status(400).json({ error: "Panier vide" })
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: cart.map(item => ({
        price_data: {
          currency: "eur",
          product_data: { name: item.nom },
          unit_amount: Math.round(Number(item.prix) * 100)
        },
        quantity: item.quantity || 1
      })),
      mode: "payment",

success_url: "https://monprijet.vercel.app/success?session_id={CHECKOUT_SESSION_ID}",
cancel_url: "https://monprijet.vercel.app/panier"
      
    })

    res.json({ url: session.url })

  } catch (error) {
    console.error("❌ Erreur paiement :", error.message)
    res.status(500).json({ error: error.message })
  }
})

// 🔥 NOUVELLE ROUTE IMPORTANTE
app.get("/session/:id", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(
      req.params.id,
      { expand: ["line_items"] }
    )

    res.json(session)
  } catch (error) {
    console.error("❌ Erreur récupération session :", error.message)
    res.status(500).json({ error: error.message })
  }
})

const PORT = process.env.PORT || 3000

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`)
})
