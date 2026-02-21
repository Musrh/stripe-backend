import express from 'express'
import cors from 'cors'
import Stripe from 'stripe'
import admin from 'firebase-admin'

const app = express()
const port = process.env.PORT || 8080

// 🔹 Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// 🔹 Firebase
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
})

const db = admin.firestore()

// 🔹 Middlewares
app.use(cors())
app.use(express.json()) // pour recevoir JSON normal

// 🔹 Créer une session Stripe
app.post('/create-checkout-session', async (req, res) => {
  try {
    const panier = req.body // on récupère le body directement

    if (!panier || !Array.isArray(panier)) {
      return res.status(400).json({ error: "Panier invalide" })
    }

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
    console.error("Erreur création session:", error)
    res.status(500).json({ error: error.message })
  }
})

// 🔹 Webhook Stripe pour enregistrer la commande
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }), // ⚠️ important pour le webhook
  async (req, res) => {
    const sig = req.headers['stripe-signature']
    let event

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      )
    } catch (err) {
      console.error("❌ Webhook signature error:", err.message)
      return res.status(400).send(`Webhook Error: ${err.message}`)
    }

    console.log("✅ Webhook reçu :", event.type)

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      console.log("Session Stripe du webhook :", session)

      try {
        await db.collection('commandes').add({
          stripeSessionId: session.id,
          email: session.customer_details?.email || null,
          montant: session.amount_total,
          devise: session.currency,
          statut: 'payé',
          date: admin.firestore.FieldValue.serverTimestamp(),
        })
        console.log("✅ Commande enregistrée dans Firestore")
      } catch (err) {
        console.error("❌ Erreur Firestore :", err)
      }
    }

    res.json({ received: true })
  }
)

// 🔹 Test Firestore
app.get('/test-firestore', async (req, res) => {
  try {
    const docRef = await db.collection('commandes').add({
      stripeSessionId: "test-session",
      email: "test@example.com",
      montant: 1000,
      devise: "eur",
      statut: "payé",
      date: admin.firestore.FieldValue.serverTimestamp(),
    })

    console.log("✅ Document Firestore créé :", docRef.id)
    res.send(`Document Firestore créé avec ID : ${docRef.id}`)
  } catch (err) {
    console.error("❌ Erreur Firestore :", err)
    res.status(500).send("Erreur Firestore")
  }
})

app.listen(port, () => {
  console.log(`🚀 Server démarré sur port ${port}`)
})
