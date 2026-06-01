/* ============================================================
   SPLIT MODULE — divide a PDF into separate documents
   REORDER MODULE — rearrange, delete, duplicate, rotate pages
   ============================================================ */
'use strict';

/* ============================================================
   Shared state and utilities
   ============================================================ */

const _splitShared = (() => {

  // ---- Shared PDF state (loaded once, shared between both modules) ----
  const state = {
    file: null,           // Original File object
    arrayBuffer: null,    // ArrayBuffer of the loaded PDF
    pdfDoc: null,         // PDF.js document (for rendering)
    pageCount: 0,
    fileName: ''
  };

  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ---- Load a PDF file and return page count ----
  async function loadPdf(file) {
    if (!file || !(file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))) {
      UI.warning('Veuillez sélectionner un fichier PDF valide.');
      return false;
    }
    state.file = file;
    state.fileName = file.name;
    state.arrayBuffer = await file.arrayBuffer();

    if (!window.pdfjsLib) {
      UI.warning('PDF.js non disponible — aperçu des pages impossible.');
      state.pdfDoc = null;
      state.pageCount = 0;
      return true;
    }

    try {
      state.pdfDoc = await window.pdfjsLib.getDocument({ data: new Uint8Array(state.arrayBuffer) }).promise;
      state.pageCount = state.pdfDoc.numPages;
    } catch (e) {
      UI.error('Impossible de lire le PDF : ' + e.message);
      return false;
    }
    return true;
  }

  // ---- Render a single page to a canvas at given scale ----
  async function renderPageToCanvas(pageNum, scale, canvas) {
    if (!state.pdfDoc) return false;
    try {
      const page = await state.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---- Parse range string "1-3, 5, 7-9" into 0-based page index arrays ----
  // Returns array of arrays, e.g. [[0,1,2], [4], [6,7,8]]
  function parseRanges(str, totalPages) {
    const result = [];
    const segments = str.split(',').map(s => s.trim()).filter(Boolean);
    for (const seg of segments) {
      const m = seg.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) continue;
      let start = parseInt(m[1], 10);
      let end = m[2] ? parseInt(m[2], 10) : start;
      // Clamp to valid range
      start = Math.max(1, start);
      end = Math.min(totalPages, end);
      if (start > end) continue;
      const pages = [];
      for (let i = start; i <= end; i++) pages.push(i - 1); // 0-based
      result.push(pages);
    }
    return result;
  }

  // ---- Download a Uint8Array as a PDF ----
  function downloadPdfBytes(bytes, name) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    UI.downloadBlob(blob, name);
  }

  return { state, escapeHtml, uid, loadPdf, renderPageToCanvas, parseRanges, downloadPdfBytes };
})();


/* ============================================================
   SPLIT MODULE
   ============================================================ */

