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

// Firestore References
const sessionDocRef = doc(db, "board", "activeSession");
const responsesColRef = collection(db, "responses");

// =========================================================================
// 2. DOM ELEMENTS & STATE
// =========================================================================
const adminView = document.getElementById("admin-view");
const participantView = document.getElementById("participant-view");
const fullscreenBtn = document.getElementById("fullscreen-btn");
const themeToggleBtn = document.getElementById("theme-toggle-btn");

// Admin Elements
const currentQuestionDisplay = document.getElementById("current-question-display");
const questionInput = document.getElementById("question-input");
const publishBtn = document.getElementById("publish-btn");
const newQuestionBtn = document.getElementById("new-question-btn");
const qrcodeContainer = document.getElementById("qrcode-container");
const shareUrlInput = document.getElementById("share-url-input");
const copyLinkBtn = document.getElementById("copy-link-btn");
const responseCountEl = document.getElementById("response-count");
const participantCountEl = document.getElementById("participant-count");
const wordcloudContainer = document.getElementById("wordcloud-container");
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

let latestResponses = [];
let isParticipantMode = false;

// =========================================================================
// 3. INITIALIZATION & ROUTING (GitHub Pages Friendly)
// =========================================================================
function initApp() {
  const urlParams = new URLSearchParams(window.location.search);
  const viewParam = urlParams.get("view") || urlParams.get("mode");
  isParticipantMode = viewParam === "participant";
  updateViewMode();

  const baseUrl = `${window.location.origin}${window.location.pathname}`;
  const participantUrl = `${baseUrl}?view=participant`;
  shareUrlInput.value = participantUrl;

  generateQRCode(participantUrl);

  if (localStorage.getItem("qr-board-theme") === "dark") {
    document.body.classList.add("dark-mode");
    themeToggleBtn.textContent = "☀️";
  }

  listenToActiveQuestion();
  listenToResponses();
}

function generateQRCode(url) {
  qrcodeContainer.innerHTML = "";
  new QRCode(qrcodeContainer, {
    text: url,
    width: 190,
    height: 190,
    colorDark: "#1e1b4b",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });
}

function updateViewMode() {
  if (isParticipantMode) {
    adminView.classList.add("hidden");
    participantView.classList.remove("hidden");
  } else {
    participantView.classList.add("hidden");
    adminView.classList.remove("hidden");
  }
}

// =========================================================================
// 4. REAL-TIME FIREBASE LISTENERS
// =========================================================================
function listenToActiveQuestion() {
  onSnapshot(
    sessionDocRef,
    (snapshot) => {
      if (snapshot.exists() && snapshot.data().question) {
        const activeQ = snapshot.data().question;
        currentQuestionDisplay.textContent = activeQ;
        participantQuestionText.textContent = activeQ;
      } else {
        const defaultPrompt = "What is one key takeaway you'd like to share today?";
        currentQuestionDisplay.textContent = defaultPrompt;
        participantQuestionText.textContent = defaultPrompt;
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

  onSnapshot(
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
  responseCountEl.textContent = responses.length;

  const uniqueNames = new Set(
    responses.map((r) => (r.name || "Anonymous").trim().toLowerCase())
  );
  participantCountEl.textContent = uniqueNames.size;

  if (responses.length === 0) {
    wordcloudContainer.innerHTML = `<div class="empty-state">Waiting for audience responses...</div>`;
    return;
  }

  const wordCounts = buildWordFrequency(responses);
  const entries = Array.from(wordCounts.entries());
  const maxCount = Math.max(...entries.map(([, count]) => count), 1);
  const minCount = Math.min(...entries.map(([, count]) => count), 1);

  wordcloudContainer.innerHTML = entries
    .map(([word, count], index) => {
      const fontSizeRem = calculateWordSize(count, minCount, maxCount, index);
      const color = pastelPalette[index % pastelPalette.length];
      const safeWord = escapeHTML(word);

      return `
        <span
          class="word-cloud-item"
          style="font-size: ${fontSizeRem}rem; color: ${color};"
          title="${safeWord} (${count})"
        >${safeWord}</span>
      `;
    })
    .join("");
}

function buildWordFrequency(responses) {
  const counts = new Map();

  responses.forEach((item) => {
    const text = (item.answer || "").trim();
    if (!text) return;

    const words = text
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
      .filter(Boolean);

    words.forEach((word) => {
      counts.set(word, (counts.get(word) || 0) + 1);
    });
  });

  return counts;
}

function calculateWordSize(count, minCount, maxCount, index = 0) {
  const minSize = 1.1; // rem
  const maxSize = 3.8; // rem

  if (maxCount === minCount) {
    const steps = [3.6, 2.2, 3.2, 2.8, 1.2, 2.7, 2.1];
    return steps[index % steps.length];
  }

  const ratio = (count - minCount) / (maxCount - minCount);
  return (minSize + ratio * (maxSize - minSize)).toFixed(2);
}

// =========================================================================
// 5. ADMIN ACTIONS
// =========================================================================
publishBtn.addEventListener("click", async () => {
  const newQuestion = questionInput.value.trim();
  if (!newQuestion) {
    showToast("
