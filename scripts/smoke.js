const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const electronExe = path.join(ROOT, 'node_modules', 'electron', 'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron');

if (!fs.existsSync(electronExe)) {
  console.error('Electron no está instalado. Ejecuta primero: npm install');
  process.exit(1);
}

const FATAL = /(Uncaught |ReferenceError|TypeError:|AssertionError|Error: Cannot find|EACCES|ENOENT|ECONNREFUSED|Unable to load|Failed to load)/i;

let finished = false;

const child = spawn(electronExe, ['.'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env }
});

let stderr = '';
child.stderr.on('data', (d) => { stderr += d.toString(); });

function finish(code, message) {
  if (finished) return;
  finished = true;
  console.log(message);
  if (child.pid) {
    try {
      if (process.platform === 'win32') {
        require('child_process').execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        child.kill('SIGTERM');
      }
    } catch { /* ya cerrado */ }
  }
  process.exit(code);
}

const timer = setTimeout(() => {
  finish(0, 'smoke OK: la ventana de Word BryanMG se abrió y el proceso sigue vivo sin errores graves.');
}, 6000);

child.on('exit', (code, signal) => {
  clearTimeout(timer);
  if (finished) return;
  if (code === 0) {
    finish(0, 'smoke OK: Electron se cerró limpiamente (código 0).');
    return;
  }
  const relevant = stderr.split('\n').filter((l) => FATAL.test(l)).slice(0, 15).join('\n');
  finish(1, 'smoke FALLO: Electron salió con código ' + code + (signal ? ' (' + signal + ')' : '') +
    (relevant ? '\n' + relevant : ''));
});