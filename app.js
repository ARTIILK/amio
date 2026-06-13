import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, onChildAdded, onValue } from 'firebase/database';

// Declare Firebase variables (loaded dynamically from serverless config)
let app;
let db;

// User code dictionary built dynamically from Vercel config API
let USER_CODES = {};

// UI Elements
const passcodeScreen = document.getElementById('passcode-screen');
const chatScreen = document.getElementById('chat-screen');
const passcodeCard = document.querySelector('.passcode-card');
const passcodeInput = document.getElementById('passcode-input');
const dots = document.querySelectorAll('.dot');
const loginError = document.getElementById('login-error');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const messageInput = document.getElementById('message-input');
const btnLogout = document.getElementById('btn-logout');
const userAvatar = document.getElementById('user-avatar');
const statusText = document.getElementById('status-text');
const connectionStatus = document.querySelector('.connection-status');
const btnScrollBottom = document.getElementById('btn-scroll-bottom');

// Calendar and Toast Elements
const btnCalendar = document.getElementById('btn-calendar');
const datePicker = document.getElementById('date-picker');
const toastBanner = document.getElementById('toast-banner');
const toastText = document.getElementById('toast-text');

// Application States
let currentUser = null;
let loadedMessages = new Set();
let lastMessageDateStr = '';
let lastMessageSender = '';
let lastMessageTimestamp = 0;
let toastTimeout = null;

async function init() {
  try {
    // Fetch configuration dynamically from Vercel Serverless API
    const configRes = await fetch('/api/config');
    const firebaseConfig = await configRes.json();
    
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    
    // Build user codes mapping dynamically from backend env variables
    USER_CODES[firebaseConfig.userA.code] = { name: firebaseConfig.userA.name, initials: firebaseConfig.userA.initials };
    USER_CODES[firebaseConfig.userB.code] = { name: firebaseConfig.userB.name, initials: firebaseConfig.userB.initials };
    
    // Check for existing session using dynamic usernames
    const savedUser = localStorage.getItem('chatUser');
    const userAName = firebaseConfig.userA.name;
    const userBName = firebaseConfig.userB.name;
    if (savedUser && (savedUser === userAName || savedUser === userBName)) {
      loginAs(savedUser);
    } else {
      showScreen('passcode-screen');
      setTimeout(() => passcodeInput.focus(), 400);
    }
    setupAuthEvents();
    setupChatEvents();
  } catch (err) {
    console.error("Configuration load failed: ", err);
    statusText.textContent = "Config Error";
    connectionStatus.className = "connection-status disconnected";
  }
}

function showScreen(screenId) {
  if (screenId === 'passcode-screen') {
    chatScreen.classList.remove('active');
    passcodeScreen.classList.add('active');
  } else {
    passcodeScreen.classList.remove('active');
    chatScreen.classList.add('active');
  }
}

function loginAs(username) {
  currentUser = username;
  localStorage.setItem('chatUser', currentUser);
  
  // Set avatar text based on initials dynamically
  let initials = 'U';
  for (const code in USER_CODES) {
    if (USER_CODES[code].name === username) {
      initials = USER_CODES[code].initials;
      break;
    }
  }
  userAvatar.textContent = initials;
  
  showScreen('chat-screen');
  startChatListening();
}

function resetPasscode(isError = false) {
  passcodeInput.value = '';
  dots.forEach(dot => {
    dot.classList.remove('active');
    if (isError) {
      dot.classList.add('error');
      setTimeout(() => dot.classList.remove('error'), 800);
    }
  });
  
  if (isError) {
    passcodeCard.classList.add('shake');
    loginError.classList.add('show');
    setTimeout(() => {
      passcodeCard.classList.remove('shake');
    }, 400);
  } else {
    loginError.classList.remove('show');
  }
}

function updateDots(val) {
  dots.forEach((dot, index) => {
    if (index < val.length) {
      dot.classList.add('active');
    } else {
      dot.classList.remove('active');
    }
  });
}

function verifyPasscode(code) {
  if (USER_CODES[code]) {
    const userObj = USER_CODES[code];
    loginAs(userObj.name);
    resetPasscode(false);
    
    // Trigger security alert notification when anu logs in
    if (userObj.name === 'anu') {
      sendLoginAlert();
    }
  } else {
    resetPasscode(true);
  }
}

