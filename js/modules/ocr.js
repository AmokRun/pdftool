/* ============================================================
   OCR MODULE — text extraction using Tesseract.js
   ============================================================ */
'use strict';

const OCRModule = (() => {

  // ---- State ----
  const state = {
    file: null,
    pages: [],        // Array of canvas elements (rendered PDF pages or image)
    worker: null,
    isRunning: false,
    initialized: false
  };

  // ---- Helpers ----
  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function setEngineStatus(text) {
    const el = document.getElementById('ocr-engine-status');
    if (el) el.textContent = text;
    const statusBox = document.getElementById('ocr-status');
    if (statusBox) statusBox.classList.remove('hidden');
  }

  function setProgress(pct, label) {
    const fill = document.getElementById('ocr-progress-fill');
    const text = document.getElementById('ocr-progress-text');
    if (fill) fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
    if (text) text.textContent = label !== undefined ? label : Math.round(pct) + '%';
  }

  function showProgressBar() {
    const el = document.getElementById('ocr-progress');
    if (el) el.classList.remove('hidden');
  }

  function hideProgressBar() {
    const el = document.getElementById('ocr-progress');
    if (el) el.classList.add('hidden');
  }

  function getLanguage() {
    const sel = document.getElementById('ocr-language');
    return sel ? sel.value : 'eng';
  }

  function getOutputFormat() {
    const radio = document.querySelector('input[name="ocr-output"]:checked');
    return radio ? radio.value : 'text';
  }

  function setOutputText(text) {
    const ta = document.getElementById('ocr-output');
    if (ta) ta.value = text;

    const copyBtn = document.getElementById('ocr-copy-btn');
    const dlBtn = document.getElementById('ocr-download-btn');
    if (copyBtn) copyBtn.style.display = text ? '' : 'none';
    if (dlBtn) dlBtn.style.display = text ? '' : 'none';
  }

  // ---- Render PDF pages to canvases ----
  async function renderPdfPages(file) {
    if (!window.pdfjsLib) throw new Error('PDF.js non disponible — impossible de traiter un PDF');

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    const total = pdf.numPages;
    const canvases = [];

    for (let i = 1; i <= total; i++) {
      setProgress((i / total) * 30, `Rendu page ${i}/${total}...`);
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 }); // higher scale = better OCR
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      canvases.push(canvas);
    }

    return canvases;
  }

  // ---- Render image file to canvas ----
  async function renderImageToCanvas(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve([canvas]);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Impossible de charger l\'image')); };
      img.src = url;
    });
  }

  // ---- Show page previews ----
  function renderPreviews(canvases) {
    const preview = document.getElementById('ocr-preview');
    if (!preview) return;
    preview.innerHTML = '';

    canvases.forEach((canvas, idx) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-bottom:12px;text-align:center;';

      const label = document.createElement('div');
      label.style.cssText = 'font-size:11px;color:var(--text-muted,#888);margin-bottom:4px;';
      label.textContent = canvases.length > 1 ? `Page ${idx + 1}` : 'Image';

      const thumb = document.createElement('canvas');
      const maxW = 260;
      const scale = Math.min(1, maxW / canvas.width);
      thumb.width = Math.round(canvas.width * scale);
      thumb.height = Math.round(canvas.height * scale);
      thumb.style.cssText = `display:block;margin:0 auto;border:1px solid var(--border-color,#333);border-radius:4px;max-width:100%;`;
      thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height);

      wrap.appendChild(label);
      wrap.appendChild(thumb);
      preview.appendChild(wrap);
    });
  }

  // ================================================================
  // LOAD FILE
  // ================================================================
  async function loadFile(file) {
    if (!file) return;
    state.file = file;
    state.pages = [];

    setOutputText('');
    const preview = document.getElementById('ocr-preview');
    if (preview) preview.innerHTML = '<div class="empty-list-state">Chargement...</div>';

    const execBtn = document.getElementById('ocr-execute-btn');
    if (execBtn) execBtn.disabled = true;

    showProgressBar();
    setProgress(0, 'Chargement...');
    setEngineStatus('Chargement...');

    try {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

      if (isPdf) {
        state.pages = await renderPdfPages(file);
      } else {
        state.pages = await renderImageToCanvas(file);
      }

      renderPreviews(state.pages);
      setProgress(100, 'Prêt');
      setEngineStatus('Prêt');

      if (execBtn) execBtn.disabled = false;
    } catch (err) {
      console.error('OCR load error:', err);
      UI.error('Erreur lors du chargement : ' + err.message);
      if (preview) preview.innerHTML = '<div class="empty-list-state">Erreur de chargement</div>';
    } finally {
      setTimeout(hideProgressBar, 1000);
    }
  }

  // ================================================================
  // RUN OCR
  // ================================================================
  async function runOcr() {
    if (!window.Tesseract) {
      UI.error(
        'Tesseract.js non disponible — téléchargez la bibliothèque locale',
        'Bibliothèque manquante'
      );
      return;
    }

    if (!state.pages.length) {
      UI.warning('Chargez d\'abord un fichier.');
      return;
    }

    if (state.isRunning) return;
    state.isRunning = true;

    const execBtn = document.getElementById('ocr-execute-btn');
    if (execBtn) execBtn.disabled = true;

    showProgressBar();
    setProgress(0, '0%');
    setEngineStatus('En cours...');
    setOutputText('');

    const lang = getLanguage();
    const outputFmt = getOutputFormat();
    const total = state.pages.length;
    const allTexts = [];

    try {
      // Create Tesseract worker
      const logger = (m) => {
        if (m.status === 'recognizing text') {
          const pagePct = (m.progress || 0) * 100;
          // Weight by current page index — rough approximation
          const overallPct = allTexts.length / total * 100 + pagePct / total;
          setProgress(Math.min(99, overallPct), `OCR page ${allTexts.length + 1}/${total} — ${Math.round(pagePct)}%`);
        } else if (m.status === 'loading tesseract core') {
          setEngineStatus('Chargement du moteur...');
          setProgress(1, 'Chargement Tesseract...');
        } else if (m.status === 'initializing tesseract') {
          setEngineStatus('Initialisation...');
        } else if (m.status === 'loading language traineddata') {
          setEngineStatus(`Chargement langue (${lang})...`);
        } else if (m.status === 'initialized') {
          setEngineStatus('Prêt');
        }
      };

      // Point Tesseract to local files
      const workerOptions = {
        logger,
        workerPath: 'libs/tesseract/worker.min.js',
        corePath:   'libs/tesseract/tesseract-core-lstm.wasm.js',
        langPath:   'libs/tesseract/lang-data'
      };
      const worker = await window.Tesseract.createWorker(lang, 1, workerOptions);
      state.worker = worker;

      for (let i = 0; i < total; i++) {
        const canvas = state.pages[i];
        let result;

        if (outputFmt === 'hocr') {
          result = await worker.recognize(canvas, {}, { hocr: true });
          allTexts.push(`<!-- Page ${i + 1} -->\n` + (result.data.hocr || ''));
        } else {
          result = await worker.recognize(canvas);
          const text = result.data.text || '';
          allTexts.push(text);
        }
      }

      await worker.terminate();
      state.worker = null;

      // Build combined output
      let combined;
      if (total === 1) {
        combined = allTexts[0];
      } else {
        combined = allTexts.map((t, i) =>
          `${'='.repeat(40)}\nPage ${i + 1}\n${'='.repeat(40)}\n\n${t}`
        ).join('\n\n');
      }

      setOutputText(combined);
      setProgress(100, '100%');
      setEngineStatus('Prêt');

      // If PDF output requested, build simple searchable PDF
      if (outputFmt === 'pdf' && window.PDFLib) {
        try {
          await buildSearchablePdf(combined);
        } catch (e) {
          UI.warning('Impossible de créer le PDF texte : ' + e.message);
        }
      }

      // Storage
      const baseName = state.file ? state.file.name : 'ocr';
      Storage.addHistory({
        op: 'ocr',
        input: baseName,
        output: `${baseName} (OCR)`,
        status: 'success'
      });
      Storage.incrementStat('ocr');
      Storage.incrementStat('totalProcessed');

      UI.success(`OCR terminé — ${total} page(s) traitée(s)`, 'OCR');

    } catch (err) {
      if (state.worker) {
        try { await state.worker.terminate(); } catch (_) {}
        state.worker = null;
      }
      console.error('OCR error:', err);
      UI.error('Erreur OCR : ' + err.message);
      setEngineStatus('Erreur');
      Storage.addHistory({ op: 'ocr', input: state.file ? state.file.name : '', status: 'error' });
    } finally {
      state.isRunning = false;
      setTimeout(hideProgressBar, 1500);
      if (execBtn) execBtn.disabled = !state.pages.length;
    }
  }

  // ---- Build a simple text-layer PDF ----
  async function buildSearchablePdf(text) {
    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const PAGE_W = 595, PAGE_H = 842, MARGIN = 50;
    const LINE_HEIGHT = 13, FONT_SIZE = 10;
    const CHARS = 90;

    const lines = text.split('\n').flatMap(l => {
      if (!l) return [''];
      const out = [];
      for (let i = 0; i < l.length; i += CHARS) out.push(l.slice(i, i + CHARS));
      return out;
    });

    let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;

    for (const line of lines) {
      if (y < MARGIN + LINE_HEIGHT) {
        page = pdfDoc.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - MARGIN;
      }
      page.drawText(line || ' ', { x: MARGIN, y, size: FONT_SIZE, font, color: rgb(0, 0, 0) });
      y -= LINE_HEIGHT;
    }

    const bytes = await pdfDoc.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const baseName = state.file ? state.file.name.replace(/\.[^.]+$/, '') : 'ocr';
    UI.downloadBlob(blob, `${baseName}_ocr.pdf`);
  }

  // ================================================================
  // COPY + DOWNLOAD
  // ================================================================
  async function copyToClipboard() {
    const ta = document.getElementById('ocr-output');
    if (!ta || !ta.value) { UI.warning('Aucun texte à copier.'); return; }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(ta.value);
        UI.success('Texte copié dans le presse-papier', 'Copié');
      } else {
        ta.select();
        document.execCommand('copy');
        UI.success('Texte copié', 'Copié');
      }
    } catch (e) {
      UI.error('Impossible de copier : ' + e.message);
    }
  }

  function downloadText() {
    const ta = document.getElementById('ocr-output');
    if (!ta || !ta.value) { UI.warning('Aucun texte à télécharger.'); return; }
    const baseName = state.file ? state.file.name.replace(/\.[^.]+$/, '') : 'ocr';
    const fmt = getOutputFormat();
    const ext = fmt === 'hocr' ? '.hocr' : '.txt';
    UI.downloadText(ta.value, baseName + ext);
  }

  // ================================================================
  // INIT
  // ================================================================
  function init() {
    if (state.initialized) return;
    state.initialized = true;

    // File input
    const fileInput = document.getElementById('ocr-file-input');
    const addBtn = document.getElementById('ocr-add-btn');
    if (addBtn && fileInput) {
      addBtn.addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
      fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) loadFile(fileInput.files[0]);
      });
    }

    // Drop zone
    const dropZone = document.getElementById('ocr-drop-zone');
    if (dropZone) {
      UI.setupDropZone(dropZone, (files) => {
        if (files[0]) loadFile(files[0]);
      }, ['.pdf', 'image/']);
    }

    // Execute OCR
    const execBtn = document.getElementById('ocr-execute-btn');
    if (execBtn) execBtn.addEventListener('click', runOcr);

    // Copy button
    const copyBtn = document.getElementById('ocr-copy-btn');
    if (copyBtn) copyBtn.addEventListener('click', copyToClipboard);

    // Download button
    const dlBtn = document.getElementById('ocr-download-btn');
    if (dlBtn) dlBtn.addEventListener('click', downloadText);

    // Check Tesseract availability on init
    if (!window.Tesseract) {
      setEngineStatus('Tesseract.js non disponible');
      UI.warning(
        'Tesseract.js non disponible — téléchargez la bibliothèque locale',
        'OCR indisponible'
      );
    } else {
      setEngineStatus('Prêt');
    }

    console.log('[OCRModule] initialized');
  }

  return { init };
})();

window.OCRModule = OCRModule;
window.Module_ocr = OCRModule;
