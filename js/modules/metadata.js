/* ============================================================
   METADATA MODULE — read and edit PDF metadata
   ============================================================ */
'use strict';

const MetadataModule = (() => {

  // ---- State ----
  const state = {
    file: null,
    arrayBuffer: null,
    pdfMeta: null,  // raw metadata from PDF.js
    pdfInfo: null,  // info dict from PDF.js
    numPages: 0,
    initialized: false
  };

  // ---- Helpers ----
  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatDate(raw) {
    if (!raw) return '';
    // PDF dates: D:YYYYMMDDHHmmSSOHH'mm'
    const m = String(raw).match(/D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
    if (m) {
      const dt = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
      return dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
             ' ' + dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }
    // Try direct Date parse
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
             ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }
    return String(raw);
  }

  function parseDateToInput(raw) {
    if (!raw) return '';
    const m = String(raw).match(/D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    return '';
  }

  // ================================================================
  // LOAD PDF
  // ================================================================
  async function loadFile(file) {
    if (!file) return;
    window.PDFState?.set(file);
    state.file = file;

    const editor = document.getElementById('metadata-editor');
    if (editor) editor.innerHTML = '<div class="empty-list-state">Chargement...</div>';

    const saveBtn = document.getElementById('metadata-save-btn');
    if (saveBtn) saveBtn.disabled = true;

    try {
      state.arrayBuffer = await file.arrayBuffer();

      // Use PDF.js to read metadata and info
      let meta = {};
      let info = {};
      let numPages = 0;
      let encrypted = false;
      let pdfVersion = '';

      if (window.pdfjsLib) {
        const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(state.arrayBuffer) }).promise;
        numPages = pdf.numPages;

        try {
          const mdata = await pdf.getMetadata();
          meta = mdata.metadata ? (mdata.metadata._metadataMap || mdata.metadata) : {};
          info = mdata.info || {};

          // Some PDF.js versions expose metadata differently
          if (mdata.metadata && typeof mdata.metadata.get === 'function') {
            const keys = ['dc:title','dc:creator','dc:description','dc:subject','xmp:createdate','xmp:modifydate','pdf:producer','xmp:creatortool'];
            const xmpMap = {};
            keys.forEach(k => {
              try { const v = mdata.metadata.get(k); if (v) xmpMap[k] = v; } catch (_) {}
            });
            meta = xmpMap;
          }
        } catch (e) {
          console.warn('getMetadata error:', e);
        }

        // Determine encryption
        try { encrypted = pdf._pdfInfo ? !!pdf._pdfInfo.encrypted : false; } catch (_) {}

        // Try to get PDF version from info
        pdfVersion = info.PDFFormatVersion || '';
      } else {
        // Fallback: use pdf-lib to count pages
        if (window.PDFLib) {
          const { PDFDocument } = window.PDFLib;
          const pdfDoc = await PDFDocument.load(state.arrayBuffer, { ignoreEncryption: true });
          numPages = pdfDoc.getPageCount();

          // Read metadata from pdf-lib
          info = {
            Title:    pdfDoc.getTitle()    || '',
            Author:   pdfDoc.getAuthor()   || '',
            Subject:  pdfDoc.getSubject()  || '',
            Keywords: (pdfDoc.getKeywords() || []).join(', '),
            Creator:  pdfDoc.getCreator()  || '',
            Producer: pdfDoc.getProducer() || '',
            CreationDate:     pdfDoc.getCreationDate()     ? pdfDoc.getCreationDate().toString() : '',
            ModificationDate: pdfDoc.getModificationDate() ? pdfDoc.getModificationDate().toString() : ''
          };
        }
      }

      state.pdfMeta = meta;
      state.pdfInfo = info;
      state.numPages = numPages;

      renderEditor(info, meta, numPages, file, encrypted, pdfVersion);

      if (saveBtn) saveBtn.disabled = false;
    } catch (err) {
      console.error('Metadata load error:', err);
      UI.error('Erreur lors du chargement : ' + err.message);
      if (editor) editor.innerHTML = '<div class="empty-list-state">Erreur de chargement</div>';
    }
  }

  // ================================================================
  // RENDER EDITOR
  // ================================================================
  function renderEditor(info, meta, numPages, file, encrypted, pdfVersion) {
    const editor = document.getElementById('metadata-editor');
    if (!editor) return;

    // Resolve field values: prefer info dict, fall back to XMP meta
    function resolve(infoKey, xmpKey) {
      const val = info[infoKey];
      if (val && String(val).trim()) return String(val).trim();
      if (xmpKey) {
        const x = meta[xmpKey] || meta[xmpKey.toLowerCase()];
        if (x && String(x).trim()) return String(x).trim();
      }
      return '';
    }

    const title    = resolve('Title',    'dc:title');
    const author   = resolve('Author',   'dc:creator');
    const subject  = resolve('Subject',  'dc:description');
    const keywords = resolve('Keywords', 'dc:subject');
    const creator  = resolve('Creator',  'xmp:creatortool');
    const producer = resolve('Producer', 'pdf:producer');
    const created  = resolve('CreationDate',     'xmp:createdate');
    const modified = resolve('ModificationDate', 'xmp:modifydate');

    const createdInput  = parseDateToInput(created);
    const modifiedInput = parseDateToInput(modified);

    editor.innerHTML = `
      <div class="metadata-container" style="padding:20px;max-width:800px;">

        <div class="metadata-section" style="margin-bottom:24px;">
          <h3 style="margin:0 0 12px;font-size:14px;color:var(--text-muted,#888);text-transform:uppercase;letter-spacing:.05em;">
            Informations du fichier
          </h3>
          <table class="metadata-info-table" style="width:100%;border-collapse:collapse;font-size:13px;">
            <tr>
              <td style="padding:6px 12px 6px 0;color:var(--text-muted,#888);white-space:nowrap;width:180px;">Nom du fichier</td>
              <td style="padding:6px 0;">${escapeHtml(file.name)}</td>
            </tr>
            <tr>
              <td style="padding:6px 12px 6px 0;color:var(--text-muted,#888);">Taille</td>
              <td style="padding:6px 0;">${UI.formatSize(file.size)}</td>
            </tr>
            <tr>
              <td style="padding:6px 12px 6px 0;color:var(--text-muted,#888);">Nombre de pages</td>
              <td style="padding:6px 0;">${numPages || '?'}</td>
            </tr>
            ${pdfVersion ? `<tr>
              <td style="padding:6px 12px 6px 0;color:var(--text-muted,#888);">Version PDF</td>
              <td style="padding:6px 0;">PDF ${escapeHtml(pdfVersion)}</td>
            </tr>` : ''}
            <tr>
              <td style="padding:6px 12px 6px 0;color:var(--text-muted,#888);">Chiffrement</td>
              <td style="padding:6px 0;">${encrypted ? '<span style="color:#e88">Oui</span>' : 'Non'}</td>
            </tr>
          </table>
        </div>

        <div class="metadata-section">
          <h3 style="margin:0 0 16px;font-size:14px;color:var(--text-muted,#888);text-transform:uppercase;letter-spacing:.05em;">
            Métadonnées modifiables
          </h3>
          <form id="metadata-form" autocomplete="off">
            ${metaField('meta-title',    'Titre',             title,    'text',             'Titre du document')}
            ${metaField('meta-author',   'Auteur',            author,   'text',             'Nom de l\'auteur')}
            ${metaField('meta-subject',  'Sujet',             subject,  'text',             'Sujet du document')}
            ${metaField('meta-keywords', 'Mots-clés',         keywords, 'text',             'Mots-clés séparés par des virgules')}
            ${metaField('meta-creator',  'Créateur',          creator,  'text',             'Application de création')}
            ${metaField('meta-producer', 'Producteur',        producer, 'text',             'Producteur PDF')}
            ${metaField('meta-created',  'Date de création',  createdInput,  'datetime-local', '')}
            ${metaField('meta-modified', 'Date de modification', modifiedInput, 'datetime-local', '')}
          </form>
        </div>

      </div>
    `;
  }

  function metaField(id, label, value, type, placeholder) {
    return `
      <div style="display:grid;grid-template-columns:180px 1fr;gap:8px;align-items:center;margin-bottom:10px;">
        <label for="${id}" style="font-size:13px;color:var(--text-secondary,#ccc);text-align:right;padding-right:12px;">
          ${escapeHtml(label)}
        </label>
        <input
          type="${type}"
          id="${id}"
          class="form-input"
          value="${escapeHtml(value)}"
          placeholder="${escapeHtml(placeholder)}"
          style="font-size:13px;"
        />
      </div>
    `;
  }

  // ---- Read current form values ----
  function readFormValues() {
    function val(id) {
      const el = document.getElementById(id);
      return el ? el.value.trim() : '';
    }
    return {
      title:    val('meta-title'),
      author:   val('meta-author'),
      subject:  val('meta-subject'),
      keywords: val('meta-keywords'),
      creator:  val('meta-creator'),
      producer: val('meta-producer'),
      created:  val('meta-created'),
      modified: val('meta-modified')
    };
  }

  // ================================================================
  // SAVE METADATA
  // ================================================================
  async function saveMetadata() {
    if (!state.arrayBuffer) {
      UI.warning('Chargez d\'abord un fichier PDF.');
      return;
    }
    if (!window.PDFLib) {
      UI.error('pdf-lib non disponible — impossible de modifier les métadonnées', 'Bibliothèque manquante');
      return;
    }

    const saveBtn = document.getElementById('metadata-save-btn');
    if (saveBtn) saveBtn.disabled = true;

    try {
      const { PDFDocument } = window.PDFLib;
      const values = readFormValues();

      const pdfDoc = await PDFDocument.load(state.arrayBuffer, { ignoreEncryption: true });

      if (values.title)    pdfDoc.setTitle(values.title);
      if (values.author)   pdfDoc.setAuthor(values.author);
      if (values.subject)  pdfDoc.setSubject(values.subject);
      if (values.keywords) {
        // pdf-lib setKeywords accepts an array
        const kwArray = values.keywords.split(/[,;]/).map(s => s.trim()).filter(Boolean);
        pdfDoc.setKeywords(kwArray);
      }
      if (values.creator)  pdfDoc.setCreator(values.creator);
      if (values.producer) pdfDoc.setProducer(values.producer);

      if (values.created) {
        try { pdfDoc.setCreationDate(new Date(values.created)); } catch (_) {}
      }
      if (values.modified) {
        try { pdfDoc.setModificationDate(new Date(values.modified)); } catch (_) {}
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const outName = state.file.name.replace(/\.pdf$/i, '') + '_métadonnées.pdf';

      UI.downloadBlob(blob, outName);

      Storage.addHistory({
        op: 'metadata',
        input: state.file.name,
        output: outName,
        size_before: state.arrayBuffer.byteLength,
        size_after: pdfBytes.byteLength,
        status: 'success'
      });
      Storage.incrementStat('totalProcessed');

      UI.success('Métadonnées sauvegardées et téléchargées', 'Métadonnées');

    } catch (err) {
      console.error('Metadata save error:', err);
      UI.error('Erreur lors de la sauvegarde : ' + err.message);
      Storage.addHistory({ op: 'metadata', input: state.file ? state.file.name : '', status: 'error' });
    } finally {
      const saveBtn = document.getElementById('metadata-save-btn');
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  // ================================================================
  // INIT
  // ================================================================
  function init() {
    if (state.initialized) return;
    state.initialized = true;

    // File input
    const fileInput = document.getElementById('metadata-file-input');
    const addBtn = document.getElementById('metadata-add-btn');
    if (addBtn && fileInput) {
      addBtn.addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
      fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) loadFile(fileInput.files[0]);
      });
    }

    // Drop zone
    const dropZone = document.getElementById('metadata-drop-zone');
    if (dropZone) {
      UI.setupDropZone(dropZone, (files) => {
        const pdf = Array.from(files).find(f =>
          f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
        );
        if (pdf) loadFile(pdf);
        else UI.warning('Veuillez déposer un fichier PDF.');
      }, ['.pdf']);
    }

    // Save button
    const saveBtn = document.getElementById('metadata-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', saveMetadata);

    _autoLoad();
    console.log('[MetadataModule] initialized');
  }

  function _autoLoad() {
    const f = window.PDFState?.get();
    if (!state.file && f) loadFile(f);
  }

  function activate() { _autoLoad(); }

  return { init, loadFile, activate };
})();

window.MetadataModule = MetadataModule;
window.Module_metadata = MetadataModule;
