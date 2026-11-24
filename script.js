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

const orientationPattern = [
  { writing: "horizontal-tb", angle: 0 },
  { writing: "vertical-rl", angle: 180 },
  { writing: "horizontal-tb", angle: 0 },
  { writing: "vertical-rl", angle: 0 },
  { writing: "horizontal-tb", angle: 0 },
  { writing: "horizontal-tb", angle: 0 }
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
      const { writing, angle } = getWordOrientation(word, index);
      const safeWord = escapeHTML(word);

      return `
        <span
          class="word-cloud-item"
          style="font-size: ${fontSizeRem}rem; color: ${color}; --word-writing: ${writing}; --word-angle: ${angle}deg;"
          title="${safeWord} (${count})"
        >${safeWord}</span>
      `;
    })
    .join("");
}

function getWordOrientation(word, index) {
  let hash = index;
  for (let i = 0; i < word.length; i++) {
    hash = (hash * 31 + word.charCodeAt(i)) % 1000;
  }
  return orientationPattern[hash % orientationPattern.length];
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
  const minSize = 1.05; // rem
  const maxSize = 3.8;  // rem

  if (maxCount === minCount) {
    const steps = [3.6, 2.0, 3.1, 2.5, 1.15, 2.4, 1.9];
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
    showToast("Please enter a question first.");
    return;
  }

  publishBtn.disabled = true;
  try {
    await setDoc(sessionDocRef, {
      question: newQuestion,
      updatedAt: serverTimestamp()
    });
    showToast("Question published live!");
  } catch (err) {
    console.error(err);
    showToast("Failed to publish question.");
  } finally {
    publishBtn.disabled = false;
  }
});

newQuestionBtn.addEventListener("click", () => {
  questionInput.value = "";
  questionInput.focus();
});

clearResponsesBtn.addEventListener("click", async () => {
  if (latestResponses.length === 0) {
    showToast("No responses to clear.");
    return;
  }

  const confirmed = confirm(
    "Are you sure you want to delete all current responses? This cannot be undone."
  );
  if (!confirmed) return;

  clearResponsesBtn.disabled = true;
  try {
    const snapshot = await getDocs(responsesColRef);
    const deletePromises = snapshot.docs.map((d) => deleteDoc(d.ref));
    await Promise.all(deletePromises);
    showToast("All responses cleared.");
  } catch (err) {
    console.error(err);
    showToast("Error clearing responses.");
  } finally {
    clearResponsesBtn.disabled = false;
  }
});

exportCsvBtn.addEventListener("click", () => {
  if (latestResponses.length === 0) {
    showToast("No responses available to export.");
    return;
  }

  const headers = ["Participant Name", "Response", "Submission Time"];
  const rows = latestResponses.map((r) => [
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
  link.setAttribute("download", `qr-responses-${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast("CSV exported!");
});

copyLinkBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shareUrlInput.value);
    showToast("Participant link copied!");
  } catch {
    shareUrlInput.select();
    document.execCommand("copy");
    showToast("Participant link copied!");
  }
});

// =========================================================================
// 6. PARTICIPANT ACTIONS
// =========================================================================
responseForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = participantNameInput.value.trim();
  const answer = participantAnswerInput.value.trim();

  if (!name || !answer) return;

  submitResponseBtn.disabled = true;
  submitResponseBtn.textContent = "Sending...";

  try {
    await addDoc(responsesColRef, {
      name,
      answer,
      createdAtMs: Date.now()
    });

    responseForm.classList.add("hidden");
    submissionConfirmation.classList.remove("hidden");
    participantAnswerInput.value = "";
  } catch (err) {
    console.error("Submission error:", err);
    showToast("Could not submit response. Check your connection.");
  } finally {
    submitResponseBtn.disabled = false;
    submitResponseBtn.textContent = "Send Response";
  }
});

submitAnotherBtn.addEventListener("click", () => {
  submissionConfirmation.classList.add("hidden");
  responseForm.classList.remove("hidden");
  participantAnswerInput.focus();
});

// =========================================================================
// 7. UI CONTROLS (FULLSCREEN, DARK MODE)
// =========================================================================
fullscreenBtn.addEventListener("click", () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {
      showToast("Fullscreen blocked by browser.");
    });
  } else {
    document.exitFullscreen();
  }
});

themeToggleBtn.addEventListener("click", () => {
  document.body.classList.toggle("dark-mode");
  const isDark = document.body.classList.contains("dark-mode");
  themeToggleBtn.textContent = isDark ? "☀️" : "🌙";
  localStorage.setItem("qr-board-theme", isDark ? "dark" : "light");
});

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
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  setTimeout(() => {
    toastEl.classList.add("hidden");
  }, 3000);
}

// Launch App
initApp();
