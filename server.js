// server.js pour printful  bon
import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 🔹 Firebase
const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT_Printful
);

const firebaseApp = admin.initializeApp(
  {
    credential: admin.credential.cert(serviceAccount),
  },
  "printfulApp"
);

const db = firebaseApp.firestore();


// 🔹 Test serveur
app.get("/", (req, res) => {
  res.send("Printful backend running 🚀");
});


// 🔹 IMPORT PRODUITS PRINTFUL + STOCKAGE FIRESTORE
app.get("/printful/import-products", async (req, res) => {
  try {

    const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;

    // 1️⃣ récupérer la liste produits
    const response = await axios.get(
      "https://api.printful.com/store/products",
      {
        headers: {
          Authorization: `Bearer ${PRINTFUL_API_KEY}`,
        },
      }
    );

    const products = response.data.result || [];

    const batch = db.batch();

    // 2️⃣ récupérer les détails de chaque produit
    for (const item of products) {

      const details = await axios.get(
        `https://api.printful.com/store/products/${item.id}`,
        {
          headers: {
            Authorization: `Bearer ${PRINTFUL_API_KEY}`,
          },
        }
      );

      const product = details.data.result;

      // première variante
      const variant = product.sync_variants?.[0];

      // 🔹 prix
      const price = variant?.retail_price
        ? parseFloat(variant.retail_price)
        : 0;

      // 🔹 mockup produit (vrai t-shirt avec design)
      const thumbnail =
        variant?.product?.image ||
        product?.sync_product?.thumbnail_url ||
        null;

      // 🔹 description
      const description =
        product?.sync_product?.description ||
        "Description non disponible";

      const productData = {
        id: item.id,
        name: item.name,
        description,
        price,
        thumbnail,
        variants: product.sync_variants?.length || 0,
        source: "Printful",
        syncDate: admin.firestore.FieldValue.serverTimestamp(),
      };

      const ref = db
        .collection("PrintfulProducts")
        .doc(item.id.toString());

      batch.set(ref, productData);
    }

    await batch.commit();

    res.json({
      status: "ok",
      message: `${products.length} produits importés`,
    });

  } catch (err) {

    console.error("Erreur import Printful:", err.message);

    res.status(500).json({
      status: "error",
      message: err.message,
    });
  }
});


// 🔹 API PRODUITS POUR LE FRONTEND
app.get("/printful/products", async (req, res) => {
  try {

    const snapshot = await db
      .collection("PrintfulProducts")
      .get();

    const products = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json({ products });

  } catch (err) {

    console.error("Erreur récupération produits:", err.message);

    res.status(500).json({
      products: [],
    });
  }
});


// 🔹 Lancer serveur
app.listen(PORT, () => {
  console.log(`🚀 Printful backend running on port ${PORT}`);
});
