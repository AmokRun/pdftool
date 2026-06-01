# Bibliothèques locales — Instructions d'installation

PDF Toolbox Ultimate fonctionne 100% localement. Pour activer toutes les fonctionnalités,
téléchargez les bibliothèques ci-dessous et placez-les dans les dossiers correspondants.

## Structure requise

```
libs/
├── pdfjs/
│   ├── pdf.min.js          ← PDF.js viewer
│   └── pdf.worker.min.js   ← PDF.js worker
├── pdflib/
│   └── pdf-lib.min.js      ← pdf-lib
├── tesseract/
│   ├── tesseract.min.js    ← Tesseract.js core
│   ├── worker.min.js       ← Tesseract worker
│   ├── tesseract-core.wasm.js
│   └── lang-data/
│       ├── fra.traineddata.gz
│       ├── eng.traineddata.gz
│       ├── deu.traineddata.gz
│       ├── spa.traineddata.gz
│       ├── ita.traineddata.gz
│       └── por.traineddata.gz
├── onnx/
│   └── ort.min.js          ← ONNX Runtime Web
└── webllm/
    └── index.js            ← WebLLM
```

## Sources de téléchargement

### PDF.js (Mozilla)
- Site: https://mozilla.github.io/pdf.js/
- GitHub: https://github.com/mozilla/pdf.js
- Télécharger la version "Prebuilt" et extraire pdf.min.js + pdf.worker.min.js

### pdf-lib
- Site: https://pdf-lib.js.org/
- GitHub: https://github.com/Hopding/pdf-lib
- Fichier direct: https://unpkg.com/pdf-lib/dist/pdf-lib.min.js

### Tesseract.js
- Site: https://tesseract.projectnaptha.com/
- GitHub: https://github.com/naptha/tesseract.js
- npm: télécharger via `npx tesseract.js-utils download` ou depuis les releases GitHub

### ONNX Runtime Web
- Site: https://onnxruntime.ai/
- GitHub: https://github.com/microsoft/onnxruntime
- Fichier direct: https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js

### WebLLM
- Site: https://webllm.mlc.ai/
- GitHub: https://github.com/mlc-ai/web-llm
- Note: nécessite un GPU compatible WebGPU et plusieurs GB de téléchargement

## Utilisation sans bibliothèques

L'application fonctionne sans les bibliothèques, avec des fonctionnalités réduites :
- Sans PDF.js : pas d'aperçu des pages
- Sans pdf-lib : pas de modification des PDF
- Sans Tesseract : pas d'OCR
- Sans WebLLM/ONNX : l'IA utilise l'algorithme extractif intégré

## Installation rapide (script)

Copiez ce script dans votre terminal pour télécharger automatiquement les bibliothèques
(nécessite curl ou wget et une connexion Internet UNE SEULE FOIS) :

```bash
#!/bin/bash
cd libs

# PDF.js
mkdir -p pdfjs && cd pdfjs
curl -L "https://github.com/mozilla/pdf.js/releases/latest/download/pdfjs-dist.zip" -o pdfjs.zip
unzip pdfjs.zip "build/pdf.min.js" "build/pdf.worker.min.js" -j
rm pdfjs.zip && cd ..

# pdf-lib
mkdir -p pdflib && cd pdflib
curl -L "https://unpkg.com/pdf-lib/dist/pdf-lib.min.js" -o pdf-lib.min.js
cd ..

echo "Done! Refresh index.html"
```