function sendLoginAlert() {
  fetch('/api/alert', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ user: 'anu' })
  })
  .then(res => res.json())
  .then(data => {
    console.log('Login alert API response:', data);
  })
  .catch(err => {
    console.error('Failed to trigger login alert:', err);
  });
}

function setupAuthEvents() {
  passcodeCard.addEventListener('click', () => {
    passcodeInput.focus();
  });
  
  passcodeInput.addEventListener('input', (e) => {
    const val = e.target.value;
    updateDots(val);
    if (val.length === 6) {
      verifyPasscode(val);
    }
  });
  
  const keyBtns = document.querySelectorAll('.key-btn[data-val]');
  keyBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const digit = btn.getAttribute('data-val');
      if (passcodeInput.value.length < 6) {
        passcodeInput.value += digit;
        updateDots(passcodeInput.value);
        if (passcodeInput.value.length === 6) {
          verifyPasscode(passcodeInput.value);
        }
      }
    });
  });
  
  document.getElementById('key-clear').addEventListener('click', (e) => {
    e.stopPropagation();
    resetPasscode(false);
  });
  
  document.getElementById('key-backspace').addEventListener('click', (e) => {
    e.stopPropagation();
    passcodeInput.value = passcodeInput.value.slice(0, -1);
    updateDots(passcodeInput.value);
  });
}

function setupChatEvents() {
  btnLogout.addEventListener('click', () => {
    localStorage.removeItem('chatUser');
    currentUser = null;
    chatMessages.innerHTML = `
      <div class="loading-messages">
        <div class="spinner"></div>
        <p>Loading messages...</p>
      </div>
    `;
    loadedMessages.clear();
    lastMessageDateStr = '';
    lastMessageSender = '';
    lastMessageTimestamp = 0;
    resetPasscode(false);
    showScreen('passcode-screen');
    setTimeout(() => passcodeInput.focus(), 500);
  });
  
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !currentUser) return;
    
    const messagesRef = ref(db, 'messages');
    push(messagesRef, {
      sender: currentUser,
      text: text,
      timestamp: Date.now()
    }).catch(err => {
      console.error("Database write error: ", err);
    });
    
    messageInput.value = '';
    messageInput.focus();
  });
  
  chatMessages.addEventListener('scroll', () => {
    const threshold = 150;
    const isScrolledUp = (chatMessages.scrollHeight - chatMessages.clientHeight - chatMessages.scrollTop) > threshold;
    if (isScrolledUp) {
      btnScrollBottom.classList.add('active');
    } else {
      btnScrollBottom.classList.remove('active');
    }
  });
  
  btnScrollBottom.addEventListener('click', () => {
    scrollToBottom(true);
  });
  
  // Calendar trigger
  btnCalendar.addEventListener('click', () => {
    if (typeof datePicker.showPicker === 'function') {
      datePicker.showPicker();
    } else {
      datePicker.click();
    }
  });
  
  // Date Picker selection change
  datePicker.addEventListener('change', (e) => {
    const selectedDate = e.target.value; // Format: YYYY-MM-DD
    if (!selectedDate) return;
    
    const targetDiv = document.querySelector(`.date-separator[data-date="${selectedDate}"]`);
    if (targetDiv) {
      targetDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
      
      // Pulse animation to highlight date selection
      targetDiv.classList.add('highlight-active');
      setTimeout(() => targetDiv.classList.remove('highlight-active'), 2000);
      
      // Also highlight the first message next to it
      const firstMsg = targetDiv.nextElementSibling;
      if (firstMsg && firstMsg.classList.contains('message-wrapper')) {
        firstMsg.classList.add('highlight-active');
        setTimeout(() => firstMsg.classList.remove('highlight-active'), 2000);
      }
    } else {
      // Find friendly date name and alert
      showToast(`No messages on ${formatFriendlyDate(selectedDate)}`);
    }
    
    datePicker.value = ''; // Reset selection
  });
}

function showToast(msg) {
  if (toastTimeout) clearTimeout(toastTimeout);
  toastText.textContent = msg;
  toastBanner.classList.add('active');
  toastTimeout = setTimeout(() => {
    toastBanner.classList.remove('active');
  }, 3000);
}

