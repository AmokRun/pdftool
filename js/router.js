/* ============================================================
   ROUTER — hash-based client-side routing
   ============================================================ */
'use strict';

const Router = (() => {
  const routes = {};
  let currentRoute = null;
  let _beforeEach = null;

  // Small alias map only for routes whose path differs from their module file name
  const MODULE_ALIASES = {
    reorder:    'split',
    pagenumber: 'watermark'
  };

  const loadedModules = new Set();

  function register(path, handler) {
    routes[path] = handler;
  }

  function beforeEach(fn) {
    _beforeEach = fn;
  }

  async function navigate(path) {
    path = path.replace(/^#/, '');
    if (!path || path === '') path = 'dashboard';

    if (_beforeEach) {
      const proceed = await _beforeEach(path, currentRoute);
      if (proceed === false) return;
    }

    // Update nav items (sidebar + bottom nav)
    document.querySelectorAll('.nav-item, .bn-item[data-route]').forEach(a => {
      a.classList.toggle('active', a.dataset.route === path);
    });

    // Update views
    document.querySelectorAll('.view').forEach(v => {
      const isTarget = v.dataset.view === path;
      v.classList.toggle('active', isTarget);
      v.classList.toggle('hidden', !isTarget);
    });

    // Breadcrumb
    const navItem = document.querySelector(`.nav-item[data-route="${path}"]`);
    const label = navItem ? navItem.querySelector('.nav-label')?.textContent : path;
    UI.setBreadcrumb(['PDF Toolbox', label || path]);

    currentRoute = path;

    // Lazy load module if needed
    // Use alias to find the correct file (e.g. reorder -> split.js, pagenumber -> watermark.js)
    const moduleName = MODULE_ALIASES[path] || path;
    const moduleSrc = 'js/modules/' + moduleName + '.js';

    if (!loadedModules.has(moduleName)) {
      loadedModules.add(moduleName);
      try {
        const script = document.createElement('script');
        script.src = moduleSrc;
        script.onload = () => {
          // Fire module init if available
          const mod = window['Module_' + path];
          if (mod && typeof mod.init === 'function') mod.init();
        };
        document.body.appendChild(script);
      } catch (err) {
        console.warn('Module load failed:', path, err);
      }
    } else {
      // Re-activate if already loaded
      const mod = window['Module_' + path];
      if (mod && typeof mod.activate === 'function') mod.activate();
    }

    // Call route handler if registered
    if (routes[path]) routes[path]();
  }

  function current() { return currentRoute; }

  function init() {
    // Handle hash changes
    window.addEventListener('hashchange', () => {
      navigate(window.location.hash.replace(/^#/, ''));
    });

    // Handle nav clicks
    document.querySelectorAll('.nav-item[data-route]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        const route = a.dataset.route;
        window.location.hash = route;
        navigate(route);
      });
    });

    // Initial route
    const hash = window.location.hash.replace(/^#/, '');
    navigate(hash || 'dashboard');
  }

  return { register, beforeEach, navigate, current, init };
})();

window.Router = Router;
