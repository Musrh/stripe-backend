import express from "express";
import cors from "cors";
import Stripe from "stripe";
import admin from "firebase-admin";
import paypal from "@paypal/checkout-server-sdk";
import axios from "axios";
import dotenv from "dotenv";
import helmet from "helmet";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// -------------------- Middlewares --------------------
app.use(helmet());
app.use(cors({
  origin: ["https://wellshoppings.com"],
  methods: ["GET","POST"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json());

// -------------------- Firebase --------------------
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// -------------------- Produits --------------------
app.get("/import-products", async (req,res)=>{
  try{
    const response = await axios.get("https://fakestoreapi.com/products");
    const products = response.data;
    const batch = db.batch();
    products.forEach(p=>{
      const ref = db.collection("Products").doc(p.id.toString());
      batch.set(ref,{
        nom: p.title,
        prix: p.price,
        description: p.description,
        categorie: p.category,
        image: p.image,
        source: "FakeStoreAPI"
      });
    });
    await batch.commit();
    res.json({ status:"ok", message:`${products.length} produits importés` });
  }catch(err){
    console.error(err);
    res.status(500).json({ status:"error", message: err.message });
  }
});

app.get("/products", async (req,res)=>{
  try{
    const snapshot = await db.collection("Products").get();
    const products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ products });
  }catch(err){
    console.error(err);
    res.status(500).json({ products: [] });
  }
});

// -------------------- Stripe --------------------
let stripe;
app.post("/create-stripe-session", async (req,res)=>{
  if(!stripe) stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const { items, email, adresseLivraison } = req.body;

  try{
    const line_items = items.map(i=>({
      price_data:{
        currency:"eur",
        product_data:{ name:i.nom, images:[i.image || "/placeholder.png"] },
        unit_amount: i.prix*100
      },
      quantity: i.quantity
    }));

    // 🔹 Créer session Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types:["card"],
      line_items,
      mode:"payment",
      metadata:{ items: JSON.stringify(items), email, adresseLivraison },
      success_url:"https://wellshoppings.com/#/success",
      cancel_url:"https://wellshoppings.com/#/cancel"
    });

    // 🔹 Écriture immédiate dans Firestore
    await db.collection("commandes").add({
      stripeSessionId: session.id,
      email,
      items,
      adresseLivraison,
      montant: line_items.reduce((sum,i)=>sum + i.price_data.unit_amount*i.quantity,0)/100,
      devise:"EUR",
      statut:"en attente de paiement",
      date: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log("✅ Commande Stripe temporaire enregistrée dans Firestore");
    res.json({ url: session.url });

  }catch(err){
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 🔹 Webhook Stripe pour confirmer paiement
app.post("/stripe-webhook", express.raw({ type:"application/json" }), async (req,res)=>{
  const sig = req.headers["stripe-signature"];
  let event;
  try{
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  }catch(err){ return res.status(400).send(`Webhook Error: ${err.message}`); }

  if(event.type==="checkout.session.completed"){
    const session = event.data.object;
    const commandesRef = db.collection("commandes").where("stripeSessionId","==",session.id);
    const snapshot = await commandesRef.get();
    snapshot.forEach(doc => {
      doc.ref.update({ statut:"payé" });
    });
    console.log(`✅ Commande Stripe ${session.id} confirmée`);
  }
  res.json({ received:true });
});

// -------------------- PayPal --------------------
let paypalClient;
app.post("/create-paypal-order", async (req,res)=>{
  if(!paypalClient){
    const env = process.env.PAYPAL_ENV==="live"
      ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_SECRET)
      : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_SECRET);
    paypalClient = new paypal.core.PayPalHttpClient(env);
  }
  const { items } = req.body;
  const total = items.reduce((sum,i)=>sum + i.prix*i.quantity,0).toFixed(2);
  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer("return=representation");
  request.requestBody({ intent:"CAPTURE", purchase_units:[{ amount:{ currency_code:"EUR", value: total } }] });
  try{
    const order = await paypalClient.execute(request);
    res.json({ id: order.result.id });
  }catch(err){ console.error(err); res.status(500).json({ error: err.message }); }
});

app.post("/capture-paypal-order", async (req,res)=>{
  const { orderId, user, items, adresseLivraison } = req.body;
  if(!user?.email || !adresseLivraison) return res.status(400).json({ error:"Informations manquantes" });
  try{
    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});
    const capture = await paypalClient.execute(request);
    const montant = capture.result.purchase_units[0].payments.captures[0].amount.value;
    const devise = capture.result.purchase_units[0].payments.captures[0].amount.currency_code;
    await db.collection("commandes").add({
      paypalOrderId: orderId,
      email:user.email,
      items,
      adresseLivraison,
      montant,
      devise,
      statut:"payé",
      date: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ capture });
    console.log("✅ Commande PayPal enregistrée");
  }catch(err){ console.error(err); res.status(500).json({ error: err.message }); }
});

// -------------------- Lancer serveur --------------------
app.listen(PORT,()=>console.log(`🚀 Backend central running on port ${PORT}`));
