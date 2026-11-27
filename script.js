// Import Firebase v11 Modular SDKs from official Google CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getFirestore,
  doc,
  setDoc,
  addDoc,
  collection,
  onSnapshot,
  query,
  orderBy,
  getDocs,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

// =========================================================================
// 1. FIREBASE CONFIGURATION (qr-code00)
// =========================================================================
const firebaseConfig = {
  apiKey: "AIzaSyApTDGNb5wqRV2ulCj8ZMrGrfSNhVuKfEw",
  authDomain: "qr-code00.firebaseapp.com",
  projectId: "qr-code00",
  storageBucket: "qr-code00.firebasestorage.app",
  messagingSenderId: "1008707934810",
  appId: "1:1008707934810:web:8d30ba2416ade9aa7b5663"
};

// Initialize Firebase & Firestore
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const FORTY_DAYS_MS = 40 * 24 * 60 * 60 * 1000;

// =========================================================================
// 2. DOM ELEMENTS & STATE
// =========================================================================
const adminView = document.getElementById("admin-view");
const participantView = document.getElementById("participant-view");
const downloadAppBtn = document.getElementById("download-app-btn");
const fullscreenBtn = document.getElementById("fullscreen-btn");
const themeToggleBtn = document.getElementById("theme-toggle-btn");

// Admin Elements
const sessionInput = document.getElementById("session-input");
const createRoomBtn = document.getElementById("create-room-btn");
const currentQuestionDisplay = document.getElementById("current-question-display");
const questionInput = document.getElementById("question-input");
const publishBtn = document.getElementById("publish-btn");
const newQuestionBtn = document.getElementById("new-question-btn");
const qrcodeContainer = document.getElementById("qrcode-container");
const shareUrlInput = document.getElementById("share-url-input");
const copyLinkBtn = document.getElementById("copy-link-btn");
const responseCountEl = document.getElementById("response-count");
const participantCountEl = document.getElementById("participant-count");
const wordcloudEmpty = document.getElementById("wordcloud-empty");
const wordcloudCanvas = document.getElementById("wordcloud-canvas");
const exportCsvBtn = document.getElementById("export-csv-btn");
const clearResponsesBtn = document.getElementById("clear-responses-btn");

// Participant Elements
const participantQuestionText = document.getElementById("participant-question-text");
const responseForm = document.getElementById("response-form");
const participantNameInput = document.getElementById("participant-name");
const participantAnswerInput = document.getElementById("participant-answer");
const submitResponseBtn = document.getElementById("submit-response-btn");
const submissionConfirmation = document.getElementById("submission-confirmation");
const submitAnotherBtn = document.getElementById("submit-another-btn");

const toastEl = document.getElementById("toast");

const pastelPalette = [
  "#9aa5d8", // soft periwinkle
  "#e2a9a6", // soft rose
  "#96a0b8", // muted slate blue
  "#d49c96", // warm dusty coral
  "#aeb7e6", // light lavender blue
  "#c7a7c9", // soft lilac
  "#9eb3c2"  // pastel steel
];

let sessionId = generateRandomSessionId();
let sessionDocRef = doc(db, "sessions", sessionId);
let responsesColRef = collection(db, "sessions", sessionId, "responses");
let unsubscribeQuestion = null;
let unsubscribeResponses = null;
let currentSessionCreatedAtMs = null;

let latestResponses = [];
let isParticipantMode = false;
let deferredInstallPrompt = null;

// =========================================================================
// 3. INITIALIZATION & PWA SETUP
// =========================================================================
function registerPWA() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
  });

  if (downloadAppBtn) {
    downloadAppBtn.addEventListener("click", async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        if (outcome === "accepted") {
          showToast("Downloading Threadly...");
        }
        return;
      }

      const isStandalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        window.navigator.standalone === true;

      if (isStandalone) {
        showToast("Threadly is already installed.");
        return;
      }

      showToast("Use browser menu (⋮ or Share) → Add to Home Screen / Install");
    });
  }

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    showToast("Threadly installed!");
  });
}

function generateRandomSessionId() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `sess-${code}`;
}

function sanitizeSessionId(raw) {
  return (raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function lockSessionInput() {
  if (!sessionInput) return;
  sessionInput.readOnly = true;
  sessionInput.value = sessionId;
  sessionInput.addEventListener("input", () => {
    sessionInput.value = sessionId;
  });
  sessionInput.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
    }
  });
}

