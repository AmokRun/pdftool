/* ============================================================
   COMPARE MODULE — side-by-side visual and text diff of two PDFs
   ============================================================ */
'use strict';

const CompareModule = (() => {

  // ---- State ----
  const state = {
    file1: null,
    file2: null,
    ab1: null,
    ab2: null,
    pdfDoc1: null,
    pdfDoc2: null,
    pageCount1: 0,
    pageCount2: 0,
    currentPage: 1,
    mode: 'visual',   // 'visual' | 'text'
    initialized: false
  };

  function qs(id) { return document.getElementById(id); }

  // ---- File loading ----
  async function loadPDF(ab) {
    if (!window.pdfjsLib) throw new Error('PDF.js non disponible');
    return window.pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
  }

  async function handleFile1(files) {
    const f = files[0];
    if (!f) return;
    state.file1 = f;
    try {
      state.ab1 = await f.arrayBuffer();
      state.pdfDoc1 = await loadPDF(state.ab1);
      state.pageCount1 = state.pdfDoc1.numPages;
      const badge = qs('compare-file1-name');
      if (badge) { badge.textContent = f.name; badge.classList.remove('hidden'); }
      UI.success(`PDF 1 chargé : ${f.name} (${state.pageCount1} pages)`, 'Comparaison');
    } catch(e) {
      UI.error('Impossible de charger PDF 1: ' + e.message);
    }
    checkReady();
  }

  async function handleFile2(files) {
    const f = files[0];
    if (!f) return;
    state.file2 = f;
    try {
      state.ab2 = await f.arrayBuffer();
      state.pdfDoc2 = await loadPDF(state.ab2);
      state.pageCount2 = state.pdfDoc2.numPages;
      const badge = qs('compare-file2-name');
      if (badge) { badge.textContent = f.name; badge.classList.remove('hidden'); }
      UI.success(`PDF 2 chargé : ${f.name} (${state.pageCount2} pages)`, 'Comparaison');
    } catch(e) {
      UI.error('Impossible de charger PDF 2: ' + e.message);
    }
    checkReady();
  }

  function checkReady() {
    const btn = qs('compare-execute-btn');
    if (btn) btn.disabled = !(state.pdfDoc1 && state.pdfDoc2);
  }

  // ---- Render a page to a canvas ----
  async function renderPage(pdfDoc, pageNum, canvas) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.2 });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return { width: viewport.width, height: viewport.height };
  }

  // ---- Visual comparison: pixel diff ----
  async function runVisualCompare(pageNum) {
    const pane1 = qs('compare-pane1');
    const pane2 = qs('compare-pane2');
    if (!pane1 || !pane2) return;

    pane1.innerHTML = '';
    pane2.innerHTML = '';

    const canvas1 = document.createElement('canvas');
    const canvas2 = document.createElement('canvas');
    const diffCanvas = document.createElement('canvas');
    diffCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none';

    const wrapper1 = document.createElement('div');
    wrapper1.style.cssText = 'position:relative;display:inline-block;max-width:100%';
    const wrapper2 = document.createElement('div');
    wrapper2.style.cssText = 'position:relative;display:inline-block;max-width:100%';

    wrapper1.appendChild(canvas1);
    wrapper2.appendChild(canvas2);
    wrapper2.appendChild(diffCanvas);
    pane1.appendChild(wrapper1);
    pane2.appendChild(wrapper2);

    const info1 = qs('compare-page-info1');
    const info2 = qs('compare-page-info2');
    if (info1) info1.textContent = `${pageNum}/${state.pageCount1}`;
    if (info2) info2.textContent = `${pageNum}/${state.pageCount2}`;

    const hasPg1 = pageNum <= state.pageCount1;
    const hasPg2 = pageNum <= state.pageCount2;

    let d1, d2, diffCount = 0, totalPixels = 0;

    if (hasPg1) {
      d1 = await renderPage(state.pdfDoc1, pageNum, canvas1);
    } else {
      canvas1.width = 100; canvas1.height = 100;
      pane1.innerHTML += '<div class="empty-list-state">Page inexistante</div>';
    }
    if (hasPg2) {
      d2 = await renderPage(state.pdfDoc2, pageNum, canvas2);
    } else {
      canvas2.width = 100; canvas2.height = 100;
      pane2.innerHTML += '<div class="empty-list-state">Page inexistante</div>';
    }

    if (hasPg1 && hasPg2) {
      const w = Math.min(canvas1.width, canvas2.width);
      const h = Math.min(canvas1.height, canvas2.height);
      diffCanvas.width = canvas2.width;
      diffCanvas.height = canvas2.height;

      const ctx1 = canvas1.getContext('2d');
      const ctx2 = canvas2.getContext('2d');
      const dctx = diffCanvas.getContext('2d');

      const img1 = ctx1.getImageData(0, 0, w, h);
      const img2 = ctx2.getImageData(0, 0, w, h);
      const diffImg = dctx.createImageData(canvas2.width, canvas2.height);

      totalPixels = w * h;
      for (let i = 0; i < img1.data.length; i += 4) {
        const dr = Math.abs(img1.data[i]   - img2.data[i]);
        const dg = Math.abs(img1.data[i+1] - img2.data[i+1]);
        const db = Math.abs(img1.data[i+2] - img2.data[i+2]);
        if (dr + dg + db > 30) {
          diffCount++;
          diffImg.data[i]   = 220;
          diffImg.data[i+1] = 50;
          diffImg.data[i+2] = 50;
          diffImg.data[i+3] = 140;
        }
      }
      dctx.putImageData(diffImg, 0, 0);
    }

    // Summary
    const summary = qs('compare-summary');
    if (summary) {
      const pct = totalPixels > 0 ? ((diffCount / totalPixels) * 100).toFixed(2) : 0;
      summary.innerHTML = `
        <strong>${diffCount.toLocaleString('fr-FR')}</strong> différences trouvées
        &nbsp;·&nbsp; <strong>${pct}%</strong> modifié
        <br><small>Page ${pageNum} — comparaison visuelle</small>
      `;
      summary.classList.remove('hidden');
    }
  }

  // ---- Text comparison: diff algorithm ----
  async function runTextCompare(pageNum) {
    const pane1 = qs('compare-pane1');
    const pane2 = qs('compare-pane2');
    if (!pane1 || !pane2) return;

    async function extractText(pdfDoc, pNum) {
      if (pNum > pdfDoc.numPages) return [];
      const page = await pdfDoc.getPage(pNum);
      const content = await page.getTextContent();
      return content.items.map(i => i.str).join(' ').split(/\n+/).filter(l => l.trim());
    }

    const [lines1, lines2] = await Promise.all([
      extractText(state.pdfDoc1, pageNum),
      extractText(state.pdfDoc2, pageNum)
    ]);

    // Myers diff (simplified LCS-based)
    const diff = computeDiff(lines1, lines2);

    let html1 = '', html2 = '', adds = 0, removes = 0;
    diff.forEach(item => {
      const escaped = escapeHtml(item.text);
      if (item.type === 'equal') {
        html1 += `<div class="diff-line diff-equal">${escaped}</div>`;
        html2 += `<div class="diff-line diff-equal">${escaped}</div>`;
      } else if (item.type === 'remove') {
        html1 += `<div class="diff-line diff-remove">${escaped}</div>`;
        html2 += `<div class="diff-line diff-placeholder">&nbsp;</div>`;
        removes++;
      } else if (item.type === 'add') {
        html1 += `<div class="diff-line diff-placeholder">&nbsp;</div>`;
        html2 += `<div class="diff-line diff-add">${escaped}</div>`;
        adds++;
      }
    });

    pane1.innerHTML = `<div class="diff-text-panel" style="font-family:monospace;font-size:12px;overflow:auto;height:100%">${html1 || '<em>Aucun texte</em>'}</div>`;
    pane2.innerHTML = `<div class="diff-text-panel" style="font-family:monospace;font-size:12px;overflow:auto;height:100%">${html2 || '<em>Aucun texte</em>'}</div>`;

    const totalLines = Math.max(lines1.length, lines2.length, 1);
    const pct = (((adds + removes) / totalLines) * 100).toFixed(1);

    const summary = qs('compare-summary');
    if (summary) {
      summary.innerHTML = `
        <strong style="color:var(--color-success)">+${adds}</strong> lignes ajoutées,
        <strong style="color:var(--color-error)">-${removes}</strong> lignes supprimées
        &nbsp;·&nbsp; <strong>${pct}%</strong> modifié
        <br><small>Page ${pageNum} — comparaison texte</small>
      `;
      summary.classList.remove('hidden');
    }
  }

  // ---- LCS-based diff ----
  function computeDiff(a, b) {
    // Build LCS table
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);

    // Backtrack
    const result = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && a[i-1] === b[j-1]) {
        result.unshift({ type: 'equal', text: a[i-1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
        result.unshift({ type: 'add', text: b[j-1] });
        j--;
      } else {
        result.unshift({ type: 'remove', text: a[i-1] });
        i--;
      }
    }
    return result;
  }

  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ---- Execute comparison ----
  async function executeCompare() {
    if (!state.pdfDoc1 || !state.pdfDoc2) {
      UI.warning('Chargez les deux PDF avant de comparer.');
      return;
    }

    const btn = qs('compare-execute-btn');
    if (btn) btn.disabled = true;
    UI.info('Comparaison en cours...', 'Comparaison');

    try {
      state.currentPage = 1;
      state.mode = (document.querySelector('input[name="compare-mode"]:checked')?.value) || 'visual';

      if (state.mode === 'visual') {
        await runVisualCompare(state.currentPage);
      } else {
        await runTextCompare(state.currentPage);
      }

      // Add pagination if needed
      const maxPages = Math.max(state.pageCount1, state.pageCount2);
      if (maxPages > 1) renderNavigation(maxPages);

      Storage.addHistory({ op: 'compare', input: `${state.file1.name} vs ${state.file2.name}`, status: 'success' });
    } catch(e) {
      UI.error('Erreur de comparaison: ' + e.message);
      Storage.addHistory({ op: 'compare', input: '', status: 'error' });
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function renderNavigation(maxPages) {
    const area = qs('compare-result');
    if (!area) return;
    let nav = area.querySelector('.compare-nav');
    if (nav) nav.remove();

    nav = document.createElement('div');
    nav.className = 'compare-nav';
    nav.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:12px;padding:8px;border-top:1px solid var(--border-color)';
    nav.innerHTML = `
      <button class="btn btn-ghost btn-xs" id="compare-prev-page">&laquo; Précédent</button>
      <span id="compare-page-num">Page ${state.currentPage} / ${maxPages}</span>
      <button class="btn btn-ghost btn-xs" id="compare-next-page">Suivant &raquo;</button>
    `;
    area.appendChild(nav);

    qs('compare-prev-page').addEventListener('click', async () => {
      if (state.currentPage <= 1) return;
      state.currentPage--;
      qs('compare-page-num').textContent = `Page ${state.currentPage} / ${maxPages}`;
      if (state.mode === 'visual') await runVisualCompare(state.currentPage);
      else await runTextCompare(state.currentPage);
    });
    qs('compare-next-page').addEventListener('click', async () => {
      if (state.currentPage >= maxPages) return;
      state.currentPage++;
      qs('compare-page-num').textContent = `Page ${state.currentPage} / ${maxPages}`;
      if (state.mode === 'visual') await runVisualCompare(state.currentPage);
      else await runTextCompare(state.currentPage);
    });
  }

  // ---- Init ----
  function init() {
    if (state.initialized) return;
    state.initialized = true;

    // File inputs
    const addBtn1 = qs('compare-add-btn1');
    const fileInput1 = qs('compare-file-input1');
    const addBtn2 = qs('compare-add-btn2');
    const fileInput2 = qs('compare-file-input2');
    const drop1 = qs('compare-drop1');
    const drop2 = qs('compare-drop2');

    if (addBtn1 && fileInput1) {
      addBtn1.addEventListener('click', () => { fileInput1.value = ''; fileInput1.click(); });
      fileInput1.addEventListener('change', () => { if (fileInput1.files[0]) handleFile1(Array.from(fileInput1.files)); });
    }
    if (addBtn2 && fileInput2) {
      addBtn2.addEventListener('click', () => { fileInput2.value = ''; fileInput2.click(); });
      fileInput2.addEventListener('change', () => { if (fileInput2.files[0]) handleFile2(Array.from(fileInput2.files)); });
    }
    if (drop1) UI.setupDropZone(drop1, handleFile1, ['.pdf']);
    if (drop2) UI.setupDropZone(drop2, handleFile2, ['.pdf']);

    // Execute
    const execBtn = qs('compare-execute-btn');
    if (execBtn) execBtn.addEventListener('click', executeCompare);

    // Mode radio
    document.querySelectorAll('input[name="compare-mode"]').forEach(r => {
      r.addEventListener('change', () => { state.mode = r.value; });
    });

    console.log('[CompareModule] initialized');
  }

  return { init };
})();

window.CompareModule = CompareModule;
window.Module_compare = CompareModule;
