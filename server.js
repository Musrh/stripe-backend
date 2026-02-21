require('dotenv').config()
const express = require('express')
const cors = require('cors')
const Stripe = require('stripe')
const admin = require('firebase-admin')

const app = express()
const port = process.env.PORT || 8080

// 🔹 Stripe secret key
const stripe = Stripe(process.env.STRIPE_SECRET_KEY)

// 🔹 Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
})

const db = admin.firestore()

// 🔹 Middleware
app.use(cors())
app.use(express.json())

// 🔹 Créer une session Stripe Checkout
app.post('/create-checkout-session', async (req, res) => {
  try {
    const items = req.body.items
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Panier invalide' })
    }

    const line_items = items.map((item) => ({
      price_data: {
        currency: 'eur',
        product_data: { name: item.name },
        unit_amount: item.amount,
      },
      quantity: item.quantity,
    }))

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      success_url: process.env.SUCCESS_URL, // ex: 'https://monprojet.vercel.app/success'
      cancel_url: process.env.CANCEL_URL,   // ex: 'https://monprojet.vercel.app/cancel'
    })

    // 🔹 On renvoie l'URL Stripe
    res.json({ url: session.url })
  } catch (error) {
    console.error('Erreur création session:', error)
    res.status(500).json({ error: error.message })
  }
})

// 🔹 Webhook Stripe pour enregistrer la commande dans Firestore
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }), // ⚠️ obligatoire pour Stripe
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
      console.error('❌ Webhook signature error:', err.message)
      return res.status(400).send(`Webhook Error: ${err.message}`)
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      try {
        await db.collection('commandes').add({
          stripeSessionId: session.id,
          email: session.customer_details?.email || null,
          montant: session.amount_total,
          devise: session.currency,
          statut: 'payé',
          date: admin.firestore.FieldValue.serverTimestamp(),
        })
        console.log('🔥 Commande enregistrée dans Firestore')
      } catch (err) {
        console.error('❌ Erreur Firestore :', err)
      }
    }

    res.json({ received: true })
  }
)

// 🔹 Endpoint test Firestore
app.get('/test-firestore', async (req, res) => {
  try {
    const docRef = await db.collection('commandes').add({
      stripeSessionId: 'test-session',
      email: 'test@example.com',
      montant: 1000,
      devise: 'eur',
      statut: 'payé',
      date: admin.firestore.FieldValue.serverTimestamp(),
    })
    res.send(`Document Firestore créé avec ID : ${docRef.id}`)
  } catch (err) {
    console.error('❌ Erreur Firestore :', err)
    res.status(500).send('Erreur Firestore')
  }
})

app.listen(port, () => console.log(`🚀 Server démarré sur port ${port}`))
