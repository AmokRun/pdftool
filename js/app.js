/* ============================================================
   PDF STATE — shared PDF file across all tools
   ============================================================ */
window.PDFState = (() => {
  let _file = null;

  function set(file) {
    _file = file;
    const pill = document.getElementById('current-pdf-pill');
    const name = document.getElementById('current-pdf-name');
    if (!pill) return;
    if (file) {
      if (name) name.textContent = file.name;
      pill.classList.remove('hidden');
    } else {
      pill.classList.add('hidden');
    }
  }

  function get() { return _file; }
  function clear() { set(null); }

  return { set, get, clear };
})();

/* ============================================================
   APP — main entry point, dashboard, global handlers
   ============================================================ */
'use strict';

const App = (() => {

  // ---- Tool registry ----
  const TOOLS = [
    { id: 'merge',      name: 'Fusionner',     emoji: '⊕', desc: 'Combiner plusieurs PDF' },
    { id: 'split',      name: 'Diviser',        emoji: '⊘', desc: 'Séparer les pages' },
    { id: 'compress',   name: 'Compresser',     emoji: '◈', desc: 'Réduire la taille' },
    { id: 'convert',    name: 'Convertir',      emoji: '⇄', desc: 'Changer de format' },
    { id: 'ocr',        name: 'OCR',            emoji: '◉', desc: 'Extraire le texte' },
    { id: 'edit',       name: 'Éditer',         emoji: '✎', desc: 'Modifier le contenu' },
    { id: 'annotate',   name: 'Annoter',        emoji: '✍', desc: 'Commentaires, surlignage' },
    { id: 'signature',  name: 'Signature',      emoji: '✒', desc: 'Signer électroniquement' },
    { id: 'watermark',  name: 'Filigrane',      emoji: '◫', desc: 'Ajouter un filigrane' },
    { id: 'reorder',    name: 'Réorganiser',    emoji: '⇅', desc: 'Déplacer les pages' },
    { id: 'pagenumber', name: 'Numéros',        emoji: '⊞', desc: 'Numéroter les pages' },
    { id: 'compare',    name: 'Comparer',       emoji: '⊟', desc: 'Comparer deux PDF' },
    { id: 'metadata',   name: 'Métadonnées',    emoji: 'ℹ', desc: 'Titre, auteur, etc.' },
    { id: 'bookmarks',  name: 'Signets',        emoji: '⊏', desc: 'Gérer les signets' },
    { id: 'forms',      name: 'Formulaires',    emoji: '⊡', desc: 'Remplir un formulaire' },
    { id: 'ai',         name: 'IA Locale',      emoji: '⬡', desc: 'Chat & résumé IA' }
  ];

  // ---- Dashboard: quick tools ----
  function renderQuickTools() {
    const container = document.getElementById('quick-tools');
    if (!container) return;
    const favorites = Storage.getFavorites();
    const shown = TOOLS.filter(t => favorites.includes(t.id)).slice(0, 8);
    const remaining = TOOLS.filter(t => !favorites.includes(t.id));
    const display = [...shown, ...remaining].slice(0, 12);

    container.innerHTML = display.map(t => `
      <button class="quick-tool-btn" data-route="${t.id}" title="${t.desc}">
        <span class="tool-emoji">${t.emoji}</span>
        <span>${t.name}</span>
      </button>
    `).join('');

    container.querySelectorAll('.quick-tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const route = btn.dataset.route;
        window.location.hash = route;
        Router.navigate(route);
      });
    });
  }

  // ---- Dashboard: recent files ----
  function renderRecentFiles() {
    const container = document.getElementById('recent-files-list');
    if (!container) return;
    const files = Storage.getRecentFiles();
    if (!files.length) {
      container.innerHTML = '<div class="empty-state">Aucun fichier récent</div>';
      return;
    }
    container.innerHTML = files.slice(0, 8).map(f => `
      <div class="recent-file-item" data-id="${f.id}" title="${f.name}">
        <span class="rfi-icon">📄</span>
        <div class="rfi-info">
          <div class="rfi-name">${escapeHtml(f.name)}</div>
          <div class="rfi-meta">${UI.formatSize(f.size || 0)} · ${f.pages || '?'} page(s) · ${UI.timeAgo(f.date)}</div>
        </div>
        <div class="rfi-actions">
          <button class="btn btn-ghost btn-xs rfi-use-btn" data-id="${f.id}" data-tool="${f.tool || 'edit'}">Ouvrir</button>
          <button class="btn btn-ghost btn-xs rfi-del-btn" data-id="${f.id}">✕</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.rfi-use-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        Router.navigate(btn.dataset.tool);
      });
    });
    container.querySelectorAll('.rfi-del-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        Storage.removeRecentFile(btn.dataset.id);
        renderRecentFiles();
      });
    });
    container.querySelectorAll('.recent-file-item').forEach(item => {
      item.addEventListener('click', () => Router.navigate('edit'));
    });
  }

  // ---- Dashboard: stats ----
  function renderStats() {
    const container = document.getElementById('stats-grid');
    if (!container) return;
    const stats = Storage.getStats();
    const items = [
      { value: stats.totalProcessed || 0, label: 'PDF traités' },
      { value: UI.formatSize(stats.totalBytesSaved || 0), label: 'Espace économisé' },
      { value: stats.merges || 0, label: 'Fusions' },
      { value: stats.splits || 0, label: 'Divisions' },
      { value: stats.compressions || 0, label: 'Compressions' },
      { value: stats.conversions || 0, label: 'Conversions' }
    ];
    container.innerHTML = items.map(s => `
      <div class="stat-card">
        <div class="stat-value">${s.value}</div>
        <div class="stat-label">${s.label}</div>
      </div>
    `).join('');
  }

  // ---- Dashboard: operations history ----
  function renderHistory() {
    const container = document.getElementById('operations-history');
    if (!container) return;
    const history = Storage.getHistory();
    if (!history.length) {
      container.innerHTML = '<div class="empty-state">Aucune opération récente</div>';
      return;
    }
    container.innerHTML = history.slice(0, 10).map(op => `
      <div class="operation-item">
        <span class="op-icon">${getOpIcon(op.op)}</span>
        <div class="op-info">
          <div class="op-name">${escapeHtml(op.op)} — ${escapeHtml(op.input || '')}</div>
          <div class="op-time">${UI.timeAgo(op.date)}</div>
        </div>
        <span class="op-status-${op.status === 'success' ? 'success' : 'error'}">
          ${op.status === 'success' ? '✓' : '✕'}
        </span>
      </div>
    `).join('');
  }

  function getOpIcon(op) {
    const icons = {
      merge: '⊕', split: '⊘', compress: '◈', convert: '⇄',
      ocr: '◉', edit: '✎', signature: '✒', watermark: '◫',
      compare: '⊟', metadata: 'ℹ', bookmarks: '⊏', forms: '⊡', ai: '⬡'
    };
    return icons[op] || '📄';
  }

  // ---- Search ----
  function initSearch() {
    const input = document.getElementById('global-search');
    const dropdown = document.getElementById('search-results');
    if (!input || !dropdown) return;

    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { dropdown.classList.add('hidden'); return; }
      const results = TOOLS.filter(t =>
        t.name.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q)
      );
      if (!results.length) { dropdown.classList.add('hidden'); return; }
      dropdown.innerHTML = results.map(t => `
        <div class="search-result-item" data-route="${t.id}">
          <span class="sr-icon">${t.emoji}</span>
          <span class="sr-name">${t.name}</span>
          <span class="sr-desc">${t.desc}</span>
        </div>
      `).join('');
      dropdown.classList.remove('hidden');
      dropdown.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
          Router.navigate(item.dataset.route);
          window.location.hash = item.dataset.route;
          dropdown.classList.add('hidden');
          input.value = '';
        });
      });
    });

    input.addEventListener('blur', () => setTimeout(() => dropdown.classList.add('hidden'), 200));
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); input.focus(); input.select(); }
    });
  }

  // ---- Theme toggle ----
  function initTheme() {
    const saved = Storage.getSetting('theme', 'dark');
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeBtn(saved);

    document.getElementById('theme-toggle').addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      Storage.setSetting('theme', next);
      updateThemeBtn(next);
    });
  }

  function updateThemeBtn(theme) {
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = theme === 'dark' ? '☀' : '☾';
  }

  // ---- Sidebar toggle ----
  function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    const btn = document.getElementById('sidebar-toggle');
    const collapsed = Storage.getSetting('sidebar_collapsed', false);
    if (collapsed) sidebar.classList.add('collapsed');

    btn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      Storage.setSetting('sidebar_collapsed', sidebar.classList.contains('collapsed'));
    });
  }

  // ---- Global file open button ----
  function initGlobalOpen() {
    const btn = document.getElementById('open-file-btn');
    const input = document.getElementById('global-file-input');
    const heroBtn = document.getElementById('hero-open-btn');
    const heroDropBtn = document.getElementById('hero-drop-btn');
    const heroDropZone = document.getElementById('hero-drop-zone');

    btn.addEventListener('click', () => { input.value = ''; input.click(); });
    heroBtn.addEventListener('click', () => { input.value = ''; input.click(); });

    input.addEventListener('change', () => {
      const files = [...input.files];
      if (files.length) handleGlobalFiles(files);
    });

    if (heroDropBtn) {
      heroDropBtn.addEventListener('click', () => {
        heroDropZone.classList.toggle('hidden');
      });
    }

    // Hero drop zone
    if (heroDropZone) {
      UI.setupDropZone(heroDropZone, handleGlobalFiles, ['.pdf', 'image/']);
    }

    // Full-window drop
    document.body.addEventListener('dragover', e => e.preventDefault());
    document.body.addEventListener('drop', e => {
      e.preventDefault();
      const files = [...e.dataTransfer.files];
      if (files.length) handleGlobalFiles(files);
    });
  }

  function handleGlobalFiles(files) {
    // Route to appropriate tool based on file type
    const pdfs = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
    const images = files.filter(f => f.type.startsWith('image/'));

    if (pdfs.length > 1) {
      Router.navigate('merge');
      window.location.hash = 'merge';
      setTimeout(() => {
        if (window.MergeModule) window.MergeModule.addFiles(pdfs);
      }, 300);
    } else if (pdfs.length === 1) {
      // Share single PDF across all tools
      PDFState.set(pdfs[0]);
      Router.navigate('edit');
      window.location.hash = 'edit';
      setTimeout(() => {
        if (window.EditModule) window.EditModule.loadFile(pdfs[0]);
      }, 300);
    } else if (images.length) {
      Router.navigate('convert');
      window.location.hash = 'convert';
      setTimeout(() => {
        if (window.ConvertModule) window.ConvertModule.addFiles(images);
      }, 300);
    }
  }

  // ---- Keyboard shortcuts ----
  function initKeyboard() {
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key === 'o') { e.preventDefault(); document.getElementById('global-file-input').click(); }
      if (ctrl && e.key === '1') { e.preventDefault(); Router.navigate('dashboard'); window.location.hash = 'dashboard'; }
      if (ctrl && e.key === 'm') { e.preventDefault(); Router.navigate('merge'); window.location.hash = 'merge'; }
      if (ctrl && e.key === 's' && e.shiftKey) { e.preventDefault(); triggerSave(); }
      if (ctrl && e.key === 'b') { e.preventDefault(); document.getElementById('sidebar-toggle').click(); }
      if (ctrl && e.key === 'd') { e.preventDefault(); document.getElementById('theme-toggle').click(); }
    });
  }

  function triggerSave() {
    const route = Router.current();
    const modName = 'Module_' + route;
    const mod = window[modName];
    if (mod && typeof mod.save === 'function') mod.save();
  }

  // ---- Clear buttons ----
  function initClearButtons() {
    document.getElementById('clear-recent-btn').addEventListener('click', async () => {
      const ok = await UI.confirm('Effacer tous les fichiers récents ?');
      if (ok) { Storage.clearRecentFiles(); renderRecentFiles(); }
    });
    document.getElementById('clear-history-btn').addEventListener('click', async () => {
      const ok = await UI.confirm('Effacer tout l\'historique ?');
      if (ok) { Storage.clearHistory(); renderHistory(); }
    });
  }

  // ---- Escape HTML ----
  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ---- Dashboard init ----
  function initDashboard() {
    renderQuickTools();
    renderRecentFiles();
    renderStats();
    renderHistory();
  }

  // ---- Register dashboard route ----
  function registerRoutes() {
    Router.register('dashboard', () => {
      renderQuickTools();
      renderRecentFiles();
      renderStats();
      renderHistory();
    });
  }

  // ---- Init ----
  function init() {
    initTheme();
    initSidebar();
    initGlobalOpen();
    initSearch();
    initKeyboard();
    initClearButtons();
    registerRoutes();
    initDashboard();
    Router.init();

    const clearPdfBtn = document.getElementById('clear-pdf-btn');
    if (clearPdfBtn) clearPdfBtn.addEventListener('click', () => PDFState.clear());

    // Log startup
    console.log(
      '%c PDF Toolbox Ultimate %c v1.0.0 — 100% Local',
      'background:#4f6ef7;color:white;padding:4px 8px;border-radius:4px 0 0 4px',
      'background:#1a1d27;color:#8892b0;padding:4px 8px;border-radius:0 4px 4px 0'
    );
  }

  return { init, renderDashboard: initDashboard, escapeHtml, TOOLS };
})();

window.App = App;
window.addEventListener('DOMContentLoaded', () => App.init());
