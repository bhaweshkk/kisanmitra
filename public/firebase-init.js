// ═══════════════════════════════════════════════
// KisanMitra — Firebase initialization
// Loaded as an ES module directly from the Firebase CDN
// (this project has no bundler, so we can't `import` from npm here)
// ═══════════════════════════════════════════════
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import { getAnalytics, isSupported as isAnalyticsSupported } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-analytics.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyA9BFFREa5nJMPShO8x1cGMUaN_iD0t87w",
  authDomain: "kisanmitra-80675.firebaseapp.com",
  projectId: "kisanmitra-80675",
  storageBucket: "kisanmitra-80675.firebasestorage.app",
  messagingSenderId: "390512804981",
  appId: "1:390512804981:web:97268080eae3d18245a43c",
  measurementId: "G-DFTPB5QV7C"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Analytics only works over https (or localhost) and only in supported
// browsers, so guard it instead of calling getAnalytics() unconditionally.
isAnalyticsSupported().then((supported) => {
  if (supported) {
    getAnalytics(app);
  }
});

// Expose the initialized app on window so other inline <script> blocks on
// the page (which are not modules) can reach it, e.g. window.firebaseApp
window.firebaseApp = app;
