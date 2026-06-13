import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, onChildAdded, onValue, update, onChildChanged, onDisconnect, get } from 'firebase/database';

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
const btnNotifToggle = document.getElementById('btn-notif-toggle');

// Calendar and Toast Elements
const btnCalendar = document.getElementById('btn-calendar');
const datePicker = document.getElementById('date-picker');
const toastBanner = document.getElementById('toast-banner');
const toastText = document.getElementById('toast-text');

// Application States
let currentUser = null;
let userAName = 'anuu';
let userBName = 'anu'; // Track the user B name configured dynamically
let otherUser = null;
let loadedMessages = new Set();
let lastMessageDateStr = '';
let lastMessageSender = '';
let lastMessageTimestamp = 0;
let toastTimeout = null;
let isClientConnected = false;
let otherUserPresence = { state: 'offline', last_changed: null };
let otherUserTyping = false;
let chatNotificationsEnabled = false;
try {
  chatNotificationsEnabled = localStorage.getItem('amio_notifications') === 'true';
} catch (e) {
  console.warn('localStorage is blocked or unavailable:', e);
}

async function init() {
  try {
    // Fetch configuration dynamically from Vercel Serverless API
    const configRes = await fetch('/api/config');
    const firebaseConfig = await configRes.json();
    
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    
    userAName = firebaseConfig.userA.name;
    userBName = firebaseConfig.userB.name;
    
    // Build user codes mapping dynamically from backend env variables
    USER_CODES[firebaseConfig.userA.code] = { name: firebaseConfig.userA.name, initials: firebaseConfig.userA.initials };
    USER_CODES[firebaseConfig.userB.code] = { name: firebaseConfig.userB.name, initials: firebaseConfig.userB.initials };
    
    // Always show passcode screen first (do not persist/remember session)
    showScreen('passcode-screen');
    setTimeout(() => passcodeInput.focus(), 400);
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
  otherUser = (username === userAName) ? userBName : userAName;
  
  // Update header room title to the other user's name
  const roomTitleEl = document.getElementById('room-title');
  if (roomTitleEl) {
    roomTitleEl.textContent = otherUser;
  }
  
  // Set avatar text based on initials dynamically
  let initials = 'U';
  for (const code in USER_CODES) {
    if (USER_CODES[code].name === username) {
      initials = USER_CODES[code].initials;
      break;
    }
  }
  userAvatar.textContent = initials;
  
  updateNotifToggleButton();
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
    
    // Trigger security alert notification when User B logs in
    if (userObj.name === userBName) {
      sendLoginAlert(userObj.name);
    }
  } else {
    resetPasscode(true);
  }
}

