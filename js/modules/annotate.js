/* ============================================================
   ANNOTATE MODULE — PDF annotations (highlight, comment, shapes)
   ============================================================ */
'use strict';

const AnnotateModule = (() => {
  let currentFile = null;
  let pdfDoc = null;
  let currentPage = 1;
  let totalPages = 0;
  let currentTool = 'highlight';
  let annotations = [];
  let scale = 1.5;
  // Drawing state
  let isDrawing = false;
  let startPoint = null;
  let drawPath = [];
  // Selection / drag state
  let selectedAnnotIndex = -1;
  let isDragging = false;
  let dragPrevPos = null;
  // Canvas refs
  let overlayCanvas = null;
  let overlayCtx = null;
  let _loadedVersion = -1;

  function init() {
    const btn = document.getElementById('annotate-add-btn');
    const input = document.getElementById('annotate-file-input');
    const dropZone = document.getElementById('annotate-drop-zone');

    if (btn) btn.onclick = () => { input.value = ''; input.click(); };
    if (input) input.onchange = () => { if (input.files[0]) loadFile(input.files[0]); };
    if (dropZone) UI.setupDropZone(dropZone, f => { if (f[0]) loadFile(f[0]); }, ['.pdf']);

    document.querySelectorAll('#annotate-toolbar .edit-tool-btn[data-tool]').forEach(b => {
      b.addEventListener('click', () => selectTool(b.dataset.tool, b));
    });

    const saveBtn = document.getElementById('annotate-save-btn');
    if (saveBtn) saveBtn.onclick = save;

    const delSelectedBtn = document.getElementById('annotate-del-selected');
    if (delSelectedBtn) delSelectedBtn.onclick = deleteSelected;

    const opacityEl = document.getElementById('annotate-opacity');
    const opacityValEl = document.getElementById('annotate-opacity-val');
    if (opacityEl && opacityValEl) {
      opacityEl.oninput = () => { opacityValEl.textContent = opacityEl.value + '%'; };
    }

    _autoLoad();
  }

  async function loadFile(file) {
    _loadedVersion = window.PDFState?.getVersion() ?? 0;
    window.PDFState?.set(file);
    if (!window.pdfjsLib) {
      document.getElementById('annotate-canvas-area').innerHTML =
        '<div class="empty-list-state">PDF.js requis. Voir libs/README.md</div>';
      return;
    }
    currentFile = file;
    annotations = [];
    selectedAnnotIndex = -1;
    const sharedBytes = window.PDFState?.getBytes();
    let ab;
    if (sharedBytes) {
      ab = sharedBytes.buffer.slice(sharedBytes.byteOffset, sharedBytes.byteOffset + sharedBytes.byteLength);
    } else {
      ab = await file.arrayBuffer();
    }
    pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
    totalPages = pdfDoc.numPages;
    currentPage = 1;
    const toolbar = document.getElementById('annotate-toolbar');
    if (toolbar) toolbar.style.display = 'flex';
    const saveBtn = document.getElementById('annotate-save-btn');
    if (saveBtn) saveBtn.style.display = 'block';
    await renderPage(currentPage);
  }

  async function renderPage(n) {
    selectedAnnotIndex = -1;
    const area = document.getElementById('annotate-canvas-area');
    area.innerHTML = '';
    const page = await pdfDoc.getPage(n);
    const viewport = page.getViewport({ scale });

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative;display:inline-block;margin:16px auto;display:block;width:fit-content;';

    const base = document.createElement('canvas');
    base.width = viewport.width;
    base.height = viewport.height;

    overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = viewport.width;
    overlayCanvas.height = viewport.height;
    overlayCanvas.style.cssText = 'position:absolute;top:0;left:0;cursor:crosshair;';
    overlayCtx = overlayCanvas.getContext('2d');

    wrapper.appendChild(base);
    wrapper.appendChild(overlayCanvas);

    const nav = document.createElement('div');
    nav.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:10px;padding:8px;';
    nav.innerHTML = `
      <button class="btn btn-ghost btn-sm" id="ann-prev" ${n<=1?'disabled':''}>← Préc</button>
      <span style="font-size:13px;color:var(--text-secondary)">Page ${n}/${totalPages}</span>
      <button class="btn btn-ghost btn-sm" id="ann-next" ${n>=totalPages?'disabled':''}>Suiv →</button>
    `;
    area.appendChild(wrapper);
    area.appendChild(nav);

    document.getElementById('ann-prev')?.addEventListener('click', async () => {
      if (currentPage > 1) { currentPage--; await renderPage(currentPage); }
    });
    document.getElementById('ann-next')?.addEventListener('click', async () => {
      if (currentPage < totalPages) { currentPage++; await renderPage(currentPage); }
    });

    await page.render({ canvasContext: base.getContext('2d'), viewport }).promise;
    setupEvents(overlayCanvas);
    redraw();

    document.querySelectorAll('#annotate-toolbar .edit-tool-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tool === currentTool);
    });
    overlayCanvas.style.cursor = currentTool === 'select' ? 'default' : 'crosshair';
  }

  function setupEvents(canvas) {
    canvas.addEventListener('mousedown', e => {
      const { x, y } = getPos(e, canvas);

      if (currentTool === 'select') {
        const idx = hitTest(x, y);
        selectedAnnotIndex = idx;
        isDragging = idx >= 0;
        dragPrevPos = { x, y };
        redraw();
        updateList();
        return;
      }

      isDrawing = true;
      startPoint = { x, y };
      if (currentTool === 'freehand') drawPath = [{ x, y }];
    });

    canvas.addEventListener('mousemove', e => {
      const { x, y } = getPos(e, canvas);

      if (currentTool === 'select') {
        if (isDragging && selectedAnnotIndex >= 0) {
          const dx = x - dragPrevPos.x;
          const dy = y - dragPrevPos.y;
          dragPrevPos = { x, y };
          moveAnnotation(selectedAnnotIndex, dx, dy);
          redraw();
        } else {
          canvas.style.cursor = hitTest(x, y) >= 0 ? 'move' : 'default';
        }
        return;
      }

      if (!isDrawing) return;
      if (currentTool === 'freehand') {
        drawPath.push({ x, y });
        redraw();
        drawLivePath();
      } else {
        redraw();
        drawLiveShape({ x, y });
      }
    });

    canvas.addEventListener('mouseup', e => {
      if (currentTool === 'select') {
        isDragging = false;
        dragPrevPos = null;
        return;
      }

      if (!isDrawing) return;
      isDrawing = false;
      const { x, y } = getPos(e, canvas);
      const color = document.getElementById('annotate-color')?.value || '#FFD700';
      const opacity = (parseInt(document.getElementById('annotate-opacity')?.value || '50')) / 100;
      const ann = { type: currentTool, color, opacity, page: currentPage };

      if (currentTool === 'freehand') {
        if (drawPath.length < 2) return;
        ann.path = [...drawPath];
        drawPath = [];
      } else if (['rect', 'circle', 'arrow', 'underline', 'strikethrough', 'highlight'].includes(currentTool)) {
        ann.x1 = startPoint.x; ann.y1 = startPoint.y; ann.x2 = x; ann.y2 = y;
      } else if (currentTool === 'comment') {
        ann.x = startPoint.x; ann.y = startPoint.y;
        UI.prompt('Texte du commentaire:', '').then(txt => {
          if (txt) { ann.text = txt; annotations.push(ann); redraw(); updateList(); }
        });
        return;
      }
      annotations.push(ann);
      redraw();
      updateList();
    });

    canvas.addEventListener('mouseleave', () => {
      if (isDragging) { isDragging = false; dragPrevPos = null; }
    });
  }

  // ---- Hit test ----
  function hitTest(x, y) {
    const TOL = 8;
    const pageAnns = annotations
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => a.page === currentPage)
      .reverse();
    for (const { a, i } of pageAnns) {
      if (hitsAnnotation(x, y, a, TOL)) return i;
    }
    return -1;
  }

  function hitsAnnotation(x, y, a, tol) {
    switch (a.type) {
      case 'highlight':
        return inRect(x, y, Math.min(a.x1,a.x2), a.y1-14, Math.abs(a.x2-a.x1), 16, tol);
      case 'underline':
        return inRect(x, y, Math.min(a.x1,a.x2), a.y1-4, Math.abs(a.x2-a.x1), 8, tol);
      case 'strikethrough': {
        const midY = (a.y1+a.y2)/2;
        return inRect(x, y, Math.min(a.x1,a.x2), midY-4, Math.abs(a.x2-a.x1), 8, tol);
      }
      case 'rect':
      case 'circle':
      case 'arrow':
        return inRect(x, y, Math.min(a.x1,a.x2), Math.min(a.y1,a.y2), Math.abs(a.x2-a.x1), Math.abs(a.y2-a.y1), tol);
      case 'comment':
        return inRect(x, y, a.x, a.y-14, 16, 16, tol);
      case 'freehand': {
        if (!a.path || !a.path.length) return false;
        const bb = pathBBox(a.path);
        return inRect(x, y, bb.x, bb.y, bb.w, bb.h, tol);
      }
      default: return false;
    }
  }

  function inRect(x, y, rx, ry, rw, rh, tol) {
    return x >= rx-tol && x <= rx+rw+tol && y >= ry-tol && y <= ry+rh+tol;
  }

  function pathBBox(path) {
    const xs = path.map(p => p.x), ys = path.map(p => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  // ---- Move annotation ----
  function moveAnnotation(idx, dx, dy) {
    const a = annotations[idx];
    if (!a) return;
    if (a.type === 'comment') {
      a.x += dx; a.y += dy;
    } else if (a.type === 'freehand') {
      a.path = a.path.map(p => ({ x: p.x + dx, y: p.y + dy }));
    } else {
      a.x1 += dx; a.y1 += dy; a.x2 += dx; a.y2 += dy;
    }
  }

  // ---- Selection indicator ----
  function drawSelectionIndicator(a) {
    const ctx = overlayCtx;
    ctx.save();
    ctx.strokeStyle = '#0071E3';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.globalAlpha = 0.9;
    const tol = 5;
    let rx, ry, rw, rh;

    if (a.type === 'comment') {
      rx = a.x - tol; ry = a.y - 14 - tol; rw = 16 + tol*2; rh = 16 + tol*2;
    } else if (a.type === 'freehand' && a.path.length) {
      const bb = pathBBox(a.path);
      rx = bb.x - tol; ry = bb.y - tol; rw = bb.w + tol*2; rh = bb.h + tol*2;
    } else if (a.type === 'highlight') {
      rx = Math.min(a.x1,a.x2) - tol; ry = a.y1 - 14 - tol;
      rw = Math.abs(a.x2-a.x1) + tol*2; rh = 16 + tol*2;
    } else {
      rx = Math.min(a.x1,a.x2) - tol; ry = Math.min(a.y1,a.y2) - tol;
      rw = Math.abs(a.x2-a.x1) + tol*2; rh = Math.abs(a.y2-a.y1) + tol*2;
    }

    ctx.strokeRect(rx, ry, rw, rh);

    // Corner handles
    ctx.setLineDash([]);
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#0071E3';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 1;
    const hs = 4;
    [[rx, ry], [rx+rw, ry], [rx, ry+rh], [rx+rw, ry+rh]].forEach(([hx, hy]) => {
      ctx.fillRect(hx - hs, hy - hs, hs*2, hs*2);
      ctx.strokeRect(hx - hs, hy - hs, hs*2, hs*2);
    });
    ctx.restore();
  }

  // ---- Delete selected ----
  function deleteSelected() {
    if (selectedAnnotIndex < 0) return;
    _del(selectedAnnotIndex);
  }

  function getPos(e, canvas) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function drawLivePath() {
    if (drawPath.length < 2) return;
    const ctx = overlayCtx;
    const color = document.getElementById('annotate-color')?.value || '#FFD700';
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.moveTo(drawPath[0].x, drawPath[0].y);
    drawPath.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.stroke();
  }

  function drawLiveShape(end) {
    if (!startPoint) return;
    const ctx = overlayCtx;
    const color = document.getElementById('annotate-color')?.value || '#FFD700';
    const opacity = (parseInt(document.getElementById('annotate-opacity')?.value || '50')) / 100;
    ctx.save();
    ctx.globalAlpha = opacity;
    const { x1, y1, x2, y2 } = { x1: startPoint.x, y1: startPoint.y, x2: end.x, y2: end.y };

    switch (currentTool) {
      case 'highlight':
        ctx.fillStyle = color;
        ctx.fillRect(Math.min(x1,x2), y1 - 14, Math.abs(x2-x1), 16);
        break;
      case 'underline':
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(Math.min(x1,x2), y1 + 2); ctx.lineTo(Math.max(x1,x2), y1 + 2);
        ctx.stroke();
        break;
      case 'strikethrough': {
        const midY = (y1 + y2) / 2;
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(Math.min(x1,x2), midY); ctx.lineTo(Math.max(x1,x2), midY);
        ctx.stroke();
        break;
      }
      case 'rect':
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.strokeRect(Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1));
        break;
      case 'circle':
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse((x1+x2)/2, (y1+y2)/2, Math.abs(x2-x1)/2, Math.abs(y2-y1)/2, 0, 0, Math.PI*2);
        ctx.stroke();
        break;
      case 'arrow':
        drawArrow(ctx, x1, y1, x2, y2, color);
        break;
    }
    ctx.restore();
  }

  function drawArrow(ctx, x1, y1, x2, y2, color) {
    const dx = x2 - x1, dy = y2 - y1;
    const length = Math.sqrt(dx*dx + dy*dy);
    if (length < 2) return;
    const angle = Math.atan2(dy, dx);
    const headLen = Math.min(24, Math.max(10, length * 0.3));
    const headAngle = Math.PI / 7;

    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen*Math.cos(angle - headAngle), y2 - headLen*Math.sin(angle - headAngle));
    ctx.lineTo(x2 - headLen*Math.cos(angle + headAngle), y2 - headLen*Math.sin(angle + headAngle));
    ctx.closePath();
    ctx.fill();
  }

  function redraw() {
    if (!overlayCtx) return;
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    annotations.filter(a => a.page === currentPage).forEach(a => {
      overlayCtx.save();
      overlayCtx.globalAlpha = a.opacity ?? 0.5;
      overlayCtx.fillStyle = a.color;
      overlayCtx.strokeStyle = a.color;
      overlayCtx.lineWidth = 2;

      switch (a.type) {
        case 'highlight':
          overlayCtx.fillRect(Math.min(a.x1,a.x2), a.y1-14, Math.abs(a.x2-a.x1), 16);
          break;
        case 'underline':
          overlayCtx.beginPath();
          overlayCtx.moveTo(a.x1, a.y1+2); overlayCtx.lineTo(a.x2, a.y1+2);
          overlayCtx.stroke();
          break;
        case 'strikethrough': {
          const midY = (a.y1 + a.y2) / 2;
          overlayCtx.beginPath();
          overlayCtx.moveTo(a.x1, midY); overlayCtx.lineTo(a.x2, midY);
          overlayCtx.stroke();
          break;
        }
        case 'rect':
          overlayCtx.strokeRect(Math.min(a.x1,a.x2), Math.min(a.y1,a.y2), Math.abs(a.x2-a.x1), Math.abs(a.y2-a.y1));
          break;
        case 'circle':
          overlayCtx.beginPath();
          overlayCtx.ellipse((a.x1+a.x2)/2,(a.y1+a.y2)/2,Math.abs(a.x2-a.x1)/2,Math.abs(a.y2-a.y1)/2,0,0,Math.PI*2);
          overlayCtx.stroke();
          break;
        case 'arrow':
          drawArrow(overlayCtx, a.x1, a.y1, a.x2, a.y2, a.color);
          break;
        case 'comment':
          overlayCtx.globalAlpha = 1;
          overlayCtx.fillStyle = '#FFD700';
          overlayCtx.fillRect(a.x, a.y-14, 16, 16);
          overlayCtx.fillStyle = '#333';
          overlayCtx.font = '12px sans-serif';
          overlayCtx.fillText('💬', a.x, a.y);
          break;
        case 'freehand':
          if (a.path && a.path.length > 1) {
            overlayCtx.beginPath();
            overlayCtx.lineCap = 'round';
            overlayCtx.moveTo(a.path[0].x, a.path[0].y);
            a.path.forEach(p => overlayCtx.lineTo(p.x, p.y));
            overlayCtx.stroke();
          }
          break;
      }
      overlayCtx.restore();
    });

    // Draw selection on top
    if (selectedAnnotIndex >= 0 && annotations[selectedAnnotIndex]?.page === currentPage) {
      drawSelectionIndicator(annotations[selectedAnnotIndex]);
    }
  }

  function updateList() {
    const list = document.getElementById('annotate-list');
    if (!list) return;
    if (!annotations.length) {
      list.innerHTML = '<p style="font-size:12px;color:var(--text-muted);text-align:center;padding:8px 0">Aucune annotation</p>';
    } else {
      list.innerHTML = annotations.map((a, i) => `
        <div class="annotation-item${i === selectedAnnotIndex ? ' selected' : ''}" onclick="AnnotateModule._select(${i})" style="cursor:pointer">
          <span class="annotation-color" style="background:${a.color}"></span>
          <span style="flex:1;font-size:12px">${a.type} — p.${a.page}${a.text ? ' : ' + a.text : ''}</span>
          <button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();AnnotateModule._del(${i})">✕</button>
        </div>
      `).join('');
    }
    const delBtn = document.getElementById('annotate-del-selected');
    if (delBtn) delBtn.style.display = selectedAnnotIndex >= 0 ? 'block' : 'none';
  }

  function _select(i) {
    selectedAnnotIndex = i;
    if (annotations[i] && annotations[i].page !== currentPage) {
      currentPage = annotations[i].page;
      renderPage(currentPage);
      return;
    }
    redraw();
    updateList();
  }

  function _del(i) {
    if (i === selectedAnnotIndex) selectedAnnotIndex = -1;
    else if (i < selectedAnnotIndex) selectedAnnotIndex--;
    annotations.splice(i, 1);
    redraw();
    updateList();
  }

  function selectTool(tool, btnEl) {
    currentTool = tool;
    if (tool !== 'select') { selectedAnnotIndex = -1; redraw(); }
    document.querySelectorAll('#annotate-toolbar .edit-tool-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    if (overlayCanvas) overlayCanvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
    updateList();
  }

  async function save() {
    if (!currentFile) return;
    if (!window.PDFLib) {
      UI.error('pdf-lib requis pour sauvegarder. Voir libs/README.md');
      return;
    }
    try {
      selectedAnnotIndex = -1;
      redraw(); // hide selection indicator in output
      const sharedBytes = window.PDFState?.getBytes();
      let sourceAb;
      if (sharedBytes) {
        sourceAb = sharedBytes.buffer.slice(sharedBytes.byteOffset, sharedBytes.byteOffset + sharedBytes.byteLength);
      } else {
        sourceAb = await currentFile.arrayBuffer();
      }
      const { PDFDocument } = PDFLib;
      const pdfLibDoc = await PDFDocument.load(sourceAb);
      const imgData = overlayCanvas.toDataURL('image/png');
      const resp = await fetch(imgData);
      const imgBytes = await resp.arrayBuffer();
      const img = await pdfLibDoc.embedPng(imgBytes);
      const page = pdfLibDoc.getPage(currentPage - 1);
      const { width, height } = page.getSize();
      page.drawImage(img, { x: 0, y: 0, width, height });

      const bytes = await pdfLibDoc.save();
      window.PDFState?.setBytes(bytes);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      UI.downloadBlob(blob, currentFile.name.replace('.pdf', '_annote.pdf'));
      UI.success('PDF annoté sauvegardé !');
      Storage.addHistory({ op: 'annotate', input: currentFile.name, status: 'success' });
    } catch (err) {
      UI.error('Erreur: ' + err.message);
    }
  }

  function hasChanges() {
    return annotations.some(a => a.page === currentPage);
  }

  async function applyChanges() {
    if (!currentFile || !overlayCanvas || !window.PDFLib || !annotations.some(a => a.page === currentPage)) return;
    try {
      selectedAnnotIndex = -1;
      redraw();
      const sharedBytes = window.PDFState?.getBytes();
      let sourceAb;
      if (sharedBytes) {
        sourceAb = sharedBytes.buffer.slice(sharedBytes.byteOffset, sharedBytes.byteOffset + sharedBytes.byteLength);
      } else {
        sourceAb = await currentFile.arrayBuffer();
      }
      const { PDFDocument } = PDFLib;
      const pdfLibDoc = await PDFDocument.load(sourceAb);
      const imgData = overlayCanvas.toDataURL('image/png');
      const resp = await fetch(imgData);
      const imgBytes = await resp.arrayBuffer();
      const img = await pdfLibDoc.embedPng(imgBytes);
      const page = pdfLibDoc.getPage(currentPage - 1);
      const { width, height } = page.getSize();
      page.drawImage(img, { x: 0, y: 0, width, height });
      const bytes = await pdfLibDoc.save();
      window.PDFState?.setBytes(bytes);
      _loadedVersion = window.PDFState?.getVersion() ?? 0;
      annotations = annotations.filter(a => a.page !== currentPage);
      overlayCtx?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      updateList();
    } catch(err) {
      console.warn('[AnnotateModule] applyChanges failed:', err);
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

  return { init, loadFile, save, _del, _select, activate, hasChanges, applyChanges };
})();

window.AnnotateModule = AnnotateModule;
window.Module_annotate = AnnotateModule;
// Module initialized
