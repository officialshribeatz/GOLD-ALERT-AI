/* ==========================================================
   Firebase Config — इथे तुझ्या स्वतःच्या Firebase project च्या
   keys टाक (त्या सगळ्या PUBLIC असतात, secret नाहीत — काळजी नको)

   कुठून मिळतील: Firebase Console → Project Settings →
   "Your apps" → Web app (</>) → SDK setup and configuration
   ========================================================== */
const firebaseConfig = {
  apiKey: "AIzaSyClW3HkQ6-i2N_hANP6Jec3G6SFXvT0YOM",
  authDomain: "gold-alert-ai-5f1cc.firebaseapp.com",
  databaseURL: "https://gold-alert-ai-5f1cc-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "gold-alert-ai-5f1cc",
  storageBucket: "gold-alert-ai-5f1cc.firebasestorage.app",
  messagingSenderId: "393151258641",
  appId: "1:393151258641:web:ef9cdf5fe723f11379d1b0"
};

// VAPID key — Firebase Console → Project Settings → Cloud Messaging →
// "Web configuration" → Generate key pair (पुढच्या step मध्ये भरू)
const VAPID_KEY = "BAJERVI3Qqi5jibKN_03eGiwWG8Cejyf4tJ-9z_OFW4AbiEoev2Pq8Uzjoee11ROW3VM2krwhgwjLqTX_t4awow";