const SplitModule = (() => {
  const { state, escapeHtml, uid, loadPdf, renderPageToCanvas, parseRanges, downloadPdfBytes } = _splitShared;

  const local = {
    initialized: false,
    selectedPages: new Set()   // 0-based selected page indices
  };

  // ---- Render page thumbnails for split preview ----
  async function renderSplitPreview() {
    const grid = document.getElementById('split-preview');
    if (!grid) return;
    grid.innerHTML = '';

    if (!state.pageCount) {
      grid.innerHTML = '<div class="empty-list-state">Chargez un PDF pour voir un aperçu des pages</div>';
      return;
    }

    local.selectedPages.clear();

    for (let i = 0; i < state.pageCount; i++) {
      const pageNum = i + 1;
      const item = document.createElement('div');
      item.className = 'page-thumb-item';
      item.dataset.page = i;
      item.innerHTML = `
        <canvas class="page-thumb-canvas" data-page="${i}"></canvas>
        <div class="page-thumb-label">Page ${pageNum}</div>
      `;

      item.addEventListener('click', (e) => {
        togglePageSelection(i, e.ctrlKey || e.metaKey || e.shiftKey, item);
      });

      grid.appendChild(item);

      // Render async
      const canvas = item.querySelector('canvas');
      renderPageToCanvas(pageNum, 0.5, canvas).then(ok => {
        if (!ok) {
          canvas.style.background = 'var(--bg-secondary, #2a2d3e)';
          const ctx = canvas.getContext('2d');
          canvas.width = 100;
          canvas.height = 130;
          ctx.fillStyle = '#888';
          ctx.font = '11px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`Page ${pageNum}`, 50, 70);
        }
      });
    }

    updateSplitUI();
  }

  function togglePageSelection(pageIdx, multi, itemEl) {
    if (multi) {
      if (local.selectedPages.has(pageIdx)) {
        local.selectedPages.delete(pageIdx);
        if (itemEl) itemEl.classList.remove('selected');
      } else {
        local.selectedPages.add(pageIdx);
        if (itemEl) itemEl.classList.add('selected');
      }
    } else {
      // Single select — clear others
      local.selectedPages.clear();
      document.querySelectorAll('#split-preview .page-thumb-item.selected')
        .forEach(el => el.classList.remove('selected'));
      local.selectedPages.add(pageIdx);
      if (itemEl) itemEl.classList.add('selected');
    }
  }

  function updateSplitUI() {
    const btn = document.getElementById('split-execute-btn');
    if (btn) btn.disabled = !state.pageCount;
  }

  // ---- Show / hide range input based on split mode ----
  function handleModeChange() {
    const mode = document.querySelector('input[name="split-mode"]:checked');
    const rangeInput = document.getElementById('split-range-input');
    if (!rangeInput) return;
    if (mode && mode.value === 'range') {
      rangeInput.classList.remove('hidden');
    } else {
      rangeInput.classList.add('hidden');
    }
  }

  // ---- Execute split ----
  async function executeSplit() {
    if (!window.PDFLib) {
      UI.error('La bibliothèque pdf-lib est introuvable.', 'Bibliothèque manquante');
      return;
    }
    if (!state.arrayBuffer || !state.pageCount) {
      UI.warning('Chargez d\'abord un PDF.');
      return;
    }

    const modeEl = document.querySelector('input[name="split-mode"]:checked');
    const mode = modeEl ? modeEl.value : 'pages';

    const progressEl = document.getElementById('split-progress');
    const fillEl = document.getElementById('split-progress-fill');
    const textEl = document.getElementById('split-progress-text');
    const execBtn = document.getElementById('split-execute-btn');

    if (progressEl) progressEl.classList.remove('hidden');
    if (execBtn) execBtn.disabled = true;

    const setProgress = (pct) => {
      if (fillEl) fillEl.style.width = Math.min(100, pct) + '%';
      if (textEl) textEl.textContent = Math.round(pct) + '%';
    };

    try {
      setProgress(5);
      const { PDFDocument } = window.PDFLib;
      const srcDoc = await PDFDocument.load(state.arrayBuffer, { ignoreEncryption: true });
      const baseName = state.fileName.replace(/\.pdf$/i, '');

      let pageGroups = [];

      if (mode === 'pages') {
        // One group per page
        for (let i = 0; i < state.pageCount; i++) {
          pageGroups.push({ pages: [i], name: `${baseName}_page${i + 1}.pdf` });
        }
      } else if (mode === 'range') {
        const rangeStr = (document.getElementById('split-ranges') || {}).value || '';
        if (!rangeStr.trim()) {
          UI.warning('Saisissez au moins une plage de pages (ex: 1-3, 5, 7-9).');
          return;
        }
        const groups = parseRanges(rangeStr, state.pageCount);
        if (!groups.length) {
          UI.warning('Plages invalides. Exemple : 1-3, 5, 7-9');
          return;
        }
        groups.forEach((pages, idx) => {
          const label = pages.map(p => p + 1).join('-');
          pageGroups.push({ pages, name: `${baseName}_pages${label}.pdf` });
        });
      } else if (mode === 'chapters') {
        // Split into equal thirds as a fallback (no TOC available without specialized parsing)
        const third = Math.ceil(state.pageCount / 3);
        for (let i = 0; i < state.pageCount; i += third) {
          const pages = [];
          for (let j = i; j < Math.min(i + third, state.pageCount); j++) pages.push(j);
          pageGroups.push({ pages, name: `${baseName}_chapitre${pageGroups.length + 1}.pdf` });
        }
      } else if (mode === 'bookmarks') {
        // Fallback: split each page (bookmarks not readily available via pdf-lib)
        for (let i = 0; i < state.pageCount; i++) {
          pageGroups.push({ pages: [i], name: `${baseName}_partie${i + 1}.pdf` });
        }
        UI.info('Signets non disponibles — division page par page effectuée.');
      }

      if (!pageGroups.length) {
        UI.warning('Aucun groupe de pages à exporter.');
        return;
      }

      const total = pageGroups.length;
      let generated = 0;

      for (const group of pageGroups) {
        setProgress(5 + (generated / total) * 90);
        const newDoc = await PDFDocument.create();
        const copied = await newDoc.copyPages(srcDoc, group.pages);
        copied.forEach(p => newDoc.addPage(p));
        const bytes = await newDoc.save();
        downloadPdfBytes(bytes, group.name);
        generated++;
      }

      setProgress(100);

      const totalInputSize = state.arrayBuffer.byteLength;
      Storage.addHistory({
        op: 'split',
        input: state.fileName,
        output: `${total} fichier(s)`,
        size_before: totalInputSize,
        size_after: 0,
        status: 'success'
      });
      Storage.incrementStat('splits');
      Storage.incrementStat('totalProcessed');

      UI.success(`${total} fichier(s) PDF généré(s) avec succès.`, 'Division terminée');

    } catch (err) {
      console.error('Split error:', err);
      UI.error('Erreur lors de la division : ' + err.message);
      Storage.addHistory({ op: 'split', input: state.fileName, status: 'error' });
    } finally {
      setTimeout(() => {
        if (progressEl) progressEl.classList.add('hidden');
        if (execBtn) execBtn.disabled = !state.pageCount;
      }, 1200);
    }
  }

  // ---- Load file (called from drop zone or file input) ----
  async function loadFile(file) {
    const grid = document.getElementById('split-preview');
    if (grid) {
      grid.innerHTML = '<div class="empty-list-state"><div class="spinner spinner-sm"></div> Chargement...</div>';
    }
    const ok = await loadPdf(file);
    if (!ok) {
      if (grid) grid.innerHTML = '<div class="empty-list-state">Erreur de chargement</div>';
      return;
    }
    await renderSplitPreview();
    UI.info(`"${state.fileName}" chargé — ${state.pageCount} page(s).`);
  }

  // ---- Init ----
  function init() {
    if (local.initialized) return;
    local.initialized = true;

    const addBtn = document.getElementById('split-add-btn');
    const fileInput = document.getElementById('split-file-input');
    if (addBtn && fileInput) {
      addBtn.addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
      fileInput.addEventListener('change', () => {
        if (fileInput.files.length) loadFile(fileInput.files[0]);
      });
    }

    const execBtn = document.getElementById('split-execute-btn');
    if (execBtn) execBtn.addEventListener('click', executeSplit);

    // Mode radio change
    document.querySelectorAll('input[name="split-mode"]').forEach(radio => {
      radio.addEventListener('change', handleModeChange);
    });
    handleModeChange();

    // Drop zone
    const dropZone = document.getElementById('split-drop-zone');
    if (dropZone) {
      UI.setupDropZone(dropZone, (files) => {
        if (files.length) loadFile(files[0]);
      }, ['.pdf']);
    }

    updateSplitUI();
    console.log('[SplitModule] initialized');
  }

  return { init, loadFile };
})();