function sendLoginAlert(username) {
  fetch('/api/alert', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ user: username })
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
  
  // Auto-focus input when user starts typing anywhere on passcode screen (useful for desktop keyboards)
  document.addEventListener('keydown', (e) => {
    // Avoid triggering if it's a modifier key or special command
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    
    if (passcodeScreen.classList.contains('active')) {
      if (document.activeElement !== passcodeInput) {
        passcodeInput.focus();
      }
    }
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
  let typingTimeout = null;

  btnLogout.addEventListener('click', () => {
    if (currentUser) {
      // Set presence offline
      update(ref(db, `presence/${currentUser}`), {
        state: 'offline',
        last_changed: Date.now()
      });
      // Clear typing
      update(ref(db, 'typing'), { [currentUser]: false });
    }
    currentUser = null;
    otherUser = null;
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
  
  messageInput.addEventListener('input', () => {
    if (!currentUser) return;
    
    update(ref(db, 'typing'), { [currentUser]: true });
    
    if (typingTimeout) clearTimeout(typingTimeout);
    
    typingTimeout = setTimeout(() => {
      update(ref(db, 'typing'), { [currentUser]: false });
    }, 2000);
  });

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !currentUser) return;
    
    if (typingTimeout) clearTimeout(typingTimeout);
    update(ref(db, 'typing'), { [currentUser]: false });

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
  
  // Notification Toggle trigger
  btnNotifToggle.addEventListener('click', () => {
    if (!currentUser) return;
    
    chatNotificationsEnabled = !chatNotificationsEnabled;
    try {
      localStorage.setItem('amio_notifications', chatNotificationsEnabled);
    } catch (e) {
      console.warn('localStorage write failed:', e);
    }
    
    // Request permission if enabling
    if (chatNotificationsEnabled && typeof Notification !== 'undefined') {
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }
    
    updateNotifToggleButton();
    showToast(`Message notifications ${chatNotificationsEnabled ? 'enabled' : 'muted'}`);
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
  // Presence ref for currentUser
  const userPresenceRef = ref(db, `presence/${currentUser}`);

  // Database connection status listener
  const connectedRef = ref(db, '.info/connected');
  onValue(connectedRef, (snap) => {
    isClientConnected = snap.val() === true;
    if (isClientConnected) {
      update(userPresenceRef, {
        state: 'online',
        last_changed: Date.now()
      });
      onDisconnect(userPresenceRef).update({
        state: 'offline',
        last_changed: Date.now()
      });
    }
    updateHeaderPresence();
  });
  
  // Other user's presence listener
  const otherPresenceRef = ref(db, `presence/${otherUser}`);
  onValue(otherPresenceRef, (snap) => {
    const val = snap.val();
    otherUserPresence = val || { state: 'offline', last_changed: null };
    updateHeaderPresence();
  });

  // Other user's typing listener
  const otherTypingRef = ref(db, `typing/${otherUser}`);
  onValue(otherTypingRef, (snap) => {
    otherUserTyping = snap.val() === true;
    updateHeaderPresence();
    if (otherUserTyping) {
      renderTypingIndicator();
    } else {
      const indicator = document.getElementById('typing-indicator');
      if (indicator) indicator.remove();
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
    
    // Mark incoming messages as seen
    if (message.sender !== currentUser && !message.seen) {
      update(ref(db, `messages/${msgId}`), { seen: true });
      message.seen = true;
      
      // Play sound / trigger desktop notification
      if (chatNotificationsEnabled && hasLoadedInitial) {
        playNotificationChime();
        if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification(`New message from ${message.sender}`, {
            body: message.text,
            tag: 'amio-chat'
          });
        }
      }
    }

    renderMessage(message, msgId);
  });

  // Real-time read receipt updates
  onChildChanged(messagesRef, (snapshot) => {
    const msgId = snapshot.key;
    const message = snapshot.val();
    const msgEl = document.getElementById(`msg-${msgId}`);
    if (msgEl && message.sender === currentUser) {
      const iconEl = msgEl.querySelector('.message-meta i');
      if (iconEl) {
        if (message.seen) {
          iconEl.className = 'ph-bold ph-checks seen-blue';
        } else {
          iconEl.className = 'ph-bold ph-check';
        }
      }
    }
  });
}

function updateNotifToggleButton() {
  const icon = btnNotifToggle.querySelector('i');
  if (icon) {
    if (chatNotificationsEnabled) {
      icon.className = 'ph-bold ph-bell';
      btnNotifToggle.title = 'Message notifications: Enabled';
      btnNotifToggle.style.color = '';
    } else {
      icon.className = 'ph-bold ph-bell-slash';
      btnNotifToggle.title = 'Message notifications: Muted';
      btnNotifToggle.style.color = 'var(--colors-muted)';
    }
  }
}

function playNotificationChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    // Double ping
    osc.frequency.setValueAtTime(523.25, ctx.currentTime);
    osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.08);
    
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {
    console.error("Audio chime play error:", e);
  }
}

function updateHeaderPresence() {
  const statusTextEl = document.getElementById('status-text');
  const connectionStatusEl = document.querySelector('.connection-status');
  
  if (!isClientConnected) {
    statusTextEl.textContent = "Reconnecting...";
    connectionStatusEl.className = "connection-status disconnected";
    return;
  }
  
  if (otherUserTyping) {
    statusTextEl.textContent = "typing...";
    connectionStatusEl.className = "connection-status connected";
    return;
  }
  
  if (otherUserPresence.state === 'online') {
    statusTextEl.textContent = "Active now";
    connectionStatusEl.className = "connection-status connected";
  } else {
    connectionStatusEl.className = "connection-status offline";
    if (otherUserPresence.last_changed) {
      statusTextEl.textContent = `Last seen ${formatLastSeen(otherUserPresence.last_changed)}`;
    } else {
      statusTextEl.textContent = "Offline";
    }
  }
}

function formatLastSeen(timestamp) {
  const diffMs = Date.now() - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function renderTypingIndicator() {
  if (document.getElementById('typing-indicator')) return;
  
  const indicator = document.createElement('div');
  indicator.className = 'message-wrapper incoming typing-wrapper';
  indicator.id = 'typing-indicator';
  
  indicator.innerHTML = `
    <span class="message-sender">${otherUser}</span>
    <div class="message-bubble typing-bubble">
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
    </div>
  `;
  chatMessages.appendChild(indicator);
  scrollToBottom(true);
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
      ${isOutgoing ? (msg.seen ? '<i class="ph-bold ph-checks seen-blue"></i>' : '<i class="ph-bold ph-check"></i>') : ''}
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
