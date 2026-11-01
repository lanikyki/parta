// Копирует воркер pdf.js в public/, чтобы загрузка PDF работала без сборщика.
const fs = require('fs');
const path = require('path');
try {
  const src = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs');
  fs.mkdirSync(path.join(__dirname, '..', 'public'), { recursive: true });
  fs.copyFileSync(src, path.join(__dirname, '..', 'public', 'pdf.worker.min.mjs'));
} catch (e) {
  console.warn('pdf worker copy skipped:', e.message);
}
