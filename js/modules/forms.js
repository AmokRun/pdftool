/* ============================================================
   FORMS MODULE — PDF form filling
   ============================================================ */
'use strict';

const FormsModule = (() => {
  let currentFile = null;
  let pdfDoc = null;
  let fieldValues = {};
  let formFields = [];
  let scale = 1.5;

  function init() {
    const btn = document.getElementById('forms-add-btn');
    const input = document.getElementById('forms-file-input');
    const dropZone = document.getElementById('forms-drop-zone');
    const saveBtn = document.getElementById('forms-save-btn');
    const resetBtn = document.getElementById('forms-reset-btn');
    const exportBtn = document.getElementById('forms-export-btn');

    if (btn) btn.onclick = () => { input.value = ''; input.click(); };
    if (input) input.onchange = () => { if (input.files[0]) loadFile(input.files[0]); };
    if (dropZone) UI.setupDropZone(dropZone, f => { if (f[0]) loadFile(f[0]); }, ['.pdf']);
    if (saveBtn) saveBtn.onclick = saveFilled;
    if (resetBtn) resetBtn.onclick = resetFields;
    if (exportBtn) exportBtn.onclick = exportData;
    _autoLoad();
  }

  async function loadFile(file) {
    window.PDFState?.set(file);
    if (!window.pdfjsLib) {
      document.getElementById('forms-viewer').innerHTML =
        '<div class="empty-list-state">PDF.js requis. Voir libs/README.md</div>';
      return;
    }
    currentFile = file;
    fieldValues = {};
    formFields = [];
    UI.showLoading('forms-viewer', 'Chargement du formulaire...');

    try {
      const ab = await file.arrayBuffer();
      pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
      await detectFields();
      await renderPages();
      const panel = document.getElementById('forms-panel');
      if (panel) panel.style.display = 'flex';
      Storage.addRecentFile({ id: UI.uid(), name: file.name, size: file.size, pages: pdfDoc.numPages, tool: 'forms' });
    } catch (err) {
      UI.error('Erreur: ' + err.message);
    } finally {
      UI.removeLoading('forms-viewer');
    }
  }

  async function detectFields() {
    formFields = [];
    // Try PDF.js annotation-based field detection
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const annotations = await page.getAnnotations();
      annotations.forEach(ann => {
        if (ann.subtype === 'Widget' && ann.fieldName) {
          const existing = formFields.find(f => f.name === ann.fieldName);
          if (!existing) {
            formFields.push({
              name: ann.fieldName,
              type: ann.fieldType || (ann.checkBox ? 'checkbox' : 'text'),
              page: i,
              rect: ann.rect,
              value: ann.fieldValue || '',
              options: ann.options || []
            });
            fieldValues[ann.fieldName] = ann.fieldValue || '';
          }
        }
      });
    }
    renderFieldList();
  }

  function renderFieldList() {
    const list = document.getElementById('forms-fields-list');
    if (!list) return;
    if (!formFields.length) {
      list.innerHTML = '<div class="empty-state" style="padding:10px;font-size:12px;color:var(--text-muted)">Aucun champ de formulaire détecté.</div>';
      return;
    }
    list.innerHTML = formFields.map(f => {
      let inputHtml = '';
      if (f.type === 'Tx' || f.type === 'text') {
        inputHtml = `<input type="text" class="form-input form-field-input" data-name="${escHtml(f.name)}" value="${escHtml(f.value)}" placeholder="${escHtml(f.name)}" />`;
      } else if (f.type === 'Btn' || f.type === 'checkbox') {
        inputHtml = `<input type="checkbox" class="form-field-input" data-name="${escHtml(f.name)}" ${f.value ? 'checked' : ''} />`;
      } else if (f.type === 'Ch' || f.type === 'select') {
        const opts = (f.options || []).map(o => `<option value="${escHtml(o.exportValue||o)}">${escHtml(o.displayValue||o)}</option>`).join('');
        inputHtml = `<select class="form-select form-field-input" data-name="${escHtml(f.name)}">${opts}</select>`;
      } else {
        inputHtml = `<input type="text" class="form-input form-field-input" data-name="${escHtml(f.name)}" value="${escHtml(f.value)}" />`;
      }
      return `
        <div class="form-field-item">
          <div class="form-field-label">${escHtml(f.name)} <span style="opacity:0.5">(p.${f.page})</span></div>
          ${inputHtml}
        </div>
      `;
    }).join('');

    list.querySelectorAll('.form-field-input').forEach(inp => {
      inp.addEventListener('change', () => {
        const name = inp.dataset.name;
        fieldValues[name] = inp.type === 'checkbox' ? inp.checked : inp.value;
      });
      inp.addEventListener('input', () => {
        const name = inp.dataset.name;
        fieldValues[name] = inp.value;
      });
    });
  }

  async function renderPages() {
    const viewer = document.getElementById('forms-viewer');
    viewer.innerHTML = '';
    for (let i = 1; i <= Math.min(pdfDoc.numPages, 5); i++) {
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale });
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:relative;display:block;margin-bottom:16px;width:fit-content;';
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.boxShadow = 'var(--shadow-md)';
      wrapper.appendChild(canvas);
      viewer.appendChild(wrapper);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }
    if (pdfDoc.numPages > 5) {
      const info = document.createElement('div');
      info.className = 'empty-state';
      info.textContent = `Aperçu limité aux 5 premières pages (${pdfDoc.numPages} pages au total)`;
      viewer.appendChild(info);
    }
  }

  async function saveFilled() {
    if (!currentFile || !window.PDFLib) {
      if (!window.PDFLib) UI.error('pdf-lib requis. Voir libs/README.md');
      return;
    }
    try {
      const { PDFDocument } = PDFLib;
      const ab = await currentFile.arrayBuffer();
      const pdfLibDoc = await PDFDocument.load(ab, { ignoreEncryption: true });
      const form = pdfLibDoc.getForm();

      for (const [name, value] of Object.entries(fieldValues)) {
        try {
          const field = form.getField(name);
          if (!field) continue;
          const fieldType = field.constructor.name;
          if (fieldType === 'PDFTextField') field.setText(String(value));
          else if (fieldType === 'PDFCheckBox') { if (value) field.check(); else field.uncheck(); }
          else if (fieldType === 'PDFDropdown') field.select(String(value));
          else if (fieldType === 'PDFRadioGroup') field.select(String(value));
        } catch (e) { /* field might not support this operation */ }
      }

      const bytes = await pdfLibDoc.save();
      const blob = new Blob([bytes], { type: 'application/pdf' });
      UI.downloadBlob(blob, currentFile.name.replace('.pdf', '_rempli.pdf'));
      UI.success('Formulaire sauvegardé !');
      Storage.addHistory({ op: 'forms', input: currentFile.name, status: 'success' });
      Storage.incrementStat('totalProcessed');
    } catch (err) {
      UI.error('Erreur: ' + err.message);
    }
  }

  function resetFields() {
    fieldValues = {};
    formFields.forEach(f => { f.value = ''; });
    renderFieldList();
  }

  function exportData() {
    const data = JSON.stringify(fieldValues, null, 2);
    const name = (currentFile?.name || 'formulaire').replace('.pdf', '') + '_donnees.json';
    UI.downloadText(data, name, 'application/json');
    UI.success('Données exportées en JSON');
  }

  function escHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function _autoLoad() {
    const f = window.PDFState?.get();
    if (!currentFile && f) loadFile(f);
  }

  function activate() { _autoLoad(); }

  return { init, loadFile, activate };
})();

window.FormsModule = FormsModule;
window.Module_forms = FormsModule;
document.addEventListener('DOMContentLoaded', FormsModule.init);
// Module initialized
