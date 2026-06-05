/* ============================================================
   SIGNATURE MODULE — draw, upload, or type a signature and
   place it on a PDF page
   ============================================================ */
'use strict';

const SignatureModule = (() => {

  let _loadedVersion = -1;

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
    signatureDataUrl: null,
    placementMode: false,
    placedSignatures: [],     // [{ pageNum, x, y, w, h, dataUrl }]
    sigOverlayCanvas: null,
    initialized: false,
    scale: 1.5                // current render scale (zoom)
  };

  // ---- Selection / drag state ----
  let selectedSigIndex = -1;

  // ---- Helpers ----
  function qs(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function getCanvasPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const src = (e.touches && e.touches.length) ? e.touches[0]
               : (e.changedTouches && e.changedTouches.length) ? e.changedTouches[0]
               : e;
    return { x: (src.clientX - rect.left) * scaleX, y: (src.clientY - rect.top) * scaleY };
  }

  function hitTestSig(x, y) {
    const sigs = state.placedSignatures.filter(s => s.pageNum === state.currentPage);
    for (let i = sigs.length - 1; i >= 0; i--) {
      const s = sigs[i];
      if (x >= s.x - s.w/2 - 5 && x <= s.x + s.w/2 + 5 &&
          y >= s.y - s.h/2 - 5 && y <= s.y + s.h/2 + 5) {
        return state.placedSignatures.indexOf(s);
      }
    }
    return -1;
  }

  function zoomLabel() {
    return Math.round((state.scale / 1.5) * 100) + '%';
  }

  function changeScale(delta) {
    const newScale = Math.max(0.5, Math.min(4.0, state.scale + delta));
    if (newScale === state.scale) return;
    const ratio = newScale / state.scale;
    state.placedSignatures.forEach(sig => {
      sig.x *= ratio; sig.y *= ratio;
      sig.w *= ratio; sig.h *= ratio;
    });
    state.scale = newScale;
    renderPDFPage(state.currentPage);
  }

  function updateDelBtn() {
    const btn = qs('sig-del-selected-btn');
    if (btn) btn.style.display = selectedSigIndex !== -1 ? 'block' : 'none';
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
    let strokes = [];
    let currentStroke = [];
    let isDrawing = false;

    state._sigStrokes = strokes;
    state._sigCurrentStroke = currentStroke;
    state._sigIsDrawing = () => isDrawing;
    state._sigRedraw = redrawSignature;
    state._sigClear = () => {
      strokes.length = 0; currentStroke.length = 0; isDrawing = false; redrawSignature();
    };

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const src = e.touches ? e.touches[0] : e;
      return { x: (src.clientX - rect.left) * scaleX, y: (src.clientY - rect.top) * scaleY };
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
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.stroke();
      });
      updateApplyBtn();
    }

    canvas.addEventListener('mousedown', e => { e.preventDefault(); isDrawing = true; currentStroke.length = 0; currentStroke.push(getPos(e)); });
    canvas.addEventListener('mousemove', e => { if (!isDrawing) return; e.preventDefault(); currentStroke.push(getPos(e)); redrawSignature(); });
    canvas.addEventListener('mouseup', e => { if (!isDrawing) return; e.preventDefault(); if (currentStroke.length) strokes.push([...currentStroke]); currentStroke.length = 0; isDrawing = false; redrawSignature(); });
    canvas.addEventListener('mouseleave', e => { if (!isDrawing) return; if (currentStroke.length) strokes.push([...currentStroke]); currentStroke.length = 0; isDrawing = false; redrawSignature(); });
    canvas.addEventListener('touchstart', e => { e.preventDefault(); isDrawing = true; currentStroke.length = 0; currentStroke.push(getPos(e)); }, { passive: false });
    canvas.addEventListener('touchmove', e => { if (!isDrawing) return; e.preventDefault(); currentStroke.push(getPos(e)); redrawSignature(); }, { passive: false });
    canvas.addEventListener('touchend', e => { if (!isDrawing) return; e.preventDefault(); if (currentStroke.length) strokes.push([...currentStroke]); currentStroke.length = 0; isDrawing = false; redrawSignature(); }, { passive: false });
  }

  function clearDrawCanvas() {
    if (state._sigClear) { state._sigClear(); } else {
      const canvas = qs('signature-canvas');
      if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
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
    ctx.font = `italic 36px ${fontSel ? fontSel.value : 'cursive'}`;
    ctx.fillStyle = '#000080';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(textInput.value || 'Votre signature', canvas.width / 2, canvas.height / 2);
    updateApplyBtn();
  }

  function updateApplyBtn() {
    const applyBtn = qs('sig-apply-btn');
    const saveBtn  = qs('sig-save-btn');
    let hasSignature = false;
    if (state.currentTab === 'draw') {
      hasSignature = !!(state._sigStrokes && state._sigStrokes.length > 0);
    } else if (state.currentTab === 'upload') {
      hasSignature = !!(qs('sig-preview-img')?.src && !qs('sig-preview-img').classList.contains('hidden'));
    } else if (state.currentTab === 'type') {
      hasSignature = !!(qs('sig-text-input')?.value?.trim());
    }
    if (applyBtn) applyBtn.disabled = !hasSignature || !state.pdfJsDoc;
    if (saveBtn)  saveBtn.style.display = state.placedSignatures.length > 0 ? 'block' : 'none';
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
      tempCanvas.getContext('2d').drawImage(img, 0, 0);
      return tempCanvas.toDataURL('image/png');
    } else if (state.currentTab === 'type') {
      return qs('sig-text-preview')?.toDataURL('image/png') || null;
    }
    return null;
  }

  // ---- Image cache ----
  const _imgCache = new Map();
  function getImage(url) {
    if (_imgCache.has(url)) return Promise.resolve(_imgCache.get(url));
    return new Promise(r => {
      const i = new Image();
      i.onload = () => { _imgCache.set(url, i); r(i); };
      i.src = url;
    });
  }

  // ---- Draw placed signatures (+ selection indicator) ----
  async function redrawPlacements(pageNum) {
    const canvas = state.sigOverlayCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const sigs = state.placedSignatures.filter(s => s.pageNum === pageNum);
    for (const sig of sigs) {
      const globalIdx = state.placedSignatures.indexOf(sig);
      const img = await getImage(sig.dataUrl);
      ctx.globalAlpha = globalIdx === selectedSigIndex ? 1 : 0.88;
      ctx.drawImage(img, sig.x - sig.w/2, sig.y - sig.h/2, sig.w, sig.h);
      ctx.globalAlpha = 1;
      if (globalIdx === selectedSigIndex) {
        ctx.save();
        ctx.strokeStyle = 'rgba(0,113,227,0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(sig.x - sig.w/2 - 4, sig.y - sig.h/2 - 4, sig.w + 8, sig.h + 8);
        ctx.setLineDash([]);
        // Corner handles
        [[sig.x-sig.w/2-4, sig.y-sig.h/2-4],[sig.x+sig.w/2+4, sig.y-sig.h/2-4],
         [sig.x-sig.w/2-4, sig.y+sig.h/2+4],[sig.x+sig.w/2+4, sig.y+sig.h/2+4]].forEach(([cx,cy]) => {
          ctx.fillStyle = '#fff';
          ctx.fillRect(cx-4, cy-4, 8, 8);
          ctx.strokeRect(cx-4, cy-4, 8, 8);
        });
        ctx.restore();
      }
    }
  }

  // ---- PDF rendering ----
  async function renderPDFPage(pageNum) {
    const area = qs('signature-pdf-area');
    if (!area || !state.pdfJsDoc) return;

    area.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'sig-page-wrapper';
    wrapper.style.cssText = 'position:relative;display:inline-block;max-width:100%';

    const pageCanvas = document.createElement('canvas');
    pageCanvas.className = 'sig-page-canvas';

    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none';
    state.sigOverlayCanvas = overlayCanvas;

    const hitCanvas = document.createElement('canvas');
    hitCanvas.style.cssText = 'position:absolute;top:0;left:0;';

    wrapper.appendChild(pageCanvas);
    wrapper.appendChild(overlayCanvas);
    wrapper.appendChild(hitCanvas);
    area.appendChild(wrapper);

    // Navigation + zoom bar (always shown)
    const nav = document.createElement('div');
    nav.style.cssText = 'display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:8px;padding:10px;';
    let pageNavHtml = '';
    if (state.pageCount > 1) {
      pageNavHtml = `
        <button class="btn btn-ghost btn-sm" id="sig-prev-page" ${pageNum<=1?'disabled':''}>&#171; Préc</button>
        <span id="sig-page-info" style="font-size:13px;color:var(--text-secondary)">Page ${pageNum} / ${state.pageCount}</span>
        <button class="btn btn-ghost btn-sm" id="sig-next-page" ${pageNum>=state.pageCount?'disabled':''}>Suiv &#187;</button>
        <span style="border-left:1px solid var(--border-color);height:16px;display:inline-block;"></span>
      `;
    }
    nav.innerHTML = `
      ${pageNavHtml}
      <button class="btn btn-ghost btn-sm" id="sig-zoom-out" title="Dézoomer" style="min-width:32px">−</button>
      <span id="sig-zoom-lvl" style="font-size:12px;color:var(--text-secondary);min-width:42px;text-align:center">${zoomLabel()}</span>
      <button class="btn btn-ghost btn-sm" id="sig-zoom-in" title="Zoomer" style="min-width:32px">+</button>
    `;
    area.appendChild(nav);

    qs('sig-prev-page')?.addEventListener('click', () => {
      if (state.currentPage > 1) { state.currentPage--; renderPDFPage(state.currentPage); }
    });
    qs('sig-next-page')?.addEventListener('click', () => {
      if (state.currentPage < state.pageCount) { state.currentPage++; renderPDFPage(state.currentPage); }
    });
    qs('sig-zoom-out')?.addEventListener('click', () => changeScale(-0.25));
    qs('sig-zoom-in')?.addEventListener('click', () => changeScale(+0.25));

    // Render page
    try {
      const page = await state.pdfJsDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: state.scale });
      pageCanvas.width = hitCanvas.width = overlayCanvas.width = viewport.width;
      pageCanvas.height = hitCanvas.height = overlayCanvas.height = viewport.height;
      await page.render({ canvasContext: pageCanvas.getContext('2d'), viewport }).promise;
      redrawPlacements(pageNum);
    } catch(e) {
      area.innerHTML = '<div class="empty-list-state">Erreur de rendu PDF</div>';
      return;
    }

    // ---- Hit canvas events ----
    let isDragging = false;
    let dragOffX = 0, dragOffY = 0;
    let didMove = false;
    let placedByTouch = false;

    function handlePlacement(x, y) {
      const dataUrl = captureSignature();
      if (!dataUrl) return;
      const sigW = Math.round(200 * (state.scale / 1.5));
      const sigH = Math.round(80  * (state.scale / 1.5));
      const sig = { pageNum: state.currentPage, x, y, w: sigW, h: sigH, dataUrl };
      state.placedSignatures.push(sig);
      state.placementMode = false;
      selectedSigIndex = state.placedSignatures.length - 1;
      hitCanvas.style.cursor = 'move';
      redrawPlacements(state.currentPage);
      updateApplyBtn();
      updateDelBtn();
      UI.success('Signature placée ! Déplacez-la si besoin, ou ajoutez-en d\'autres.', 'Signature');
    }

    // Mouse drag
    hitCanvas.addEventListener('mousedown', e => {
      if (state.placementMode) return;
      const { x, y } = getCanvasPos(e, hitCanvas);
      const idx = hitTestSig(x, y);
      selectedSigIndex = idx;
      isDragging = idx !== -1;
      if (isDragging) {
        const sig = state.placedSignatures[idx];
        dragOffX = x - sig.x;
        dragOffY = y - sig.y;
        didMove = false;
        hitCanvas.style.cursor = 'grabbing';
      }
      redrawPlacements(state.currentPage);
      updateDelBtn();
    });

    hitCanvas.addEventListener('mousemove', e => {
      const { x, y } = getCanvasPos(e, hitCanvas);
      if (state.placementMode) {
        redrawPlacements(state.currentPage);
        const dataUrl = captureSignature();
        if (dataUrl) {
          const tmpImg = new Image();
          const sigW = Math.round(200 * (state.scale / 1.5));
          const sigH = Math.round(80  * (state.scale / 1.5));
          tmpImg.onload = () => {
            const ctx = overlayCanvas.getContext('2d');
            redrawPlacements(state.currentPage).then(() => {
              ctx.globalAlpha = 0.6;
              ctx.drawImage(tmpImg, x - sigW/2, y - sigH/2, sigW, sigH);
              ctx.globalAlpha = 1;
            });
          };
          tmpImg.src = dataUrl;
        }
        return;
      }
      if (isDragging && selectedSigIndex !== -1) {
        const sig = state.placedSignatures[selectedSigIndex];
        sig.x = x - dragOffX;
        sig.y = y - dragOffY;
        didMove = true;
        redrawPlacements(state.currentPage);
      } else {
        hitCanvas.style.cursor = hitTestSig(x, y) !== -1 ? 'move' : (state.placementMode ? 'crosshair' : 'default');
      }
    });

    hitCanvas.addEventListener('mouseup', () => {
      isDragging = false;
      if (!state.placementMode) {
        hitCanvas.style.cursor = selectedSigIndex !== -1 ? 'move' : 'default';
      }
    });

    hitCanvas.addEventListener('click', e => {
      if (placedByTouch) { placedByTouch = false; return; }
      if (state.placementMode) {
        const { x, y } = getCanvasPos(e, hitCanvas);
        handlePlacement(x, y);
        return;
      }
      if (!didMove) {
        const { x, y } = getCanvasPos(e, hitCanvas);
        const idx = hitTestSig(x, y);
        if (idx === -1) {
          selectedSigIndex = -1;
          hitCanvas.style.cursor = 'default';
          redrawPlacements(state.currentPage);
          updateDelBtn();
        }
      }
      didMove = false;
    });

    // Touch drag + placement
    hitCanvas.addEventListener('touchstart', e => {
      e.preventDefault();
      if (state.placementMode) return;
      const { x, y } = getCanvasPos(e, hitCanvas);
      const idx = hitTestSig(x, y);
      selectedSigIndex = idx;
      isDragging = idx !== -1;
      if (isDragging) {
        const sig = state.placedSignatures[idx];
        dragOffX = x - sig.x;
        dragOffY = y - sig.y;
        didMove = false;
      }
      redrawPlacements(state.currentPage);
      updateDelBtn();
    }, { passive: false });

    hitCanvas.addEventListener('touchmove', e => {
      e.preventDefault();
      if (state.placementMode) return;
      if (isDragging && selectedSigIndex !== -1) {
        const { x, y } = getCanvasPos(e, hitCanvas);
        const sig = state.placedSignatures[selectedSigIndex];
        sig.x = x - dragOffX;
        sig.y = y - dragOffY;
        didMove = true;
        redrawPlacements(state.currentPage);
      }
    }, { passive: false });

    hitCanvas.addEventListener('touchend', e => {
      e.preventDefault();
      if (state.placementMode) {
        const { x, y } = getCanvasPos(e, hitCanvas);
        handlePlacement(x, y);
        placedByTouch = true;
        setTimeout(() => { placedByTouch = false; }, 600);
      }
      isDragging = false;
      if (!state.placementMode && !didMove) {
        // Deselect on tap of empty area handled by touchstart above
      }
    }, { passive: false });

    // Update cursor based on mode
    hitCanvas.style.cursor = state.placementMode ? 'crosshair' : 'default';
  }

  // ---- Load PDF ----
  async function loadFile(file) {
    if (!file) return;
    _loadedVersion = window.PDFState?.getVersion() ?? 0;
    const isNewFile = file !== state.file;
    window.PDFState?.set(file);
    state.file = file;
    if (isNewFile) {
      // New file: reset everything
      state.placedSignatures = [];
      state.currentPage = 1;
      selectedSigIndex = -1;
      updateDelBtn();
    }
    const area = qs('signature-pdf-area');
    UI.showLoading('signature-pdf-area', 'Chargement du PDF...');
    try {
      if (!window.pdfjsLib) throw new Error('PDF.js non disponible');
      const sharedBytes = window.PDFState?.getBytes();
      let ab;
      if (sharedBytes) {
        ab = sharedBytes.buffer.slice(sharedBytes.byteOffset, sharedBytes.byteOffset + sharedBytes.byteLength);
      } else {
        ab = await file.arrayBuffer();
      }
      state.arrayBuffer = ab.slice(0);
      state.pdfJsDoc = await window.pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
      state.pageCount = state.pdfJsDoc.numPages;
      updateApplyBtn();
      await renderPDFPage(state.currentPage);
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
    selectedSigIndex = -1;
    updateDelBtn();
    UI.info('Cliquez sur le PDF pour placer votre signature.', 'Placement');
    const area = qs('signature-pdf-area');
    const hitCanvas = area?.querySelector('canvas:last-of-type');
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
        // Find the page canvas to get canvas dimensions
        const pageCanvas = qs('signature-pdf-area')?.querySelector('.sig-page-canvas');
        if (!pageCanvas) continue;
        const scaleX = pw / pageCanvas.width;
        const scaleY = ph / pageCanvas.height;

        const resp = await fetch(sig.dataUrl);
        const blob = await resp.blob();
        const ab = await blob.arrayBuffer();
        const embeddedImg = await pdfDoc.embedPng(new Uint8Array(ab));

        page.drawImage(embeddedImg, {
          x: (sig.x - sig.w/2) * scaleX,
          y: ph - (sig.y - sig.h/2) * scaleY - sig.h * scaleY,
          width:  sig.w * scaleX,
          height: sig.h * scaleY,
          opacity: 1
        });
      }

      const pdfBytes = await pdfDoc.save();
      window.PDFState?.setBytes(pdfBytes);
      const outName = (state.file.name.replace(/\.pdf$/i, '') + '_signé.pdf');
      UI.downloadBlob(new Blob([pdfBytes], { type: 'application/pdf' }), outName);
      Storage.incrementStat('signatures');
      Storage.incrementStat('totalProcessed');
      Storage.addRecentFile({ id: UI.uid(), name: outName, size: pdfBytes.byteLength, pages: state.pageCount, tool: 'signature', date: Date.now() });
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

    const addBtn   = qs('signature-add-btn');
    const fileInput = qs('signature-file-input');
    const dropZone  = qs('signature-drop-zone');
    if (addBtn && fileInput) addBtn.addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
    if (fileInput) fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); });
    if (dropZone) UI.setupDropZone(dropZone, files => { if (files[0]) loadFile(files[0]); }, ['.pdf']);

    document.querySelectorAll('.sig-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    initDrawCanvas();
    qs('sig-clear-btn')?.addEventListener('click', clearDrawCanvas);

    const sigColor = qs('sig-color');
    if (sigColor) sigColor.addEventListener('input', () => { state.drawColor = sigColor.value; });

    const imgBtn = qs('sig-image-btn');
    const imgInput = qs('sig-image-input');
    if (imgBtn && imgInput) {
      imgBtn.addEventListener('click', () => { imgInput.value = ''; imgInput.click(); });
      imgInput.addEventListener('change', () => {
        const f = imgInput.files[0];
        if (!f) return;
        const previewImg = qs('sig-preview-img');
        if (previewImg) {
          previewImg.src = URL.createObjectURL(f);
          previewImg.classList.remove('hidden');
        }
        updateApplyBtn();
      });
    }

    const textInput = qs('sig-text-input');
    const fontSel = qs('sig-font');
    if (textInput) textInput.addEventListener('input', renderTypePreview);
    if (fontSel) fontSel.addEventListener('change', renderTypePreview);

    qs('sig-apply-btn')?.addEventListener('click', activatePlacementMode);
    qs('sig-save-btn')?.addEventListener('click', savePDF);
    qs('sig-del-selected-btn')?.addEventListener('click', () => {
      if (selectedSigIndex !== -1) {
        state.placedSignatures.splice(selectedSigIndex, 1);
        selectedSigIndex = -1;
        redrawPlacements(state.currentPage);
        updateApplyBtn();
        updateDelBtn();
      }
    });

    activate();
    console.log('[SignatureModule] initialized');
  }

  function activate() {
    const f = window.PDFState?.get();
    if (!f) return;
    const v = window.PDFState?.getVersion() ?? 0;
    if (!state.file || (state.file === f && v > _loadedVersion)) loadFile(f);
  }

  return { init, loadFile, activate };
})();

window.SignatureModule = SignatureModule;
window.Module_signature = SignatureModule;
