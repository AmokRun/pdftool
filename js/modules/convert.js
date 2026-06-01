/* ============================================================
   CONVERT MODULE — convert files to/from PDF
   ============================================================ */
'use strict';

const ConvertModule = (() => {

  // ---- State ----
  const state = {
    files: [],          // Array of { id, file, name, size, type }
    direction: 'to-pdf', // 'to-pdf' | 'from-pdf'
    fromFormat: 'jpg',   // selected source format (to-pdf direction)
    toFormat: 'jpg',     // selected target format (from-pdf direction)
    dpi: 150,
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

  function setProgress(pct, label) {
    const fill = document.getElementById('convert-progress-fill');
    const text = document.getElementById('convert-progress-text');
    if (fill) fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
    if (text) text.textContent = label !== undefined ? label : Math.round(pct) + '%';
  }

  function showProgressBar() {
    const el = document.getElementById('convert-progress');
    if (el) el.classList.remove('hidden');
  }

  function hideProgressBar() {
    const el = document.getElementById('convert-progress');
    if (el) el.classList.add('hidden');
  }

  // ---- Accepted MIME / extensions per format ----
  const FORMAT_ACCEPT = {
    'to-pdf': {
      jpg:  ['image/jpeg', '.jpg', '.jpeg'],
      png:  ['image/png', '.png'],
      webp: ['image/webp', '.webp'],
      tiff: ['image/tiff', '.tiff', '.tif'],
      html: ['text/html', '.html', '.htm'],
      txt:  ['text/plain', '.txt'],
      md:   ['.md', '.markdown']
    },
    'from-pdf': {
      jpg: ['application/pdf', '.pdf'],
      png: ['application/pdf', '.pdf'],
      webp:['application/pdf', '.pdf'],
      txt: ['application/pdf', '.pdf'],
      html:['application/pdf', '.pdf'],
      svg: ['application/pdf', '.pdf'],
      md:  ['application/pdf', '.pdf']
    }
  };

  function fileMatchesDirection(file) {
    if (state.direction === 'from-pdf') {
      return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    }
    // to-pdf: accept images, txt, html, md
    const name = file.name.toLowerCase();
    const type = file.type || '';
    if (type.startsWith('image/')) return true;
    if (type === 'text/plain' || name.endsWith('.txt')) return true;
    if (type === 'text/html' || name.endsWith('.html') || name.endsWith('.htm')) return true;
    if (name.endsWith('.md') || name.endsWith('.markdown')) return true;
    return false;
  }

  // ---- Add files ----
  function addFiles(files) {
    const arr = Array.from(files).filter(f => fileMatchesDirection(f));
    if (!arr.length) {
      UI.warning('Aucun fichier compatible avec la direction sélectionnée.');
      return;
    }
    for (const file of arr) {
      const isDupe = state.files.some(e => e.name === file.name && e.size === file.size);
      if (isDupe) { UI.info(`"${file.name}" est déjà dans la liste.`); continue; }
      const entry = { id: uid(), file, name: file.name, size: file.size, type: file.type };
      state.files.push(entry);
      renderFileItem(entry);
    }
    updateUI();
  }

  // ---- Render a file row ----
  function renderFileItem(entry) {
    const list = document.getElementById('convert-file-list');
    if (!list) return;
    const empty = list.querySelector('.empty-list-state');
    if (empty) empty.remove();

    const item = document.createElement('div');
    item.className = 'merge-file-item';
    item.dataset.id = entry.id;

    const ext = entry.name.split('.').pop().toUpperCase();
    const typeLabel = ext || 'FILE';

    item.innerHTML = `
      <div class="file-thumb-wrap">
        <span class="file-thumb-icon">📄</span>
      </div>
      <div class="file-item-info">
        <span class="file-item-name" title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</span>
        <span class="file-item-meta">${UI.formatSize(entry.size)} · ${typeLabel}</span>
      </div>
      <button class="btn btn-ghost btn-xs file-remove-btn" data-id="${entry.id}" title="Supprimer">✕</button>
    `;
    list.appendChild(item);
    item.querySelector('.file-remove-btn').addEventListener('click', () => removeFile(entry.id));
  }

  function removeFile(id) {
    state.files = state.files.filter(e => e.id !== id);
    const item = document.querySelector(`.merge-file-item[data-id="${id}"]`);
    if (item) item.remove();
    const list = document.getElementById('convert-file-list');
    if (list && !list.querySelector('.merge-file-item')) {
      list.innerHTML = '<div class="empty-list-state">Ajoutez des fichiers pour commencer</div>';
    }
    updateUI();
  }

  function clearFileList() {
    state.files = [];
    const list = document.getElementById('convert-file-list');
    if (list) list.innerHTML = '<div class="empty-list-state">Ajoutez des fichiers pour commencer</div>';
    updateUI();
  }

  function updateUI() {
    const execBtn = document.getElementById('convert-execute-btn');
    if (execBtn) execBtn.disabled = state.files.length === 0;
  }

  // ---- Update file input accept attribute ----
  function updateFileInputAccept() {
    const input = document.getElementById('convert-file-input');
    if (!input) return;
    if (state.direction === 'from-pdf') {
      input.accept = '.pdf';
    } else {
      const fmt = state.fromFormat;
      const map = { jpg: '.jpg,.jpeg', png: '.png', webp: '.webp', tiff: '.tiff,.tif',
                    html: '.html,.htm', txt: '.txt', md: '.md,.markdown' };
      input.accept = map[fmt] || '*/*';
    }
  }

  // ================================================================
  // CONVERSION: TO PDF
  // ================================================================

  // ---- Image → PDF via pdf-lib ----
  async function imageToPdf(file) {
    if (!window.PDFLib) throw new Error('pdf-lib non disponible');
    const { PDFDocument } = window.PDFLib;
    const pdfDoc = await PDFDocument.create();
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    const name = file.name.toLowerCase();
    const type = file.type || '';
    let image;

    if (type === 'image/jpeg' || name.endsWith('.jpg') || name.endsWith('.jpeg')) {
      image = await pdfDoc.embedJpg(uint8);
    } else if (type === 'image/png' || name.endsWith('.png')) {
      image = await pdfDoc.embedPng(uint8);
    } else {
      // WEBP / TIFF: render via canvas to get PNG data
      image = await embedImageViaCanvas(pdfDoc, file, 'png');
    }

    const { width, height } = image;
    const page = pdfDoc.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });

    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes], { type: 'application/pdf' });
  }

  async function embedImageViaCanvas(pdfDoc, file, outFmt) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = async () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext('2d').drawImage(img, 0, 0);
          canvas.toBlob(async blob => {
            try {
              const ab = await blob.arrayBuffer();
              const imgEmbed = await pdfDoc.embedPng(new Uint8Array(ab));
              URL.revokeObjectURL(url);
              resolve(imgEmbed);
            } catch (e) { reject(e); }
          }, 'image/png');
        } catch (e) { reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Impossible de charger l\'image')); };
      img.src = url;
    });
  }

  // ---- TXT → PDF via pdf-lib ----
  async function txtToPdf(file) {
    if (!window.PDFLib) throw new Error('pdf-lib non disponible');
    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;

    const text = await file.text();
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Courier);

    const PAGE_WIDTH = 595;
    const PAGE_HEIGHT = 842;
    const MARGIN = 50;
    const LINE_HEIGHT = 14;
    const FONT_SIZE = 11;
    const CHARS_PER_LINE = 80;
    const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LINE_HEIGHT);

    // Split text into lines, wrapping at CHARS_PER_LINE
    const rawLines = text.split('\n');
    const lines = [];
    for (const raw of rawLines) {
      if (raw.length === 0) { lines.push(''); continue; }
      for (let i = 0; i < raw.length; i += CHARS_PER_LINE) {
        lines.push(raw.slice(i, i + CHARS_PER_LINE));
      }
    }

    let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = PAGE_HEIGHT - MARGIN;
    let lineIdx = 0;

    while (lineIdx < lines.length) {
      if (y < MARGIN + LINE_HEIGHT) {
        page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN;
      }
      page.drawText(lines[lineIdx] || ' ', {
        x: MARGIN, y,
        size: FONT_SIZE,
        font,
        color: rgb(0, 0, 0)
      });
      y -= LINE_HEIGHT;
      lineIdx++;
    }

    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes], { type: 'application/pdf' });
  }

  // ---- Markdown → PDF (strip markdown, treat as TXT) ----
  async function markdownToPdf(file) {
    const raw = await file.text();
    // Strip common markdown syntax
    const plain = raw
      .replace(/^#{1,6}\s+/gm, '')          // headings
      .replace(/\*\*([^*]+)\*\*/g, '$1')     // bold
      .replace(/__([^_]+)__/g, '$1')         // bold alt
      .replace(/\*([^*]+)\*/g, '$1')         // italic
      .replace(/_([^_]+)_/g, '$1')           // italic alt
      .replace(/~~([^~]+)~~/g, '$1')         // strikethrough
      .replace(/`{3}[^\n]*\n([\s\S]*?)`{3}/g, '$1') // fenced code
      .replace(/`([^`]+)`/g, '$1')           // inline code
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '[$1]') // images
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')     // links
      .replace(/^[-*+]\s+/gm, '• ')          // unordered lists
      .replace(/^\d+\.\s+/gm, '')            // ordered lists
      .replace(/^>\s+/gm, '')               // blockquotes
      .replace(/^---+$/gm, '─'.repeat(40)); // horizontal rules

    const textFile = new File([plain], file.name.replace(/\.md$/i, '.txt'), { type: 'text/plain' });
    return txtToPdf(textFile);
  }

  // ---- HTML → PDF via canvas snapshot ----
  async function htmlToPdf(file) {
    if (!window.PDFLib) throw new Error('pdf-lib non disponible');

    const html = await file.text();

    // Create a hidden iframe, load HTML, snapshot via canvas
    return new Promise((resolve, reject) => {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:800px;height:1100px;border:none;';
      document.body.appendChild(iframe);

      const cleanup = () => { try { document.body.removeChild(iframe); } catch (e) {} };

      // Write HTML into iframe
      try {
        iframe.contentDocument.open();
        iframe.contentDocument.write(html);
        iframe.contentDocument.close();
      } catch (e) {
        cleanup();
        // Fallback: treat as plain text
        return txtToPdf(new File([html.replace(/<[^>]+>/g, ' ')], file.name, { type: 'text/plain' }))
          .then(resolve).catch(reject);
      }

      iframe.onload = async () => {
        try {
          const doc = iframe.contentDocument;
          const body = doc.body;
          const W = body.scrollWidth || 800;
          const H = body.scrollHeight || 1100;

          // Use html2canvas-like approach: create a canvas and draw the iframe
          // Since direct cross-origin drawing is blocked, use print-to-blob fallback
          // We render visible content via canvas
          const canvas = document.createElement('canvas');
          const scale = 2;
          canvas.width = W * scale;
          canvas.height = H * scale;
          const ctx = canvas.getContext('2d');
          ctx.scale(scale, scale);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, W, H);

          // Draw text content from iframe as a simpler fallback
          const textContent = doc.body ? doc.body.innerText || doc.body.textContent : html.replace(/<[^>]+>/g, ' ');
          cleanup();

          // Delegate to txtToPdf with extracted text
          const textFile = new File([textContent], file.name, { type: 'text/plain' });
          resolve(await txtToPdf(textFile));
        } catch (e) {
          cleanup();
          reject(e);
        }
      };

      setTimeout(() => {
        if (document.body.contains(iframe)) {
          const textContent = iframe.contentDocument && iframe.contentDocument.body
            ? iframe.contentDocument.body.innerText || ''
            : html.replace(/<[^>]+>/g, ' ');
          cleanup();
          txtToPdf(new File([textContent], file.name, { type: 'text/plain' })).then(resolve).catch(reject);
        }
      }, 4000);
    });
  }

  // ================================================================
  // CONVERSION: FROM PDF
  // ================================================================

  // ---- PDF → Images ----
  async function pdfToImages(file, format, onProgress) {
    if (!window.pdfjsLib) throw new Error('PDF.js non disponible');

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    const total = pdf.numPages;
    const results = []; // { name, blob }

    const scale = state.dpi / 72;
    const mimeMap = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
    const mime = mimeMap[format] || 'image/png';
    const quality = format === 'png' ? undefined : 0.92;
    const baseName = file.name.replace(/\.pdf$/i, '');

    for (let i = 1; i <= total; i++) {
      onProgress(((i - 1) / total) * 90, `Page ${i}/${total}...`);
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

      const blob = await new Promise(res => canvas.toBlob(res, mime, quality));
      const ext = format === 'jpg' ? 'jpg' : format;
      results.push({ name: `${baseName}_page${String(i).padStart(3, '0')}.${ext}`, blob });
    }
    return results;
  }

  // ---- PDF → TXT ----
  async function pdfToTxt(file, onProgress) {
    if (!window.pdfjsLib) throw new Error('PDF.js non disponible');

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    const total = pdf.numPages;
    let fullText = '';

    for (let i = 1; i <= total; i++) {
      onProgress((i / total) * 90, `Extraction page ${i}/${total}...`);
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(' ');
      fullText += `\n\n--- Page ${i} ---\n\n${pageText}`;
    }

    const baseName = file.name.replace(/\.pdf$/i, '');
    return [{ name: `${baseName}.txt`, blob: new Blob([fullText.trim()], { type: 'text/plain' }) }];
  }

  // ---- PDF → HTML ----
  async function pdfToHtml(file, onProgress) {
    const results = await pdfToTxt(file, onProgress);
    const text = await results[0].blob.text();
    const baseName = file.name.replace(/\.pdf$/i, '');

    const escaped = escapeHtml(text);
    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(baseName)}</title>
  <style>
    body { font-family: Georgia, serif; max-width: 800px; margin: 0 auto; padding: 2em; line-height: 1.6; }
    h1 { color: #333; border-bottom: 2px solid #ddd; padding-bottom: .5em; }
    pre { background: #f9f9f9; padding: 1em; border-radius: 4px; white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <h1>${escapeHtml(baseName)}</h1>
  <pre>${escaped}</pre>
</body>
</html>`;

    return [{ name: `${baseName}.html`, blob: new Blob([html], { type: 'text/html' }) }];
  }

  // ---- PDF → Markdown ----
  async function pdfToMarkdown(file, onProgress) {
    const results = await pdfToTxt(file, onProgress);
    const text = await results[0].blob.text();
    const baseName = file.name.replace(/\.pdf$/i, '');
    const md = `# ${baseName}\n\n${text}`;
    return [{ name: `${baseName}.md`, blob: new Blob([md], { type: 'text/markdown' }) }];
  }

  // ---- Download multiple files (with JSZip if available, else individually) ----
  async function downloadResults(results, zipName) {
    if (results.length === 1) {
      UI.downloadBlob(results[0].blob, results[0].name);
      return;
    }

    if (window.JSZip) {
      const zip = new window.JSZip();
      for (const r of results) zip.file(r.name, r.blob);
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      UI.downloadBlob(zipBlob, zipName);
    } else {
      // Individual downloads with a small delay
      UI.info(`Téléchargement de ${results.length} fichiers individuellement (JSZip non disponible)`);
      for (let i = 0; i < results.length; i++) {
        await new Promise(resolve => setTimeout(resolve, i === 0 ? 0 : 300));
        UI.downloadBlob(results[i].blob, results[i].name);
      }
    }
  }

  // ================================================================
  // EXECUTE CONVERSION
  // ================================================================
  async function executeConversion() {
    if (state.files.length === 0) {
      UI.warning('Ajoutez des fichiers à convertir.');
      return;
    }

    const execBtn = document.getElementById('convert-execute-btn');
    if (execBtn) execBtn.disabled = true;
    showProgressBar();
    setProgress(2, 'Démarrage...');

    const allResults = [];

    try {
      const total = state.files.length;
      for (let fi = 0; fi < total; fi++) {
        const entry = state.files[fi];
        const fileBase = fi / total;
        const fileShare = 1 / total;

        const onProgress = (pct, label) => {
          setProgress(fileBase * 100 + fileShare * pct, label || `${Math.round(fileBase * 100 + fileShare * pct)}%`);
        };

        onProgress(2, `Conversion de "${entry.name}"...`);

        try {
          if (state.direction === 'to-pdf') {
            let blob;
            const name = entry.name.toLowerCase();
            const type = entry.file.type || '';

            if (type.startsWith('image/') || ['jpg','jpeg','png','webp','tiff','tif'].some(e => name.endsWith('.'+e))) {
              blob = await imageToPdf(entry.file);
            } else if (type === 'text/html' || name.endsWith('.html') || name.endsWith('.htm')) {
              blob = await htmlToPdf(entry.file);
            } else if (name.endsWith('.md') || name.endsWith('.markdown')) {
              blob = await markdownToPdf(entry.file);
            } else {
              blob = await txtToPdf(entry.file);
            }

            const outName = entry.name.replace(/\.[^.]+$/, '') + '.pdf';
            allResults.push({ name: outName, blob });
          } else {
            // from-pdf
            let results;
            const fmt = state.toFormat;
            if (['jpg', 'png', 'webp'].includes(fmt)) {
              results = await pdfToImages(entry.file, fmt, onProgress);
            } else if (fmt === 'txt') {
              results = await pdfToTxt(entry.file, onProgress);
            } else if (fmt === 'html') {
              results = await pdfToHtml(entry.file, onProgress);
            } else if (fmt === 'md') {
              results = await pdfToMarkdown(entry.file, onProgress);
            } else if (fmt === 'svg') {
              // SVG fallback: convert page to canvas then inline SVG wrapping the PNG
              const imgResults = await pdfToImages(entry.file, 'png', onProgress);
              results = [];
              for (const r of imgResults) {
                const dataUrl = await blobToDataUrl(r.blob);
                const canvas = document.createElement('canvas');
                const img = await loadImageFromBlob(r.blob);
                const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${img.width}" height="${img.height}">` +
                  `<image href="${dataUrl}" width="${img.width}" height="${img.height}"/></svg>`;
                const svgBlob = new Blob([svgContent], { type: 'image/svg+xml' });
                results.push({ name: r.name.replace(/\.png$/, '.svg'), blob: svgBlob });
              }
            } else {
              results = await pdfToTxt(entry.file, onProgress);
            }
            allResults.push(...results);
          }
        } catch (e) {
          UI.error(`Erreur pour "${entry.name}": ${e.message}`);
          console.error(e);
        }

        onProgress(100);
      }

      if (!allResults.length) throw new Error('Aucun résultat produit');

      setProgress(98, 'Téléchargement...');
      const baseName = state.files[0].name.replace(/\.[^.]+$/, '');
      await downloadResults(allResults, `${baseName}_converti.zip`);

      setProgress(100, '100%');

      // Storage tracking
      Storage.addHistory({
        op: 'convert',
        input: state.files.map(e => e.name).join(', '),
        output: allResults.length === 1 ? allResults[0].name : `${allResults.length} fichiers`,
        status: 'success'
      });
      Storage.incrementStat('conversions');
      Storage.incrementStat('totalProcessed');

      UI.success(`Conversion réussie — ${allResults.length} fichier(s) produit(s)`, 'Conversion');

    } catch (err) {
      console.error('Convert error:', err);
      UI.error('Erreur lors de la conversion : ' + err.message);
      Storage.addHistory({ op: 'convert', input: '', status: 'error' });
    } finally {
      setTimeout(() => {
        hideProgressBar();
        if (execBtn) execBtn.disabled = state.files.length === 0;
      }, 1400);
    }
  }

  // ---- Utility: blob → data URL ----
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  // ---- Utility: load image from blob ----
  function loadImageFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
      img.src = url;
    });
  }

  // ================================================================
  // INIT
  // ================================================================
  function init() {
    if (state.initialized) return;
    state.initialized = true;

    // Direction toggle buttons
    document.querySelectorAll('.convert-dir-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.convert-dir-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.direction = btn.dataset.dir;

        const toPanel = document.getElementById('convert-to-pdf-panel');
        const fromPanel = document.getElementById('convert-from-pdf-panel');
        if (toPanel) toPanel.classList.toggle('hidden', state.direction !== 'to-pdf');
        if (fromPanel) fromPanel.classList.toggle('hidden', state.direction !== 'from-pdf');

        clearFileList();
        updateFileInputAccept();
      });
    });

    // From-format buttons (to-pdf)
    const fromFormatsEl = document.getElementById('convert-from-formats');
    if (fromFormatsEl) {
      fromFormatsEl.querySelectorAll('.format-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          fromFormatsEl.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          state.fromFormat = btn.dataset.format;
          updateFileInputAccept();
          clearFileList();
        });
      });
    }

    // To-format buttons (from-pdf)
    const toFormatsEl = document.getElementById('convert-to-formats');
    if (toFormatsEl) {
      toFormatsEl.querySelectorAll('.format-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          toFormatsEl.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          state.toFormat = btn.dataset.format;
        });
      });
    }

    // DPI range
    const dpiRange = document.getElementById('convert-dpi');
    const dpiVal = document.getElementById('convert-dpi-val');
    if (dpiRange && dpiVal) {
      dpiRange.addEventListener('input', () => {
        state.dpi = parseInt(dpiRange.value, 10);
        dpiVal.textContent = dpiRange.value + ' DPI';
      });
    }

    // File input + add button
    const fileInput = document.getElementById('convert-file-input');
    const addBtn = document.getElementById('convert-add-btn');
    if (addBtn && fileInput) {
      addBtn.addEventListener('click', () => {
        updateFileInputAccept();
        fileInput.value = '';
        fileInput.click();
      });
      fileInput.addEventListener('change', () => {
        if (fileInput.files.length) addFiles(fileInput.files);
      });
    }

    // Drop zone
    const dropZone = document.getElementById('convert-drop-zone');
    if (dropZone) {
      UI.setupDropZone(dropZone, addFiles, []);
    }

    // Execute button
    const execBtn = document.getElementById('convert-execute-btn');
    if (execBtn) execBtn.addEventListener('click', executeConversion);

    updateUI();
    updateFileInputAccept();
    console.log('[ConvertModule] initialized');
  }

  return { init, addFiles };
})();

window.ConvertModule = ConvertModule;
window.Module_convert = ConvertModule;