function initApp() {
  registerPWA();
  lockSessionInput();

  const urlParams = new URLSearchParams(window.location.search);
  const viewParam = urlParams.get("view") || urlParams.get("mode");
  isParticipantMode = viewParam === "participant";
  updateViewMode();

  if (localStorage.getItem("threadly-theme") === "dark") {
    document.body.classList.add("dark-mode");
    if (themeToggleBtn) themeToggleBtn.textContent = "☀️";
  }

  const rawParamSession = sanitizeSessionId(urlParams.get("session"));
  const initialSession = rawParamSession || generateRandomSessionId();
  setActiveSession(initialSession, !isParticipantMode);
}

function setActiveSession(nextSessionId, updateUrl = true) {
  sessionId = sanitizeSessionId(nextSessionId) || generateRandomSessionId();
  sessionDocRef = doc(db, "sessions", sessionId);
  responsesColRef = collection(db, "sessions", sessionId, "responses");
  currentSessionCreatedAtMs = null;

  if (sessionInput) {
    sessionInput.readOnly = true;
    sessionInput.value = sessionId;
  }

  if (updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set("session", sessionId);
    window.history.replaceState({}, "", url.toString());
  }

  const baseUrl = `${window.location.origin}${window.location.pathname}`;
  const participantUrl = `${baseUrl}?view=participant&session=${encodeURIComponent(sessionId)}`;
  if (shareUrlInput) shareUrlInput.value = participantUrl;
  generateQRCode(participantUrl);

  if (unsubscribeQuestion) unsubscribeQuestion();
  if (unsubscribeResponses) unsubscribeResponses();

  listenToActiveQuestion();
  listenToResponses();
}

function generateQRCode(url) {
  if (!qrcodeContainer) return;
  qrcodeContainer.innerHTML = "";
  if (typeof window.QRCode === "function") {
    new window.QRCode(qrcodeContainer, {
      text: url,
      width: 190,
      height: 190,
      colorDark: "#1e1b4b",
      colorLight: "#ffffff",
      correctLevel: window.QRCode.CorrectLevel.H
    });
  }
}

function updateViewMode() {
  if (!adminView || !participantView) return;
  if (isParticipantMode) {
    adminView.classList.add("hidden");
    participantView.classList.remove("hidden");
  } else {
    participantView.classList.add("hidden");
    adminView.classList.remove("hidden");
  }
}

// =========================================================================
// 4. 40-DAY EXPIRATION & REAL-TIME FIREBASE LISTENERS
// =========================================================================
async function purgeSessionIfExpired(sessionData, targetSessionId, docRef, colRef) {
  if (!sessionData || !sessionData.createdAtMs) return false;

  const ageMs = Date.now() - sessionData.createdAtMs;
  if (ageMs < FORTY_DAYS_MS) return false;

  try {
    const snap = await getDocs(colRef);
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    await deleteDoc(docRef);
    if (sessionId === targetSessionId) {
      showToast(`Session "${targetSessionId}" passed 40 days and was deleted.`);
    }
    return true;
  } catch (err) {
    console.error("Error expiring old session:", err);
    return false;
  }
}

function listenToActiveQuestion() {
  const watchedSessionId = sessionId;
  const watchedDocRef = sessionDocRef;
  const watchedColRef = responsesColRef;
  const defaultPrompt = "What is one key takeaway you'd like to share today?";

  unsubscribeQuestion = onSnapshot(
    watchedDocRef,
    async (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        currentSessionCreatedAtMs = data.createdAtMs || null;

        const expired = await purgeSessionIfExpired(
          data,
          watchedSessionId,
          watchedDocRef,
          watchedColRef
        );

        if (expired) {
          currentSessionCreatedAtMs = null;
          if (currentQuestionDisplay) currentQuestionDisplay.textContent = defaultPrompt;
          if (participantQuestionText) participantQuestionText.textContent = defaultPrompt;
          return;
        }

        const activeQ = data.question || defaultPrompt;
        if (currentQuestionDisplay) currentQuestionDisplay.textContent = activeQ;
        if (participantQuestionText) participantQuestionText.textContent = activeQ;
      } else {
        currentSessionCreatedAtMs = null;
        if (currentQuestionDisplay) currentQuestionDisplay.textContent = defaultPrompt;
        if (participantQuestionText) participantQuestionText.textContent = defaultPrompt;
      }
    },
    (error) => {
      console.error("Error listening to question:", error);
      showToast("Check Firestore rules in Firebase Console");
    }
  );
}

