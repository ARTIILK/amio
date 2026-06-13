// Vercel Serverless Function: api/config.js
// Securely retrieves Firebase configuration parameters from backend environment variables.

const cleanEnv = (key, fallback = '') => {
  const val = process.env[key];
  if (val === undefined || val === null) return fallback;
  return val.replace(/^["']|["']$/g, '');
};

const getInitials = (name, fallback) => {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

module.exports = async (req, res) => {
  // Allow only GET requests
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const nameA = cleanEnv('USER_A_NAME', 'anuu');
  const nameB = cleanEnv('USER_B_NAME', 'anu');

  return res.status(200).json({
    apiKey: cleanEnv('FIREBASE_API_KEY'),
    authDomain: cleanEnv('FIREBASE_AUTH_DOMAIN'),
    databaseURL: cleanEnv('FIREBASE_DATABASE_URL'),
    projectId: cleanEnv('FIREBASE_PROJECT_ID'),
    storageBucket: cleanEnv('FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: cleanEnv('FIREBASE_MESSAGING_SENDER_ID'),
    appId: cleanEnv('FIREBASE_APP_ID'),
    measurementId: cleanEnv('FIREBASE_MEASUREMENT_ID'),
    
    // User Configurations
    userA: {
      name: nameA,
      code: cleanEnv('USER_A_CODE', '251112'),
      initials: process.env.USER_A_NAME ? getInitials(nameA) : 'AU'
    },
    userB: {
      name: nameB,
      code: cleanEnv('USER_B_CODE', '123456'),
      initials: process.env.USER_B_NAME ? getInitials(nameB) : 'AN'
    }
  });
};
