/* ============================================================
   WATERMARK MODULE — text/image watermark + page numbering
   ============================================================ */
'use strict';

/* ------------------------------------------------------------------ */
/*  WatermarkModule                                                     */
/* ------------------------------------------------------------------ */
const WatermarkModule = (() => {

  const state = {
    file: null,
    arrayBuffer: null,
    pdfDoc: null,       // PDF.js document for preview
    pageCount: 0,
    currentMode: 'text', // 'text' | 'image'
    wmImage: null,       // HTMLImageElement for image watermark
    wmImageFile: null,
    initialized: false
  };

  // ---- Helpers ----
  function qs(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function hexToRgb01(hex) {
    const r = parseInt(hex.slice(1,3),16)/255;
    const g = parseInt(hex.slice(3,5),16)/255;
    const b = parseInt(hex.slice(5,7),16)/255;
    return { r, g, b };
  }

  // ---- Read input values ----
  function getTextOptions() {
    return {
      text:     (qs('wm-text')     ? qs('wm-text').value     : 'CONFIDENTIEL'),
      size:     (qs('wm-size')     ? parseInt(qs('wm-size').value)     : 60),
      color:    (qs('wm-color')    ? qs('wm-color').value    : '#ff0000'),
      opacity:  (qs('wm-opacity')  ? parseInt(qs('wm-opacity').value)/100  : 0.3),
      rotation: (qs('wm-rotation') ? parseInt(qs('wm-rotation').value) : -45)
    };
  }

  function getImageOpacity() {
    return qs('wm-img-opacity') ? parseInt(qs('wm-img-opacity').value)/100 : 0.3;
  }

  function getPageMode() {
    const checked = document.querySelector('input[name="wm-pages"]:checked');
    return checked ? checked.value : 'all';
  }

  // ---- Draw watermark on a canvas overlay ----
  function drawTextWatermark(ctx, w, h, opts) {
    ctx.save();
    ctx.globalAlpha = opts.opacity;
    ctx.translate(w/2, h/2);
    ctx.rotate(opts.rotation * Math.PI / 180);
    ctx.font = `bold ${opts.size}px sans-serif`;
    ctx.fillStyle = opts.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(opts.text, 0, 0);
    ctx.restore();
  }

  function drawImageWatermark(ctx, w, h, img, opacity) {
    if (!img) return;
    ctx.save();
    ctx.globalAlpha = opacity;
    const scale = Math.min(w * 0.6 / img.naturalWidth, h * 0.6 / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, (w - dw)/2, (h - dh)/2, dw, dh);
    ctx.restore();
  }

  // ---- Render preview ----
  async function renderPreview() {
    const area = qs('watermark-preview-area');
    if (!area || !state.pdfDoc) return;

    area.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative;display:inline-block;max-width:100%';

    const baseCanvas = document.createElement('canvas');
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none';

    wrapper.appendChild(baseCanvas);
    wrapper.appendChild(overlayCanvas);
    area.appendChild(wrapper);

    try {
      const page = await state.pdfDoc.getPage(1);
      const viewport = page.getViewport({ scale: 1.2 });
      baseCanvas.width  = viewport.width;
      baseCanvas.height = viewport.height;
      overlayCanvas.width  = viewport.width;
      overlayCanvas.height = viewport.height;

      await page.render({ canvasContext: baseCanvas.getContext('2d'), viewport }).promise;
      applyOverlay(overlayCanvas);
    } catch(e) {
      area.innerHTML = '<div class="empty-list-state">Erreur de rendu aperçu</div>';
    }
  }

  function applyOverlay(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (state.currentMode === 'text') {
      drawTextWatermark(ctx, canvas.width, canvas.height, getTextOptions());
    } else if (state.currentMode === 'image' && state.wmImage) {
      drawImageWatermark(ctx, canvas.width, canvas.height, state.wmImage, getImageOpacity());
    }
  }

  function refreshOverlay() {
    const area = qs('watermark-preview-area');
    if (!area) return;
    const overlay = area.querySelector('canvas:last-child');
    if (overlay) applyOverlay(overlay);
  }

  // ---- Load PDF file ----
  async function loadFile(file) {
    if (!file) return;
    state.file = file;
    UI.showLoading('watermark-preview-area', 'Chargement...');
    try {
      const ab = await file.arrayBuffer();
      state.arrayBuffer = ab;
      if (!window.pdfjsLib) throw new Error('PDF.js non disponible');
      state.pdfDoc = await window.pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
      state.pageCount = state.pdfDoc.numPages;
      qs('watermark-execute-btn').disabled = false;
      await renderPreview();
    } catch(e) {
      UI.error('Impossible de charger le PDF: ' + e.message);
      UI.removeLoading('watermark-preview-area');
    }
  }

  // ---- Parse page range ----
  function parseRange(rangeStr, total) {
    const pages = new Set();
    const parts = rangeStr.split(',');
    for (const part of parts) {
      const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
      if (!m) continue;
      const from = parseInt(m[1]);
      const to   = m[2] ? parseInt(m[2]) : from;
      for (let i = from; i <= Math.min(to, total); i++) pages.add(i);
    }
    return [...pages].sort((a,b) => a-b);
  }

  function getTargetPages(total) {
    const mode = getPageMode();
    if (mode === 'first') return [1];
    if (mode === 'range') {
      const rangeInput = qs('wm-range-input');
      const rangeStr = rangeInput ? rangeInput.value : '';
      const pages = parseRange(rangeStr, total);
      return pages.length ? pages : Array.from({length: total}, (_,i) => i+1);
    }
    return Array.from({length: total}, (_,i) => i+1);
  }

  // ---- Apply watermark via pdf-lib ----
  async function applyWatermark() {
    if (!state.arrayBuffer) { UI.warning('Chargez un PDF d\'abord.'); return; }
    if (!window.PDFLib)     { UI.error('pdf-lib non disponible.'); return; }

    const btn = qs('watermark-execute-btn');
    btn.disabled = true;
    UI.info('Application du filigrane...', 'Filigrane');

    try {
      const { PDFDocument, rgb, degrees } = window.PDFLib;
      const pdfDoc = await PDFDocument.load(state.arrayBuffer);
      const pages  = pdfDoc.getPages();
      const total  = pages.length;
      const targets = getTargetPages(total);

      for (const pageNum of targets) {
        const page = pages[pageNum - 1];
        const { width, height } = page.getSize();

        if (state.currentMode === 'text') {
          const opts = getTextOptions();
          const col  = hexToRgb01(opts.color);
          const fontSize = opts.size;
          const textStr = opts.text;

          // Approximate text width for centering
          const approxTW = textStr.length * fontSize * 0.55;
          page.drawText(textStr, {
            x: width/2 - approxTW/2,
            y: height/2 - fontSize/2,
            size: fontSize,
            color: rgb(col.r, col.g, col.b),
            opacity: opts.opacity,
            rotate: degrees(opts.rotation)
          });

        } else if (state.currentMode === 'image' && state.wmImageFile) {
          const imgBytes = await state.wmImageFile.arrayBuffer();
          let embeddedImg;
          const mimeType = state.wmImageFile.type;
          if (mimeType === 'image/png' || mimeType === 'image/svg+xml') {
            embeddedImg = await pdfDoc.embedPng(imgBytes);
          } else {
            embeddedImg = await pdfDoc.embedJpg(imgBytes);
          }
          const opacity = getImageOpacity();
          const scale = Math.min(width * 0.6 / embeddedImg.width, height * 0.6 / embeddedImg.height);
          const dw = embeddedImg.width  * scale;
          const dh = embeddedImg.height * scale;
          page.drawImage(embeddedImg, {
            x: (width - dw) / 2,
            y: (height - dh) / 2,
            width: dw,
            height: dh,
            opacity
          });
        }
      }

      const pdfBytes = await pdfDoc.save();
      UI.downloadBlob(new Blob([pdfBytes], { type: 'application/pdf' }),
        (state.file.name.replace(/\.pdf$/i,'') + '_filigrane.pdf'));

      Storage.incrementStat('watermarks');
      Storage.addHistory({ op: 'watermark', input: state.file.name, status: 'success' });
      UI.success('Filigrane appliqué avec succès !');

    } catch(e) {
      UI.error('Erreur: ' + e.message);
      Storage.addHistory({ op: 'watermark', input: state.file?.name || '', status: 'error' });
    } finally {
      btn.disabled = false;
    }
  }

  // ---- Init ----
  function init() {
    if (state.initialized) return;
    state.initialized = true;

    // File input
    const fileInput = qs('watermark-file-input');
    const addBtn    = qs('watermark-add-btn');
    const dropZone  = qs('watermark-drop-zone');

    if (addBtn && fileInput) addBtn.addEventListener('click', () => { fileInput.value=''; fileInput.click(); });
    if (fileInput) fileInput.addEventListener('change', () => { if(fileInput.files[0]) loadFile(fileInput.files[0]); });
    if (dropZone)  UI.setupDropZone(dropZone, files => { if(files[0]) loadFile(files[0]); }, ['.pdf']);

    // Tabs
    document.querySelectorAll('.wm-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.wm-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.currentMode = tab.dataset.tab;
        qs('wm-text-panel')?.classList.toggle('hidden', state.currentMode !== 'text');
        qs('wm-image-panel')?.classList.toggle('hidden', state.currentMode !== 'image');
        refreshOverlay();
      });
    });

    // Range sliders live display
    UI.bindRange('wm-size',    'wm-size-val',    'px');
    UI.bindRange('wm-opacity', 'wm-opacity-val', '%');
    UI.bindRange('wm-rotation','wm-rotation-val','°');
    UI.bindRange('wm-img-opacity','wm-img-opacity-val','%');

    // Live preview refresh on option change
    ['wm-text','wm-size','wm-color','wm-opacity','wm-rotation','wm-img-opacity'].forEach(id => {
      const el = qs(id);
      if (el) el.addEventListener('input', refreshOverlay);
    });

    // Image watermark file input
    const wmImgInput = qs('wm-img-input');
    const wmImgBtn   = qs('wm-img-btn');
    if (wmImgBtn && wmImgInput) wmImgBtn.addEventListener('click', () => { wmImgInput.value=''; wmImgInput.click(); });
    if (wmImgInput) {
      wmImgInput.addEventListener('change', () => {
        const f = wmImgInput.files[0];
        if (!f) return;
        state.wmImageFile = f;
        const url = URL.createObjectURL(f);
        const img = new Image();
        img.onload = () => { state.wmImage = img; refreshOverlay(); };
        img.src = url;
      });
    }

    // Execute
    const execBtn = qs('watermark-execute-btn');
    if (execBtn) execBtn.addEventListener('click', applyWatermark);
  }

  return { init, loadFile };
})();

