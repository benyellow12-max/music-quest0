// Firebase is loaded via script tags in HTML, available as global firebase object
// This file runs as a regular script (not a module) and sets up globals

// Initialize as null first
window.firebaseExports = null;
window.firebaseInitialized = false;

// Fetch Firebase config from server endpoint to avoid hardcoding keys
(async function initializeFirebase() {
  try {
    console.log('[Firebase] Starting initialization...');
    const response = await fetch('/api/firebase-config');
    if (!response.ok) {
      console.warn('[Firebase] Config endpoint not available (status ' + response.status + '), continuing without Firebase');
      window.firebaseExports = null;
      window.firebaseInitialized = true;
      return;
    }
    
    const firebaseConfig = await response.json();
    console.log('[Firebase] Config loaded, project:', firebaseConfig.projectId);

    // Check if firebase is loaded
    if (typeof firebase === 'undefined') {
      console.error('[Firebase] Firebase SDK not loaded');
      window.firebaseExports = null;
      window.firebaseInitialized = true;
      return;
    }

    // Initialize Firebase
    const app = firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const db = firebase.firestore();
    const googleProvider = new firebase.auth.GoogleAuthProvider();
    googleProvider.addScope('profile');
    googleProvider.addScope('email');

    // Make available globally for app.js module to import
    window.firebaseExports = {
      auth,
      db,
      doc: (collectionPath, docId) => db.collection(collectionPath).doc(docId),
      getDoc: async (docRef) => {
        const snapshot = await docRef.get();
        return {
          exists: () => snapshot.exists,
          data: () => snapshot.data()
        };
      },
      setDoc: (docRef, data) => docRef.set(data),
      googleProvider,
      onAuthStateChanged: (callback) => auth.onAuthStateChanged(callback),
      signInWithPopup: (provider) => auth.signInWithPopup(provider),
      signOut: () => auth.signOut()
    };

    window.firebaseInitialized = true;
    console.log('[Firebase] Initialized successfully');
  } catch (error) {
    console.error('[Firebase] Failed to initialize:', error);
    window.firebaseExports = null;
    window.firebaseInitialized = true;
  }
})();