function listenToResponses() {
  const q = query(responsesColRef, orderBy("createdAtMs", "desc"));

  unsubscribeResponses = onSnapshot(
    q,
    (snapshot) => {
      latestResponses = [];
      snapshot.forEach((docSnap) => {
        latestResponses.push({ id: docSnap.id, ...docSnap.data() });
      });

      renderResponses(latestResponses);
    },
    (error) => {
      console.error("Error listening to responses:", error);
    }
  );
}

function renderResponses(responses) {
  if (responseCountEl) responseCountEl.textContent = responses.length;

  const uniqueNames = new Set(
    responses.map((r) => (r.name || "Anonymous").trim().toLowerCase())
  );
  if (participantCountEl) participantCountEl.textContent = uniqueNames.size;

  if (!wordcloudCanvas || !wordcloudEmpty) return;

  if (responses.length === 0) {
    wordcloudCanvas.classList.add("hidden");
    wordcloudEmpty.classList.remove("hidden");
    return;
  }

  const wordCounts = buildWordFrequency(responses);
  const entries = Array.from(wordCounts.entries());

  if (entries.length === 0) {
    wordcloudCanvas.classList.add("hidden");
    wordcloudEmpty.classList.remove("hidden");
    return;
  }

  wordcloudEmpty.classList.add("hidden");
  wordcloudCanvas.classList.remove("hidden");

  const maxCount = Math.max(...entries.map(([, count]) => count), 1);
  const minCount = Math.min(...entries.map(([, count]) => count), 1);
  const variedWeights = [56, 30, 46, 36, 20, 28, 24];

  const wordList = entries.map(([phrase, count], index) => {
    let weight;
    if (maxCount === minCount) {
      weight = variedWeights[index % variedWeights.length];
    } else {
      const ratio = (count - minCount) / (maxCount - minCount);
      weight = Math.round(20 + ratio * 42);
    }
    return [phrase, weight];
  });

  const isDark = document.body.classList.contains("dark-mode");
  const bgColor = isDark ? "#1e293b" : "#ffffff";

  if (typeof window.WordCloud === "function") {
    wordcloudCanvas.width = 1200;
    wordcloudCanvas.height = 560;

    window.WordCloud(wordcloudCanvas, {
      list: wordList,
      gridSize: 6,
      weightFactor: 1,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      color: (_word, _weight, fontSize, distance, theta) => {
        const idx = Math.abs(Math.round(fontSize + distance + theta * 10)) % pastelPalette.length;
        return pastelPalette[idx];
      },
      backgroundColor: bgColor,
      rotateRatio: 0.35,
      rotationSteps: 2,
      minRotation: -Math.PI / 2,
      maxRotation: Math.PI / 2,
      shuffle: false,
      shrinkToFit: true,
      drawOutOfBound: false
    });
  } else {
    wordcloudCanvas.classList.add("hidden");
    wordcloudEmpty.classList.remove("hidden");
    wordcloudEmpty.innerHTML = wordList
      .map(
        ([phrase, weight], i) =>
          `<span style="font-size:${(weight / 22).toFixed(2)}rem;color:${pastelPalette[i % pastelPalette.length]};margin:0 0.5rem;">${escapeHTML(phrase)}</span>`
      )
      .join("");
  }
}

function buildWordFrequency(responses) {
  const counts = new Map();

  responses.forEach((item) => {
    const rawText = (item.answer || "").trim().replace(/\s+/g, " ");
    if (!rawText) return;

    const normalizedKey = rawText.toLowerCase();
    const existing = counts.get(normalizedKey);

    if (existing) {
      existing.count += 1;
    } else {
      counts.set(normalizedKey, {
        label: rawText,
        count: 1
      });
    }
  });

  const result = new Map();
  counts.forEach(({ label, count }) => {
    result.set(label, count);
  });

  return result;
}

// =========================================================================
// 5. ADMIN ACTIONS
// =========================================================================
if (createRoomBtn) {
  createRoomBtn.addEventListener("click", () => {
    const roomId = generateRandomSessionId();
    setActiveSession(roomId, true);
    showToast(`Created room "${roomId}"`);
  });
}