window.WatermarkModule = WatermarkModule;

/* ------------------------------------------------------------------ */
/*  PagenumberModule                                                    */
/* ------------------------------------------------------------------ */
const PagenumberModule = (() => {

  const state = {
    file: null,
    arrayBuffer: null,
    pdfJsDoc: null,
    pageCount: 0,
    position: 'bottom-center',
    initialized: false
  };

  function qs(id) { return document.getElementById(id); }

  function hexToRgb01(hex) {
    const r = parseInt(hex.slice(1,3),16)/255;
    const g = parseInt(hex.slice(3,5),16)/255;
    const b = parseInt(hex.slice(5,7),16)/255;
    return { r, g, b };
  }

  function formatPageLabel(template, n, total) {
    const now = new Date();
    return template
      .replace(/\{n\}/g, String(n))
      .replace(/\{total\}/g, String(total))
      .replace(/\{date\}/g, now.toLocaleDateString('fr-FR'))
      .replace(/\{time\}/g, now.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}));
  }

  function getOptions() {
    const format   = qs('pn-format')    ? qs('pn-format').value           : '{n}';
    const start    = qs('pn-start')     ? parseInt(qs('pn-start').value)   : 1;
    const fontSize = qs('pn-font-size') ? parseInt(qs('pn-font-size').value): 12;
    const color    = qs('pn-color')     ? qs('pn-color').value             : '#000000';
    const inclDate = qs('pn-include-date') ? qs('pn-include-date').checked : false;
    const inclTime = qs('pn-include-time') ? qs('pn-include-time').checked : false;

    let tpl = format;
    if (inclDate) tpl += ' {date}';
    if (inclTime) tpl += ' {time}';

    return { tpl, start, fontSize, color };
  }

  // Compute x,y on a PDF page (pdf-lib coords: origin bottom-left)
  function computePosition(pos, pageWidth, pageHeight, fontSize, textWidth) {
    const margin = 20;
    let x, y;
    if (pos.startsWith('top'))    y = pageHeight - margin - fontSize;
    else                           y = margin;

    if (pos.endsWith('left'))      x = margin;
    else if (pos.endsWith('right'))x = pageWidth - textWidth - margin;
    else                           x = (pageWidth - textWidth) / 2;

    return { x, y };
  }

  // ---- Render preview ----
  async function renderPreview() {
    const area = qs('pn-preview-area');
    if (!area || !state.pdfJsDoc) return;
    area.innerHTML = '';

    const baseCanvas = document.createElement('canvas');
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none';
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative;display:inline-block;max-width:100%';
    wrapper.appendChild(baseCanvas);
    wrapper.appendChild(overlayCanvas);
    area.appendChild(wrapper);

    try {
      const page = await state.pdfJsDoc.getPage(1);
      const vp = page.getViewport({ scale: 1.2 });
      baseCanvas.width = overlayCanvas.width = vp.width;
      baseCanvas.height = overlayCanvas.height = vp.height;
      await page.render({ canvasContext: baseCanvas.getContext('2d'), viewport: vp }).promise;
      drawPreviewOverlay(overlayCanvas, vp.width, vp.height);
    } catch(e) {
      area.innerHTML = '<div class="empty-list-state">Erreur aperçu</div>';
    }
  }

  function drawPreviewOverlay(canvas, w, h) {
    const opts = getOptions();
    const ctx  = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.font = `${opts.fontSize}px sans-serif`;
    const label = formatPageLabel(opts.tpl, opts.start, state.pageCount || 1);
    const tw = ctx.measureText(label).width;

    const margin = 20;
    let x, y;
    if (state.position.startsWith('top'))    y = margin + opts.fontSize;
    else                                      y = h - margin;
    if (state.position.endsWith('left'))     x = margin;
    else if (state.position.endsWith('right'))x = w - tw - margin;
    else                                      x = (w - tw) / 2;

    ctx.fillStyle = opts.color;
    ctx.globalAlpha = 1;
    ctx.fillText(label, x, y);
  }

  function refreshPreviewOverlay() {
    const area = qs('pn-preview-area');
    if (!area) return;
    const wrapper = area.querySelector('div');
    if (!wrapper) return;
    const overlay = wrapper.querySelector('canvas:last-child');
    if (!overlay) return;
    drawPreviewOverlay(overlay, overlay.width, overlay.height);
  }

  // ---- Load file ----
  async function loadFile(file) {
    state.file = file;
    UI.showLoading('pn-preview-area', 'Chargement...');
    try {
      const ab = await file.arrayBuffer();
      state.arrayBuffer = ab;
      if (!window.pdfjsLib) throw new Error('PDF.js non disponible');
      state.pdfJsDoc = await window.pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
      state.pageCount = state.pdfJsDoc.numPages;
      qs('pn-execute-btn').disabled = false;
      await renderPreview();
    } catch(e) {
      UI.error('Impossible de charger: ' + e.message);
      UI.removeLoading('pn-preview-area');
    }
  }

  // ---- Apply page numbers via pdf-lib ----
  async function applyPageNumbers() {
    if (!state.arrayBuffer) { UI.warning('Chargez un PDF d\'abord.'); return; }
    if (!window.PDFLib)     { UI.error('pdf-lib non disponible.'); return; }

    const btn = qs('pn-execute-btn');
    btn.disabled = true;
    UI.info('Ajout de la numérotation...', 'Numérotation');

    try {
      const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
      const pdfDoc = await PDFDocument.load(state.arrayBuffer);
      const font   = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pages  = pdfDoc.getPages();
      const total  = pages.length;
      const opts   = getOptions();
      const col    = hexToRgb01(opts.color);

      for (let i = 0; i < total; i++) {
        const page = pages[i];
        const { width, height } = page.getSize();
        const label = formatPageLabel(opts.tpl, opts.start + i, total);
        const tw = font.widthOfTextAtSize(label, opts.fontSize);
        const { x, y } = computePosition(state.position, width, height, opts.fontSize, tw);
        page.drawText(label, {
          x, y,
          size: opts.fontSize,
          font,
          color: rgb(col.r, col.g, col.b)
        });
      }

      const pdfBytes = await pdfDoc.save();
      UI.downloadBlob(new Blob([pdfBytes], { type: 'application/pdf' }),
        (state.file.name.replace(/\.pdf$/i,'') + '_numerote.pdf'));

      Storage.incrementStat('totalProcessed');
      Storage.addHistory({ op: 'pagenumber', input: state.file.name, status: 'success' });
      UI.success('Numérotation ajoutée avec succès !');

    } catch(e) {
      UI.error('Erreur: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ---- Init ----
  function init() {
    if (state.initialized) return;
    state.initialized = true;

    const fileInput = qs('pn-file-input');
    const addBtn    = qs('pn-add-btn');
    const dropZone  = qs('pn-drop-zone');

    if (addBtn && fileInput) addBtn.addEventListener('click', () => { fileInput.value=''; fileInput.click(); });
    if (fileInput) fileInput.addEventListener('change', () => { if(fileInput.files[0]) loadFile(fileInput.files[0]); });
    if (dropZone)  UI.setupDropZone(dropZone, files => { if(files[0]) loadFile(files[0]); }, ['.pdf']);

    // Position grid
    document.querySelectorAll('.pos-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pos-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.position = btn.dataset.pos;
        refreshPreviewOverlay();
      });
    });

    // Live options
    UI.bindRange('pn-font-size','pn-font-size-val','px');
    ['pn-format','pn-start','pn-font-size','pn-color','pn-include-date','pn-include-time'].forEach(id => {
      const el = qs(id);
      if (el) el.addEventListener('change', refreshPreviewOverlay);
      if (el) el.addEventListener('input',  refreshPreviewOverlay);
    });

    const execBtn = qs('pn-execute-btn');
    if (execBtn) execBtn.addEventListener('click', applyPageNumbers);
  }

  return { init, loadFile };
})();

window.PagenumberModule = PagenumberModule;

// Router integration: init both when the view activates
document.addEventListener('DOMContentLoaded', () => {
  if (window.Router) {
    Router.register('watermark',  () => WatermarkModule.init());
    Router.register('pagenumber', () => PagenumberModule.init());
  }
});
