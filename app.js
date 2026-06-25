import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, onChildAdded, onValue, update, onChildChanged, onDisconnect, get } from 'firebase/database';

// Declare Firebase variables (loaded dynamically from serverless config)
let app;
let db;

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
const btnLogout = document.getElementById('btn-sidebar-logout');
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
let currentUserRole = 'user'; // 'admin' | 'user'
let currentUserPasscode = '';
let activeRoomId = null;
let activeRoomName = '';
let activeRoomMembers = {};
let allUsers = {}; // Map of passcode -> { name, isAdmin }
let allRooms = {}; // Map of roomId -> { name, admin, members }
let membersPresence = {}; // Map of username -> { state, last_changed }

let userAName = 'anuu';
let userBName = 'anu'; // Track the user B name configured dynamically

let loadedMessages = new Set();
let lastMessageDateStr = '';
let lastMessageSender = '';
let lastMessageTimestamp = 0;
let toastTimeout = null;
let isClientConnected = false;
let chatNotificationsEnabled = false;

let activeRoomUnsubscribes = [];
let globalUnsubscribes = [];

try {
  chatNotificationsEnabled = localStorage.getItem('amio_notifications') === 'true';
} catch (e) {
  console.warn('localStorage is blocked or unavailable:', e);
}

// Case-insensitive user matching helper (handles legacy Anuska/Prince names vs Annu/Junnu)
function isSenderCurrentUser(sender, current) {
  if (!sender || !current) return false;
  const s = sender.toLowerCase().trim();
  const c = current.toLowerCase().trim();
  if (s === c) return true;
  
  // Map legacy names to new config names case-insensitively
  if ((c === 'annu' || c === 'prince' || c === 'annuu') && (s === 'annu' || s === 'prince' || s === 'annuu')) {
    return true;
  }
  if ((c === 'junnu' || c === 'anuska' || c === 'junnuu') && (s === 'junnu' || s === 'anuska' || s === 'junnuu')) {
    return true;
  }
  return false;
}

