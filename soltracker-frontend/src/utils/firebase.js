import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCSCPSocctufSd83TF0hE0nqqL_YYj9Oxs",
  authDomain: "soltracker-31043.firebaseapp.com",
  projectId: "soltracker-31043",
  storageBucket: "soltracker-31043.firebasestorage.app",
  messagingSenderId: "1055834701577",
  appId: "1:1055834701577:web:5be5b94b3520e7265b1dd8"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
