import express from "express";
import cors from "cors";
import Stripe from "stripe";
import dotenv from "dotenv";
import paypal from "@paypal/checkout-server-sdk";
import admin from "firebase-admin";
import bodyParser from "body-parser";

dotenv.config();
const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// ===== FIREBASE =====
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
});
const db = admin.firestore();

// ===== STRIPE =====
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.post("/create-stripe-session", async (req, res) => {
  try {
    const { items, email, adresseLivraison } = req.body;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      customer_email: email,
      line_items: items.map(item => ({
        price_data: {
          currency: "eur",
          product_data: { name: item.nom },
          unit_amount: Math.round(item.prix * 100)
        },
        quantity: item.quantity
      })),
      mode: "payment",
      success_url: `${process.env.FRONTEND_URL}/success`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel`,
      metadata: { adresseLivraison }
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Webhook Stripe
app.post("/stripe-webhook", bodyParser.raw({ type: "application/json" }), async (req,res)=>{
  const sig = req.headers["stripe-signature"];
  try{
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    if(event.type === "checkout.session.completed"){
      const session = event.data.object;
      await db.collection("commandes").add({
        email: session.customer_email,
        montant: session.amount_total/100,
        adresse: session.metadata.adresseLivraison,
        paymentMethod: "stripe",
        createdAt: new Date()
      });
      console.log("✅ Paiement Stripe confirmé");
    }
    res.json({received:true});
  }catch(err){console.error(err);res.status(400).send(`Webhook Error: ${err.message}`);}
});

// ===== PAYPAL =====
const environment = process.env.PAYPAL_ENV === "live"
  ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
  : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);
const paypalClient = new paypal.core.PayPalHttpClient(environment);

app.post("/create-paypal-order", async (req,res)=>{
  try{
    const { items } = req.body;
    const total = items.reduce((sum,item)=>sum+item.prix*item.quantity,0).toFixed(2);
    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent:"CAPTURE",
      purchase_units:[{ amount:{ currency_code:"EUR", value: total } }]
    });
    const order = await paypalClient.execute(request);
    res.json({ id: order.result.id });
  }catch(err){console.error(err);res.status(500).json({error:err.message});}
});

app.post("/capture-paypal-order", async(req,res)=>{
  try{
    const { orderId, email, adresseLivraison } = req.body;
    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});
    const capture = await paypalClient.execute(request);
    if(capture.result.status==="COMPLETED"){
      await db.collection("commandes").add({
        email,
        montant:capture.result.purchase_units[0].payments.captures[0].amount.value,
        adresse:adresseLivraison,
        paymentMethod:"paypal",
        createdAt:new Date()
      });
      console.log("✅ Paiement PayPal confirmé");
    }
    res.json({success:true});
  }catch(err){console.error(err);res.status(500).json({error:err.message});}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log("🚀 Serveur démarré sur port",PORT));