// Initialize Application
async function init() {
  try {
    // Fetch configuration dynamically from Vercel Serverless API
    const configRes = await fetch('/api/config');
    const firebaseConfig = await configRes.json();
    
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    
    userAName = firebaseConfig.userA.name;
    userBName = firebaseConfig.userB.name;
    
    // Check and seed the database if the users registry is empty
    const usersRef = ref(db, 'users');
    const usersSnap = await get(usersRef);
    if (!usersSnap.exists()) {
      const updates = {};
      // Seed default admin and user
      updates[`users/${firebaseConfig.userA.code}`] = { name: firebaseConfig.userA.name, isAdmin: true };
      updates[`users/${firebaseConfig.userB.code}`] = { name: firebaseConfig.userB.name, isAdmin: false };
      
      // Seed default "General Chat" room
      const defaultRoomId = 'general';
      updates[`rooms/${defaultRoomId}`] = {
        name: 'General Chat',
        admin: firebaseConfig.userA.name,
        members: {
          [firebaseConfig.userA.name]: true,
          [firebaseConfig.userB.name]: true
        }
      };
      
      await update(ref(db), updates);
    }
    
    // Always show passcode screen first (do not persist/remember session)
    showScreen('passcode-screen');
    setTimeout(() => passcodeInput.focus(), 400);
    setupAuthEvents();
    setupChatEvents();
    setupModalEvents();
    setupSidebarEvents();
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

// Log in as a verified user
function loginAs(username, isAdmin) {
  currentUser = username;
  currentUserRole = isAdmin ? 'admin' : 'user';
  
  // Set profile info in sidebar
  document.getElementById('my-name').textContent = username;
  document.getElementById('my-role').textContent = isAdmin ? 'Admin' : 'User';
  document.getElementById('my-avatar').textContent = username.slice(0, 2).toUpperCase();
  
  // Toggle Admin components
  const adminElements = document.querySelectorAll('.admin-only');
  adminElements.forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });
  
  // Clear any selection state
  activeRoomId = null;
  activeRoomName = '';
  activeRoomMembers = {};
  
  // Clear message feed and show fallback selector
  chatMessages.innerHTML = `
    <div class="select-room-fallback">
      <i class="ph-bold ph-chats-teardrop"></i>
      <h3>No Active Chat</h3>
      <p>Choose a room from the sidebar menu to start exchanging messages.</p>
    </div>
  `;
  chatForm.style.display = 'none';
  document.getElementById('room-title').textContent = "Select a Room";
  userAvatar.innerHTML = '<i class="ph-bold ph-user"></i>';
  document.getElementById('btn-calendar').style.display = 'none';
  document.getElementById('btn-scroll-bottom').style.display = 'none';
  document.getElementById('btn-room-settings').style.display = 'none';
  
  updateNotifToggleButton();
  showScreen('chat-screen');
  
  // Setup global listeners (rooms list, users list, and migration alerts)
  startGlobalListeners();
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

// Verify passcode against Database Users Registry
async function verifyPasscode(code) {
  try {
    const userRef = ref(db, `users/${code}`);
    const userSnap = await get(userRef);
    if (userSnap.exists()) {
      const userObj = userSnap.val();
      currentUserPasscode = code;
      resetPasscode(false);
      loginAs(userObj.name, userObj.isAdmin);
      
      // Trigger security alert notification when User B logs in
      if (userObj.name === userBName) {
        sendLoginAlert(userObj.name);
      }
    } else {
      resetPasscode(true);
    }
  } catch (err) {
    console.error("Passcode verification failed:", err);
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

// Setup Keyboard/Keypad Authentication Screen listeners
function setupAuthEvents() {
  passcodeCard.addEventListener('click', () => {
    passcodeInput.focus();
  });
  
  document.addEventListener('keydown', (e) => {
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

// Global Listeners for Authenticated State
function startGlobalListeners() {
  // Clear any existing global listeners
  globalUnsubscribes.forEach(unsub => unsub());
  globalUnsubscribes = [];
  
  // 1. Listen to Rooms
  const roomsRef = ref(db, 'rooms');
  const roomsUnsub = onValue(roomsRef, (snapshot) => {
    allRooms = snapshot.val() || {};
    renderRoomsList();
  });
  globalUnsubscribes.push(roomsUnsub);
  
  // 2. Setup presence state and disconnect hooks
  const userPresenceRef = ref(db, `presence/${currentUser}`);
  const connectedRef = ref(db, '.info/connected');
  const connectedUnsub = onValue(connectedRef, (snap) => {
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
    updateHeaderStatus();
  });
  globalUnsubscribes.push(connectedUnsub);
  
  // 3. Admin-only listeners (Users list & Legacy Migration prompt)
  if (currentUserRole === 'admin') {
    const usersRef = ref(db, 'users');
    const usersUnsub = onValue(usersRef, (snapshot) => {
      allUsers = snapshot.val() || {};
      renderUsersList();
      populateMemberSelectionLists();
    });
    globalUnsubscribes.push(usersUnsub);
    
    const legacyMessagesRef = ref(db, 'messages');
    const legacyUnsub = onValue(legacyMessagesRef, (snapshot) => {
      const migrationSection = document.getElementById('migration-section');
      if (snapshot.exists() && Object.keys(snapshot.val()).length > 0) {
        migrationSection.style.display = '';
      } else {
        migrationSection.style.display = 'none';
      }
    });
    globalUnsubscribes.push(legacyUnsub);
  }
}

// Render Joined Rooms in the Sidebar
function renderRoomsList() {
  const roomsListEl = document.getElementById('rooms-list');
  roomsListEl.innerHTML = '';
  
  let joinedRoomsCount = 0;
  
  for (const roomId in allRooms) {
    const room = allRooms[roomId];
    
    // Render only if user is listed in members
    if (room.members && room.members[currentUser]) {
      joinedRoomsCount++;
      const roomItem = document.createElement('div');
      roomItem.className = `room-item ${roomId === activeRoomId ? 'active' : ''}`;
      roomItem.setAttribute('data-id', roomId);
      
      const memberCount = Object.keys(room.members).length;
      
      roomItem.innerHTML = `
        <div class="room-item-info">
          <span class="room-icon"><i class="ph-bold ph-hash"></i></span>
          <span class="room-name">${escapeHtml(room.name)}</span>
        </div>
        <span class="user-badge">${memberCount} members</span>
      `;
      
      roomItem.addEventListener('click', () => {
        switchActiveRoom(roomId);
      });
      
      roomsListEl.appendChild(roomItem);
    }
  }
  
  if (joinedRoomsCount === 0) {
    roomsListEl.innerHTML = `
      <div style="padding: 16px; text-align: center; font-size: 13px; color: var(--colors-muted);">
        You haven't joined any rooms yet.
      </div>
    `;
  }
}

// Render User Accounts for Admin Management
function renderUsersList() {
  const usersListEl = document.getElementById('users-list');
  usersListEl.innerHTML = '';
  
  for (const passcode in allUsers) {
    const user = allUsers[passcode];
    const isSelf = passcode === currentUserPasscode;
    
    const userItem = document.createElement('div');
    userItem.className = 'user-item';
    
    const deleteButton = isSelf ? '' : `
      <button class="user-delete-btn" data-code="${passcode}" title="Delete User">
        <i class="ph-bold ph-trash"></i>
      </button>
    `;
    
    userItem.innerHTML = `
      <div class="user-item-info">
        <span class="user-name">${escapeHtml(user.name)}</span>
        ${user.isAdmin ? '<span class="user-badge">Admin</span>' : ''}
      </div>
      ${deleteButton}
    `;
    
    if (!isSelf) {
      userItem.querySelector('.user-delete-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Are you sure you want to delete user "${user.name}"?`)) {
          await deleteUser(passcode);
        }
      });
    }
    
    usersListEl.appendChild(userItem);
  }
}

// Populates member selection checklists inside modals
function populateMemberSelectionLists() {
  const createMembersList = document.getElementById('create-room-members');
  const migrateMembersList = document.getElementById('migrate-room-members');
  
  createMembersList.innerHTML = '';
  migrateMembersList.innerHTML = '';
  
  for (const passcode in allUsers) {
    const user = allUsers[passcode];
    
    // 1. Create Room list item
    const createLabel = document.createElement('label');
    createLabel.className = 'member-select-item';
    const createCheckbox = document.createElement('input');
    createCheckbox.type = 'checkbox';
    createCheckbox.name = 'create-member';
    createCheckbox.value = user.name;
    if (user.name === currentUser) {
      createCheckbox.checked = true;
      createCheckbox.disabled = true; // Include self by default
    }
    createLabel.appendChild(createCheckbox);
    createLabel.appendChild(document.createTextNode(` ${user.name}`));
    createMembersList.appendChild(createLabel);
    
    // 2. Migrate Room list item
    const migrateLabel = document.createElement('label');
    migrateLabel.className = 'member-select-item';
    const migrateCheckbox = document.createElement('input');
    migrateCheckbox.type = 'checkbox';
    migrateCheckbox.name = 'migrate-member';
    migrateCheckbox.value = user.name;
    if (user.name === currentUser) {
      migrateCheckbox.checked = true;
      migrateCheckbox.disabled = true; // Include self by default
    }
    migrateLabel.appendChild(migrateCheckbox);
    migrateLabel.appendChild(document.createTextNode(` ${user.name}`));
    migrateMembersList.appendChild(migrateLabel);
  }
}

// Populates member selection checklist inside Room Settings modal
function populateSettingsMembersList() {
  const settingsMembersEl = document.getElementById('room-settings-members');
  settingsMembersEl.innerHTML = '';
  
  for (const passcode in allUsers) {
    const user = allUsers[passcode];
    
    const label = document.createElement('label');
    label.className = 'member-select-item';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'settings-member';
    checkbox.value = user.name;
    
    if (activeRoomMembers && activeRoomMembers[user.name]) {
      checkbox.checked = true;
    }
    
    if (user.name === currentUser) {
      checkbox.checked = true;
      checkbox.disabled = true; // Cannot remove self
    }
    
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(` ${user.name}`));
    settingsMembersEl.appendChild(label);
  }
}

// Switching rooms & managing real-time listeners
function switchActiveRoom(roomId) {
  if (activeRoomId === roomId) return;
  
  clearActiveRoomListeners();
  
  activeRoomId = roomId;
  activeRoomName = allRooms[roomId].name;
  activeRoomMembers = allRooms[roomId].members || {};
  membersPresence = {};
  
  // Highlight active room item
  const roomItems = document.querySelectorAll('.room-item');
  roomItems.forEach(item => {
    if (item.getAttribute('data-id') === roomId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
  
  // Update header content
  document.getElementById('room-title').textContent = activeRoomName;
  userAvatar.textContent = getRoomInitials(activeRoomName);
  
  // Show header elements
  document.getElementById('btn-calendar').style.display = '';
  document.getElementById('btn-scroll-bottom').style.display = '';
  
  // Show settings gear if admin
  const btnRoomSettings = document.getElementById('btn-room-settings');
  if (btnRoomSettings) {
    btnRoomSettings.style.display = currentUserRole === 'admin' ? '' : 'none';
  }
  
  // Show message list spinner
  chatMessages.innerHTML = `
    <div class="loading-messages">
      <div class="spinner"></div>
      <p>Loading messages...</p>
    </div>
  `;
  
  // Reset message variables
  loadedMessages.clear();
  lastMessageDateStr = '';
  lastMessageSender = '';
  lastMessageTimestamp = 0;
  
  // Show input field
  chatForm.style.display = '';
  messageInput.placeholder = `Message in ${activeRoomName}...`;
  messageInput.value = '';
  messageInput.focus();
  
  // Close mobile navigation drawer if open
  document.querySelector('.app-layout').classList.remove('sidebar-open');
  
  startActiveRoomListeners();
}

function clearActiveRoomListeners() {
  if (currentUser && activeRoomId) {
    update(ref(db, `rooms/${activeRoomId}/typing`), { [currentUser]: false });
  }
  
  activeRoomUnsubscribes.forEach(unsub => unsub());
  activeRoomUnsubscribes = [];
}

function startActiveRoomListeners() {
  if (!activeRoomId) return;
  
  let hasLoadedInitial = false;
  
  // 1. Listen for new messages
  const messagesRef = ref(db, `rooms/${activeRoomId}/messages`);
  const msgAddedUnsub = onChildAdded(messagesRef, (snapshot) => {
    const msgId = snapshot.key;
    if (loadedMessages.has(msgId)) return;
    loadedMessages.add(msgId);
    
    // Clear spinner or fallback view
    const loader = document.querySelector('.loading-messages');
    if (loader) loader.remove();
    const fallback = document.querySelector('.select-room-fallback');
    if (fallback) fallback.remove();
    
    hasLoadedInitial = true;
    const message = snapshot.val();
    
    // Mark incoming messages seen
    if (!isSenderCurrentUser(message.sender, currentUser) && !message.seen) {
      update(ref(db, `rooms/${activeRoomId}/messages/${msgId}`), { seen: true });
      message.seen = true;
      
      if (chatNotificationsEnabled) {
        playNotificationChime();
        if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification(`New message in ${activeRoomName}`, {
            body: `${message.sender}: ${message.text}`,
            tag: `amio-room-${activeRoomId}`
          });
        }
      }
    }
    
    renderMessage(message, msgId);
  });
  activeRoomUnsubscribes.push(msgAddedUnsub);
  
  // Safety check to remove loading indicator if room has no messages
  setTimeout(() => {
    const loader = document.querySelector('.loading-messages');
    if (loader) {
      loader.remove();
      const fallback = document.createElement('div');
      fallback.className = 'select-room-fallback';
      fallback.innerHTML = `
        <i class="ph-bold ph-chats-teardrop"></i>
        <h3>No Messages Yet</h3>
        <p>Send a message below to start the conversation.</p>
      `;
      chatMessages.appendChild(fallback);
    }
  }, 2000);
  
  // 2. Listen for read receipts
  const msgChangedUnsub = onChildChanged(messagesRef, (snapshot) => {
    const msgId = snapshot.key;
    const message = snapshot.val();
    const msgEl = document.getElementById(`msg-${msgId}`);
    if (msgEl && isSenderCurrentUser(message.sender, currentUser)) {
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
  activeRoomUnsubscribes.push(msgChangedUnsub);
  
  // 3. Listen for typing statuses
  const typingRef = ref(db, `rooms/${activeRoomId}/typing`);
  const typingUnsub = onValue(typingRef, (snapshot) => {
    const typingData = snapshot.val() || {};
    const typingUsers = [];
    
    for (const username in typingData) {
      if (!isSenderCurrentUser(username, currentUser) && typingData[username] === true && activeRoomMembers[username]) {
        typingUsers.push(username);
      }
    }
    
    updateHeaderStatus(typingUsers);
    
    if (typingUsers.length > 0) {
      renderTypingIndicator(typingUsers.join(', '));
    } else {
      const indicator = document.getElementById('typing-indicator');
      if (indicator) indicator.remove();
    }
  });
  activeRoomUnsubscribes.push(typingUnsub);
  
  // 4. Listen for presence of other room members
  for (const memberName in activeRoomMembers) {
    if (!isSenderCurrentUser(memberName, currentUser)) {
      const presenceRef = ref(db, `presence/${memberName}`);
      const presenceUnsub = onValue(presenceRef, (snap) => {
        membersPresence[memberName] = snap.val() || { state: 'offline', last_changed: null };
        updateHeaderStatus();
      });
      activeRoomUnsubscribes.push(presenceUnsub);
    }
  }
}

// Compute initials for the room avatar
function getRoomInitials(name) {
  if (!name) return 'RM';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

// Sync room presence and typing statuses to the UI header
function updateHeaderStatus(typingUsers = []) {
  if (!isClientConnected) {
    statusText.textContent = "Reconnecting...";
    connectionStatus.className = "connection-status disconnected";
    return;
  }
  
  if (typingUsers.length > 0) {
    statusText.textContent = `${typingUsers.join(', ')} ${typingUsers.length === 1 ? 'is' : 'are'} typing...`;
    connectionStatus.className = "connection-status connected";
    return;
  }
  
  if (!activeRoomId) {
    statusText.textContent = "Connected";
    connectionStatus.className = "connection-status connected";
    return;
  }
  
  const otherMembers = Object.keys(activeRoomMembers).filter(m => !isSenderCurrentUser(m, currentUser));
  const onlineMembers = otherMembers.filter(m => membersPresence[m] && membersPresence[m].state === 'online');
  
  if (onlineMembers.length > 0) {
    statusText.textContent = `Active: ${onlineMembers.join(', ')}`;
    connectionStatus.className = "connection-status connected";
  } else {
    if (otherMembers.length === 1) {
      const otherUser = otherMembers[0];
      const presence = membersPresence[otherUser];
      if (presence && presence.last_changed) {
        statusText.textContent = `Last seen ${formatLastSeen(presence.last_changed)}`;
      } else {
        statusText.textContent = "Offline";
      }
    } else {
      statusText.textContent = `${otherMembers.length + 1} members`;
    }
    connectionStatus.className = "connection-status offline";
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

function setupChatEvents() {
  let typingTimeout = null;
  
  messageInput.addEventListener('input', () => {
    if (!currentUser || !activeRoomId) return;
    
    update(ref(db, `rooms/${activeRoomId}/typing`), { [currentUser]: true });
    
    if (typingTimeout) clearTimeout(typingTimeout);
    
    typingTimeout = setTimeout(() => {
      if (activeRoomId) {
        update(ref(db, `rooms/${activeRoomId}/typing`), { [currentUser]: false });
      }
    }, 2000);
  });

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !currentUser || !activeRoomId) return;
    
    if (typingTimeout) clearTimeout(typingTimeout);
    update(ref(db, `rooms/${activeRoomId}/typing`), { [currentUser]: false });

    const messagesRef = ref(db, `rooms/${activeRoomId}/messages`);
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
    
    if (chatNotificationsEnabled && typeof Notification !== 'undefined') {
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }
    
    updateNotifToggleButton();
    showToast(`Message notifications ${chatNotificationsEnabled ? 'enabled' : 'muted'}`);
  });
  
  // Calendar triggers
  btnCalendar.addEventListener('click', () => {
    if (typeof datePicker.showPicker === 'function') {
      datePicker.showPicker();
    } else {
      datePicker.click();
    }
  });
  
  datePicker.addEventListener('change', (e) => {
    const selectedDate = e.target.value;
    if (!selectedDate) return;
    
    const targetDiv = document.querySelector(`.date-separator[data-date="${selectedDate}"]`);
    if (targetDiv) {
      targetDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
      targetDiv.classList.add('highlight-active');
      setTimeout(() => targetDiv.classList.remove('highlight-active'), 2000);
      
      const firstMsg = targetDiv.nextElementSibling;
      if (firstMsg && firstMsg.classList.contains('message-wrapper')) {
        firstMsg.classList.add('highlight-active');
        setTimeout(() => firstMsg.classList.remove('highlight-active'), 2000);
      }
    } else {
      showToast(`No messages on ${formatFriendlyDate(selectedDate)}`);
    }
    
    datePicker.value = '';
  });
}

// CRUDS: Manage User Accounts & Custom Rooms
async function createUser(name, passcode, isAdmin) {
  const updates = {};
  updates[`users/${passcode}`] = { name, isAdmin };
  await update(ref(db), updates);
  showToast(`User "${name}" has been registered.`);
}

async function deleteUser(passcode) {
  if (passcode === currentUserPasscode) {
    alert("You cannot delete your own account.");
    return;
  }
  
  const updates = {};
  updates[`users/${passcode}`] = null;
  await update(ref(db), updates);
  showToast("User successfully removed.");
}

async function createRoom(name, memberNames) {
  const newRoomId = push(ref(db, 'rooms')).key;
  
  const members = {};
  memberNames.forEach(name => {
    members[name] = true;
  });
  
  const updates = {};
  updates[`rooms/${newRoomId}`] = {
    name,
    admin: currentUser,
    members
  };
  
  await update(ref(db), updates);
  showToast(`Room "${name}" created.`);
  switchActiveRoom(newRoomId);
}

// Convert Legacy data into a new room backup
async function convertOldDataToRoom(roomName, memberNames) {
  try {
    const newRoomId = push(ref(db, 'rooms')).key;
    
    const members = {};
    memberNames.forEach(name => {
      members[name] = true;
    });
    
    // Fetch old messages from root node
    const messagesSnap = await get(ref(db, 'messages'));
    const oldMessages = messagesSnap.val() || {};
    
    const updates = {};
    updates[`rooms/${newRoomId}`] = {
      name: roomName,
      admin: currentUser,
      members,
      messages: oldMessages
    };
    
    // Delete legacy root messages node
    updates['messages'] = null;
    
    await update(ref(db), updates);
    showToast(`Legacy chat converted to room "${roomName}".`);
    switchActiveRoom(newRoomId);
  } catch (err) {
    console.error("Migration failed:", err);
    alert("Failed to migrate legacy messages.");
  }
}

// UI Modals setup
function setupModalEvents() {
  // Helper show/hide
  const showModal = (id) => document.getElementById(id).classList.add('active');
  const hideModal = (id) => document.getElementById(id).classList.remove('active');
  
  document.querySelectorAll('.close-modal-btn, .cancel-modal-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal');
      if (modal) modal.classList.remove('active');
    });
  });
  
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('active');
    });
  });
  
  // 1. Add User Form
  document.getElementById('btn-open-add-user').addEventListener('click', () => {
    document.getElementById('form-add-user').reset();
    showModal('modal-add-user');
  });
  
  document.getElementById('form-add-user').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('new-user-name').value.trim();
    const passcode = document.getElementById('new-user-passcode').value.trim();
    const isAdmin = document.getElementById('new-user-admin').checked;
    
    if (passcode.length !== 6 || !/^\d+$/.test(passcode)) {
      alert("Passcode must be exactly 6 digits.");
      return;
    }
    
    if (allUsers[passcode]) {
      alert("This passcode is already taken. Please configure another.");
      return;
    }
    
    try {
      await createUser(name, passcode, isAdmin);
      hideModal('modal-add-user');
    } catch (err) {
      console.error(err);
      alert("Failed to create user.");
    }
  });
  
  // 2. Create Room Form
  document.getElementById('btn-open-create-room').addEventListener('click', () => {
    document.getElementById('form-create-room').reset();
    document.getElementById('create-room-members-error').style.display = 'none';
    populateMemberSelectionLists();
    showModal('modal-create-room');
  });
  
  document.getElementById('form-create-room').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('new-room-name').value.trim();
    
    const checkboxes = document.querySelectorAll('input[name="create-member"]:checked');
    const memberNames = Array.from(checkboxes).map(cb => cb.value);
    
    // Explicitly add current user if not checked
    if (!memberNames.includes(currentUser)) {
      memberNames.push(currentUser);
    }
    
    // Enforce 2 or 3 members
    if (memberNames.length < 2 || memberNames.length > 3) {
      document.getElementById('create-room-members-error').style.display = 'block';
      return;
    }
    
    try {
      await createRoom(name, memberNames);
      hideModal('modal-create-room');
    } catch (err) {
      console.error(err);
      alert("Failed to create room.");
    }
  });
  
  // 3. Migrate Legacy Data Form
  document.getElementById('btn-open-migrate').addEventListener('click', () => {
    document.getElementById('form-migrate-data').reset();
    document.getElementById('migrate-room-members-error').style.display = 'none';
    populateMemberSelectionLists();
    showModal('modal-migrate-data');
  });
  
  document.getElementById('form-migrate-data').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('migrate-room-name').value.trim();
    
    const checkboxes = document.querySelectorAll('input[name="migrate-member"]:checked');
    const memberNames = Array.from(checkboxes).map(cb => cb.value);
    
    if (!memberNames.includes(currentUser)) {
      memberNames.push(currentUser);
    }
    
    if (memberNames.length < 2 || memberNames.length > 3) {
      document.getElementById('migrate-room-members-error').style.display = 'block';
      return;
    }
    
    try {
      await convertOldDataToRoom(name, memberNames);
      hideModal('modal-migrate-data');
    } catch (err) {
      console.error(err);
      alert("Failed to convert legacy messages.");
    }
  });

  // 4. Room Settings Form
  document.getElementById('btn-room-settings').addEventListener('click', () => {
    if (!activeRoomId) return;
    document.getElementById('settings-room-name').textContent = activeRoomName;
    document.getElementById('settings-room-name-input').value = activeRoomName;
    document.getElementById('room-settings-members-error').style.display = 'none';
    populateSettingsMembersList();
    showModal('modal-room-settings');
  });

  document.getElementById('form-room-settings').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newRoomName = document.getElementById('settings-room-name-input').value.trim();
    const checkboxes = document.querySelectorAll('input[name="settings-member"]:checked');
    const memberNames = Array.from(checkboxes).map(cb => cb.value);
    
    if (!memberNames.includes(currentUser)) {
      memberNames.push(currentUser);
    }
    
    if (memberNames.length < 2 || memberNames.length > 3) {
      document.getElementById('room-settings-members-error').style.display = 'block';
      return;
    }
    
    try {
      const members = {};
      memberNames.forEach(name => {
        members[name] = true;
      });
      
      await update(ref(db, `rooms/${activeRoomId}`), { 
        name: newRoomName,
        members: members
      });
      
      activeRoomName = newRoomName;
      activeRoomMembers = members;
      
      // Update UI title and initials
      document.getElementById('room-title').textContent = activeRoomName;
      userAvatar.textContent = getRoomInitials(activeRoomName);
      
      showToast("Room settings updated successfully.");
      hideModal('modal-room-settings');
      
      renderRoomsList();
      updateHeaderStatus();
    } catch (err) {
      console.error(err);
      alert("Failed to update room settings.");
    }
  });

  document.getElementById('btn-delete-room').addEventListener('click', async () => {
    if (confirm(`Are you sure you want to delete the room "${activeRoomName}"? This will permanently delete all messages.`)) {
      try {
        const idToDelete = activeRoomId;
        
        clearActiveRoomListeners();
        activeRoomId = null;
        activeRoomName = '';
        activeRoomMembers = {};
        
        chatForm.style.display = 'none';
        document.getElementById('room-title').textContent = "Select a Room";
        userAvatar.innerHTML = '<i class="ph-bold ph-user"></i>';
        document.getElementById('btn-calendar').style.display = 'none';
        document.getElementById('btn-scroll-bottom').style.display = 'none';
        document.getElementById('btn-room-settings').style.display = 'none';
        
        chatMessages.innerHTML = `
          <div class="select-room-fallback">
            <i class="ph-bold ph-chats-teardrop"></i>
            <h3>No Active Chat</h3>
            <p>Choose a room from the sidebar menu to start exchanging messages.</p>
          </div>
        `;
        
        await update(ref(db), { [`rooms/${idToDelete}`]: null });
        showToast("Room deleted successfully.");
        hideModal('modal-room-settings');
      } catch (err) {
        console.error(err);
        alert("Failed to delete room.");
      }
    }
  });
}

