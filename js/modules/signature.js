/* ============================================================
   SIGNATURE MODULE — draw, upload, or type a signature and
   place it on a PDF page
   ============================================================ */
'use strict';

const SignatureModule = (() => {

  // ---- State ----
  const state = {
    file: null,
    arrayBuffer: null,
    pdfJsDoc: null,
    pageCount: 0,
    currentPage: 1,
    currentTab: 'draw',       // 'draw' | 'upload' | 'type'
    isDrawing: false,
    drawPoints: [],
    drawColor: '#000080',
    signatureDataUrl: null,   // final signature as data URL
    placementMode: false,     // true when waiting for user click on PDF
    placedSignatures: [],     // [{ pageNum, x, y, w, h, dataUrl }]
    pageCanvases: [],         // rendered PDF page canvases
    sigOverlayCanvas: null,   // overlay for placement preview
    initialized: false
  };

  // ---- Helpers ----
  function qs(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ---- Tab switching ----
  function switchTab(tab) {
    state.currentTab = tab;
    document.querySelectorAll('.sig-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    qs('sig-draw-panel')?.classList.toggle('hidden', tab !== 'draw');
    qs('sig-upload-panel')?.classList.toggle('hidden', tab !== 'upload');
    qs('sig-type-panel')?.classList.toggle('hidden', tab !== 'type');
    if (tab === 'type') renderTypePreview();
    updateApplyBtn();
  }

  // ---- Drawing on signature canvas ----
  function initDrawCanvas() {
    const canvas = qs('signature-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let strokes = [];        // completed strokes
    let currentStroke = [];  // stroke being drawn
    let isDrawing = false;

    // Store on state so clearDrawCanvas can access
    state._sigStrokes = strokes;
    state._sigCurrentStroke = currentStroke;
    state._sigIsDrawing = () => isDrawing;
    state._sigRedraw = redrawSignature;
    state._sigClear = () => {
      strokes.length = 0;
      currentStroke.length = 0;
      isDrawing = false;
      redrawSignature();
    };

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const src = e.touches ? e.touches[0] : e;
      return {
        x: (src.clientX - rect.left) * scaleX,
        y: (src.clientY - rect.top) * scaleY
      };
    }

    function redrawSignature() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const allStrokes = currentStroke.length ? strokes.concat([currentStroke]) : strokes;
      allStrokes.forEach(stroke => {
        if (stroke.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(stroke[0].x, stroke[0].y);
        for (let i = 1; i < stroke.length - 1; i++) {
          const mx = (stroke[i].x + stroke[i+1].x) / 2;
          const my = (stroke[i].y + stroke[i+1].y) / 2;
          ctx.quadraticCurveTo(stroke[i].x, stroke[i].y, mx, my);
        }
        ctx.lineTo(stroke[stroke.length-1].x, stroke[stroke.length-1].y);
        ctx.strokeStyle = state.drawColor;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      });
      updateApplyBtn();
    }

    canvas.addEventListener('mousedown', e => {
      e.preventDefault();
      isDrawing = true;
      currentStroke.length = 0;
      currentStroke.push(getPos(e));
    });
    canvas.addEventListener('mousemove', e => {
      if (!isDrawing) return;
      e.preventDefault();
      currentStroke.push(getPos(e));
      redrawSignature();
    });
    canvas.addEventListener('mouseup', e => {
      if (!isDrawing) return;
      e.preventDefault();
      if (currentStroke.length) strokes.push([...currentStroke]);
      currentStroke.length = 0;
      isDrawing = false;
      redrawSignature();
    });
    canvas.addEventListener('mouseleave', e => {
      if (!isDrawing) return;
      if (currentStroke.length) strokes.push([...currentStroke]);
      currentStroke.length = 0;
      isDrawing = false;
      redrawSignature();
    });
    canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      isDrawing = true;
      currentStroke.length = 0;
      currentStroke.push(getPos(e));
    }, { passive: false });
    canvas.addEventListener('touchmove', e => {
      if (!isDrawing) return;
      e.preventDefault();
      currentStroke.push(getPos(e));
      redrawSignature();
    }, { passive: false });
    canvas.addEventListener('touchend', e => {
      if (!isDrawing) return;
      e.preventDefault();
      if (currentStroke.length) strokes.push([...currentStroke]);
      currentStroke.length = 0;
      isDrawing = false;
      redrawSignature();
    }, { passive: false });
  }

  function clearDrawCanvas() {
    if (state._sigClear) {
      state._sigClear();
    } else {
      const canvas = qs('signature-canvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    updateApplyBtn();
  }

  // ---- Typed signature preview ----
  function renderTypePreview() {
    const canvas = qs('sig-text-preview');
    const textInput = qs('sig-text-input');
    const fontSel = qs('sig-font');
    if (!canvas || !textInput) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const font = fontSel ? fontSel.value : 'cursive';
    const text = textInput.value || 'Votre signature';
    ctx.font = `italic 36px ${font}`;
    ctx.fillStyle = '#000080';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    updateApplyBtn();
  }

  function updateApplyBtn() {
    const btn = qs('sig-apply-btn');
    if (!btn) return;
    let hasSignature = false;
    if (state.currentTab === 'draw') {
      hasSignature = !!(state._sigStrokes && state._sigStrokes.length > 0);
    } else if (state.currentTab === 'upload') {
      hasSignature = !!(qs('sig-preview-img')?.src && !qs('sig-preview-img').classList.contains('hidden'));
    } else if (state.currentTab === 'type') {
      hasSignature = !!(qs('sig-text-input')?.value?.trim());
    }
    btn.disabled = !hasSignature || !state.pdfJsDoc;
  }

  // ---- Capture the current signature as data URL ----
  function captureSignature() {
    if (state.currentTab === 'draw') {
      const canvas = qs('signature-canvas');
      return canvas ? canvas.toDataURL('image/png') : null;
    } else if (state.currentTab === 'upload') {
      const img = qs('sig-preview-img');
      if (!img || img.classList.contains('hidden')) return null;
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = img.naturalWidth || 200;
      tempCanvas.height = img.naturalHeight || 80;
      const ctx = tempCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return tempCanvas.toDataURL('image/png');
    } else if (state.currentTab === 'type') {
      return qs('sig-text-preview')?.toDataURL('image/png') || null;
    }
    return null;
  }

  // ---- PDF rendering ----
  async function renderPDFPage(pageNum) {
    const area = qs('signature-pdf-area');
    if (!area || !state.pdfJsDoc) return;

    area.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'sig-page-wrapper';
    wrapper.style.cssText = 'position:relative;display:inline-block;max-width:100%;cursor:crosshair';

    const pageCanvas = document.createElement('canvas');
    pageCanvas.className = 'sig-page-canvas';

    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none';
    state.sigOverlayCanvas = overlayCanvas;

    // Placement canvas (captures clicks)
    const hitCanvas = document.createElement('canvas');
    hitCanvas.style.cssText = 'position:absolute;top:0;left:0;cursor:crosshair';

    wrapper.appendChild(pageCanvas);
    wrapper.appendChild(overlayCanvas);
    wrapper.appendChild(hitCanvas);
    area.appendChild(wrapper);

    // Navigation controls
    if (state.pageCount > 1) {
      const nav = document.createElement('div');
      nav.className = 'pdf-nav';
      nav.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:8px;justify-content:center';
      nav.innerHTML = `
        <button class="btn btn-ghost btn-xs" id="sig-prev-page">&laquo; Précédent</button>
        <span id="sig-page-info">Page ${pageNum} / ${state.pageCount}</span>
        <button class="btn btn-ghost btn-xs" id="sig-next-page">Suivant &raquo;</button>
      `;
      area.appendChild(nav);
      qs('sig-prev-page').addEventListener('click', () => {
        if (state.currentPage > 1) { state.currentPage--; renderPDFPage(state.currentPage); }
      });
      qs('sig-next-page').addEventListener('click', () => {
        if (state.currentPage < state.pageCount) { state.currentPage++; renderPDFPage(state.currentPage); }
      });
    }

    // Render page
    try {
      const page = await state.pdfJsDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.5 });
      pageCanvas.width = hitCanvas.width = overlayCanvas.width = viewport.width;
      pageCanvas.height = hitCanvas.height = overlayCanvas.height = viewport.height;
      await page.render({ canvasContext: pageCanvas.getContext('2d'), viewport }).promise;
      redrawPlacements(pageNum);
    } catch(e) {
      area.innerHTML = '<div class="empty-list-state">Erreur de rendu PDF</div>';
    }

    // Hit canvas placement click
    hitCanvas.addEventListener('click', (e) => {
      if (!state.placementMode) return;
      const rect = hitCanvas.getBoundingClientRect();
      const scaleX = hitCanvas.width / rect.width;
      const scaleY = hitCanvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      const dataUrl = captureSignature();
      if (!dataUrl) return;

      const sig = { pageNum: state.currentPage, x, y, w: 200, h: 80, dataUrl };
      state.placedSignatures.push(sig);
      state.placementMode = false;
      hitCanvas.style.cursor = 'default';
      redrawPlacements(state.currentPage);
      UI.success('Signature placée ! Cliquez sur "Sauvegarder" pour télécharger.', 'Signature');

      // Show save button
      if (!qs('sig-save-btn')) {
        const saveBtn = document.createElement('button');
        saveBtn.id = 'sig-save-btn';
        saveBtn.className = 'btn btn-success btn-full';
        saveBtn.textContent = 'Sauvegarder le PDF signé';
        saveBtn.style.marginTop = '12px';
        saveBtn.addEventListener('click', savePDF);
        area.parentElement?.appendChild(saveBtn);
      }
    });

    // Hover preview during placement
    hitCanvas.addEventListener('mousemove', (e) => {
      if (!state.placementMode) return;
      const rect = hitCanvas.getBoundingClientRect();
      const scaleX = hitCanvas.width / rect.width;
      const scaleY = hitCanvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      redrawPlacements(state.currentPage);
      const ctx = overlayCanvas.getContext('2d');
      const dataUrl = captureSignature();
      if (dataUrl) {
        const tmpImg = new Image();
        tmpImg.onload = () => ctx.drawImage(tmpImg, x - 100, y - 40, 200, 80);
        tmpImg.src = dataUrl;
      }
    });
  }

  const _imgCache = new Map();
  function getImage(url) {
    if (_imgCache.has(url)) return Promise.resolve(_imgCache.get(url));
    return new Promise(r => {
      const i = new Image();
      i.onload = () => { _imgCache.set(url, i); r(i); };
      i.src = url;
    });
  }

  async function redrawPlacements(pageNum) {
    const canvas = state.sigOverlayCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const sigs = state.placedSignatures.filter(s => s.pageNum === pageNum);
    for (const sig of sigs) {
      const img = await getImage(sig.dataUrl);
      ctx.globalAlpha = 0.9;
      ctx.drawImage(img, sig.x - sig.w/2, sig.y - sig.h/2, sig.w, sig.h);
      ctx.globalAlpha = 1;
    }
  }

  // ---- Load PDF ----
  async function loadFile(file) {
    if (!file) return;
    window.PDFState?.set(file);
    state.file = file;
    state.placedSignatures = [];
    state.currentPage = 1;
    const area = qs('signature-pdf-area');
    UI.showLoading('signature-pdf-area', 'Chargement du PDF...');
    try {
      const ab = await file.arrayBuffer();
      state.arrayBuffer = ab;
      if (!window.pdfjsLib) throw new Error('PDF.js non disponible');
      state.pdfJsDoc = await window.pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
      state.pageCount = state.pdfJsDoc.numPages;
      updateApplyBtn();
      await renderPDFPage(1);
    } catch(e) {
      UI.error('Impossible de charger le PDF: ' + e.message);
      if (area) area.innerHTML = '<div class="empty-list-state">Erreur de chargement</div>';
    }
  }

  // ---- Activate placement mode ----
  function activatePlacementMode() {
    if (!state.pdfJsDoc) { UI.warning('Chargez un PDF d\'abord.'); return; }
    const dataUrl = captureSignature();
    if (!dataUrl) { UI.warning('Créez une signature d\'abord.'); return; }
    state.signatureDataUrl = dataUrl;
    state.placementMode = true;
    UI.info('Cliquez sur le PDF pour placer votre signature.', 'Placement');
    // Update cursor on hit canvas
    const area = qs('signature-pdf-area');
    const hitCanvas = area?.querySelector('canvas:last-child');
    if (hitCanvas) hitCanvas.style.cursor = 'crosshair';
  }

  // ---- Save PDF with signatures ----
  async function savePDF() {
    if (!state.arrayBuffer || !state.placedSignatures.length) {
      UI.warning('Placez au moins une signature sur le PDF.');
      return;
    }
    if (!window.PDFLib) { UI.error('pdf-lib non disponible.'); return; }

    UI.info('Intégration des signatures...', 'Sauvegarde');
    try {
      const { PDFDocument } = window.PDFLib;
      const pdfDoc = await PDFDocument.load(state.arrayBuffer);
      const pages = pdfDoc.getPages();

      for (const sig of state.placedSignatures) {
        const page = pages[sig.pageNum - 1];
        if (!page) continue;
        const { width: pw, height: ph } = page.getSize();
        const pageCanvas = qs('signature-pdf-area')?.querySelector('canvas');
        if (!pageCanvas) continue;
        // Scale from canvas coords to PDF coords
        const scaleX = pw / pageCanvas.width;
        const scaleY = ph / pageCanvas.height;

        // Fetch data URL as bytes
        const resp = await fetch(sig.dataUrl);
        const blob = await resp.blob();
        const ab = await blob.arrayBuffer();
        const pngBytes = new Uint8Array(ab);
        const embeddedImg = await pdfDoc.embedPng(pngBytes);

        const x = (sig.x - sig.w/2) * scaleX;
        // PDF.js y goes down, pdf-lib y goes up
        const pdfY = ph - (sig.y - sig.h/2) * scaleY - sig.h * scaleY;

        page.drawImage(embeddedImg, {
          x,
          y: pdfY,
          width: sig.w * scaleX,
          height: sig.h * scaleY,
          opacity: 1
        });
      }

      const pdfBytes = await pdfDoc.save();
      const outName = (state.file.name.replace(/\.pdf$/i, '') + '_signé.pdf');
      UI.downloadBlob(new Blob([pdfBytes], { type: 'application/pdf' }), outName);

      Storage.incrementStat('signatures');
      Storage.incrementStat('totalProcessed');
      Storage.addRecentFile({
        id: UI.uid(), name: outName, size: pdfBytes.byteLength,
        pages: state.pageCount, tool: 'signature', date: Date.now()
      });
      Storage.addHistory({ op: 'signature', input: state.file.name, status: 'success' });
      UI.success('PDF signé téléchargé avec succès !', 'Signature');
    } catch(e) {
      UI.error('Erreur lors de la sauvegarde: ' + e.message);
      Storage.addHistory({ op: 'signature', input: state.file?.name || '', status: 'error' });
    }
  }

  // ---- Init ----
  function init() {
    if (state.initialized) return;
    state.initialized = true;

    // File input
    const addBtn   = qs('signature-add-btn');
    const fileInput = qs('signature-file-input');
    const dropZone  = qs('signature-drop-zone');
    if (addBtn && fileInput) addBtn.addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
    if (fileInput) fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); });
    if (dropZone) UI.setupDropZone(dropZone, files => { if (files[0]) loadFile(files[0]); }, ['.pdf']);

    // Tabs
    document.querySelectorAll('.sig-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Drawing
    initDrawCanvas();

    // Clear button
    qs('sig-clear-btn')?.addEventListener('click', clearDrawCanvas);

    // Ink color
    const sigColor = qs('sig-color');
    if (sigColor) {
      sigColor.addEventListener('input', () => {
        state.drawColor = sigColor.value;
      });
    }

    // Image upload
    const imgBtn = qs('sig-image-btn');
    const imgInput = qs('sig-image-input');
    if (imgBtn && imgInput) {
      imgBtn.addEventListener('click', () => { imgInput.value = ''; imgInput.click(); });
      imgInput.addEventListener('change', () => {
        const f = imgInput.files[0];
        if (!f) return;
        const url = URL.createObjectURL(f);
        const previewImg = qs('sig-preview-img');
        if (previewImg) {
          previewImg.src = url;
          previewImg.classList.remove('hidden');
        }
        updateApplyBtn();
      });
    }

    // Type signature
    const textInput = qs('sig-text-input');
    const fontSel = qs('sig-font');
    if (textInput) textInput.addEventListener('input', renderTypePreview);
    if (fontSel) fontSel.addEventListener('change', renderTypePreview);

    // Apply (place) button
    const applyBtn = qs('sig-apply-btn');
    if (applyBtn) applyBtn.addEventListener('click', activatePlacementMode);

    _autoLoad();
    console.log('[SignatureModule] initialized');
  }

  function _autoLoad() {
    const f = window.PDFState?.get();
    if (!state.file && f) loadFile(f);
  }

  function activate() { _autoLoad(); }

  return { init, loadFile, activate };
})();

window.SignatureModule = SignatureModule;
window.Module_signature = SignatureModule;
