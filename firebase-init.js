// shared Firebase bootstrap for vote.js and admin.html.
// TODO(setup): replace with the real values from
// Firebase Console > Project settings > General > Your apps > Web app.
// These are public client identifiers, not secrets -- Firestore Security
// Rules (see firestore.rules) are what actually protects the data.
export const firebaseConfig = {
  apiKey: "AIzaSyAm4Wfk4_9MVIW0uH1XcYOEqMtk150NCtA",
  authDomain: "hackops-vote.firebaseapp.com",
  projectId: "hackops-vote",
  storageBucket: "hackops-vote.firebasestorage.app",
  messagingSenderId: "184340731540",
  appId: "1:184340731540:web:3c0bcd4edf74847a070681"
};

// every doc for this vote lives under this path, so future operations
// (op003, op004, ...) can reuse the same schema without collisions
export const EVENT_ID = "op002-slopathon";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