// Setup Sidebar Toggle events
function setupSidebarEvents() {
  document.getElementById('btn-menu').addEventListener('click', () => {
    document.querySelector('.app-layout').classList.add('sidebar-open');
  });
  
  const closeSidebar = () => {
    document.querySelector('.app-layout').classList.remove('sidebar-open');
  };
  
  document.getElementById('btn-close-sidebar').addEventListener('click', closeSidebar);
  document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);
  
  // Setup Sidebar Logout
  btnLogout.addEventListener('click', () => {
    if (currentUser) {
      // Set presence offline
      update(ref(db, `presence/${currentUser}`), {
        state: 'offline',
        last_changed: Date.now()
      });
      if (activeRoomId) {
        update(ref(db, `rooms/${activeRoomId}/typing`), { [currentUser]: false });
      }
    }
    
    clearActiveRoomListeners();
    globalUnsubscribes.forEach(unsub => unsub());
    globalUnsubscribes = [];
    
    currentUser = null;
    currentUserRole = 'user';
    currentUserPasscode = '';
    activeRoomId = null;
    activeRoomName = '';
    activeRoomMembers = {};
    membersPresence = {};
    
    document.getElementById('rooms-list').innerHTML = `<div class="loading-sidebar"><div class="spinner-small"></div></div>`;
    document.getElementById('users-list').innerHTML = '';
    chatMessages.innerHTML = `
      <div class="select-room-fallback">
        <i class="ph-bold ph-chats-teardrop"></i>
        <h3>No Active Chat</h3>
        <p>Choose a room from the sidebar menu to start exchanging messages.</p>
      </div>
    `;
    chatForm.style.display = 'none';
    document.getElementById('room-title').textContent = "Select a Room";
    userAvatar.innerHTML = '<i class="ph-bold ph-user"></i>';
    document.getElementById('btn-calendar').style.display = 'none';
    document.getElementById('btn-scroll-bottom').style.display = 'none';
    document.getElementById('btn-room-settings').style.display = 'none';
    
    loadedMessages.clear();
    lastMessageDateStr = '';
    lastMessageSender = '';
    lastMessageTimestamp = 0;
    
    resetPasscode(false);
    showScreen('passcode-screen');
    setTimeout(() => passcodeInput.focus(), 500);
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

function renderTypingIndicator(names) {
  if (document.getElementById('typing-indicator')) {
    document.getElementById('typing-indicator-names').textContent = names;
    return;
  }
  
  const indicator = document.createElement('div');
  indicator.className = 'message-wrapper incoming typing-wrapper';
  indicator.id = 'typing-indicator';
  
  indicator.innerHTML = `
    <span class="message-sender" id="typing-indicator-names">${names}</span>
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
  const isOutgoing = isSenderCurrentUser(msg.sender, currentUser);
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
    // If date has not changed, check if time gap is >= 15 minutes to show time separators
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
      ${formatMessageText(msg.text)}
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

function formatMessageText(text) {
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
  const urls = [];
  
  // Replace URLs with placeholders first
  let placeholderText = text.replace(urlRegex, (url) => {
    urls.push(url);
    return `__URL_PLACEHOLDER_${urls.length - 1}__`;
  });
  
  // Escape HTML of the remaining text (protects against XSS)
  let escapedText = escapeHtml(placeholderText);
  
  // Replace placeholders back with clickable links
  return escapedText.replace(/__URL_PLACEHOLDER_(\d+)__/g, (match, index) => {
    const rawUrl = urls[parseInt(index, 10)];
    let href = rawUrl;
    if (rawUrl.startsWith('www.')) {
      href = 'http://' + rawUrl;
    }
    
    const escapedHref = escapeHtml(href);
    const escapedDisplay = escapeHtml(rawUrl);
    
    // Check if the URL points to an image
    const isImageUrl = /\.(jpeg|jpg|gif|png|webp|svg)(\?.*)?$/i.test(href);
    if (isImageUrl) {
      return `<a href="${escapedHref}" target="_blank" rel="noopener noreferrer" class="chat-link">${escapedDisplay}</a>
              <div class="chat-image-embed">
                <img src="${escapedHref}" alt="embedded image" class="embed-img" loading="lazy">
              </div>`;
    }
    
    return `<a href="${escapedHref}" target="_blank" rel="noopener noreferrer" class="chat-link">${escapedDisplay}</a>`;
  });
}

window.addEventListener('DOMContentLoaded', init);