function formatFriendlyDate(dateString) {
  const [year, month, day] = dateString.split('-');
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function startChatListening() {
  // Database connection status listener
  const connectedRef = ref(db, '.info/connected');
  onValue(connectedRef, (snap) => {
    if (snap.val() === true) {
      statusText.textContent = "Connected";
      connectionStatus.className = "connection-status connected";
    } else {
      statusText.textContent = "Reconnecting...";
      connectionStatus.className = "connection-status disconnected";
    }
  });
  
  let hasLoadedInitial = false;
  setTimeout(() => {
    if (!hasLoadedInitial) {
      const loader = document.querySelector('.loading-messages');
      if (loader) loader.remove();
      hasLoadedInitial = true;
    }
  }, 3000);
  
  // Real-time messages sync
  const messagesRef = ref(db, 'messages');
  onChildAdded(messagesRef, (snapshot) => {
    const msgId = snapshot.key;
    if (loadedMessages.has(msgId)) return;
    loadedMessages.add(msgId);
    
    if (!hasLoadedInitial) {
      const loader = document.querySelector('.loading-messages');
      if (loader) loader.remove();
      hasLoadedInitial = true;
    }
    
    const message = snapshot.val();
    renderMessage(message, msgId);
  });
}

function renderMessage(msg, id) {
  const isOutgoing = msg.sender === currentUser;
  const timestamp = new Date(msg.timestamp);
  const timeFormatted = timestamp.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  
  const dateStr = timestamp.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const year = timestamp.getFullYear();
  const month = String(timestamp.getMonth() + 1).padStart(2, '0');
  const day = String(timestamp.getDate()).padStart(2, '0');
  const isoDate = `${year}-${month}-${day}`;
  
  // Render Date Separator if date shifts
  if (dateStr !== lastMessageDateStr) {
    const dateDiv = document.createElement('div');
    dateDiv.className = 'date-separator';
    dateDiv.setAttribute('data-date', isoDate);
    
    const today = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = yesterdayDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    
    let displayDate = dateStr;
    if (dateStr === today) {
      displayDate = "Today";
    } else if (dateStr === yesterday) {
      displayDate = "Yesterday";
    }
    
    dateDiv.innerHTML = `<span class="date-text">${displayDate}</span>`;
    chatMessages.appendChild(dateDiv);
  } else {
    // If date has not changed, check if time gap is >= 15 minutes to show time separators like Instagram
    const diffMs = msg.timestamp - lastMessageTimestamp;
    const diffMins = diffMs / (1000 * 60);
    if (diffMins >= 15 && lastMessageTimestamp > 0) {
      const timeGapDiv = document.createElement('div');
      timeGapDiv.className = 'time-gap-separator';
      timeGapDiv.textContent = timeFormatted;
      chatMessages.appendChild(timeGapDiv);
    }
  }
  
  // Check if message is consecutive (same sender, same date, within 15 mins)
  let isConsecutive = false;
  if (lastMessageSender === msg.sender && lastMessageDateStr === dateStr && (msg.timestamp - lastMessageTimestamp) < 15 * 60 * 1000) {
    isConsecutive = true;
  }
  
  const msgWrapper = document.createElement('div');
  msgWrapper.className = `message-wrapper ${isOutgoing ? 'outgoing' : 'incoming'} ${isConsecutive ? 'consecutive' : ''}`;
  msgWrapper.id = `msg-${id}`;
  
  msgWrapper.innerHTML = `
    <span class="message-sender">${msg.sender}</span>
    <div class="message-bubble">
      ${escapeHtml(msg.text)}
    </div>
    <div class="message-meta">
      <span>${timeFormatted}</span>
      ${isOutgoing ? '<i class="ph-bold ph-checks"></i>' : ''}
    </div>
  `;
  
  // Click-to-reveal mobile timestamp trigger
  msgWrapper.addEventListener('click', (e) => {
    e.stopPropagation();
    msgWrapper.classList.toggle('show-time');
  });
  
  chatMessages.appendChild(msgWrapper);
  
  // Update rendering track states
  lastMessageSender = msg.sender;
  lastMessageDateStr = dateStr;
  lastMessageTimestamp = msg.timestamp;
  
  scrollToBottom(true);
}

function scrollToBottom(smooth = true) {
  setTimeout(() => {
    chatMessages.scrollTo({
      top: chatMessages.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
  }, 50);
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

window.addEventListener('DOMContentLoaded', init);