if (publishBtn) {
  publishBtn.addEventListener("click", async () => {
    const newQuestion = (questionInput?.value || "").trim();
    if (!newQuestion) {
      showToast("Please enter a question first.");
      return;
    }

    publishBtn.disabled = true;
    try {
      const createdAtMs = currentSessionCreatedAtMs || Date.now();
      await setDoc(
        sessionDocRef,
        {
          sessionId,
          question: newQuestion,
          createdAtMs,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
      currentSessionCreatedAtMs = createdAtMs;
      showToast(`Published to "${sessionId}"!`);
    } catch (err) {
      console.error(err);
      showToast("Failed to publish question.");
    } finally {
      publishBtn.disabled = false;
    }
  });
}

if (newQuestionBtn) {
  newQuestionBtn.addEventListener("click", () => {
    if (questionInput) {
      questionInput.value = "";
      questionInput.focus();
    }
  });
}

if (clearResponsesBtn) {
  clearResponsesBtn.addEventListener("click", async () => {
    if (latestResponses.length === 0) {
      showToast("No responses to clear.");
      return;
    }

    const confirmed = confirm(
      `Delete all responses in session "${sessionId}"? This cannot be undone.`
    );
    if (!confirmed) return;

    clearResponsesBtn.disabled = true;
    try {
      const snapshot = await getDocs(responsesColRef);
      const deletePromises = snapshot.docs.map((d) => deleteDoc(d.ref));
      await Promise.all(deletePromises);
      showToast("Session responses cleared.");
    } catch (err) {
      console.error(err);
      showToast("Error clearing responses.");
    } finally {
      clearResponsesBtn.disabled = false;
    }
  });
}

if (exportCsvBtn) {
  exportCsvBtn.addEventListener("click", () => {
    if (latestResponses.length === 0) {
      showToast("No responses available to export.");
      return;
    }

    const headers = ["Session ID", "Participant Name", "Response", "Submission Time"];
    const rows = latestResponses.map((r) => [
      `"${sessionId.replace(/"/g, '""')}"`,
      `"${(r.name || "").replace(/"/g, '""')}"`,
      `"${(r.answer || "").replace(/"/g, '""')}"`,
      `"${formatTimestamp(r.createdAtMs)}"`
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `threadly-${sessionId}-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("CSV exported!");
  });
}

if (copyLinkBtn) {
  copyLinkBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(shareUrlInput?.value || "");
      showToast("Participant link copied!");
    } catch {
      if (shareUrlInput) {
        shareUrlInput.select();
        document.execCommand("copy");
      }
      showToast("Participant link copied!");
    }
  });
}

// =========================================================================
// 6. PARTICIPANT ACTIONS
// =========================================================================
if (responseForm) {
  responseForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = (participantNameInput?.value || "").trim();
    const answer = (participantAnswerInput?.value || "").trim();

    if (!name || !answer) return;

    if (submitResponseBtn) {
      submitResponseBtn.disabled = true;
      submitResponseBtn.textContent = "Sending...";
    }

    try {
      await addDoc(responsesColRef, {
        name,
        answer,
        createdAtMs: Date.now()
      });

      responseForm.classList.add("hidden");
      if (submissionConfirmation) submissionConfirmation.classList.remove("hidden");
      if (participantAnswerInput) participantAnswerInput.value = "";
    } catch (err) {
      console.error("Submission error:", err);
      showToast("Could not submit response. Check your connection.");
    } finally {
      if (submitResponseBtn) {
        submitResponseBtn.disabled = false;
        submitResponseBtn.textContent = "Send Response";
      }
    }
  });
}

if (submitAnotherBtn) {
  submitAnotherBtn.addEventListener("click", () => {
    if (submissionConfirmation) submissionConfirmation.classList.add("hidden");
    if (responseForm) responseForm.classList.remove("hidden");
    if (participantAnswerInput) participantAnswerInput.focus();
  });
}

// =========================================================================
// 7. UI CONTROLS (FULLSCREEN, DARK MODE)
// =========================================================================
if (fullscreenBtn) {
  fullscreenBtn.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {
        showToast("Fullscreen blocked by browser.");
      });
    } else {
      document.exitFullscreen();
    }
  });
}

if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", () => {
    document.body.classList.toggle("dark-mode");
    const isDark = document.body.classList.contains("dark-mode");
    themeToggleBtn.textContent = isDark ? "☀️" : "🌙";
    localStorage.setItem("threadly-theme", isDark ? "dark" : "light");
    if (latestResponses.length > 0) {
      renderResponses(latestResponses);
    }
  });
}

// =========================================================================
// 8. HELPER UTILITIES
// =========================================================================
function formatTimestamp(ms) {
  if (!ms) return "Just now";
  const date = new Date(ms);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  setTimeout(() => {
    toastEl.classList.add("hidden");
  }, 3000);
}

// Launch App
initApp();
