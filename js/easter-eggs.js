/* ============================================================
   EASTER EGGS — PDF Toolbox Ultimate
   ============================================================ */
(function () {
  'use strict';

  function injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
      @keyframes ee-fadein  { from{opacity:0;transform:scale(.92)} to{opacity:1;transform:scale(1)} }
      @keyframes ee-fadeout { from{opacity:1} to{opacity:0;transform:scale(.92)} }
      @keyframes ee-spin    { to{transform:rotate(360deg)} }
      @keyframes ee-bounce  { 0%,100%{transform:translateY(0)} 40%{transform:translateY(-18px)} 60%{transform:translateY(-8px)} }
      @keyframes ee-shake   { 0%,100%{transform:translate(0)} 20%{transform:translate(-6px,4px)} 40%{transform:translate(6px,-4px)} 60%{transform:translate(-4px,-6px)} 80%{transform:translate(4px,6px)} }
      @keyframes ee-pulse   { 0%,100%{opacity:1} 50%{opacity:.6} }
      @keyframes ee-star    { 0%{opacity:1;transform:translateY(0) rotate(0deg) scale(1)} 100%{opacity:0;transform:translateY(80px) rotate(540deg) scale(0)} }
      @keyframes ee-glow    { 0%,100%{text-shadow:0 0 8px currentColor} 50%{text-shadow:0 0 24px currentColor,0 0 48px currentColor} }
      @keyframes ee-scanline{ 0%{top:-10%} 100%{top:110%} }
      @keyframes ee-blink   { 50%{opacity:0} }

      .ee-overlay {
        position:fixed; inset:0; z-index:99999;
        display:flex; align-items:center; justify-content:center;
        padding:16px; box-sizing:border-box;
        animation:ee-fadein .35s cubic-bezier(.22,.61,.36,1) both;
      }
      .ee-overlay.closing { animation:ee-fadeout .3s ease forwards; }

      .ee-card {
        position:relative; border-radius:20px; overflow:hidden;
        padding:40px 32px; text-align:center;
        max-width:min(500px,90vw); width:100%;
        cursor:pointer;
      }
      @media(max-width:480px){ .ee-card { padding:28px 20px; } }

      .ee-close-hint {
        font-size:11px; opacity:.3; margin-top:20px;
        font-style:italic; pointer-events:none;
      }

      /* Matrix canvas fills overlay */
      .ee-matrix-canvas {
        position:absolute; inset:0; display:block;
        width:100%; height:100%;
      }
      .ee-matrix-msg {
        position:relative; z-index:1; text-align:center;
        pointer-events:none;
      }
    `;
    document.head.appendChild(s);
  }

  /* ── Shared close helpers ─────────────────────────────── */
  function closeOverlay(overlay) {
    overlay.classList.add('closing');
    setTimeout(() => overlay.remove(), 350);
  }
  function autoClose(overlay, ms) {
    const t = setTimeout(() => closeOverlay(overlay), ms);
    overlay.addEventListener('click', () => { clearTimeout(t); closeOverlay(overlay); });
  }


  /* ══════════════════════════════════════════════════════════
     EGG 1 — MODE AMOK
     PC  : taper "amok" au clavier (hors champ de saisie)
     Mobile: tapoter le logo 5× rapidement (ou taper "amok")
     ══════════════════════════════════════════════════════════ */
  function initAmokEgg() {
    /* keyboard */
    let buf = '';
    document.addEventListener('keydown', e => {
      const tag = (document.activeElement || {}).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      buf = (buf + e.key).toLowerCase().slice(-6);
      if (buf.includes('amok')) { buf = ''; triggerAmok(); }
    });

    /* logo tap ×5 */
    const logo = document.querySelector('.logo');
    if (logo) {
      logo.style.cursor = 'pointer';
      logo.title = '…';
      let taps = 0, timer;
      logo.addEventListener('click', () => {
        taps++;
        clearTimeout(timer);
        timer = setTimeout(() => { taps = 0; }, 1600);
        if (taps >= 5) { taps = 0; triggerAmok(); }
      });
    }
  }

  function triggerAmok() {
    const overlay = document.createElement('div');
    overlay.className = 'ee-overlay';
    overlay.style.background = 'rgba(0,0,0,.88)';
    overlay.style.backdropFilter = 'blur(10px)';

    /* floating emojis */
    ['🔥','⚡','💥','✨','🎆','🔥','⚡'].forEach((em, i) => {
      const sp = document.createElement('span');
      sp.textContent = em;
      sp.style.cssText = `
        position:absolute;
        font-size:${18 + Math.random() * 22}px;
        left:${5 + Math.random() * 90}%;
        top:${5 + Math.random() * 90}%;
        animation:ee-star ${1 + Math.random()}s ease-out ${Math.random() * .6}s both;
        pointer-events:none;
      `;
      overlay.appendChild(sp);
    });

    const card = document.createElement('div');
    card.className = 'ee-card';
    card.style.cssText = `
      background:linear-gradient(145deg,#1a0a0a,#2a0d0d,#1a0000);
      border:2px solid rgba(220,50,40,.7);
      box-shadow:0 0 60px rgba(220,50,40,.35),0 24px 64px rgba(0,0,0,.6);
    `;
    card.innerHTML = `
      <div style="font-size:clamp(52px,12vw,72px);animation:ee-spin 3s linear infinite;display:inline-block;margin-bottom:12px">🔥</div>
      <div style="
        font-size:clamp(28px,7vw,44px);font-weight:900;letter-spacing:4px;
        color:#fff;text-shadow:0 0 20px rgba(220,50,40,.9);
        animation:ee-glow 2s ease infinite;margin-bottom:6px
      ">MODE AMOK</div>
      <div style="color:rgba(220,80,70,.9);font-style:italic;font-size:clamp(13px,3vw,16px);margin-bottom:24px;animation:ee-pulse 1.5s ease infinite">
        🚨 Activé !
      </div>
      <div style="background:rgba(255,255,255,.04);border:1px solid rgba(220,50,40,.25);border-radius:14px;padding:20px;margin-bottom:20px">
        <div style="font-size:clamp(13px,3vw,15px);color:#ddd;line-height:1.8">
          🛠️ <strong style="color:#fff">PDF Toolbox Ultimate</strong><br>
          Forgé dans les flammes par<br>
          <span style="font-size:clamp(20px,5vw,28px);font-weight:800;color:rgba(220,70,60,.95);letter-spacing:2px;animation:ee-glow 1.5s ease infinite">Amok</span><br>
          avec ❤️ et une quantité dangereuse de café ☕
        </div>
        <div style="margin-top:14px;font-size:11px;color:rgba(255,255,255,.3);line-height:1.6">
          100% local &nbsp;·&nbsp; 0% données envoyées &nbsp;·&nbsp; ∞% passion
        </div>
      </div>
      <div class="ee-close-hint">Touchez ou cliquez pour fermer</div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    autoClose(overlay, 9000);
  }


  /* ══════════════════════════════════════════════════════════
     EGG 2 — MATRIX RAIN
     PC    : code Konami ↑↑↓↓←→←→BA
     Mobile: tapoter le numéro de version 3× rapidement
     ══════════════════════════════════════════════════════════ */
  function initMatrixEgg() {
    const KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown',
                    'ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
    let ki = 0;
    document.addEventListener('keydown', e => {
      ki = (e.key === KONAMI[ki]) ? ki + 1 : (e.key === KONAMI[0] ? 1 : 0);
      if (ki === KONAMI.length) { ki = 0; triggerMatrix(); }
    });

    /* version triple-tap */
    const ver = document.querySelector('.version');
    if (ver) {
      ver.style.cursor = 'pointer';
      let vtaps = 0, vt;
      ver.addEventListener('click', () => {
        vtaps++;
        clearTimeout(vt);
        vt = setTimeout(() => { vtaps = 0; }, 1200);
        if (vtaps >= 3) { vtaps = 0; triggerMatrix(); }
      });
    }
  }

  function triggerMatrix() {
    const overlay = document.createElement('div');
    overlay.className = 'ee-overlay';
    overlay.style.cssText = 'background:#000;cursor:pointer;overflow:hidden;';

    /* canvas */
    const canvas = document.createElement('canvas');
    canvas.className = 'ee-matrix-canvas';
    const W = canvas.width  = window.innerWidth;
    const H = canvas.height = window.innerHeight;
    overlay.appendChild(canvas);

    /* message */
    const msgWrap = document.createElement('div');
    msgWrap.className = 'ee-matrix-msg';
    msgWrap.innerHTML = `
      <div style="font-size:clamp(22px,5vw,40px);color:#00ff41;font-family:monospace;font-weight:bold;
                  text-shadow:0 0 20px #00ff41;animation:ee-glow 1.5s ease infinite">
        ACCÈS AUTORISÉ
      </div>
      <div style="font-size:clamp(12px,2.8vw,17px);color:rgba(0,255,65,.7);font-family:monospace;margin-top:10px">
        PDF Toolbox — vos données restent chez vous
      </div>
      <div style="margin-top:6px;font-size:clamp(10px,2vw,13px);color:rgba(0,255,65,.35);font-family:monospace;animation:ee-blink 1s step-end infinite">
        [ Touchez pour quitter ]
      </div>
    `;
    overlay.appendChild(msgWrap);
    document.body.appendChild(overlay);

    /* rain */
    const ctx   = canvas.getContext('2d');
    const col   = 16;
    const cols  = Math.ceil(W / col);
    const drops = Array.from({length: cols}, () => Math.random() * -H / col | 0);
    const chars = '01アイウエオカキPDFTOOLBOX☢✓'.split('');

    const raf = { id: 0 };
    let last = 0;
    function draw(ts) {
      if (ts - last > 45) {
        last = ts;
        ctx.fillStyle = 'rgba(0,0,0,.055)';
        ctx.fillRect(0, 0, W, H);
        ctx.font = col + 'px monospace';
        drops.forEach((y, i) => {
          ctx.fillStyle = y === 1 ? '#9affb5' : '#00ff41';
          ctx.fillText(chars[Math.random() * chars.length | 0], i * col, y * col);
          if (y * col > H && Math.random() > .975) drops[i] = 0;
          drops[i]++;
        });
      }
      raf.id = requestAnimationFrame(draw);
    }
    raf.id = requestAnimationFrame(draw);

    const cleanup = () => { cancelAnimationFrame(raf.id); closeOverlay(overlay); };
    overlay.addEventListener('click', cleanup);
    setTimeout(cleanup, 11000);
  }


  /* ══════════════════════════════════════════════════════════
     EGG 3 — ALGORITHME SECRET
     PC & Mobile : cliquer/tapoter le badge 🔒 7× rapidement
     ══════════════════════════════════════════════════════════ */
  function initPrivacyEgg() {
    const badge = document.getElementById('privacy-badge');
    if (!badge) return;
    let clicks = 0, timer;
    badge.addEventListener('click', () => {
      clicks++;
      clearTimeout(timer);
      timer = setTimeout(() => { clicks = 0; }, 2200);
      if (clicks >= 7) { clicks = 0; triggerPrivacy(); }
    });
  }

  function triggerPrivacy() {
    const overlay = document.createElement('div');
    overlay.className = 'ee-overlay';
    overlay.style.cssText = 'background:rgba(0,0,0,.92);backdrop-filter:blur(14px);';

    /* scanline */
    const scan = document.createElement('div');
    scan.style.cssText = `
      position:absolute;inset:0;pointer-events:none;overflow:hidden;
    `;
    const line = document.createElement('div');
    line.style.cssText = `
      position:absolute;left:0;right:0;height:3px;
      background:linear-gradient(90deg,transparent,rgba(88,166,255,.4),transparent);
      animation:ee-scanline 2.5s linear infinite;
    `;
    scan.appendChild(line);
    overlay.appendChild(scan);

    const card = document.createElement('div');
    card.className = 'ee-card';
    card.style.cssText = `
      background:linear-gradient(145deg,#0d1117,#161b22,#0d1117);
      border:1px solid rgba(88,166,255,.35);
      box-shadow:0 0 80px rgba(88,166,255,.12),0 24px 48px rgba(0,0,0,.7);
      animation:ee-shake .45s ease;
    `;
    card.innerHTML = `
      <div style="font-size:clamp(44px,10vw,64px);margin-bottom:12px">🔒</div>
      <div style="
        display:inline-block;background:rgba(248,81,73,.12);
        border:1px solid rgba(248,81,73,.5);border-radius:5px;
        padding:3px 14px;color:#f85149;font-size:11px;font-family:monospace;
        font-weight:bold;letter-spacing:3px;margin-bottom:16px
      ">CLASSIFICATION : TOP SECRET</div>
      <h2 style="color:#fff;font-size:clamp(17px,4vw,23px);margin:0 0 20px;font-weight:700">
        Algorithme de compression révélé
      </h2>
      <div style="
        background:rgba(88,166,255,.05);border:1px solid rgba(88,166,255,.18);
        border-radius:12px;padding:18px;margin-bottom:18px;
        text-align:left;font-family:monospace;
        font-size:clamp(11px,2.6vw,13px);line-height:1.9;
      ">
        <span style="color:#7ee787">async function</span>
        <span style="color:#d2a8ff"> compresserPDF</span>
        <span style="color:#c9d1d9">(fichier) {</span><br>
        &nbsp;&nbsp;<span style="color:#79c0ff">let</span>
        <span style="color:#c9d1d9"> resultat = </span>
        <span style="color:#ffa657">ZIP</span>
        <span style="color:#c9d1d9">(fichier);</span><br>
        &nbsp;&nbsp;<span style="color:#79c0ff">await</span>
        <span style="color:#ffa657"> prier</span>
        <span style="color:#c9d1d9">(resultat);</span><br>
        &nbsp;&nbsp;<span style="color:#79c0ff">return</span>
        <span style="color:#ffa657"> esperer</span>
        <span style="color:#c9d1d9">(resultat)</span>
        <span style="color:#ff7b72"> ??</span>
        <span style="color:#c9d1d9"> fichier;</span><br>
        <span style="color:#c9d1d9">}</span><br>
        <span style="color:#484f58">// taux de réussite : 99,9 %</span><br>
        <span style="color:#484f58">// (selon moi)</span>
      </div>
      <p style="color:rgba(255,255,255,.45);font-size:clamp(11px,2.5vw,13px);line-height:1.7;margin:0 0 6px">
        ⚠️ Cet algorithme est protégé par le droit<br>
        international de la blague informatique
      </p>
      <div class="ee-close-hint">Touchez ou cliquez pour fermer ce dossier classifié</div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    autoClose(overlay, 13000);
  }


  /* ── Init ─────────────────────────────────────────────── */
  function init() {
    injectStyles();
    initAmokEgg();
    initMatrixEgg();
    initPrivacyEgg();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
