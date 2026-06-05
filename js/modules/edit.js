/* ============================================================
   EDIT MODULE — PDF editing (text, image, draw, stamps)
   ============================================================ */
'use strict';

const EditModule = (() => {
  let currentFile = null;
  let currentBuffer = null;
  let pdfDoc = null;
  let currentPage = 1;
  let totalPages = 0;
  let currentTool = 'select';
  let scale = 1.5;
  let isDrawing = false;
  let drawPath = [];
  let annotations = [];
  let pageViewport = null;
  let mainCanvas = null;
  let overlayCanvas = null;
  let overlayCtx = null;
  // Selection / drag state
  let selectedAnnotIndex = -1;
  let isDragging = false;
  let dragPrevPos = null;
  let _loadedVersion = -1;

  function init() {
    setupFileInputs();
    setupToolbar();
    setupOptions();
    _autoLoad();
  }

  function setupFileInputs() {
    const btn = document.getElementById('edit-add-btn');
    const input = document.getElementById('edit-file-input');
    const dropZone = document.getElementById('edit-drop-zone');

    if (btn) btn.onclick = () => { input.value = ''; input.click(); };
    if (input) input.onchange = () => { if (input.files[0]) loadFile(input.files[0]); };
    if (dropZone) UI.setupDropZone(dropZone, files => { if (files[0]) loadFile(files[0]); }, ['.pdf']);
  }

  function setupToolbar() {
    document.querySelectorAll('.edit-tool-btn[data-tool]').forEach(btn => {
      btn.onclick = () => selectTool(btn.dataset.tool, btn);
    });
    const saveBtn = document.getElementById('edit-save-btn');
    if (saveBtn) saveBtn.onclick = save;
    const delBtn = document.getElementById('edit-del-selected');
    if (delBtn) delBtn.onclick = () => {
      if (selectedAnnotIndex !== -1) {
        annotations.splice(selectedAnnotIndex, 1);
        selectedAnnotIndex = -1;
        redrawAnnotations();
        document.getElementById('edit-del-selected')?.style.setProperty('display', 'none');
      }
    };
  }

  function setupOptions() {
    const fontSizeEl = document.getElementById('edit-font-size');
    const drawWidthEl = document.getElementById('edit-draw-width');
    if (drawWidthEl) {
      drawWidthEl.oninput = () => {
        document.getElementById('edit-draw-width-val').textContent = drawWidthEl.value + 'px';
      };
    }
  }

  async function loadFile(file) {
    _loadedVersion = window.PDFState?.getVersion() ?? 0;
    window.PDFState?.set(file);
    currentFile = file;
    const toolbar = document.getElementById('edit-toolbar');
    const area = document.getElementById('edit-canvas-area');
    if (!window.pdfjsLib) {
      area.innerHTML = '<div class="empty-list-state">PDF.js requis pour l\'édition. Voir libs/README.md</div>';
      return;
    }
    UI.showLoading('edit-canvas-area', 'Chargement du PDF...');
    try {
      const sharedBytes = window.PDFState?.getBytes();
      let arrayBuffer;
      if (sharedBytes) {
        arrayBuffer = sharedBytes.buffer.slice(sharedBytes.byteOffset, sharedBytes.byteOffset + sharedBytes.byteLength);
      } else {
        arrayBuffer = await file.arrayBuffer();
      }
      currentBuffer = arrayBuffer.slice(0);
      const typedArray = new Uint8Array(arrayBuffer);
      pdfDoc = await pdfjsLib.getDocument({ data: typedArray }).promise;
      totalPages = pdfDoc.numPages;
      currentPage = 1;
      annotations = [];
      area.innerHTML = '';
      if (toolbar) toolbar.style.display = 'flex';
      await renderPage(currentPage);
      Storage.addRecentFile({ id: UI.uid(), name: file.name, size: file.size, pages: totalPages, tool: 'edit' });
    } catch (err) {
      UI.error('Impossible de charger le PDF: ' + err.message);
    } finally {
      UI.removeLoading('edit-canvas-area');
    }
  }

  async function renderPage(pageNum) {
    const area = document.getElementById('edit-canvas-area');
    area.innerHTML = '';
    const page = await pdfDoc.getPage(pageNum);
    pageViewport = page.getViewport({ scale });

    const wrapper = document.createElement('div');
    wrapper.className = 'pdf-page-wrapper';
    wrapper.style.position = 'relative';
    wrapper.style.display = 'inline-block';

    mainCanvas = document.createElement('canvas');
    mainCanvas.width = pageViewport.width;
    mainCanvas.height = pageViewport.height;
    mainCanvas.style.display = 'block';

    overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = pageViewport.width;
    overlayCanvas.height = pageViewport.height;
    overlayCanvas.style.position = 'absolute';
    overlayCanvas.style.top = '0';
    overlayCanvas.style.left = '0';
    overlayCanvas.style.cursor = 'crosshair';
    overlayCtx = overlayCanvas.getContext('2d');

    wrapper.appendChild(mainCanvas);
    wrapper.appendChild(overlayCanvas);

    // Navigation
    const nav = document.createElement('div');
    nav.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:10px;padding:10px;flex-wrap:wrap;';
    nav.innerHTML = `
      <button class="btn btn-ghost btn-sm" id="edit-prev-btn" ${currentPage <= 1 ? 'disabled' : ''}>← Préc</button>
      <span style="font-size:13px;color:var(--text-secondary)">Page ${currentPage} / ${totalPages}</span>
      <button class="btn btn-ghost btn-sm" id="edit-next-btn" ${currentPage >= totalPages ? 'disabled' : ''}>Suiv →</button>
      <span style="margin-left:8px;color:var(--text-muted);font-size:12px">|</span>
      <button class="btn btn-ghost btn-sm" id="edit-zoom-out">−</button>
      <span id="edit-zoom-label" style="font-size:13px;color:var(--text-secondary);min-width:44px;text-align:center">${Math.round(scale/1.5*100)}%</span>
      <button class="btn btn-ghost btn-sm" id="edit-zoom-in">+</button>
    `;

    area.appendChild(wrapper);
    area.appendChild(nav);

    document.getElementById('edit-prev-btn')?.addEventListener('click', async () => {
      if (currentPage > 1) { currentPage--; await renderPage(currentPage); }
    });
    document.getElementById('edit-next-btn')?.addEventListener('click', async () => {
      if (currentPage < totalPages) { currentPage++; await renderPage(currentPage); }
    });
    document.getElementById('edit-zoom-out')?.addEventListener('click', () => changeScale(-0.25));
    document.getElementById('edit-zoom-in')?.addEventListener('click', () => changeScale(0.25));

    const ctx = mainCanvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: pageViewport }).promise;

    setupCanvasEvents(overlayCanvas);
    redrawAnnotations();
  }

  function setupCanvasEvents(canvas) {
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('touchstart', e => { e.preventDefault(); onMouseDown(touchToMouse(e)); }, { passive: false });
    canvas.addEventListener('touchmove', e => { e.preventDefault(); onMouseMove(touchToMouse(e)); }, { passive: false });
    canvas.addEventListener('touchend', e => { e.preventDefault(); onMouseUp(); }, { passive: false });

    canvas.addEventListener('click', async (e) => {
      if (currentTool === 'text') {
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left);
        const y = (e.clientY - rect.top);
        const text = await UI.prompt('Saisissez le texte à ajouter:', '');
        if (text) {
          const font = document.getElementById('edit-font-family')?.value || 'Helvetica';
          const size = parseInt(document.getElementById('edit-font-size')?.value || '12');
          const color = document.getElementById('edit-text-color')?.value || '#000000';
          annotations.push({ type: 'text', x, y, text, font, size, color, page: currentPage });
          redrawAnnotations();
        }
      } else if (currentTool === 'stamp') {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const stamps = ['APPROUVÉ', 'REFUSÉ', 'CONFIDENTIEL', 'DRAFT', 'ORIGINAL', 'COPIE'];
        const stamp = stamps[Math.floor(Math.random() * stamps.length)];
        annotations.push({ type: 'stamp', x, y, text: stamp, page: currentPage });
        redrawAnnotations();
      } else if (currentTool === 'image') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = () => {
          if (!input.files[0]) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            const rect = canvas.getBoundingClientRect();
            const img = new Image();
            img.onload = () => {
              annotations.push({
                type: 'image', src: ev.target.result, _img: img,
                x: e.clientX - rect.left - 50,
                y: e.clientY - rect.top - 50,
                width: 100, height: 100, page: currentPage
              });
              redrawAnnotations();
            };
            img.src = ev.target.result;
          };
          reader.readAsDataURL(input.files[0]);
        };
        input.click();
      }
    });
  }

  function onMouseDown(e) {
    const rect = overlayCanvas.getBoundingClientRect();
    const x = (e.clientX || e.pageX) - rect.left;
    const y = (e.clientY || e.pageY) - rect.top;
    if (currentTool === 'select') {
      const idx = hitTest(x, y);
      selectedAnnotIndex = idx;
      isDragging = idx !== -1;
      dragPrevPos = { x, y };
      redrawAnnotations();
      return;
    }
    if (currentTool !== 'draw' && currentTool !== 'eraser') return;
    isDrawing = true;
    drawPath = [{ x, y }];
  }

  function onMouseMove(e) {
    const rect = overlayCanvas.getBoundingClientRect();
    const x = (e.clientX || e.pageX) - rect.left;
    const y = (e.clientY || e.pageY) - rect.top;
    if (currentTool === 'select') {
      if (isDragging && selectedAnnotIndex !== -1) {
        const dx = x - dragPrevPos.x;
        const dy = y - dragPrevPos.y;
        dragPrevPos = { x, y };
        moveAnnotation(selectedAnnotIndex, dx, dy);
        redrawAnnotations();
      } else {
        if (overlayCanvas) overlayCanvas.style.cursor = hitTest(x, y) !== -1 ? 'move' : 'default';
      }
      return;
    }
    if (!isDrawing) return;
    drawPath.push({ x, y });
    redrawAnnotations();
    drawCurrentPath();
  }

  function onMouseUp() {
    if (currentTool === 'select') {
      isDragging = false;
      dragPrevPos = null;
      return;
    }
    if (!isDrawing) return;
    isDrawing = false;
    if (drawPath.length > 1) {
      const color = document.getElementById('edit-draw-color')?.value || '#ff0000';
      const width = parseInt(document.getElementById('edit-draw-width')?.value || '3');
      annotations.push({
        type: currentTool === 'eraser' ? 'eraser' : 'draw',
        path: [...drawPath], color, width, page: currentPage
      });
    }
    drawPath = [];
    redrawAnnotations();
  }

  function drawCurrentPath() {
    if (drawPath.length < 2) return;
    const ctx = overlayCtx;
    const color = document.getElementById('edit-draw-color')?.value || '#ff0000';
    const width = parseInt(document.getElementById('edit-draw-width')?.value || '3');
    ctx.save();
    if (currentTool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = width * 3;
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
    }
    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const pts = drawPath;
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.stroke();
    ctx.restore();
  }

  function pathBBox(path) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    path.forEach(p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function getAnnotBBox(a) {
    if (a.type === 'text') {
      const fs = a.size || 12;
      return { x: a.x, y: a.y - fs, w: Math.max((a.text || '').length * fs * 0.6, 20), h: fs + 4 };
    }
    if (a.type === 'stamp') return { x: a.x, y: a.y - 24, w: 160, h: 30 };
    if (a.type === 'image') return { x: a.x, y: a.y, w: a.width || 100, h: a.height || 100 };
    if (a.type === 'draw' || a.type === 'eraser') {
      const bb = pathBBox(a.path || []);
      return { x: bb.x, y: bb.y, w: Math.max(bb.w, 4), h: Math.max(bb.h, 4) };
    }
    return null;
  }

  function inRect(x, y, rx, ry, rw, rh, tol) {
    return x >= rx - tol && x <= rx + rw + tol && y >= ry - tol && y <= ry + rh + tol;
  }

  function hitTest(x, y) {
    const tol = 6;
    const pageAnns = annotations.filter(a => a.page === currentPage);
    for (let i = pageAnns.length - 1; i >= 0; i--) {
      const a = pageAnns[i];
      const bbox = getAnnotBBox(a);
      if (!bbox) continue;
      if (inRect(x, y, bbox.x, bbox.y, bbox.w, bbox.h, tol)) return annotations.indexOf(a);
    }
    return -1;
  }

  function moveAnnotation(idx, dx, dy) {
    const a = annotations[idx];
    if (!a) return;
    if (a.type === 'text' || a.type === 'stamp') { a.x += dx; a.y += dy; }
    else if (a.type === 'image') { a.x += dx; a.y += dy; }
    else if (a.type === 'draw' || a.type === 'eraser') {
      a.path = a.path.map(p => ({ x: p.x + dx, y: p.y + dy }));
    }
  }

  function drawSelectionIndicator(a) {
    const bbox = getAnnotBBox(a);
    if (!bbox) return;
    const ctx = overlayCtx;
    ctx.save();
    ctx.strokeStyle = 'rgba(0,113,227,0.85)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(bbox.x - 4, bbox.y - 4, bbox.w + 8, bbox.h + 8);
    ctx.setLineDash([]);
    [[bbox.x - 4, bbox.y - 4], [bbox.x + bbox.w + 4, bbox.y - 4],
     [bbox.x - 4, bbox.y + bbox.h + 4], [bbox.x + bbox.w + 4, bbox.y + bbox.h + 4]
    ].forEach(([cx, cy]) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(cx - 3, cy - 3, 6, 6);
      ctx.strokeStyle = 'rgba(0,113,227,0.85)';
      ctx.strokeRect(cx - 3, cy - 3, 6, 6);
    });
    ctx.restore();
  }

  function redrawAnnotations() {
    if (!overlayCtx) return;
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    annotations.filter(a => a.page === currentPage).forEach(a => {
      if (a.type === 'draw') {
        overlayCtx.beginPath();
        overlayCtx.strokeStyle = a.color;
        overlayCtx.lineWidth = a.width;
        overlayCtx.lineCap = 'round';
        overlayCtx.lineJoin = 'round';
        if (a.path.length > 1) {
          overlayCtx.moveTo(a.path[0].x, a.path[0].y);
          for (let i = 1; i < a.path.length; i++) overlayCtx.lineTo(a.path[i].x, a.path[i].y);
          overlayCtx.stroke();
        }
      } else if (a.type === 'text') {
        overlayCtx.font = `${a.size}px ${a.font}`;
        overlayCtx.fillStyle = a.color;
        overlayCtx.fillText(a.text, a.x, a.y);
      } else if (a.type === 'stamp') {
        overlayCtx.font = 'bold 24px sans-serif';
        overlayCtx.fillStyle = 'rgba(255,0,0,0.6)';
        overlayCtx.strokeStyle = 'rgba(255,0,0,0.8)';
        overlayCtx.lineWidth = 2;
        overlayCtx.strokeText(a.text, a.x, a.y);
      } else if (a.type === 'image') {
        if (a._img) {
          overlayCtx.drawImage(a._img, a.x, a.y, a.width, a.height);
        }
      } else if (a.type === 'eraser') {
        overlayCtx.save();
        overlayCtx.globalCompositeOperation = 'destination-out';
        overlayCtx.beginPath();
        overlayCtx.lineWidth = a.width * 3;
        overlayCtx.lineCap = 'round';
        overlayCtx.lineJoin = 'round';
        if (a.path.length > 1) {
          overlayCtx.moveTo(a.path[0].x, a.path[0].y);
          for (let i = 1; i < a.path.length; i++) overlayCtx.lineTo(a.path[i].x, a.path[i].y);
          overlayCtx.stroke();
        }
        overlayCtx.restore();
      }
    });
    if (selectedAnnotIndex !== -1 && annotations[selectedAnnotIndex]?.page === currentPage) {
      drawSelectionIndicator(annotations[selectedAnnotIndex]);
    }
  }

  function changeScale(delta) {
    const newScale = Math.max(0.5, Math.min(4.0, scale + delta));
    if (newScale === scale) return;
    const ratio = newScale / scale;
    annotations.forEach(a => {
      if (a.type === 'text' || a.type === 'stamp') {
        a.x *= ratio; a.y *= ratio;
      } else if (a.type === 'image') {
        a.x *= ratio; a.y *= ratio; a.width *= ratio; a.height *= ratio;
      } else if (a.type === 'draw' || a.type === 'eraser') {
        a.path = a.path.map(p => ({ x: p.x * ratio, y: p.y * ratio }));
      }
    });
    scale = newScale;
    renderPage(currentPage);
  }

  function selectTool(tool, btnEl) {
    if (tool !== 'select') { selectedAnnotIndex = -1; redrawAnnotations(); }
    currentTool = tool;
    document.querySelectorAll('.edit-tool-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');

    document.getElementById('edit-text-options')?.classList.toggle('hidden', tool !== 'text');
    document.getElementById('edit-draw-options')?.classList.toggle('hidden', tool !== 'draw' && tool !== 'eraser');
    const delBtn = document.getElementById('edit-del-selected');
    if (delBtn) delBtn.style.display = (tool === 'select') ? 'block' : 'none';
    if (overlayCanvas) overlayCanvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
  }

  async function save() {
    if (!currentBuffer || !window.PDFLib) {
      if (!window.PDFLib) UI.error('pdf-lib requis pour sauvegarder. Voir libs/README.md');
      return;
    }
    try {
      UI.showLoading('edit-canvas-area', 'Sauvegarde...');
      const { PDFDocument, rgb, StandardFonts } = PDFLib;
      const pdfLibDoc = await PDFDocument.load(currentBuffer);
      let font;
      try { font = await pdfLibDoc.embedFont(StandardFonts.Helvetica); }
      catch(e) { font = await pdfLibDoc.embedFont(StandardFonts.TimesRoman); }

      for (const ann of annotations) {
        if (ann.page < 1 || ann.page > pdfLibDoc.getPageCount()) continue;
        const page = pdfLibDoc.getPage(ann.page - 1);
        const { height } = page.getSize();

        if (ann.type === 'text') {
          const [r, g, b] = hexToRgb(ann.color);
          page.drawText(ann.text, {
            x: ann.x / scale, y: height - (ann.y / scale),
            size: ann.size, font, color: rgb(r, g, b)
          });
        } else if (ann.type === 'draw' && ann.path.length > 1) {
          const [r, g, b] = hexToRgb(ann.color);
          for (let i = 1; i < ann.path.length; i++) {
            page.drawLine({
              start: { x: ann.path[i-1].x / scale, y: height - ann.path[i-1].y / scale },
              end: { x: ann.path[i].x / scale, y: height - ann.path[i].y / scale },
              thickness: ann.width / scale,
              color: rgb(r, g, b)
            });
          }
        } else if (ann.type === 'image' && ann.src) {
          const resp = await fetch(ann.src);
          const imgBytes = await resp.arrayBuffer();
          let embeddedImg;
          if (ann.src.includes('png')) embeddedImg = await pdfLibDoc.embedPng(imgBytes);
          else embeddedImg = await pdfLibDoc.embedJpg(imgBytes);
          page.drawImage(embeddedImg, {
            x: ann.x / scale, y: height - (ann.y + ann.height) / scale,
            width: ann.width / scale, height: ann.height / scale
          });
        }
      }

      const pdfBytes = await pdfLibDoc.save();
      window.PDFState?.setBytes(pdfBytes);
      currentBuffer = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength);
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const name = (currentFile?.name || 'document').replace(/\.pdf$/i, '') + '_edite.pdf';
      UI.downloadBlob(blob, name);
      UI.success('PDF sauvegardé avec succès !');
      Storage.addHistory({ op: 'edit', input: currentFile?.name, status: 'success' });
      Storage.incrementStat('totalProcessed');
    } catch (err) {
      UI.error('Erreur lors de la sauvegarde: ' + err.message);
    } finally {
      UI.removeLoading('edit-canvas-area');
    }
  }

  function hexToRgb(hex) {
    hex = hex || '#000000';
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b];
  }

  function touchToMouse(e) {
    const touch = e.touches[0] || e.changedTouches[0];
    return { clientX: touch.clientX, clientY: touch.clientY };
  }

  function hasChanges() {
    return annotations.some(a => a.type === 'text' || a.type === 'draw' || a.type === 'image');
  }

  async function applyChanges() {
    if (!currentBuffer || !window.PDFLib) return;
    const applicable = annotations.filter(a => a.type === 'text' || a.type === 'draw' || a.type === 'image');
    if (!applicable.length) return;
    try {
      const { PDFDocument, rgb, StandardFonts } = PDFLib;
      const pdfLibDoc = await PDFDocument.load(currentBuffer);
      let font;
      try { font = await pdfLibDoc.embedFont(StandardFonts.Helvetica); }
      catch(e) { font = await pdfLibDoc.embedFont(StandardFonts.TimesRoman); }
      for (const ann of applicable) {
        if (ann.page < 1 || ann.page > pdfLibDoc.getPageCount()) continue;
        const page = pdfLibDoc.getPage(ann.page - 1);
        const { height } = page.getSize();
        if (ann.type === 'text') {
          const [r, g, b] = hexToRgb(ann.color);
          page.drawText(ann.text, { x: ann.x / scale, y: height - (ann.y / scale), size: ann.size, font, color: rgb(r, g, b) });
        } else if (ann.type === 'draw' && ann.path.length > 1) {
          const [r, g, b] = hexToRgb(ann.color);
          for (let i = 1; i < ann.path.length; i++) {
            page.drawLine({
              start: { x: ann.path[i-1].x / scale, y: height - ann.path[i-1].y / scale },
              end:   { x: ann.path[i].x   / scale, y: height - ann.path[i].y   / scale },
              thickness: ann.width / scale, color: rgb(r, g, b)
            });
          }
        } else if (ann.type === 'image' && ann.src) {
          const resp = await fetch(ann.src);
          const imgBytes = await resp.arrayBuffer();
          const embeddedImg = ann.src.includes('png')
            ? await pdfLibDoc.embedPng(imgBytes)
            : await pdfLibDoc.embedJpg(imgBytes);
          page.drawImage(embeddedImg, { x: ann.x / scale, y: height - (ann.y + ann.height) / scale, width: ann.width / scale, height: ann.height / scale });
        }
      }
      const pdfBytes = await pdfLibDoc.save();
      window.PDFState?.setBytes(pdfBytes);
      _loadedVersion = window.PDFState?.getVersion() ?? 0;
      currentBuffer = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength);
      annotations = annotations.filter(a => a.type !== 'text' && a.type !== 'draw' && a.type !== 'image');
      redrawAnnotations();
    } catch(err) {
      console.warn('[EditModule] applyChanges failed:', err);
    }
  }

  function _autoLoad() {
    const f = window.PDFState?.get();
    if (!currentFile && f) loadFile(f);
  }

  function activate() {
    const f = window.PDFState?.get();
    if (!f) return;
    const v = window.PDFState?.getVersion() ?? 0;
    if (!currentFile || (currentFile === f && v > _loadedVersion)) loadFile(f);
  }

  return { init, loadFile, save, activate, hasChanges, applyChanges };
})();

window.EditModule = EditModule;
window.Module_edit = EditModule;
// Module initialized
