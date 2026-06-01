/* ============================================================
   PDF WORKER — background PDF processing
   Handles: compression, page extraction, rendering tasks
   ============================================================ */
'use strict';

importScripts('../libs/pdflib/pdf-lib.min.js');

self.addEventListener('message', async (e) => {
  const { type, id, payload } = e.data;

  try {
    switch (type) {
      case 'compress':    await handleCompress(id, payload);   break;
      case 'merge':       await handleMerge(id, payload);      break;
      case 'split':       await handleSplit(id, payload);      break;
      case 'watermark':   await handleWatermark(id, payload);  break;
      case 'metadata':    await handleMetadata(id, payload);   break;
      case 'pagenumber':  await handlePageNumber(id, payload); break;
      default:
        self.postMessage({ type: 'error', id, error: 'Unknown task: ' + type });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id, error: err.message || String(err) });
  }
});

function progress(id, pct, msg) {
  self.postMessage({ type: 'progress', id, pct, msg });
}

function done(id, buffer) {
  self.postMessage({ type: 'done', id, buffer }, [buffer]);
}

// ---- Compress ----
async function handleCompress(id, { buffer, level, imageQuality, removeMetadata }) {
  const { PDFDocument, PDFRawStream } = PDFLib;
  progress(id, 10, 'Chargement du PDF...');
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  progress(id, 30, 'Analyse...');

  if (removeMetadata) {
    pdfDoc.setTitle('');
    pdfDoc.setAuthor('');
    pdfDoc.setSubject('');
    pdfDoc.setKeywords([]);
    pdfDoc.setCreator('PDF Toolbox Ultimate');
    pdfDoc.setProducer('PDF Toolbox Ultimate');
  }

  progress(id, 60, 'Compression...');

  const saved = await pdfDoc.save({
    useObjectStreams: true,
    addDefaultPage: false,
    objectsPerTick: 50
  });

  progress(id, 100, 'Terminé');
  done(id, saved.buffer);
}

// ---- Merge ----
async function handleMerge(id, { buffers, keepBookmarks }) {
  const { PDFDocument } = PDFLib;
  progress(id, 5, 'Initialisation...');
  const merged = await PDFDocument.create();
  let processed = 0;

  for (const buffer of buffers) {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const pageCount = doc.getPageCount();
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach(p => merged.addPage(p));
    processed++;
    progress(id, (processed / buffers.length) * 90, `Fusion ${processed}/${buffers.length}...`);
  }

  progress(id, 95, 'Finalisation...');
  const saved = await merged.save();
  progress(id, 100, 'Terminé');
  done(id, saved.buffer);
}

// ---- Split ----
async function handleSplit(id, { buffer, ranges }) {
  const { PDFDocument } = PDFLib;
  progress(id, 5, 'Chargement...');
  const srcDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const results = [];

  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    const newDoc = await PDFDocument.create();
    const pages = await newDoc.copyPages(srcDoc, range.map(n => n - 1));
    pages.forEach(p => newDoc.addPage(p));
    const saved = await newDoc.save();
    results.push(saved.buffer);
    progress(id, ((i + 1) / ranges.length) * 95, `Partie ${i + 1}/${ranges.length}...`);
  }

  progress(id, 100, 'Terminé');
  self.postMessage({ type: 'split-done', id, buffers: results }, results);
}

// ---- Watermark ----
async function handleWatermark(id, { buffer, text, fontSize, color, opacity, rotation, pages: pageSpec }) {
  const { PDFDocument, rgb, degrees, StandardFonts } = PDFLib;
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const totalPages = pdfDoc.getPageCount();
  const pageIndices = resolvePageSpec(pageSpec, totalPages);
  const [r, g, b] = hexToRgb(color);

  pageIndices.forEach(i => {
    const page = pdfDoc.getPage(i);
    const { width, height } = page.getSize();
    page.drawText(text, {
      x: width / 2 - (text.length * fontSize * 0.3),
      y: height / 2,
      size: fontSize,
      font,
      color: rgb(r, g, b),
      opacity: opacity / 100,
      rotate: degrees(rotation)
    });
  });

  progress(id, 90, 'Sauvegarde...');
  const saved = await pdfDoc.save();
  progress(id, 100, 'Terminé');
  done(id, saved.buffer);
}

// ---- Metadata ----
async function handleMetadata(id, { buffer, meta }) {
  const { PDFDocument } = PDFLib;
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  if (meta.title !== undefined) pdfDoc.setTitle(meta.title);
  if (meta.author !== undefined) pdfDoc.setAuthor(meta.author);
  if (meta.subject !== undefined) pdfDoc.setSubject(meta.subject);
  if (meta.keywords !== undefined) pdfDoc.setKeywords(meta.keywords ? meta.keywords.split(',').map(k => k.trim()) : []);
  if (meta.creator !== undefined) pdfDoc.setCreator(meta.creator);
  if (meta.producer !== undefined) pdfDoc.setProducer(meta.producer);

  const saved = await pdfDoc.save();
  done(id, saved.buffer);
}

// ---- Page Numbers ----
async function handlePageNumber(id, { buffer, format, position, startAt, fontSize, color, includeDate, includeTime }) {
  const { PDFDocument, rgb, StandardFonts } = PDFLib;
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();
  const [r, g, b] = hexToRgb(color);
  const total = pages.length;
  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-FR');
  const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const margin = 20;

  pages.forEach((page, i) => {
    const { width, height } = page.getSize();
    let text = format
      .replace('{n}', startAt + i)
      .replace('{total}', total);
    if (includeDate) text += '  ' + dateStr;
    if (includeTime) text += '  ' + timeStr;

    const textWidth = font.widthOfTextAtSize(text, fontSize);
    let x, y;

    if (position.includes('top')) y = height - margin;
    else y = margin;
    if (position.includes('left')) x = margin;
    else if (position.includes('right')) x = width - textWidth - margin;
    else x = (width - textWidth) / 2;

    page.drawText(text, { x, y, size: fontSize, font, color: rgb(r, g, b) });
  });

  const saved = await pdfDoc.save();
  done(id, saved.buffer);
}

// ---- Helpers ----
function resolvePageSpec(spec, total) {
  if (spec === 'all') return Array.from({ length: total }, (_, i) => i);
  if (spec === 'first') return [0];
  if (typeof spec === 'string' && spec.includes('-')) {
    const [a, b] = spec.split('-').map(Number);
    return Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i);
  }
  return Array.from({ length: total }, (_, i) => i);
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}
