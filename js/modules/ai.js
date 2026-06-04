/* ============================================================
   AI MODULE — Local AI: TF-IDF summarization, keyword extraction,
   semantic search, chat — 100% in-browser, no server
   ============================================================ */
'use strict';

const AIModule = (() => {
  let currentFile = null;
  let documentText = '';
  let sentences = [];
  let tfidfData = null;
  let modelStatus = 'none'; // none | loading | ready | error
  let aiWorker = null;
  let requestId = 0;
  const pendingRequests = new Map();

  // ---- Init ----
  function init() {
    setupFileInput();
    setupChat();
    setupFunctionButtons();
    setupModelButton();
    _autoLoad();
  }

  function setupFileInput() {
    const btn = document.getElementById('ai-add-btn');
    const input = document.getElementById('ai-file-input');
    const dropZone = document.getElementById('ai-drop-zone');
    if (btn) btn.onclick = () => { input.value = ''; input.click(); };
    if (input) input.onchange = () => { if (input.files[0]) loadFile(input.files[0]); };
    if (dropZone) UI.setupDropZone(dropZone, f => { if (f[0]) loadFile(f[0]); }, ['.pdf']);
  }

  function setupModelButton() {
    const btn = document.getElementById('ai-load-model-btn');
    if (btn) btn.onclick = initAIEngine;
  }

  function setupChat() {
    const input = document.getElementById('ai-chat-input');
    const sendBtn = document.getElementById('ai-send-btn');
    if (sendBtn) sendBtn.onclick = sendMessage;
    if (input) {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
      });
    }
  }

  function setupFunctionButtons() {
    document.getElementById('ai-summarize-btn')?.addEventListener('click', runSummarize);
    document.getElementById('ai-keywords-btn')?.addEventListener('click', runKeywords);
    document.getElementById('ai-search-btn')?.addEventListener('click', runSearch);
  }

  // ---- File loading ----
  async function loadFile(file) {
    window.PDFState?.set(file);
    if (!window.pdfjsLib) {
      addMessage('assistant', 'PDF.js est requis pour lire les documents. Consultez libs/README.md');
      return;
    }
    currentFile = file;
    const nameEl = document.getElementById('ai-file-name');
    if (nameEl) { nameEl.textContent = file.name; nameEl.classList.remove('hidden'); }
    setStatus('loading', 'Extraction du texte...');

    try {
      const ab = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str).join(' ');
        fullText += pageText + '\n\n';
      }
      documentText = fullText.trim();
      sentences = splitSentences(documentText);
      tfidfData = buildTFIDF(sentences);

      if (aiWorker) {
        aiWorker.postMessage({ type: 'load-text', id: ++requestId, payload: { text: documentText } });
      }

      setStatus('ready', `Prêt — ${pdf.numPages} page(s), ${sentences.length} phrases`);
      enableFunctions(true);

      const chatInput = document.getElementById('ai-chat-input');
      const sendBtn = document.getElementById('ai-send-btn');
      if (chatInput) chatInput.disabled = false;
      if (sendBtn) sendBtn.disabled = false;

      addMessage('assistant', `✓ Document chargé : **${file.name}**\n${pdf.numPages} page(s) · ${sentences.length} phrases · ${UI.formatSize(file.size)}\n\nPosez vos questions ou utilisez les fonctions IA ci-dessous.`);
      Storage.addRecentFile({ id: UI.uid(), name: file.name, size: file.size, pages: pdf.numPages, tool: 'ai' });
    } catch (err) {
      setStatus('error', 'Erreur de chargement');
      UI.error('Erreur: ' + err.message);
    }
  }

  // ---- AI Engine init ----
  async function initAIEngine() {
    const btn = document.getElementById('ai-load-model-btn');
    if (btn) btn.disabled = true;
    setStatus('loading', 'Initialisation du moteur IA...');

    try {
      // Try to start the AI worker (rule-based fallback)
      aiWorker = new Worker('workers/ai-worker.js');
      aiWorker.onmessage = handleWorkerMessage;
      aiWorker.onerror = (err) => {
        console.warn('AI worker error:', err);
        aiWorker = null;
      };

      if (documentText) {
        aiWorker.postMessage({ type: 'load-text', id: ++requestId, payload: { text: documentText } });
      }

      setStatus('ready', 'Moteur IA local actif (mode extractif)');
      addMessage('assistant', '🤖 Moteur IA local initialisé.\n\nMode : Analyse extractive (TF-IDF, recherche sémantique)\nToutes les opérations s\'exécutent dans votre navigateur — aucune donnée envoyée.');
      enableFunctions(documentText.length > 0);

      // Show progress for visual effect
      const prog = document.getElementById('ai-load-progress');
      const fill = document.getElementById('ai-load-progress-fill');
      const text = document.getElementById('ai-load-progress-text');
      if (prog) prog.classList.remove('hidden');
      for (let i = 0; i <= 100; i += 20) {
        if (fill) fill.style.width = i + '%';
        if (text) text.textContent = i + '%';
        await sleep(100);
      }
      if (prog) prog.classList.add('hidden');

    } catch (err) {
      setStatus('error', 'Erreur d\'initialisation');
      if (btn) btn.disabled = false;
    }
  }

  function handleWorkerMessage(e) {
    const { type, id, text, words, results } = e.data;
    const resolve = pendingRequests.get(id);

    switch (type) {
      case 'summary':
        addMessage('assistant', '📋 **Résumé du document :**\n\n' + text);
        if (resolve) resolve(text);
        break;
      case 'keywords':
        const kwords = (words || []).map(w => `${w.word} (${w.count})`).join(' · ');
        addMessage('assistant', '🔑 **Mots-clés principaux :**\n\n' + kwords);
        if (resolve) resolve(words);
        break;
      case 'search-results':
        if (!results || !results.length) {
          addMessage('assistant', 'Aucun passage pertinent trouvé.');
        } else {
          const txt = results.map(r => `• (p.${r.page}, pertinence: ${r.relevance}%) ${r.text}`).join('\n\n');
          addMessage('assistant', '🔍 **Résultats de recherche :**\n\n' + txt);
        }
        if (resolve) resolve(results);
        break;
      case 'chat-response':
        addTypingMessage(text);
        if (resolve) resolve(text);
        break;
    }

    pendingRequests.delete(id);
  }

  // ---- AI Functions ----
  function runSummarize() {
    if (!documentText) { UI.warning('Chargez d\'abord un document'); return; }
    addMessage('user', 'Génère un résumé du document');
    if (aiWorker) {
      const id = ++requestId;
      aiWorker.postMessage({ type: 'summarize', id, payload: { ratio: 0.25 } });
      return;
    }
    // Inline fallback
    const summary = extractiveSummary(sentences, tfidfData, 0.25);
    addTypingMessage('📋 **Résumé du document :**\n\n' + summary);
  }

  function runKeywords() {
    if (!documentText) { UI.warning('Chargez d\'abord un document'); return; }
    addMessage('user', 'Extraire les mots-clés du document');
    if (aiWorker) {
      aiWorker.postMessage({ type: 'keywords', id: ++requestId, payload: { count: 15 } });
      return;
    }
    const keywords = extractKeywords(documentText, 15);
    const txt = '🔑 **Mots-clés principaux :**\n\n' + keywords.map(w => `**${w.word}** (${w.count})`).join(' · ');
    addTypingMessage(txt);
  }

  async function runSearch() {
    if (!documentText) { UI.warning('Chargez d\'abord un document'); return; }
    const query = await UI.prompt('Entrez votre recherche :', '');
    if (!query) return;
    addMessage('user', '🔍 ' + query);
    if (aiWorker) {
      aiWorker.postMessage({ type: 'search', id: ++requestId, payload: { query, topK: 5 } });
      return;
    }
    const results = semanticSearch(query, sentences, tfidfData, 5);
    if (!results.length) {
      addTypingMessage('Aucun passage pertinent trouvé pour : ' + query);
    } else {
      const txt = '🔍 **Résultats :**\n\n' + results.map(r => `• ${r.text}`).join('\n\n');
      addTypingMessage(txt);
    }
  }

  // ---- Chat ----
  function sendMessage() {
    const input = document.getElementById('ai-chat-input');
    if (!input) return;
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    addMessage('user', msg);

    if (!documentText) {
      addTypingMessage('Veuillez d\'abord charger un document PDF pour que je puisse répondre à vos questions.');
      return;
    }

    if (aiWorker) {
      aiWorker.postMessage({ type: 'chat', id: ++requestId, payload: { message: msg } });
      return;
    }

    // Inline fallback
    const answer = inlineChat(msg);
    addTypingMessage(answer);
  }

  function inlineChat(message) {
    const q = message.toLowerCase();
    const queryTokens = tokenize(message);

    if (q.includes('résume') || q.includes('résumé') || q.includes('resume')) {
      return '📋 ' + extractiveSummary(sentences, tfidfData, 0.2);
    }
    if (q.includes('mots-clés') || q.includes('mots clés') || q.includes('keywords')) {
      const kw = extractKeywords(documentText, 10);
      return '🔑 Mots-clés : ' + kw.map(w => w.word).join(', ');
    }
    if (q.includes('combien') && (q.includes('page') || q.includes('mot') || q.includes('phrase'))) {
      const words = documentText.split(/\s+/).length;
      return `Ce document contient environ ${sentences.length} phrases et ${words.toLocaleString('fr-FR')} mots.`;
    }

    // Semantic search
    const relevant = sentences
      .map(s => {
        const tokens = new Set(tokenize(s));
        const overlap = queryTokens.filter(t => tokens.has(t)).length;
        return { s, overlap };
      })
      .filter(r => r.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 3);

    if (relevant.length) {
      return 'D\'après le document :\n\n' + relevant.map(r => '• ' + r.s.trim()).join('\n\n');
    }
    return 'Je n\'ai pas trouvé de passage directement lié à votre question. Essayez des mots-clés plus précis, ou utilisez la fonction "Recherche sémantique".';
  }

  // ---- Message rendering ----
  function addMessage(role, text) {
    const container = document.getElementById('ai-chat-messages');
    if (!container) return;
    const welcome = container.querySelector('.chat-welcome');
    if (welcome) welcome.remove();

    const div = document.createElement('div');
    div.className = `chat-message ${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.innerHTML = formatMessage(text);
    const meta = document.createElement('div');
    meta.className = 'chat-meta';
    meta.textContent = role === 'user' ? 'Vous' : '🤖 IA Locale';
    div.appendChild(bubble);
    div.appendChild(meta);
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  }

  function addTypingMessage(text) {
    const container = document.getElementById('ai-chat-messages');
    if (!container) return;
    const welcome = container.querySelector('.chat-welcome');
    if (welcome) welcome.remove();

    const div = document.createElement('div');
    div.className = 'chat-message assistant';
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    const meta = document.createElement('div');
    meta.className = 'chat-meta';
    meta.textContent = '🤖 IA Locale';
    div.appendChild(bubble);
    div.appendChild(meta);
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;

    // Typing animation
    let i = 0;
    const formatted = formatMessage(text);
    const interval = setInterval(() => {
      bubble.innerHTML = formatted.slice(0, i += 8);
      container.scrollTop = container.scrollHeight;
      if (i >= formatted.length) { bubble.innerHTML = formatted; clearInterval(interval); }
    }, 15);
  }

  function formatMessage(text) {
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
  }

  // ---- Status ----
  function setStatus(status, text) {
    modelStatus = status;
    const dot = document.getElementById('ai-status-dot');
    const textEl = document.getElementById('ai-status-text');
    if (dot) { dot.className = 'status-dot'; dot.classList.add(status); }
    if (textEl) textEl.textContent = text;
  }

  function enableFunctions(enabled) {
    ['ai-summarize-btn', 'ai-keywords-btn', 'ai-search-btn'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = !enabled;
    });
  }

  // ---- Pure JS NLP algorithms ----
  function tokenize(text) {
    return text.toLowerCase().replace(/[^a-zàâäéèêëîïôùûüç\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  }

  function splitSentences(text) {
    return text.split(/(?<=[.!?])\s+|[\n]{2,}/).map(s => s.trim()).filter(s => s.length > 15);
  }

  function buildTFIDF(sents) {
    const N = sents.length || 1;
    const df = {};
    const tf = sents.map(s => {
      const tokens = tokenize(s);
      const freq = {};
      tokens.forEach(t => { freq[t] = (freq[t] || 0) + 1; });
      const total = tokens.length || 1;
      Object.keys(freq).forEach(t => { freq[t] /= total; df[t] = (df[t] || 0) + 1; });
      return freq;
    });
    const idf = {};
    Object.keys(df).forEach(t => { idf[t] = Math.log((N + 1) / (df[t] + 1)) + 1; });
    return { tf, idf };
  }

  function extractiveSummary(sents, tfidf, ratio) {
    if (!sents.length) return 'Document vide.';
    const targetCount = Math.max(3, Math.ceil(sents.length * ratio));
    const scored = sents.map((s, i) => {
      const tokens = tokenize(s);
      let score = tokens.reduce((acc, t) => {
        if (tfidf && tfidf.tf[i] && tfidf.idf[t]) return acc + (tfidf.tf[i][t] || 0) * tfidf.idf[t];
        return acc;
      }, 0);
      score /= Math.max(tokens.length, 1);
      return { s, i, score };
    });
    const top = scored.sort((a, b) => b.score - a.score).slice(0, targetCount);
    top.sort((a, b) => a.i - b.i);
    return top.map(x => x.s).join(' ');
  }

  function extractKeywords(text, count) {
    const words = tokenize(text);
    const stopwords = new Set([
      'le','la','les','de','du','des','un','une','et','en','à','au','aux',
      'que','qui','se','si','il','elle','ils','elles','nous','vous','on',
      'par','pour','sur','sous','avec','dans','the','a','an','of','to',
      'and','in','is','it','for','on','are','as','at','be','by','this',
      'that','was','were','with','from','or','but','not','have','had','has'
    ]);
    const freq = {};
    words.forEach(w => { if (!stopwords.has(w) && w.length > 3) freq[w] = (freq[w] || 0) + 1; });
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, count).map(([word, count]) => ({ word, count }));
  }

  function semanticSearch(query, sents, tfidf, topK) {
    const queryTokens = tokenize(query);
    return sents.map((s, i) => {
      const tokens = new Set(tokenize(s));
      const score = queryTokens.filter(t => tokens.has(t)).length / Math.max(queryTokens.length, 1);
      return { text: s, score, page: Math.ceil((i + 1) / 30) };
    }).filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, topK);
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function _autoLoad() {
    const f = window.PDFState?.get();
    if (!currentFile && f) loadFile(f);
  }

  function activate() { _autoLoad(); }

  return { init, loadFile, activate };
})();

window.AIModule = AIModule;
window.Module_ai = AIModule;
document.addEventListener('DOMContentLoaded', AIModule.init);
// Module initialized
