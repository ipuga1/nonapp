    import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
    import {
      getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
      signOut, onAuthStateChanged
    } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
    import {
      getFirestore, doc, getDoc, setDoc, collection,
      getDocs, query, where, onSnapshot, deleteDoc
    } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

    // ── Configuración Firebase ──────────────────────────────
    const firebaseConfig = {
      apiKey: "AIzaSyBbZiVnDWFFnmPfJLuZB8oCUasyhECE1Oc",
      authDomain: "raiz-cuidado.firebaseapp.com",
      projectId: "raiz-cuidado",
      storageBucket: "raiz-cuidado.firebasestorage.app",
      messagingSenderId: "6028788651",
      appId: "1:6028788651:web:5d8d53ee1b71e594c448ee"
    };

    const firebaseApp = initializeApp(firebaseConfig);
    const auth = getAuth(firebaseApp);
    const db = getFirestore(firebaseApp);

    // ── Exponer globalmente para el código de la app ─────────
    window._fb = { auth, db, createUserWithEmailAndPassword, signInWithEmailAndPassword,
                   signOut, onAuthStateChanged, doc, getDoc, setDoc, collection,
                   getDocs, query, where, onSnapshot, deleteDoc };

    // ── Observar estado de autenticación ─────────────────────
    onAuthStateChanged(auth, async (user) => {
      if (user && window._raizOnAuth) {
        await window._raizOnAuth(user);
      }
    });
