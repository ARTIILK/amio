const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { google } = require('googleapis');
const https = require('https');

// Load environment variables manually
function loadEnv() {
  const envPath = path.join(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.\-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      let key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  });
}
loadEnv();

const TOKEN_PATH = path.join(__dirname, 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, '../client_secret_514250971747-6ek1v9nlh7974mni17qpugct3ubhbi6q.apps.googleusercontent.com.json');

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/userinfo.email'
];

async function main() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error(`Credentials file not found at: ${CREDENTIALS_PATH}`);
    process.exit(1);
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris ? redirect_uris[0] : 'urn:ietf:wg:oauth:2.0:oob'
  );

  // Check if we have previously stored a token.
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
    oAuth2Client.setCredentials(token);
  } else {
    await getAccessToken(oAuth2Client);
  }

  // Run the backup process
  try {
    await runBackupFlow(oAuth2Client);
  } catch (err) {
    console.error('Backup process encountered an error:', err);
  }
}

function getAccessToken(oAuth2Client) {
  return new Promise((resolve, reject) => {
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent'
    });
    console.log('Authorize this app by visiting this url:');
    console.log(authUrl);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question('Enter the code from that page here: ', (code) => {
      rl.close();
      oAuth2Client.getToken(code, (err, token) => {
        if (err) return reject(err);
        oAuth2Client.setCredentials(token);
        // Store the token to disk for later program executions
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
        console.log('Token stored to', TOKEN_PATH);
        resolve();
      });
    });
  });
}

// REST request wrapper
function makeRequest(url, method, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: headers
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data ? JSON.parse(data) : null);
        } else {
          reject(new Error(`Request failed with status ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runBackupFlow(authClient) {
  // Get access token for Firebase DB REST call
  const tokenInfo = await authClient.getAccessToken();
  const accessToken = tokenInfo.token;
  if (!accessToken) {
    throw new Error('Failed to retrieve OAuth access token');
  }

  const databaseUrl = process.env.FIREBASE_DATABASE_URL || 'https://gen-lang-client-0946145742-default-rtdb.asia-southeast1.firebasedatabase.app';
  console.log(`Connecting to database: ${databaseUrl}`);

  // Fetch rooms database snapshot
  const dbUrl = `${databaseUrl}/rooms.json`;
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Accept': 'application/json'
  };

  const roomsData = await makeRequest(dbUrl, 'GET', headers);
  if (!roomsData) {
    console.log('No rooms data found in database.');
    return;
  }

  // Filter messages older than 30 days
  const limitTime = Date.now() - 30 * 24 * 60 * 60 * 1000;
  console.log(`Filtering messages older than: ${new Date(limitTime).toISOString()}`);

  const archivedRooms = {};
  const deletions = {}; // Map of room_id -> { message_id: null }

  let archivedCount = 0;

  for (const roomId in roomsData) {
    const room = roomsData[roomId];
    if (!room || !room.messages) continue;

    const messages = room.messages;
    const oldMessages = [];
    const deleteUpdates = {};

    for (const msgId in messages) {
      const msg = messages[msgId];
      if (msg && msg.timestamp && msg.timestamp < limitTime) {
        oldMessages.push({
          id: msgId,
          sender: msg.sender,
          text: msg.text,
          timestamp: msg.timestamp
        });
        deleteUpdates[msgId] = null; // null deletes the key in PATCH request
        archivedCount++;
      }
    }

    if (oldMessages.length > 0) {
      archivedRooms[roomId] = {
        name: room.name || 'Chat Room',
        messages: oldMessages
      };
      deletions[roomId] = deleteUpdates;
    }
  }

  if (archivedCount === 0) {
    console.log('No messages older than 30 days found. Database is clean.');
    return;
  }

  console.log(`Found ${archivedCount} messages to backup.`);

  // Create JSON archive payload
  const archivePayload = {
    archiveDate: new Date().toISOString(),
    rooms: archivedRooms
  };
  const jsonContent = JSON.stringify(archivePayload, null, 2);

  // Upload to Google Drive
  const drive = google.drive({ version: 'v3', auth: authClient });
  const dateStr = new Date().toISOString().split('T')[0];
  const fileName = `chat_backup_30days_${dateStr}.json`;

  console.log(`Uploading backup file "${fileName}" to Google Drive...`);
  
  const driveRes = await drive.files.create({
    requestBody: {
      name: fileName,
      mimeType: 'application/json'
    },
    media: {
      mimeType: 'application/json',
      body: jsonContent
    }
  });

  const driveFileId = driveRes.data.id;
  console.log(`Backup file uploaded successfully. Drive File ID: ${driveFileId}`);

  // Delete archived messages from Firebase database
  console.log('Cleaning up archived messages from Firebase database...');
  for (const roomId in deletions) {
    const deleteUrl = `${databaseUrl}/rooms/${roomId}/messages.json`;
    const patchBody = deletions[roomId];
    
    await makeRequest(deleteUrl, 'PATCH', headers, patchBody);
    console.log(`Cleared ${Object.keys(patchBody).length} archived messages from room: ${roomId}`);
  }

  console.log('Database cleanup completed successfully.');
}

main().catch(console.error);
