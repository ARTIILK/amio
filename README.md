# Amio Chat 💬

Amio is a premium, lightweight, private real-time chat application designed exclusively for secure 1-on-1 conversations between two users: **anuu** (User A) and **anu** (User B). 

The application is built on a clean Vanilla web stack and features a warm editorial design system inspired by Claude's brand identity. It utilizes **Firebase Realtime Database** for live, permanent chat logs, and is deployed as a serverless application on **Vercel** with integrated security alerts.

---

## ✨ Features

- 🔒 **Exclusive Private Space:** Restricted to two specific users via individual passcodes. Chat room logs are permanent and synchronized.
- 🎨 **Warm Editorial UI:** Designed using custom Vanilla CSS with a warm canvas palette (`#faf9f5`), coral accent elements (`#cc785c`), and dark navy product containers.
- 📱 **Fully Responsive:** Optimised layout and safe-area margins for Android/iOS browsers, tablets, and desktop viewports.
- 🔑 **Passcode Lock Gate:** Session-less security screen containing a custom touch keypad (or hardware keyboard entry). Users are required to enter their passcode each time they open the app.
- 📬 **Security Login Alerts:** Automatically triggers instant alerts via **Telegram Bot API** and/or **Google Mail (SMTP)** whenever User B (`anu`) logs into the chat.
- 📅 **Jump to Date:** A calendar navigation picker allows users to jump directly to any specific date in the message feed, complete with a visual highlight indicator.
- 💬 **Smart Chat Flow:**
  - Consecutive messages from the same sender within 15 minutes are grouped together seamlessly.
  - Generates Instagram-style time-gap separators when messages are spaced more than 15 minutes apart.
  - Click any message bubble to toggle its precise timestamp display.
  - Dynamic connection status tracking (auto-reconnects when connection is interrupted).

---

## 🛠️ Tech Stack

- **Frontend:** HTML5, CSS3 (Vanilla design tokens, CSS variables), JavaScript (ES Modules, modern async/await).
- **Backend Services:** Vercel Serverless Functions (Node.js).
- **Database:** Firebase Realtime Database (via official Firebase Web SDK 10.8 CDN imports).
- **Icons:** Phosphor Icons.
- **Alert Notifications:** Node SMTP (`nodemailer`) & Telegram Bot API via `fetch`.

---

## 📁 Directory Structure

```text
amio/
├── api/
│   ├── alert.js        # Serverless endpoint to trigger login notifications (Telegram / SMTP)
│   └── config.js       # Serverless endpoint to safely load Firebase & User configs from backend env
├── index.html          # Main application structure & imports
├── index.css           # Claude-inspired warm layout & responsive CSS styling
├── app.js              # Core application logic & Firebase real-time integration
├── vercel.json         # Vercel deployment and routing parameters
├── package.json        # Node dependencies for serverless functions (e.g., nodemailer)
├── .gitignore          # Git exclusion rules
├── .env.example        # Reference file for environment variables
└── README.md           # Project documentation (this file)
```

---

## 🔑 Authentication Credentials

The application assigns specific permissions and roles based on the passcode entered at the login screen:

| User | Code | Initial |
| :--- | :--- | :--- |
| **User A (anuu)** | `251112` | `AU` |
| **User B (anu)** | `123456` | `AN` |

*Note: These passcodes and names are default values and can be customized via server-side environment variables.*

---

## 🚀 Setup & Local Development

To run the application locally with its serverless API routes, you will need the [Vercel CLI](https://vercel.com/cli) installed.

### 1. Clone & Install Dependencies
Initialize the project repository and install the backend Node dependencies required for serverless alerts:
```bash
npm install
```

### 2. Configure Environment Variables
Duplicate the `.env.example` file and rename it to `.env`:
```bash
cp .env.example .env
```
Fill out the variables inside `.env` with your active Firebase, Telegram, and Gmail credentials. **Never commit the `.env` file to Git.**

```env
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_chat_id_to_receive_alerts

# Gmail SMTP Configuration (For Google Mail Alerts)
GOOGLE_MAIL_USER=your_gmail_sender@gmail.com
GOOGLE_MAIL_PASS=your_gmail_app_password
EMAIL_TO=recipient_email@example.com

# Firebase Configuration
FIREBASE_API_KEY=your_firebase_api_key
FIREBASE_AUTH_DOMAIN=your_firebase_project.firebaseapp.com
FIREBASE_DATABASE_URL=https://your_firebase_project.firebaseio.com
FIREBASE_PROJECT_ID=your_firebase_project_id
FIREBASE_STORAGE_BUCKET=your_firebase_project.appspot.com
FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
FIREBASE_APP_ID=your_firebase_app_id
FIREBASE_MEASUREMENT_ID=your_firebase_measurement_id

# User Credentials Overrides (Optional)
USER_A_NAME=anuu
USER_A_CODE=251112
USER_B_NAME=anu
USER_B_CODE=123456
```

### 3. Run Locally
Start the local development server using Vercel CLI:
```bash
vercel dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser to test.

---

## 🌐 Deployment to Vercel

1. **Create a Vercel Project:** Run `vercel` in the project root or import the repository to your Vercel Dashboard via Git integration.
2. **Environment Variables:** In the Vercel dashboard, go to your project's **Settings > Environment Variables** and add all the keys defined in your local `.env` file.
3. **Deploy:** Vercel automatically builds and deploys serverless functions located inside the `api/` directory.

---

## 🔒 Security Best Practices

1. **Environment Variables:** All Firebase API keys and notification credentials are kept on Vercel's server-side environment. They are never hardcoded inside the client-side `app.js` file.
2. **Dynamic Config Payload:** The client fetches Firebase and user credentials via the secure `/api/config` serverless endpoint upon initialization.
3. **Session Termination:** In-memory user logs are deleted immediately on click of the logout lock button (`btn-logout`). Session state is intentionally not stored in `localStorage` to prevent unauthorized access by anyone who gains physical access to the device.
