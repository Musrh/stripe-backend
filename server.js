//avant Health 
import express from "express";
import admin from "firebase-admin";
import axios from "axios";

const app = express();
const PORT = process.env.PORT || 3000;

// Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

app.get("/import-products", async (req, res) => {
  try {

    // appel API
    const response = await axios.get("https://fakestoreapi.com/products");

    const products = response.data;

    const batch = db.batch();

    products.forEach((item) => {

      const ref = db.collection("ProductsExternes").doc(item.id.toString());

      batch.set(ref,{
        nom: item.title,
        prix: item.price,
        description: item.description,
        categorie: item.category,
        image: item.image,
        source: "FakeStoreAPI"
      });

    });

    await batch.commit();

    res.send({
      status: "ok",
      message: products.length + " produits importés"
    });

  } catch (err) {

    res.status(500).send({
      status: "error",
      message: err.message
    });

  }
});



app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
