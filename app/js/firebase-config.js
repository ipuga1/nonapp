    import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
    import {
      getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
      signOut, onAuthStateChanged, sendPasswordResetEmail
    } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
    import {
      getFirestore, doc, getDoc, setDoc, collection,
      getDocs, query, where, onSnapshot, deleteDoc
    } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
    import {
      getStorage, ref, uploadString, getDownloadURL, deleteObject
    } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

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
    const storage = getStorage(firebaseApp);

    // ── Exponer globalmente para el código de la app ─────────
    window._fb = { auth, db, createUserWithEmailAndPassword, signInWithEmailAndPassword,
                   signOut, onAuthStateChanged, sendPasswordResetEmail, doc, getDoc, setDoc, collection,
                   getDocs, query, where, onSnapshot, deleteDoc,
                   storage, ref, uploadString, getDownloadURL, deleteObject };

    // ── Observar estado de autenticación ─────────────────────
    onAuthStateChanged(auth, async (user) => {
      if (user && window._raizOnAuth) {
        await window._raizOnAuth(user);
      } else if (!user && window._raizOnNoAuth) {
        window._raizOnNoAuth();
      }
    });
