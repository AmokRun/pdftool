/* ============================================================
   MERGE MODULE — combine multiple PDFs into one
   ============================================================ */
'use strict';

const MergeModule = (() => {

  // ---- State ----
  const state = {
    files: [],       // Array of { id, file, name, size, pages, arrayBuffer }
    initialized: false
  };

  // ---- Helpers ----
  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ---- Get page count from ArrayBuffer via PDF.js ----
  async function getPageCount(arrayBuffer) {
    if (!window.pdfjsLib) return null;
    try {
      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
      return pdf.numPages;
    } catch (e) {
      return null;
    }
  }

  // ---- Render a thumbnail canvas for first page via PDF.js ----
  async function renderThumbnail(arrayBuffer, canvas) {
    if (!window.pdfjsLib) return false;
    try {
      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 0.3 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---- Add files to the merge list ----
  async function addFiles(files) {
    const pdfs = Array.from(files).filter(f =>
      f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );
    if (!pdfs.length) {
      UI.warning('Aucun fichier PDF valide sélectionné.');
      return;
    }

    for (const file of pdfs) {
      // Prevent duplicates by name+size
      const isDupe = state.files.some(e => e.name === file.name && e.size === file.size);
      if (isDupe) {
        UI.info(`"${file.name}" est déjà dans la liste.`);
        continue;
      }
      const id = uid();
      const arrayBuffer = await file.arrayBuffer();
      const pages = await getPageCount(arrayBuffer);
      const entry = { id, file, name: file.name, size: file.size, pages, arrayBuffer };
      state.files.push(entry);
      renderFileItem(entry);
    }

    updateUI();
  }

  // ---- Render a single file row in the list ----
  function renderFileItem(entry) {
    const list = document.getElementById('merge-file-list');
    // Remove empty-state placeholder if present
    const empty = list.querySelector('.empty-list-state');
    if (empty) empty.remove();

    const item = document.createElement('div');
    item.className = 'merge-file-item sortable-item';
    item.dataset.id = entry.id;
    item.setAttribute('draggable', 'true');

    const pagesLabel = entry.pages !== null && entry.pages !== undefined
      ? `${entry.pages} page${entry.pages !== 1 ? 's' : ''}`
      : '? pages';

    item.innerHTML = `
      <span class="drag-handle" title="Déplacer">⠿</span>
      <div class="file-thumb-wrap">
        <canvas class="file-thumb-canvas" data-id="${entry.id}"></canvas>
        <span class="file-thumb-icon hidden" data-id="${entry.id}">📄</span>
      </div>
      <div class="file-item-info">
        <span class="file-item-name" title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</span>
        <span class="file-item-meta">${UI.formatSize(entry.size)} · ${pagesLabel}</span>
      </div>
      <button class="btn btn-ghost btn-xs file-remove-btn" data-id="${entry.id}" title="Supprimer">✕</button>
    `;

    list.appendChild(item);

    // Wire up remove button
    item.querySelector('.file-remove-btn').addEventListener('click', () => removeFile(entry.id));

    // Render thumbnail async
    const canvas = item.querySelector(`canvas[data-id="${entry.id}"]`);
    const icon = item.querySelector(`.file-thumb-icon[data-id="${entry.id}"]`);
    renderThumbnail(entry.arrayBuffer, canvas).then(ok => {
      if (!ok) {
        canvas.classList.add('hidden');
        icon.classList.remove('hidden');
      }
    });
  }

  // ---- Remove a file ----
  function removeFile(id) {
    state.files = state.files.filter(e => e.id !== id);
    const item = document.querySelector(`.merge-file-item[data-id="${id}"]`);
    if (item) item.remove();
    updateUI();
    // Restore empty state if no files
    const list = document.getElementById('merge-file-list');
    if (!list.querySelector('.merge-file-item')) {
      list.innerHTML = '<div class="empty-list-state">Ajoutez des PDF pour commencer</div>';
    }
  }

  // ---- Sync state.files order from the DOM ----
  function syncOrderFromDOM() {
    const list = document.getElementById('merge-file-list');
    const items = [...list.querySelectorAll('.merge-file-item[data-id]')];
    const idOrder = items.map(el => el.dataset.id);
    state.files.sort((a, b) => idOrder.indexOf(a.id) - idOrder.indexOf(b.id));
  }

  // ---- Update merge count and button state ----
  function updateUI() {
    const countEl = document.getElementById('merge-count');
    if (countEl) countEl.textContent = state.files.length;
    const execBtn = document.getElementById('merge-execute-btn');
    if (execBtn) execBtn.disabled = state.files.length < 2;
  }

  // ---- Execute merge ----
  async function executeMerge() {
    if (!window.PDFLib) {
      UI.error('La bibliothèque pdf-lib est introuvable. Veuillez inclure pdf-lib avant ce module.', 'Bibliothèque manquante');
      return;
    }
    if (state.files.length < 2) {
      UI.warning('Ajoutez au moins 2 fichiers PDF pour fusionner.');
      return;
    }

    syncOrderFromDOM();

    const progressEl = document.getElementById('merge-progress');
    const fillEl = document.getElementById('merge-progress-fill');
    const textEl = document.getElementById('merge-progress-text');
    const execBtn = document.getElementById('merge-execute-btn');

    if (progressEl) progressEl.classList.remove('hidden');
    if (execBtn) execBtn.disabled = true;

    const setProgress = (pct) => {
      if (fillEl) fillEl.style.width = Math.min(100, pct) + '%';
      if (textEl) textEl.textContent = Math.round(pct) + '%';
    };

    try {
      setProgress(5);
      const { PDFDocument } = window.PDFLib;
      const mergedDoc = await PDFDocument.create();

      const total = state.files.length;
      for (let i = 0; i < total; i++) {
        const entry = state.files[i];
        setProgress(5 + (i / total) * 85);

        let srcDoc;
        try {
          srcDoc = await PDFDocument.load(entry.arrayBuffer, { ignoreEncryption: true });
        } catch (e) {
          UI.error(`Impossible de lire "${entry.name}": ${e.message}`);
          continue;
        }

        const pageIndices = srcDoc.getPageIndices();
        const copiedPages = await mergedDoc.copyPages(srcDoc, pageIndices);
        copiedPages.forEach(p => mergedDoc.addPage(p));
      }

      setProgress(92);

      const mergedBytes = await mergedDoc.save();
      const blob = new Blob([mergedBytes], { type: 'application/pdf' });

      setProgress(98);

      // Build output filename
      const firstName = state.files[0].name.replace(/\.pdf$/i, '');
      const outputName = `${firstName}_fusionné.pdf`;

      UI.downloadBlob(blob, outputName);

      // Persist to storage
      const totalInputSize = state.files.reduce((s, e) => s + e.size, 0);
      const fileId = UI.uid();
      Storage.addRecentFile({
        id: fileId,
        name: outputName,
        size: mergedBytes.byteLength,
        pages: mergedDoc.getPageCount(),
        tool: 'merge',
        date: Date.now()
      });
      Storage.addHistory({
        op: 'merge',
        input: state.files.map(e => e.name).join(', '),
        output: outputName,
        size_before: totalInputSize,
        size_after: mergedBytes.byteLength,
        status: 'success'
      });
      Storage.incrementStat('merges');
      Storage.incrementStat('totalProcessed');

      setProgress(100);
      UI.success(`Fusion réussie ! ${mergedDoc.getPageCount()} pages · ${UI.formatSize(mergedBytes.byteLength)}`, 'PDF fusionné');

    } catch (err) {
      console.error('Merge error:', err);
      UI.error('Erreur lors de la fusion : ' + err.message);
      Storage.addHistory({ op: 'merge', input: '', status: 'error' });
    } finally {
      setTimeout(() => {
        if (progressEl) progressEl.classList.add('hidden');
        if (execBtn) execBtn.disabled = state.files.length < 2;
      }, 1200);
    }
  }

  // ---- Clear all files ----
  function clearAll() {
    state.files = [];
    const list = document.getElementById('merge-file-list');
    if (list) list.innerHTML = '<div class="empty-list-state">Ajoutez des PDF pour commencer</div>';
    updateUI();
  }

  // ---- Init ----
  function init() {
    if (state.initialized) return;
    state.initialized = true;

    // Add button → open file dialog
    const addBtn = document.getElementById('merge-add-btn');
    const fileInput = document.getElementById('merge-file-input');
    if (addBtn && fileInput) {
      addBtn.addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
      fileInput.addEventListener('change', () => {
        if (fileInput.files.length) addFiles(fileInput.files);
      });
    }

    // Execute merge
    const execBtn = document.getElementById('merge-execute-btn');
    if (execBtn) execBtn.addEventListener('click', executeMerge);

    // Clear all
    const clearBtn = document.getElementById('merge-clear-btn');
    if (clearBtn) clearBtn.addEventListener('click', clearAll);

    // Drop zone
    const dropZone = document.getElementById('merge-drop-zone');
    if (dropZone) {
      UI.setupDropZone(dropZone, addFiles, ['.pdf']);
    }

    // Make file list sortable (drag-to-reorder)
    const list = document.getElementById('merge-file-list');
    if (list) UI.makeSortable(list, updateUI);

    updateUI();
    console.log('[MergeModule] initialized');
  }

  return { init, addFiles, clearAll };
})();

window.MergeModule = MergeModule;
window.Module_merge = MergeModule;

// Module initialized
