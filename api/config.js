// Vercel Serverless Function: api/config.js
// Securely retrieves Firebase configuration parameters from backend environment variables.

module.exports = async (req, res) => {
  // Allow only GET requests
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(200).json({
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID,
    
    // User Configurations
    userA: {
      name: process.env.USER_A_NAME || 'anuu',
      code: process.env.USER_A_CODE || '251112',
      initials: 'AU'
    },
    userB: {
      name: process.env.USER_B_NAME || 'anu',
      code: process.env.USER_B_CODE || '123456',
      initials: 'AN'
    }
  });
};
