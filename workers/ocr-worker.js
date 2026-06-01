/* ============================================================
   OCR WORKER — Tesseract.js background OCR processing
   ============================================================ */
'use strict';

// Attempt to import Tesseract
try {
  importScripts('../libs/tesseract/tesseract.min.js');
} catch (e) {
  // Tesseract not available — main thread will handle
  self.postMessage({ type: 'no-tesseract' });
}

let worker = null;
let currentLang = null;

self.addEventListener('message', async (e) => {
  const { type, id, payload } = e.data;

  switch (type) {
    case 'init':
      await initTesseract(id, payload.lang);
      break;
    case 'recognize':
      await doOCR(id, payload);
      break;
    case 'terminate':
      if (worker) { await worker.terminate(); worker = null; }
      break;
  }
});

async function initTesseract(id, lang) {
  try {
    if (worker && currentLang === lang) {
      self.postMessage({ type: 'ready', id });
      return;
    }
    if (worker) await worker.terminate();

    self.postMessage({ type: 'status', id, msg: 'Création du worker Tesseract...' });
    worker = await Tesseract.createWorker(lang, 1, {
      workerPath: '../libs/tesseract/worker.min.js',
      langPath: '../libs/tesseract/lang-data',
      corePath: '../libs/tesseract/tesseract-core.wasm.js',
      logger: (m) => {
        if (m.status === 'recognizing text') {
          self.postMessage({ type: 'progress', id, pct: m.progress * 100 });
        } else {
          self.postMessage({ type: 'status', id, msg: m.status });
        }
      }
    });
    currentLang = lang;
    self.postMessage({ type: 'ready', id });
  } catch (err) {
    self.postMessage({ type: 'error', id, error: 'Tesseract init failed: ' + err.message });
  }
}

async function doOCR(id, { imageData, width, height, lang, outputFormat }) {
  try {
    if (!worker || currentLang !== lang) {
      await initTesseract(id, lang);
    }

    self.postMessage({ type: 'status', id, msg: 'Reconnaissance en cours...' });

    // If imageData is ImageData-like (array), reconstruct
    let result;
    if (imageData) {
      const img = new ImageData(new Uint8ClampedArray(imageData), width, height);
      result = await worker.recognize(img);
    } else {
      result = await worker.recognize(imageData);
    }

    const output = outputFormat === 'hocr' ? result.data.hocr : result.data.text;
    self.postMessage({ type: 'result', id, text: output, confidence: result.data.confidence });
  } catch (err) {
    self.postMessage({ type: 'error', id, error: err.message });
  }
}
