/* ============================================================
   BOOKMARKS MODULE — read, edit, add, delete, reorder and
   save PDF outline/bookmarks
   ============================================================ */
'use strict';

const BookmarksModule = (() => {

  // ---- State ----
  const state = {
    file: null,
    arrayBuffer: null,
    pdfJsDoc: null,
    pageCount: 0,
    outline: [],        // flat tree of { title, dest, pageNum, level, children, id }
    nextId: 1,
    initialized: false
  };

  function qs(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function uid() {
    return 'bm_' + (state.nextId++);
  }

  // ---- Load and parse outline ----
  async function loadFile(file) {
    if (!file) return;
    window.PDFState?.set(file);
    state.file = file;
    const editor = qs('bookmarks-editor');
    UI.showLoading('bookmarks-editor', 'Chargement...');

    try {
      const ab = await file.arrayBuffer();
      state.arrayBuffer = ab;
      if (!window.pdfjsLib) throw new Error('PDF.js non disponible');

      state.pdfJsDoc = await window.pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
      state.pageCount = state.pdfJsDoc.numPages;

      let rawOutline = null;
      try { rawOutline = await state.pdfJsDoc.getOutline(); } catch(e) { rawOutline = null; }

      state.outline = rawOutline ? parseOutline(rawOutline, 0) : [];

      const actions = qs('bookmarks-actions');
      if (actions) actions.style.display = '';

      renderTree();
    } catch(e) {
      UI.error('Impossible de charger le PDF: ' + e.message);
      if (editor) editor.innerHTML = '<div class="empty-list-state">Erreur de chargement</div>';
    }
  }

  function parseOutline(items, level) {
    if (!items) return [];
    return items.map(item => ({
      id: uid(),
      title: item.title || 'Sans titre',
      dest: item.dest,
      url: item.url,
      newWindow: item.newWindow,
      pageNum: null,   // resolved lazily
      level,
      expanded: level < 2,
      children: parseOutline(item.items, level + 1)
    }));
  }

  // ---- Resolve page number from dest ----
  async function resolvePageNum(item) {
    if (!state.pdfJsDoc || !item.dest) return null;
    try {
      let dest = item.dest;
      if (typeof dest === 'string') {
        dest = await state.pdfJsDoc.getDestination(dest);
      }
      if (!dest || !dest[0]) return null;
      const ref = dest[0];
      const idx = await state.pdfJsDoc.getPageIndex(ref);
      return idx + 1;
    } catch(e) {
      return null;
    }
  }

  // ---- Render the bookmark tree ----
  function renderTree() {
    const editor = qs('bookmarks-editor');
    if (!editor) return;

    if (!state.outline.length) {
      editor.innerHTML = '<div class="empty-list-state">Aucun signet trouvé dans ce PDF.<br>Utilisez le bouton "Ajouter un signet" pour en créer.</div>';
      return;
    }

    editor.innerHTML = '';
    const ul = buildTreeUL(state.outline);
    editor.appendChild(ul);

    // Resolve page numbers asynchronously
    resolveAllPageNums(state.outline);
  }

  function buildTreeUL(items, level = 0) {
    const ul = document.createElement('ul');
    ul.className = `bm-tree-level-${level}`;
    ul.style.cssText = `list-style:none;padding-left:${level * 18}px;margin:0`;

    items.forEach(item => {
      const li = buildTreeItem(item, level);
      ul.appendChild(li);
    });
    return ul;
  }

  function buildTreeItem(item, level) {
    const li = document.createElement('li');
    li.className = 'bm-item';
    li.dataset.id = item.id;
    li.setAttribute('draggable', 'true');
    li.style.cssText = 'padding:4px 0;border-bottom:1px solid var(--border-color,#333);user-select:none';

    const hasChildren = item.children && item.children.length > 0;

    li.innerHTML = `
      <div class="bm-item-row" style="display:flex;align-items:center;gap:6px;cursor:pointer">
        <span class="bm-expand-btn" style="display:inline-block;width:16px;text-align:center;cursor:pointer;font-size:10px">
          ${hasChildren ? (item.expanded ? '▼' : '▶') : '·'}
        </span>
        <span class="drag-handle" title="Déplacer" style="cursor:grab;opacity:.5">⠿</span>
        <span class="bm-icon" style="opacity:.7">🔖</span>
        <span class="bm-title" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
        <span class="bm-page" style="font-size:11px;opacity:.6;white-space:nowrap" data-id="${item.id}">${item.pageNum ? 'p.' + item.pageNum : '…'}</span>
        <button class="btn btn-ghost btn-xs bm-rename-btn" data-id="${item.id}" title="Renommer">✎</button>
        <button class="btn btn-ghost btn-xs bm-delete-btn" data-id="${item.id}" title="Supprimer" style="color:var(--color-error,#e55)">✕</button>
      </div>
    `;

    // Children container
    if (hasChildren) {
      const childContainer = document.createElement('div');
      childContainer.className = 'bm-children';
      childContainer.style.display = item.expanded ? '' : 'none';
      childContainer.appendChild(buildTreeUL(item.children, level + 1));
      li.appendChild(childContainer);

      // Expand/collapse toggle
      li.querySelector('.bm-expand-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        item.expanded = !item.expanded;
        childContainer.style.display = item.expanded ? '' : 'none';
        li.querySelector('.bm-expand-btn').textContent = item.expanded ? '▼' : '▶';
      });
    }

    // Rename inline
    li.querySelector('.bm-rename-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const titleEl = li.querySelector('.bm-title');
      const newTitle = await UI.prompt('Nouveau titre :', item.title, 'Renommer le signet');
      if (newTitle !== null && newTitle.trim()) {
        item.title = newTitle.trim();
        titleEl.textContent = item.title;
        titleEl.title = item.title;
      }
    });

    // Delete
    li.querySelector('.bm-delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await UI.confirm(`Supprimer le signet "${item.title}" ?`);
      if (!ok) return;
      removeById(state.outline, item.id);
      renderTree();
    });

    // Title click → inline edit
    const titleEl = li.querySelector('.bm-title');
    titleEl.addEventListener('dblclick', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = item.title;
      input.className = 'form-input';
      input.style.cssText = 'flex:1;font-size:13px;padding:2px 6px';
      titleEl.replaceWith(input);
      input.focus();
      input.select();
      const commit = () => {
        item.title = input.value.trim() || item.title;
        input.replaceWith(titleEl);
        titleEl.textContent = item.title;
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { input.value = item.title; commit(); } });
    });

    // Drag to reorder
    attachDragHandlers(li, item);

    return li;
  }

  // ---- Drag-to-reorder ----
  let _dragItem = null;
  let _dragId = null;

  function attachDragHandlers(li, item) {
    li.addEventListener('dragstart', (e) => {
      _dragItem = li;
      _dragId = item.id;
      e.dataTransfer.effectAllowed = 'move';
      li.style.opacity = '0.4';
    });
    li.addEventListener('dragend', () => { li.style.opacity = ''; _dragItem = null; });
    li.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      if (_dragItem === li || _dragId === item.id) return;
      // Move _dragId before this item in the flat outline
      const moved = removeById(state.outline, _dragId);
      if (moved) {
        insertBefore(state.outline, item.id, moved);
        renderTree();
      }
    });
  }

  function removeById(items, id) {
    for (let i = 0; i < items.length; i++) {
      if (items[i].id === id) {
        return items.splice(i, 1)[0];
      }
      const found = removeById(items[i].children, id);
      if (found) return found;
    }
    return null;
  }

  function insertBefore(items, targetId, newItem) {
    for (let i = 0; i < items.length; i++) {
      if (items[i].id === targetId) {
        items.splice(i, 0, newItem);
        return true;
      }
      if (insertBefore(items[i].children, targetId, newItem)) return true;
    }
    return false;
  }

  // ---- Resolve page numbers async and update DOM labels ----
  async function resolveAllPageNums(items) {
    for (const item of items) {
      if (item.pageNum === null) {
        const n = await resolvePageNum(item);
        if (n !== null) {
          item.pageNum = n;
          const el = document.querySelector(`.bm-page[data-id="${item.id}"]`);
          if (el) el.textContent = 'p.' + n;
        }
      }
      if (item.children.length) await resolveAllPageNums(item.children);
    }
  }

  // ---- Add bookmark ----
  async function addBookmark() {
    const title = await UI.prompt('Titre du signet :', '', 'Ajouter un signet');
    if (!title || !title.trim()) return;
    const pageStr = await UI.prompt(`Numéro de page (1–${state.pageCount}) :`, '1', 'Page cible');
    const pageNum = parseInt(pageStr);
    if (!pageNum || pageNum < 1 || pageNum > state.pageCount) {
      UI.warning('Numéro de page invalide.');
      return;
    }
    state.outline.push({
      id: uid(),
      title: title.trim(),
      dest: null,
      pageNum,
      level: 0,
      expanded: false,
      children: []
    });
    renderTree();
  }

  // ---- Serialize outline to pdf-lib PDFContext ----
  function flattenOutline(items, pdfDoc, pdfLibPages) {
    // Build a simple array of { title, pageIndex } for serialization
    const result = [];
    function walk(nodes, depth) {
      nodes.forEach(node => {
        result.push({ title: node.title, pageIndex: (node.pageNum ? node.pageNum - 1 : 0), depth });
        if (node.children.length) walk(node.children, depth + 1);
      });
    }
    walk(items, 0);
    return result;
  }

  // ---- Save PDF with updated bookmarks ----
  async function saveBookmarks() {
    if (!state.arrayBuffer) { UI.warning('Chargez un PDF d\'abord.'); return; }
    if (!window.PDFLib) { UI.error('pdf-lib non disponible.'); return; }

    UI.info('Enregistrement des signets...', 'Signets');
    const saveBtn = qs('bm-save-btn');
    if (saveBtn) saveBtn.disabled = true;

    try {
      const { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFRef, PDFHexString } = window.PDFLib;
      const pdfDoc = await PDFDocument.load(state.arrayBuffer);
      const pdfPages = pdfDoc.getPages();
      const context = pdfDoc.context;

      const entries = flattenOutline(state.outline, pdfDoc, pdfPages);

      if (!entries.length) {
        // Remove outline if empty
        const catalog = pdfDoc.catalog;
        catalog.delete(PDFName.of('Outlines'));
      } else {
        // Build outline items
        const itemRefs = entries.map((entry, idx) => {
          const pageIndex = Math.min(entry.pageIndex, pdfPages.length - 1);
          const page = pdfPages[pageIndex];
          const pageRef = pdfDoc.getPage(pageIndex).ref;

          const dest = context.obj([pageRef, PDFName.of('XYZ'), context.obj(null), context.obj(null), context.obj(null)]);

          const itemDict = context.obj({
            Title: PDFHexString.fromText(entry.title),
            Dest: dest
          });
          return context.register(itemDict);
        });

        // Link items as doubly-linked list
        for (let i = 0; i < itemRefs.length; i++) {
          const itemDict = context.lookup(itemRefs[i]);
          if (i > 0)                       itemDict.set(PDFName.of('Prev'), itemRefs[i - 1]);
          if (i < itemRefs.length - 1)     itemDict.set(PDFName.of('Next'), itemRefs[i + 1]);
        }

        // Outline root
        const outlineDict = context.obj({
          Type: PDFName.of('Outlines'),
          First: itemRefs[0],
          Last: itemRefs[itemRefs.length - 1],
          Count: context.obj(itemRefs.length)
        });
        const outlineRef = context.register(outlineDict);
        pdfDoc.catalog.set(PDFName.of('Outlines'), outlineRef);

        // Set parent
        itemRefs.forEach(ref => {
          const d = context.lookup(ref);
          d.set(PDFName.of('Parent'), outlineRef);
        });
      }

      const pdfBytes = await pdfDoc.save();
      const outName = state.file.name.replace(/\.pdf$/i, '') + '_signets.pdf';
      UI.downloadBlob(new Blob([pdfBytes], { type: 'application/pdf' }), outName);

      Storage.incrementStat('totalProcessed');
      Storage.addRecentFile({ id: UI.uid(), name: outName, size: pdfBytes.byteLength, pages: state.pageCount, tool: 'bookmarks', date: Date.now() });
      Storage.addHistory({ op: 'bookmarks', input: state.file.name, status: 'success' });
      UI.success('Signets sauvegardés avec succès !', 'Signets');
    } catch(e) {
      UI.error('Erreur lors de la sauvegarde: ' + e.message);
      Storage.addHistory({ op: 'bookmarks', input: state.file?.name || '', status: 'error' });
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  // ---- Init ----
  function init() {
    if (state.initialized) return;
    state.initialized = true;

    const addBtn   = qs('bookmarks-add-btn');
    const fileInput = qs('bookmarks-file-input');
    const dropZone  = qs('bookmarks-drop-zone');
    const bmAddBtn = qs('bm-add-btn');
    const bmSaveBtn = qs('bm-save-btn');

    if (addBtn && fileInput) {
      addBtn.addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
      fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); });
    }
    if (dropZone) UI.setupDropZone(dropZone, files => { if (files[0]) loadFile(files[0]); }, ['.pdf']);
    if (bmAddBtn) bmAddBtn.addEventListener('click', addBookmark);
    if (bmSaveBtn) bmSaveBtn.addEventListener('click', saveBookmarks);

    _autoLoad();
    console.log('[BookmarksModule] initialized');
  }

  function _autoLoad() {
    const f = window.PDFState?.get();
    if (!state.file && f) loadFile(f);
  }

  function activate() { _autoLoad(); }

  return { init, loadFile, activate };
})();

window.BookmarksModule = BookmarksModule;
window.Module_bookmarks = BookmarksModule;
