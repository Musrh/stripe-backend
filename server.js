require('dotenv').config()
const express = require('express')
const cors = require('cors')
const Stripe = require('stripe')
const admin = require('firebase-admin')

const app = express()

/* ================================
   🔥 STRIPE
================================ */

const stripe = Stripe(process.env.STRIPE_SECRET_KEY)

/* ================================
   🔥 FIREBASE ADMIN INIT
================================ */

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
})

const db = admin.firestore()

/* ================================
   🔥 MIDDLEWARE
================================ */

app.use(cors())

// ⚠️ IMPORTANT : webhook AVANT express.json()
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature']

    let event

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      )
      console.log('✅ Webhook reçu :', event.type)
    } catch (err) {
      console.error('❌ Erreur signature webhook :', err.message)
      return res.status(400).send(`Webhook Error: ${err.message}`)
    }

    /* ================================
       🎯 CHECKOUT SUCCESS
    ================================ */
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object

      try {
        await db.collection('commandes').add({
          sessionId: session.id,
          email: session.customer_email,
          montant: session.amount_total / 100,
          currency: session.currency,
          paymentStatus: session.payment_status,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        console.log('🔥 Commande enregistrée dans Firestore')
      } catch (error) {
        console.error('🔥 ERREUR FIRESTORE :', error)
      }
    }

    res.json({ received: true })
  }
)

// ⚠️ DOIT être après le webhook
app.use(express.json())

/* ================================
   🛒 CREER SESSION CHECKOUT
================================ */

app.post('/create-checkout-session', async (req, res) => {
  try {
    const { panier } = req.body

    const line_items = panier.map((item) => ({
      price_data: {
        currency: 'eur',
        product_data: {
          name: item.nom,
        },
        unit_amount: item.prix * 100,
      },
      quantity: item.quantite,
    }))

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      success_url: process.env.SUCCESS_URL,
      cancel_url: process.env.CANCEL_URL,
    })

    res.json({ id: session.id })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: error.message })
  }
})

/* ================================
   🚀 START SERVER
================================ */

const PORT = process.env.PORT || 8080
app.listen(PORT, () => {
  console.log('🚀 Server démarré sur port', PORT)
})
