const fs = require('fs');
const path = require('path');

function filtersFor(ext) {
  const map = {
    txt: [{ name: 'Texto plano', extensions: ['txt'] }],
    md: [{ name: 'Markdown', extensions: ['md'] }],
    html: [{ name: 'Documento HTML', extensions: ['html', 'htm'] }],
    docx: [{ name: 'Documento Word BryanMG', extensions: ['docx'] }],
    odt: [{ name: 'OpenDocument Text', extensions: ['odt'] }],
    pdf: [{ name: 'PDF', extensions: ['pdf'] }]
  };
  return map[ext] || [{ name: 'Todos los archivos', extensions: ['*'] }];
}

function filtersForList(exts) {
  if (!exts || !exts.length) return [{ name: 'Documentos', extensions: ['txt', 'md', 'html', 'htm', 'docx', 'odt'] }];
  return exts.map((e) => filtersFor(e));
}

function suggestPath(app, name, ext) {
  const docs = app.getPath('documents');
  const clean = String(name || 'Documento').replace(/[\\/:*?"<>|]/g, '_');
  const withExt = clean.toLowerCase().endsWith('.' + ext) ? clean : clean + '.' + ext;
  return path.join(docs, withExt);
}

function writeBase64(filePath, dataBase64) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(dataBase64, 'base64'));
}

function read(filePath) {
  return fs.readFileSync(filePath);
}

function baseName(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

module.exports = { filtersFor, filtersForList, suggestPath, writeBase64, read, baseName };
