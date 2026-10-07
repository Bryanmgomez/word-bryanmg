const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src', 'renderer');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function createServer() {
  return http.createServer((req, res) => {
    let pathname = '/';
    try {
      pathname = decodeURIComponent(req.url.split('?')[0]);
    } catch { /* usar raíz */ }
    if (pathname === '/' || pathname.endsWith('/')) pathname += 'index.html';

    const filePath = path.join(ROOT, path.normalize(pathname).replace(/^([/\\])+/, ''));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('Prohibido');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('No encontrado: ' + pathname);
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      res.end(data);
    });
  });
}

function startServer(port = 4173) {
  const server = createServer();
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (require.main === module) {
  startServer(Number(process.env.PORT) || 4173).then((server) => {
    const address = server.address();
    console.log('Word BryanMG (web) disponible en http://localhost:' + address.port);
    console.log('Pulsa Ctrl+C para detener.');
  });
}

module.exports = { startServer, createServer };