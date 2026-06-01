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
  let isDrawing = false;
  let startPoint = null;
  let drawPath = [];
  let overlayCanvas = null;
  let overlayCtx = null;

  function init() {
    const btn = document.getElementById('annotate-add-btn');
    const input = document.getElementById('annotate-file-input');
    const dropZone = document.getElementById('annotate-drop-zone');

    if (btn) btn.onclick = () => { input.value = ''; input.click(); };
    if (input) input.onchange = () => { if (input.files[0]) loadFile(input.files[0]); };
    if (dropZone) UI.setupDropZone(dropZone, f => { if (f[0]) loadFile(f[0]); }, ['.pdf']);

    document.querySelectorAll('.edit-tool-btn[data-tool]').forEach(b => {
      b.addEventListener('click', () => selectTool(b.dataset.tool, b));
    });

    const saveBtn = document.getElementById('annotate-save-btn');
    if (saveBtn) saveBtn.onclick = save;
  }

  async function loadFile(file) {
    if (!window.pdfjsLib) {
      document.getElementById('annotate-canvas-area').innerHTML =
        '<div class="empty-list-state">PDF.js requis. Voir libs/README.md</div>';
      return;
    }
    currentFile = file;
    annotations = [];
    const ab = await file.arrayBuffer();
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
    setupEvents(overlayCanvas, viewport);
    redraw();
  }

  function setupEvents(canvas, viewport) {
    canvas.addEventListener('mousedown', e => {
      const { x, y } = getPos(e, canvas);
      isDrawing = true;
      startPoint = { x, y };
      if (currentTool === 'freehand') drawPath = [{ x, y }];
    });
    canvas.addEventListener('mousemove', e => {
      if (!isDrawing) return;
      const { x, y } = getPos(e, canvas);
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
      if (!isDrawing) return;
      isDrawing = false;
      const { x, y } = getPos(e, canvas);
      const color = document.getElementById('annotate-color')?.value || '#FFD700';
      const opacity = (parseInt(document.getElementById('annotate-opacity')?.value || '50')) / 100;
      const ann = { type: currentTool, color, opacity, page: currentPage };

      if (currentTool === 'freehand') {
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
      case 'rect':
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1));
        break;
      case 'circle':
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
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
    const angle = Math.atan2(y2-y1, x2-x1);
    const headLen = 12;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2 - headLen*Math.cos(angle-Math.PI/6), y2 - headLen*Math.sin(angle-Math.PI/6));
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen*Math.cos(angle+Math.PI/6), y2 - headLen*Math.sin(angle+Math.PI/6));
    ctx.stroke();
  }

  function redraw() {
    if (!overlayCtx) return;
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    annotations.filter(a => a.page === currentPage).forEach(a => {
      overlayCtx.save();
      overlayCtx.globalAlpha = a.opacity || 0.5;
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
        case 'strikethrough':
          const midY = (a.y1 + a.y2) / 2;
          overlayCtx.beginPath();
          overlayCtx.moveTo(a.x1, midY); overlayCtx.lineTo(a.x2, midY);
          overlayCtx.stroke();
          break;
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
  }

  function updateList() {
    const list = document.getElementById('annotate-list');
    if (!list) return;
    list.innerHTML = annotations.map((a, i) => `
      <div class="annotation-item">
        <span class="annotation-color" style="background:${a.color}"></span>
        <span style="flex:1">${a.type} — p.${a.page}${a.text?' : '+a.text:''}</span>
        <button class="btn btn-ghost btn-xs" onclick="AnnotateModule._del(${i})">✕</button>
      </div>
    `).join('');
  }

  function _del(i) {
    annotations.splice(i, 1);
    redraw();
    updateList();
  }

  function selectTool(tool, btnEl) {
    currentTool = tool;
    document.querySelectorAll('#annotate-toolbar .edit-tool-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    if (overlayCanvas) overlayCanvas.style.cursor = 'crosshair';
  }

  async function save() {
    if (!currentFile) return;
    // Flatten annotations onto PDF by re-rendering overlayCanvas onto each page
    // Uses canvas compositing approach
    if (!window.PDFLib) {
      UI.error('pdf-lib requis pour sauvegarder. Voir libs/README.md');
      return;
    }
    try {
      const ab = await currentFile.arrayBuffer();
      const { PDFDocument } = PDFLib;
      const pdfLibDoc = await PDFDocument.load(ab);
      // For now, render current overlay as image and embed
      const imgData = overlayCanvas.toDataURL('image/png');
      const resp = await fetch(imgData);
      const imgBytes = await resp.arrayBuffer();
      const img = await pdfLibDoc.embedPng(imgBytes);
      const page = pdfLibDoc.getPage(currentPage - 1);
      const { width, height } = page.getSize();
      page.drawImage(img, { x: 0, y: 0, width, height });

      const bytes = await pdfLibDoc.save();
      const blob = new Blob([bytes], { type: 'application/pdf' });
      UI.downloadBlob(blob, currentFile.name.replace('.pdf', '_annote.pdf'));
      UI.success('PDF annoté sauvegardé !');
      Storage.addHistory({ op: 'annotate', input: currentFile.name, status: 'success' });
    } catch (err) {
      UI.error('Erreur: ' + err.message);
    }
  }

  return { init, loadFile, save, _del, activate: () => {} };
})();

window.AnnotateModule = AnnotateModule;
window.Module_annotate = AnnotateModule;
document.addEventListener('DOMContentLoaded', AnnotateModule.init);
// Module initialized
