/* ============================================================
   UI — notifications, modals, helpers
   ============================================================ */
'use strict';

const UI = (() => {

  // ---- Toast notifications ----
  function toast(message, type = 'info', title = '', duration = 4000) {
    const container = document.getElementById('toast-container');
    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <div class="toast-body">
        ${title ? `<div class="toast-title">${title}</div>` : ''}
        <div class="toast-message">${message}</div>
      </div>
      <button class="toast-close">×</button>
    `;
    container.appendChild(toast);
    const close = () => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    };
    toast.querySelector('.toast-close').onclick = close;
    if (duration > 0) setTimeout(close, duration);
    return toast;
  }

  function success(msg, title) { return toast(msg, 'success', title); }
  function error(msg, title) { return toast(msg, 'error', title || 'Erreur', 6000); }
  function warning(msg, title) { return toast(msg, 'warning', title); }
  function info(msg, title) { return toast(msg, 'info', title); }

  // ---- Modal ----
  let _modalResolve = null;

  function openModal(title, bodyHtml, footerHtml = '') {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-footer').innerHTML = footerHtml;
    document.getElementById('modal-overlay').classList.remove('hidden');
    return new Promise(resolve => { _modalResolve = resolve; });
  }

  function closeModal(result) {
    document.getElementById('modal-overlay').classList.add('hidden');
    if (_modalResolve) { _modalResolve(result); _modalResolve = null; }
  }

  function confirm(message, title = 'Confirmer') {
    const body = `<p>${message}</p>`;
    const footer = `
      <button class="btn btn-ghost" id="modal-cancel-btn">Annuler</button>
      <button class="btn btn-primary" id="modal-confirm-btn">Confirmer</button>
    `;
    const p = openModal(title, body, footer);
    setTimeout(() => {
      const cb = document.getElementById('modal-confirm-btn');
      const cn = document.getElementById('modal-cancel-btn');
      if (cb) cb.onclick = () => closeModal(true);
      if (cn) cn.onclick = () => closeModal(false);
    }, 0);
    return p;
  }

  function alert(message, title = 'Information') {
    const body = `<p>${message}</p>`;
    const footer = `<button class="btn btn-primary" id="modal-ok-btn">OK</button>`;
    const p = openModal(title, body, footer);
    setTimeout(() => {
      const btn = document.getElementById('modal-ok-btn');
      if (btn) btn.onclick = () => closeModal(true);
    }, 0);
    return p;
  }

  function prompt(message, defaultValue = '', title = 'Saisir') {
    const body = `
      <p>${message}</p>
      <input type="text" id="modal-prompt-input" class="form-input" value="${defaultValue}" style="margin-top:10px" />
    `;
    const footer = `
      <button class="btn btn-ghost" id="modal-cancel-btn">Annuler</button>
      <button class="btn btn-primary" id="modal-ok-btn">OK</button>
    `;
    const p = openModal(title, body, footer);
    setTimeout(() => {
      const inp = document.getElementById('modal-prompt-input');
      const ok = document.getElementById('modal-ok-btn');
      const cn = document.getElementById('modal-cancel-btn');
      if (inp) { inp.focus(); inp.select(); inp.onkeydown = e => { if (e.key === 'Enter') closeModal(inp.value); }; }
      if (ok) ok.onclick = () => closeModal(inp ? inp.value : null);
      if (cn) cn.onclick = () => closeModal(null);
    }, 0);
    return p;
  }

  // ---- Progress ----
  function setProgress(fillId, textId, pct) {
    const fill = document.getElementById(fillId);
    const text = document.getElementById(textId);
    if (fill) fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
    if (text) text.textContent = Math.round(pct) + '%';
  }

  function showProgress(containerId) {
    const el = document.getElementById(containerId);
    if (el) el.classList.remove('hidden');
  }

  function hideProgress(containerId) {
    const el = document.getElementById(containerId);
    if (el) el.classList.add('hidden');
  }

  // ---- Loading overlay ----
  function showLoading(container, message = 'Chargement...') {
    if (typeof container === 'string') container = document.getElementById(container);
    if (!container) return;
    removeLoading(container);
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.innerHTML = `<div class="spinner spinner-lg"></div><span>${message}</span>`;
    overlay.style.position = 'absolute';
    container.style.position = 'relative';
    container.appendChild(overlay);
    return overlay;
  }

  function removeLoading(container) {
    if (typeof container === 'string') container = document.getElementById(container);
    if (!container) return;
    const ov = container.querySelector('.loading-overlay');
    if (ov) ov.remove();
  }

  // ---- File size formatting ----
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(2) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }

  // ---- Date formatting ----
  function formatDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
           ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  function timeAgo(ts) {
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 60) return 'À l\'instant';
    if (sec < 3600) return Math.floor(sec / 60) + ' min';
    if (sec < 86400) return Math.floor(sec / 3600) + ' h';
    return Math.floor(sec / 86400) + ' j';
  }

  // ---- Drag and drop setup ----
  function setupDropZone(zoneEl, onFiles, accept = []) {
    zoneEl.addEventListener('dragover', e => { e.preventDefault(); zoneEl.classList.add('drag-over'); });
    zoneEl.addEventListener('dragleave', () => zoneEl.classList.remove('drag-over'));
    zoneEl.addEventListener('drop', e => {
      e.preventDefault();
      zoneEl.classList.remove('drag-over');
      const files = [...e.dataTransfer.files];
      const filtered = accept.length ? files.filter(f => accept.some(a => {
        if (a.startsWith('.')) return f.name.toLowerCase().endsWith(a);
        return f.type.startsWith(a.replace('*',''));
      })) : files;
      if (filtered.length) onFiles(filtered);
      else if (files.length) toast('Format de fichier non supporté', 'warning');
    });
  }

  // ---- Download helpers ----
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function downloadText(text, filename, mime = 'text/plain') {
    downloadBlob(new Blob([text], { type: mime }), filename);
  }

  // ---- File input trigger ----
  function openFileDialog(inputEl) {
    inputEl.value = '';
    inputEl.click();
  }

  // ---- Generate unique ID ----
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ---- Breadcrumb update ----
  function setBreadcrumb(parts) {
    const el = document.getElementById('breadcrumb');
    if (!el) return;
    el.innerHTML = parts.map(p => `<span>${p}</span>`).join('');
  }

  // ---- Context menu ----
  function showContextMenu(x, y, items) {
    const menu = document.getElementById('context-menu');
    const list = document.getElementById('context-menu-list');
    list.innerHTML = '';
    items.forEach(item => {
      if (item === 'separator') {
        const li = document.createElement('li');
        li.className = 'separator';
        list.appendChild(li);
        return;
      }
      const li = document.createElement('li');
      if (item.danger) li.className = 'danger';
      li.innerHTML = `${item.icon ? `<span>${item.icon}</span>` : ''}<span>${item.label}</span>`;
      li.onclick = () => { hideContextMenu(); if (item.action) item.action(); };
      list.appendChild(li);
    });
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.classList.remove('hidden');
    // Adjust if off screen
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth) menu.style.left = (x - r.width) + 'px';
    if (r.bottom > window.innerHeight) menu.style.top = (y - r.height) + 'px';
  }

  function hideContextMenu() {
    document.getElementById('context-menu').classList.add('hidden');
  }

  // ---- Range input live update helper ----
  function bindRange(rangeId, displayId, suffix = '') {
    const r = document.getElementById(rangeId);
    const d = document.getElementById(displayId);
    if (!r || !d) return;
    const update = () => { d.textContent = r.value + suffix; };
    r.addEventListener('input', update);
    update();
  }

  // ---- Drag-to-reorder for file lists ----
  function makeSortable(listEl, onChange) {
    let dragSrc = null;

    function onDragStart(e) {
      dragSrc = this;
      e.dataTransfer.effectAllowed = 'move';
      this.classList.add('dragging');
    }
    function onDragEnd() { this.classList.remove('dragging'); }
    function onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
    function onDrop(e) {
      e.stopPropagation();
      if (dragSrc !== this) {
        const items = [...listEl.children];
        const srcIdx = items.indexOf(dragSrc);
        const dstIdx = items.indexOf(this);
        if (srcIdx < dstIdx) listEl.insertBefore(dragSrc, this.nextSibling);
        else listEl.insertBefore(dragSrc, this);
        if (onChange) onChange();
      }
    }

    function attachToItem(item) {
      item.setAttribute('draggable', true);
      item.addEventListener('dragstart', onDragStart);
      item.addEventListener('dragend', onDragEnd);
      item.addEventListener('dragover', onDragOver);
      item.addEventListener('drop', onDrop);
    }

    const observer = new MutationObserver(() => {
      [...listEl.children].forEach(c => {
        if (!c.getAttribute('draggable')) attachToItem(c);
      });
    });
    observer.observe(listEl, { childList: true });
    [...listEl.children].forEach(attachToItem);
    return observer;
  }

  // ---- Canvas text rendering helper ----
  function renderTextOnCanvas(canvas, text, font, size, color, x, y) {
    const ctx = canvas.getContext('2d');
    ctx.font = `${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  // ---- Expose ----
  return {
    toast, success, error, warning, info,
    openModal, closeModal, confirm, alert, prompt,
    setProgress, showProgress, hideProgress,
    showLoading, removeLoading,
    formatSize, formatDate, timeAgo,
    setupDropZone, downloadBlob, downloadText,
    openFileDialog, uid, setBreadcrumb,
    showContextMenu, hideContextMenu,
    bindRange, makeSortable, renderTextOnCanvas
  };
})();

window.UI = UI;

// ---- Global modal close buttons ----
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modal-close').onclick = () => UI.closeModal(null);
  document.getElementById('modal-overlay').onclick = (e) => {
    if (e.target === document.getElementById('modal-overlay')) UI.closeModal(null);
  };
  document.getElementById('shortcuts-modal-close').onclick = () => {
    document.getElementById('shortcuts-modal').classList.add('hidden');
  };
  document.getElementById('shortcuts-btn').onclick = () => {
    document.getElementById('shortcuts-modal').classList.remove('hidden');
  };
  document.addEventListener('click', () => UI.hideContextMenu());
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      UI.closeModal(null);
      document.getElementById('shortcuts-modal').classList.add('hidden');
      UI.hideContextMenu();
    }
    if (e.key === '?') {
      document.getElementById('shortcuts-modal').classList.remove('hidden');
    }
  });
});
