/* ============================================================
   COMPRESS MODULE — reduce PDF file size via canvas re-rendering
   ============================================================ */
'use strict';

const CompressModule = (() => {

  // ---- State ----
  const state = {
    file: null,
    arrayBuffer: null,
    fileName: '',
    pageCount: 0,
    pdfDoc: null,          // PDF.js document
    compressionLevel: 'light',
    initialized: false
  };

  // ---- Compression presets ----
  const LEVELS = {
    light:  { imageQuality: 0.75, scale: 1.0,  label: 'Légère'       },
    medium: { imageQuality: 0.50, scale: 0.85, label: 'Moyenne'      },
    strong: { imageQuality: 0.25, scale: 0.70, label: 'Forte'        },
    custom: { imageQuality: null, scale: null,  label: 'Personnalisée' }
  };

  // ---- Helpers ----
  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function setProgress(pct) {
    const fill = document.getElementById('compress-progress-fill');
    const text = document.getElementById('compress-progress-text');
    if (fill) fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
    if (text) text.textContent = Math.round(pct) + '%';
  }

  function getCustomSettings() {
    const qualityEl = document.getElementById('compress-image-quality');
    const quality = qualityEl ? parseInt(qualityEl.value, 10) / 100 : 0.75;
    return {
      imageQuality: Math.max(0.01, Math.min(1.0, quality)),
      scale: 1.0   // Custom mode keeps scale, only affects quality
    };
  }

  // ---- Load file ----
  async function loadFile(file) {
    if (!file || !(file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))) {
      UI.warning('Veuillez sélectionner un fichier PDF valide.');
      return;
    }

    window.PDFState?.set(file);
    state.file = file;
    state.fileName = file.name;
    state.arrayBuffer = await file.arrayBuffer();
    state.pdfDoc = null;
    state.pageCount = 0;

    const resultArea = document.getElementById('compress-result');
    if (resultArea) {
      resultArea.innerHTML = '<div class="empty-list-state"><div class="spinner spinner-sm"></div> Analyse en cours...</div>';
    }

    if (window.pdfjsLib) {
      try {
        state.pdfDoc = await window.pdfjsLib.getDocument({ data: new Uint8Array(state.arrayBuffer) }).promise;
        state.pageCount = state.pdfDoc.numPages;
      } catch (e) {
        UI.error('Impossible de lire le PDF : ' + e.message);
        if (resultArea) resultArea.innerHTML = '<div class="empty-list-state">Erreur de chargement</div>';
        return;
      }
    } else {
      UI.warning('PDF.js non disponible — compression limitée.');
    }

    showFileInfo();
    const execBtn = document.getElementById('compress-execute-btn');
    if (execBtn) execBtn.disabled = false;
  }

  // ---- Show file information card ----
  function showFileInfo() {
    const resultArea = document.getElementById('compress-result');
    if (!resultArea) return;

    const level = state.compressionLevel;
    const preset = LEVELS[level] || LEVELS.light;
    const settings = level === 'custom' ? getCustomSettings() : preset;
    const estRatio = { light: 0.80, medium: 0.60, strong: 0.40, custom: 0.65 }[level] || 0.70;
    const estSize = Math.round(state.arrayBuffer.byteLength * estRatio);

    resultArea.innerHTML = `
      <div class="compress-info-card" id="compress-info-card">
        <div class="info-card-section">
          <h3>Fichier source</h3>
          <div class="info-row">
            <span class="info-label">Nom</span>
            <span class="info-value">${escapeHtml(state.fileName)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Taille originale</span>
            <span class="info-value" id="compress-size-before">${UI.formatSize(state.arrayBuffer.byteLength)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Pages</span>
            <span class="info-value">${state.pageCount || '?'}</span>
          </div>
        </div>
        <div class="info-card-section">
          <h3>Compression prévue</h3>
          <div class="info-row">
            <span class="info-label">Niveau</span>
            <span class="info-value">${preset.label}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Taille estimée</span>
            <span class="info-value" id="compress-size-after-est">${UI.formatSize(estSize)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Gain estimé</span>
            <span class="info-value" id="compress-gain-est">${Math.round((1 - estRatio) * 100)}%</span>
          </div>
        </div>
        <div class="info-card-section info-result-section hidden" id="compress-result-section">
          <h3>Résultat</h3>
          <div class="info-row">
            <span class="info-label">Taille finale</span>
            <span class="info-value" id="compress-size-after">—</span>
          </div>
          <div class="info-row">
            <span class="info-label">Gain réel</span>
            <span class="info-value info-gain" id="compress-gain">—</span>
          </div>
        </div>
      </div>
    `;
  }

  // ---- Execute compression ----
  async function executeCompress() {
    if (!window.PDFLib) {
      UI.error('La bibliothèque pdf-lib est introuvable.', 'Bibliothèque manquante');
      return;
    }
    if (!state.arrayBuffer) {
      UI.warning('Chargez d\'abord un PDF.');
      return;
    }
    if (!window.pdfjsLib) {
      UI.error('PDF.js est nécessaire pour la compression par re-rendu.', 'Bibliothèque manquante');
      return;
    }

    const progressEl = document.getElementById('compress-progress');
    const execBtn = document.getElementById('compress-execute-btn');
    if (progressEl) progressEl.classList.remove('hidden');
    if (execBtn) execBtn.disabled = true;

    setProgress(2);

    const level = state.compressionLevel;
    const preset = level === 'custom' ? getCustomSettings() : LEVELS[level];
    const imageQuality = preset.imageQuality;
    const renderScale = preset.scale;

    const removeMetadata = level === 'custom'
      ? !!(document.getElementById('compress-remove-metadata') || {}).checked
      : false;

    try {
      const { PDFDocument } = window.PDFLib;

      // Load source doc to get page dimensions
      const srcDoc = await PDFDocument.load(state.arrayBuffer, { ignoreEncryption: true });
      const newDoc = await PDFDocument.create();

      if (removeMetadata) {
        newDoc.setTitle('');
        newDoc.setAuthor('');
        newDoc.setSubject('');
        newDoc.setKeywords([]);
        newDoc.setProducer('PDF Toolbox');
        newDoc.setCreator('PDF Toolbox');
      }

      const total = state.pageCount || srcDoc.getPageCount();
      const offscreen = document.createElement('canvas');

      for (let i = 0; i < total; i++) {
        setProgress(5 + (i / total) * 88);

        // Get page dimensions from srcDoc
        const srcPages = srcDoc.getPages();
        const srcPage = srcPages[i];
        const { width: pdfW, height: pdfH } = srcPage.getSize();
        const pageRotation = srcPage.getRotation().angle;

        // Render page via PDF.js to canvas
        const pdfJsPage = await state.pdfDoc.getPage(i + 1);
        const viewport = pdfJsPage.getViewport({ scale: renderScale });
        offscreen.width = Math.round(viewport.width);
        offscreen.height = Math.round(viewport.height);
        const ctx = offscreen.getContext('2d');
        ctx.clearRect(0, 0, offscreen.width, offscreen.height);
        await pdfJsPage.render({ canvasContext: ctx, viewport }).promise;

        // Convert canvas to JPEG data
        const mimeType = imageQuality >= 0.95 ? 'image/png' : 'image/jpeg';
        const dataUrl = offscreen.toDataURL(mimeType, imageQuality);
        const base64 = dataUrl.split(',')[1];
        const imgBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

        // Embed image in new PDF page
        let embeddedImage;
        if (mimeType === 'image/png') {
          embeddedImage = await newDoc.embedPng(imgBytes);
        } else {
          embeddedImage = await newDoc.embedJpg(imgBytes);
        }

        // Create new page with same dimensions as original
        const newPage = newDoc.addPage([pdfW, pdfH]);
        if (pageRotation && typeof pageRotation === 'number') {
          const rotObj = window.PDFLib?.degrees?.(pageRotation);
          if (rotObj) newPage.setRotation(rotObj);
        }

        // Draw image to fill the page
        newPage.drawImage(embeddedImage, {
          x: 0,
          y: 0,
          width: pdfW,
          height: pdfH
        });
      }

      setProgress(95);

      const compressedBytes = await newDoc.save();
      const blob = new Blob([compressedBytes], { type: 'application/pdf' });
      const baseName = state.fileName.replace(/\.pdf$/i, '');
      const outputName = `${baseName}_compressé.pdf`;

      setProgress(99);

      UI.downloadBlob(blob, outputName);

      // Update result card
      const beforeSize = state.arrayBuffer.byteLength;
      const afterSize = compressedBytes.byteLength;
      const gain = Math.round((1 - afterSize / beforeSize) * 100);

      const resultSection = document.getElementById('compress-result-section');
      if (resultSection) resultSection.classList.remove('hidden');

      const sizeAfterEl = document.getElementById('compress-size-after');
      if (sizeAfterEl) sizeAfterEl.textContent = UI.formatSize(afterSize);

      const gainEl = document.getElementById('compress-gain');
      if (gainEl) {
        gainEl.textContent = gain > 0 ? `-${gain}%` : `+${Math.abs(gain)}%`;
        gainEl.style.color = gain > 0 ? 'var(--success, #4caf50)' : 'var(--warning, #ff9800)';
      }

      // Persist
      Storage.addRecentFile({
        id: UI.uid(),
        name: outputName,
        size: afterSize,
        pages: newDoc.getPageCount(),
        tool: 'compress',
        date: Date.now()
      });
      Storage.addHistory({
        op: 'compress',
        input: state.fileName,
        output: outputName,
        size_before: beforeSize,
        size_after: afterSize,
        status: 'success'
      });
      Storage.incrementStat('compressions');
      Storage.incrementStat('totalProcessed');
      if (afterSize < beforeSize) {
        Storage.incrementStat('totalBytesSaved', beforeSize - afterSize);
      }

      setProgress(100);
      const gainMsg = gain > 0
        ? `Gain : ${gain}% · ${UI.formatSize(beforeSize - afterSize)} économisés`
        : 'Le fichier ne peut pas être réduit davantage avec ce niveau.';
      UI.success(`Compression terminée. ${gainMsg}`, 'PDF compressé');

    } catch (err) {
      console.error('Compress error:', err);
      UI.error('Erreur lors de la compression : ' + err.message);
      Storage.addHistory({ op: 'compress', input: state.fileName, status: 'error' });
    } finally {
      setTimeout(() => {
        if (progressEl) progressEl.classList.add('hidden');
        if (execBtn) execBtn.disabled = false;
      }, 1200);
    }
  }

  // ---- Level button activation ----
  function setCompressionLevel(level) {
    state.compressionLevel = level;
    document.querySelectorAll('.compress-level-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.level === level);
    });
    const customOptions = document.getElementById('compress-custom-options');
    if (customOptions) {
      if (level === 'custom') {
        customOptions.classList.remove('hidden');
      } else {
        customOptions.classList.add('hidden');
      }
    }
    // Refresh estimate if file already loaded
    if (state.arrayBuffer) showFileInfo();
  }

  // ---- Init ----
  function init() {
    if (state.initialized) return;
    state.initialized = true;

    // File open
    const addBtn = document.getElementById('compress-add-btn');
    const fileInput = document.getElementById('compress-file-input');
    if (addBtn && fileInput) {
      addBtn.addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
      fileInput.addEventListener('change', () => {
        if (fileInput.files.length) loadFile(fileInput.files[0]);
      });
    }

    // Compression level buttons
    document.querySelectorAll('.compress-level-btn').forEach(btn => {
      btn.addEventListener('click', () => setCompressionLevel(btn.dataset.level));
    });

    // Custom quality slider live update
    const qualitySlider = document.getElementById('compress-image-quality');
    const qualityVal = document.getElementById('compress-quality-val');
    if (qualitySlider && qualityVal) {
      qualitySlider.addEventListener('input', () => {
        qualityVal.textContent = qualitySlider.value;
        if (state.compressionLevel === 'custom' && state.arrayBuffer) showFileInfo();
      });
    }

    // Execute
    const execBtn = document.getElementById('compress-execute-btn');
    if (execBtn) execBtn.addEventListener('click', executeCompress);

    // Drop zone
    const dropZone = document.getElementById('compress-drop-zone');
    if (dropZone) {
      UI.setupDropZone(dropZone, (files) => {
        if (files.length) loadFile(files[0]);
      }, ['.pdf']);
    }

    // Set default active level
    setCompressionLevel('light');

    _autoLoad();
    console.log('[CompressModule] initialized');
  }

  function _autoLoad() {
    const f = window.PDFState?.get();
    if (!state.file && f) loadFile(f);
  }

  function activate() { _autoLoad(); }

  return { init, loadFile, activate };
})();

window.CompressModule = CompressModule;
window.Module_compress = CompressModule;

// Module initialized