window.SplitModule = SplitModule;
window.Module_split = SplitModule;


/* ============================================================
   REORDER MODULE
   ============================================================ */

const ReorderModule = (() => {
  const { state, escapeHtml, uid, loadPdf, renderPageToCanvas, parseRanges, downloadPdfBytes } = _splitShared;

  const local = {
    initialized: false,
    pageOrder: [],        // Array of { origIdx (0-based), rotation }
    selectedIndices: new Set()  // Indices into pageOrder array
  };

  // ---- Render / refresh page grid ----
  async function renderPageGrid() {
    const grid = document.getElementById('reorder-page-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!state.pageCount || !local.pageOrder.length) {
      grid.innerHTML = '<div class="empty-list-state">Chargez un PDF pour commencer</div>';
      return;
    }

    local.selectedIndices.clear();

    for (let orderIdx = 0; orderIdx < local.pageOrder.length; orderIdx++) {
      const entry = local.pageOrder[orderIdx];
      const pageNum = entry.origIdx + 1;

      const item = document.createElement('div');
      item.className = 'page-thumb-item reorder-page-item';
      item.dataset.orderIdx = orderIdx;
      item.setAttribute('draggable', 'true');
      item.innerHTML = `
        <div class="page-thumb-canvas-wrap">
          <canvas class="page-thumb-canvas" data-order="${orderIdx}"></canvas>
        </div>
        <div class="page-thumb-label">Page ${pageNum}</div>
        <div class="page-thumb-order">#${orderIdx + 1}</div>
      `;

      // Click to select
      item.addEventListener('click', (e) => {
        toggleReorderSelection(orderIdx, e.ctrlKey || e.metaKey || e.shiftKey, item);
      });

      grid.appendChild(item);

      // Render thumbnail with rotation
      const canvas = item.querySelector('canvas');
      renderPageToCanvas(pageNum, 0.5, canvas).then(ok => {
        if (!ok) {
          canvas.style.background = 'var(--bg-secondary, #2a2d3e)';
          canvas.width = 100;
          canvas.height = 130;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#888';
          ctx.font = '11px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`Page ${pageNum}`, 50, 70);
        }
        // Apply rotation via CSS
        applyCanvasRotation(canvas, entry.rotation);
      });
    }

    // Make grid sortable
    setupReorderDragDrop(grid);
    updateReorderUI();
  }

  // ---- Apply CSS rotation to a canvas ----
  function applyCanvasRotation(canvas, rotation) {
    const norm = ((rotation % 360) + 360) % 360;
    canvas.style.transform = norm ? `rotate(${norm}deg)` : '';
    // Swap wrap dimensions for 90/270
    const wrap = canvas.closest('.page-thumb-canvas-wrap');
    if (wrap) {
      if (norm === 90 || norm === 270) {
        wrap.style.aspectRatio = '3/4';
      } else {
        wrap.style.aspectRatio = '';
      }
    }
  }

  // ---- Toggle page selection ----
  function toggleReorderSelection(orderIdx, multi, itemEl) {
    if (multi) {
      if (local.selectedIndices.has(orderIdx)) {
        local.selectedIndices.delete(orderIdx);
        if (itemEl) itemEl.classList.remove('selected');
      } else {
        local.selectedIndices.add(orderIdx);
        if (itemEl) itemEl.classList.add('selected');
      }
    } else {
      // Single: toggle if already selected, else select only this
      const wasSelected = local.selectedIndices.has(orderIdx);
      clearSelection();
      if (!wasSelected) {
        local.selectedIndices.add(orderIdx);
        if (itemEl) itemEl.classList.add('selected');
      }
    }
    updateReorderUI();
  }

  function clearSelection() {
    local.selectedIndices.clear();
    document.querySelectorAll('#reorder-page-grid .page-thumb-item.selected')
      .forEach(el => el.classList.remove('selected'));
  }

  // ---- Update UI state ----
  function updateReorderUI() {
    const execBtn = document.getElementById('reorder-execute-btn');
    const actionsPanel = document.getElementById('reorder-actions');
    const countEl = document.getElementById('reorder-selection-count');
    const selCount = local.selectedIndices.size;

    if (execBtn) execBtn.disabled = !local.pageOrder.length;
    if (actionsPanel) {
      actionsPanel.style.display = local.pageOrder.length ? 'block' : 'none';
    }
    if (countEl) {
      countEl.textContent = `${selCount} page(s) sélectionnée(s)`;
    }

    // Enable/disable action buttons based on selection
    ['reorder-delete-btn', 'reorder-extract-btn', 'reorder-duplicate-btn',
     'reorder-rotate-left-btn', 'reorder-rotate-right-btn'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = selCount === 0;
    });
  }

  // ---- Drag-and-drop reordering within the grid ----
  function setupReorderDragDrop(grid) {
    let dragSrcIdx = null;

    grid.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.reorder-page-item');
      if (!item) return;
      dragSrcIdx = parseInt(item.dataset.orderIdx, 10);
      e.dataTransfer.effectAllowed = 'move';
      item.classList.add('dragging');
    });

    grid.addEventListener('dragend', (e) => {
      const item = e.target.closest('.reorder-page-item');
      if (item) item.classList.remove('dragging');
      dragSrcIdx = null;
    });

    grid.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const item = e.target.closest('.reorder-page-item');
      grid.querySelectorAll('.reorder-page-item').forEach(el => el.classList.remove('drag-target'));
      if (item) item.classList.add('drag-target');
    });

    grid.addEventListener('dragleave', (e) => {
      const item = e.target.closest('.reorder-page-item');
      if (item) item.classList.remove('drag-target');
    });

    grid.addEventListener('drop', (e) => {
      e.preventDefault();
      grid.querySelectorAll('.reorder-page-item').forEach(el => el.classList.remove('drag-target', 'dragging'));
      const item = e.target.closest('.reorder-page-item');
      if (!item || dragSrcIdx === null) return;
      const dstIdx = parseInt(item.dataset.orderIdx, 10);
      if (dragSrcIdx === dstIdx) return;

      // Move entry in pageOrder
      const moved = local.pageOrder.splice(dragSrcIdx, 1)[0];
      local.pageOrder.splice(dstIdx, 0, moved);
      dragSrcIdx = null;

      // Re-render (async, but fine for UX)
      renderPageGrid();
    });
  }

  // ---- Operations on selected pages ----

  function deleteSelected() {
    if (!local.selectedIndices.size) return;
    if (local.pageOrder.length - local.selectedIndices.size < 1) {
      UI.warning('Impossible de supprimer toutes les pages.');
      return;
    }
    const sorted = [...local.selectedIndices].sort((a, b) => b - a);
    sorted.forEach(idx => local.pageOrder.splice(idx, 1));
    local.selectedIndices.clear();
    renderPageGrid();
  }

  async function extractSelected() {
    if (!local.selectedIndices.size) return;
    if (!window.PDFLib) {
      UI.error('pdf-lib non disponible.', 'Bibliothèque manquante');
      return;
    }
    const { PDFDocument } = window.PDFLib;
    try {
      const srcDoc = await PDFDocument.load(state.arrayBuffer, { ignoreEncryption: true });
      const newDoc = await PDFDocument.create();
      const sorted = [...local.selectedIndices].sort((a, b) => a - b);
      const origIndices = sorted.map(i => local.pageOrder[i].origIdx);
      const copied = await newDoc.copyPages(srcDoc, origIndices);
      copied.forEach(p => newDoc.addPage(p));
      const bytes = await newDoc.save();
      const baseName = state.fileName.replace(/\.pdf$/i, '');
      downloadPdfBytes(bytes, `${baseName}_extrait.pdf`);
      UI.success(`${sorted.length} page(s) extraite(s).`);
    } catch (err) {
      UI.error('Erreur lors de l\'extraction : ' + err.message);
    }
  }

  function duplicateSelected() {
    if (!local.selectedIndices.size) return;
    const sorted = [...local.selectedIndices].sort((a, b) => a - b);
    // Insert duplicates after the last selected item
    const lastIdx = sorted[sorted.length - 1];
    const duplicates = sorted.map(i => ({ ...local.pageOrder[i] }));
    local.pageOrder.splice(lastIdx + 1, 0, ...duplicates);
    local.selectedIndices.clear();
    renderPageGrid();
  }

  function rotateSelected(degrees) {
    if (!local.selectedIndices.size) return;
    local.selectedIndices.forEach(idx => {
      const entry = local.pageOrder[idx];
      if (entry) entry.rotation = ((entry.rotation || 0) + degrees + 360) % 360;
    });
    // Update canvas rotation visually without full re-render
    document.querySelectorAll('#reorder-page-grid .reorder-page-item.selected').forEach(item => {
      const orderIdx = parseInt(item.dataset.orderIdx, 10);
      const entry = local.pageOrder[orderIdx];
      if (!entry) return;
      const canvas = item.querySelector('canvas');
      if (canvas) applyCanvasRotation(canvas, entry.rotation);
    });
  }

  // ---- Save reordered PDF ----
  async function saveReordered() {
    if (!window.PDFLib) {
      UI.error('pdf-lib non disponible.', 'Bibliothèque manquante');
      return;
    }
    if (!local.pageOrder.length) {
      UI.warning('Aucune page à sauvegarder.');
      return;
    }

    const execBtn = document.getElementById('reorder-execute-btn');
    if (execBtn) execBtn.disabled = true;

    try {
      const { PDFDocument, degrees } = window.PDFLib;
      const srcDoc = await PDFDocument.load(state.arrayBuffer, { ignoreEncryption: true });
      const newDoc = await PDFDocument.create();
      const origIndices = local.pageOrder.map(e => e.origIdx);
      const copied = await newDoc.copyPages(srcDoc, origIndices);
      copied.forEach((page, i) => {
        const rotation = local.pageOrder[i].rotation || 0;
        if (rotation) {
          const current = page.getRotation().angle;
          page.setRotation(degrees((current + rotation) % 360));
        }
        newDoc.addPage(page);
      });

      const bytes = await newDoc.save();
      const baseName = state.fileName.replace(/\.pdf$/i, '');
      downloadPdfBytes(bytes, `${baseName}_réorganisé.pdf`);

      Storage.addRecentFile({
        id: UI.uid(),
        name: `${baseName}_réorganisé.pdf`,
        size: bytes.byteLength,
        pages: newDoc.getPageCount(),
        tool: 'reorder',
        date: Date.now()
      });
      Storage.addHistory({
        op: 'reorder',
        input: state.fileName,
        output: `${baseName}_réorganisé.pdf`,
        size_before: state.arrayBuffer.byteLength,
        size_after: bytes.byteLength,
        status: 'success'
      });
      Storage.incrementStat('splits');
      Storage.incrementStat('totalProcessed');

      UI.success(`PDF réorganisé sauvegardé — ${newDoc.getPageCount()} pages.`, 'Succès');
    } catch (err) {
      console.error('Reorder save error:', err);
      UI.error('Erreur lors de la sauvegarde : ' + err.message);
      Storage.addHistory({ op: 'reorder', input: state.fileName, status: 'error' });
    } finally {
      if (execBtn) execBtn.disabled = !local.pageOrder.length;
    }
  }

  // ---- Load file ----
  async function loadFile(file) {
    const grid = document.getElementById('reorder-page-grid');
    if (grid) {
      grid.innerHTML = '<div class="empty-list-state"><div class="spinner spinner-sm"></div> Chargement...</div>';
    }
    const ok = await loadPdf(file);
    if (!ok) {
      if (grid) grid.innerHTML = '<div class="empty-list-state">Erreur de chargement</div>';
      return;
    }
    // Build initial page order (identity, no rotation)
    local.pageOrder = Array.from({ length: state.pageCount }, (_, i) => ({
      origIdx: i,
      rotation: 0
    }));
    local.selectedIndices.clear();
    await renderPageGrid();
    UI.info(`"${state.fileName}" chargé — ${state.pageCount} page(s).`);
  }

  // ---- Init ----
  function init() {
    if (local.initialized) return;
    local.initialized = true;

    const addBtn = document.getElementById('reorder-add-btn');
    const fileInput = document.getElementById('reorder-file-input');
    if (addBtn && fileInput) {
      addBtn.addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
      fileInput.addEventListener('change', () => {
        if (fileInput.files.length) loadFile(fileInput.files[0]);
      });
    }

    // Action buttons
    const delBtn = document.getElementById('reorder-delete-btn');
    if (delBtn) delBtn.addEventListener('click', deleteSelected);

    const extBtn = document.getElementById('reorder-extract-btn');
    if (extBtn) extBtn.addEventListener('click', extractSelected);

    const dupBtn = document.getElementById('reorder-duplicate-btn');
    if (dupBtn) dupBtn.addEventListener('click', duplicateSelected);

    const rotLBtn = document.getElementById('reorder-rotate-left-btn');
    if (rotLBtn) rotLBtn.addEventListener('click', () => rotateSelected(-90));

    const rotRBtn = document.getElementById('reorder-rotate-right-btn');
    if (rotRBtn) rotRBtn.addEventListener('click', () => rotateSelected(90));

    const saveBtn = document.getElementById('reorder-execute-btn');
    if (saveBtn) saveBtn.addEventListener('click', saveReordered);

    // Drop zone
    const dropZone = document.getElementById('reorder-drop-zone');
    if (dropZone) {
      UI.setupDropZone(dropZone, (files) => {
        if (files.length) loadFile(files[0]);
      }, ['.pdf']);
    }

    updateReorderUI();
    console.log('[ReorderModule] initialized');
  }

  return { init, loadFile };
})();

window.ReorderModule = ReorderModule;
window.Module_reorder = ReorderModule;

// Module initialized
