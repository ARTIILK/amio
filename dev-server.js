// Development HTTP Server for local testing
// Serves static files and emulates Vercel Serverless functions (/api/config, /api/alert)

const http = require('http');
const fs = require('fs');
const path = require('path');

// 1. Simple helper to parse the local .env file
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const equalIdx = trimmed.indexOf('=');
    if (equalIdx === -1) return;
    const key = trimmed.substring(0, equalIdx).trim();
    let val = trimmed.substring(equalIdx + 1).trim();
    // Strip quotes if present
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    process.env[key] = val;
  });
}

// Import Vercel Serverless Function handlers
const configHandler = require('./api/config.js');
const alertHandler = require('./api/alert.js');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  // Parse URL pathname
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // Log incoming request
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${pathname}`);

  // Vercel /api/config Emulation
  if (pathname === '/api/config') {
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (data) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    };
    return configHandler(req, res);
  }

  // Vercel /api/alert Emulation
  if (pathname === '/api/alert') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          req.body = JSON.parse(body);
        } catch (e) {
          req.body = {};
        }
        res.status = (code) => {
          res.statusCode = code;
          return res;
        };
        res.json = (data) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data));
        };
        return alertHandler(req, res);
      });
      return;
    } else {
      res.statusCode = 405;
      res.end('Method Not Allowed');
      return;
    }
  }

  // Serve static UI assets
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  
  // Security guard against directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  // Detect MIME type
  const ext = path.extname(filePath);
  let contentType = 'text/plain';
  if (ext === '.html') contentType = 'text/html';
  else if (ext === '.css') contentType = 'text/css';
  else if (ext === '.js') contentType = 'application/javascript';
  else if (ext === '.json') contentType = 'application/json';
  else if (ext === '.png') contentType = 'image/png';
  else if (ext === '.jpg') contentType = 'image/jpeg';
  else if (ext === '.svg') contentType = 'image/svg+xml';
  else if (ext === '.ico') contentType = 'image/x-icon';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.statusCode = 404;
        res.end('404 File Not Found');
      } else {
        res.statusCode = 500;
        res.end('500 Server Error');
      }
    } else {
      res.setHeader('Content-Type', contentType);
      res.end(content);
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 Amio Chat Dev Server is active!`);
  console.log(`👉 Access URL: http://localhost:${PORT}`);
  console.log(`==================================================\n`);
});
