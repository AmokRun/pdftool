/* ============================================================
   AI WORKER — Local AI processing (TF-IDF, summarization)
   Falls back to rule-based when no LLM available
   ============================================================ */
'use strict';

let documentText = '';
let sentences = [];
let tfidf = null;

self.addEventListener('message', (e) => {
  const { type, id, payload } = e.data;
  switch (type) {
    case 'load-text':      loadText(id, payload.text);   break;
    case 'summarize':      summarize(id, payload);        break;
    case 'keywords':       extractKeywords(id, payload);  break;
    case 'search':         semanticSearch(id, payload);   break;
    case 'chat':           chat(id, payload);              break;
  }
});

function loadText(id, text) {
  documentText = text;
  sentences = splitSentences(text);
  tfidf = buildTFIDF(sentences);
  self.postMessage({ type: 'text-loaded', id, sentenceCount: sentences.length });
}

// ---- Summarization (extractive) ----
function summarize(id, { ratio = 0.3 }) {
  if (!sentences.length) {
    return self.postMessage({ type: 'summary', id, text: 'Aucun texte à résumer.' });
  }
  const targetCount = Math.max(3, Math.ceil(sentences.length * ratio));
  const scored = scoreSentences(sentences, tfidf);
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, targetCount);
  top.sort((a, b) => a.index - b.index);
  const summary = top.map(s => s.sentence).join(' ');
  self.postMessage({ type: 'summary', id, text: summary });
}

// ---- Keyword extraction ----
function extractKeywords(id, { count = 15 }) {
  if (!documentText) {
    return self.postMessage({ type: 'keywords', id, words: [] });
  }
  const words = tokenize(documentText);
  const freq = {};
  words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  const stopwords = new Set([
    'le','la','les','de','du','des','un','une','et','en','à','au','aux',
    'que','qui','se','si','il','elle','ils','elles','nous','vous','on',
    'par','pour','sur','sous','avec','dans','the','a','an','of','to',
    'and','in','is','it','for','on','are','as','at','be','by','this',
    'that','was','were','with','from','or','but','not','have','had',
    'has','more','also','can','will','all','been','one','its','than','then'
  ]);
  const filtered = Object.entries(freq)
    .filter(([w]) => w.length > 3 && !stopwords.has(w) && !/^\d+$/.test(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, count);
  self.postMessage({ type: 'keywords', id, words: filtered.map(([w, c]) => ({ word: w, count: c })) });
}

// ---- Semantic search (keyword-based with TF-IDF ranking) ----
function semanticSearch(id, { query, topK = 5 }) {
  if (!sentences.length) {
    return self.postMessage({ type: 'search-results', id, results: [] });
  }
  const queryTokens = new Set(tokenize(query));
  const scored = sentences.map((s, i) => {
    const tokens = new Set(tokenize(s));
    let score = 0;
    queryTokens.forEach(qt => { if (tokens.has(qt)) score++; });
    score /= Math.max(queryTokens.size, 1);
    return { sentence: s, index: i, score };
  });
  const results = scored
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(r => ({ text: r.sentence, page: estimatePage(r.index), relevance: Math.round(r.score * 100) }));
  self.postMessage({ type: 'search-results', id, results });
}

// ---- Chat (simple Q&A) ----
function chat(id, { message }) {
  if (!documentText) {
    return self.postMessage({ type: 'chat-response', id, text: 'Veuillez d\'abord charger un document.' });
  }
  const q = message.toLowerCase();
  let answer = '';

  // Try to find relevant sentences
  const queryTokens = new Set(tokenize(message));
  const scored = sentences.map((s, i) => {
    const tokens = new Set(tokenize(s));
    let score = 0;
    queryTokens.forEach(qt => { if (tokens.has(qt)) score++; });
    return { sentence: s, score };
  }).sort((a, b) => b.score - a.score);

  const relevant = scored.filter(r => r.score > 0).slice(0, 3);

  if (relevant.length) {
    answer = 'D\'après le document :\n\n' + relevant.map(r => '• ' + r.sentence.trim()).join('\n\n');
  } else {
    // Generic responses
    if (q.includes('combien') || q.includes('nombre')) {
      answer = `Ce document contient environ ${sentences.length} phrases.`;
    } else if (q.includes('résume') || q.includes('résumé')) {
      const s = { ratio: 0.2 };
      const scored2 = scoreSentences(sentences, tfidf);
      scored2.sort((a, b) => b.score - a.score);
      const top = scored2.slice(0, 3);
      top.sort((a, b) => a.index - b.index);
      answer = top.map(s => s.sentence).join(' ');
    } else {
      answer = 'Je n\'ai pas trouvé de passage directement lié à votre question dans ce document. Essayez des mots-clés différents.';
    }
  }

  self.postMessage({ type: 'chat-response', id, text: answer });
}

// ---- TF-IDF ----
function buildTFIDF(sents) {
  const N = sents.length;
  const df = {};
  const tf = sents.map(s => {
    const tokens = tokenize(s);
    const freq = {};
    tokens.forEach(t => { freq[t] = (freq[t] || 0) + 1; });
    const total = tokens.length || 1;
    Object.keys(freq).forEach(t => {
      freq[t] /= total;
      df[t] = (df[t] || 0) + 1;
    });
    return freq;
  });
  const idf = {};
  Object.keys(df).forEach(t => { idf[t] = Math.log((N + 1) / (df[t] + 1)) + 1; });
  return { tf, idf };
}

function scoreSentences(sents, tfidf) {
  if (!tfidf) return sents.map((s, i) => ({ sentence: s, index: i, score: 0 }));
  return sents.map((s, i) => {
    const tokens = tokenize(s);
    let score = 0;
    tokens.forEach(t => {
      if (tfidf.tf[i] && tfidf.idf[t]) score += (tfidf.tf[i][t] || 0) * tfidf.idf[t];
    });
    score /= Math.max(tokens.length, 1);
    return { sentence: s, index: i, score };
  });
}

function tokenize(text) {
  return text.toLowerCase().replace(/[^a-zàâäéèêëîïôùûüç\s]/g, ' ').split(/\s+/).filter(w => w.length > 1);
}

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+|[\n]{2,}/)
    .map(s => s.trim())
    .filter(s => s.length > 15);
}

function estimatePage(sentenceIndex) {
  return Math.ceil((sentenceIndex + 1) / 30);
}
