/* =========================================================================
 * Paper Reader — app.js  (vanilla JS, no build step)
 * Features: dual-pane reader, view switch, in-app floating screenshots,
 *           font-scale slider, annotations on BOTH translation HTML and PDF.
 * ========================================================================= */
"use strict";

const ANNO_SEL = "p, div, section, article, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, pre, figure, figcaption, .fig-caption"; // annotatable blocks in translation HTML
const HL_COLORS = {
  yellow: "rgba(255,213,74,.45)",
  green: "rgba(124,255,178,.45)",
  blue: "rgba(126,200,255,.45)",
  pink: "rgba(255,158,203,.45)",
};
const PDF_SCALE = 1.3; // base render scale for PDF pages

const state = {
  papers: [],
  current: null,        // {folder, html, pdf}
  annotations: [],      // mixed: {source:'html'|'pdf', ...}
  bookmarks: [],        // reading-position bookmarks for current paper
  annoMode: false,
  syncMode: false,
  view: "both",
  fontScale: 1,         // 1 == 100%
  transBg: localStorage.getItem("pr_transBg") || "#14141c",
  transFg: localStorage.getItem("pr_transFg") || "#e6e6e6",
  pdfPages: {},         // page number -> .pdf-page wrapper element
};

const DEFAULT_THEME = { bg: "#14141c", fg: "#e6e6e6" };

// DOM refs
const $ = (id) => document.getElementById(id);
const library = $("library");
const paperList = $("paper-list");
const viewer = $("viewer");
const paneTrans = $("pane-translation");
const panePdf = $("pane-pdf");
const splitter = $("splitter");
const iframe = $("trans-frame");
const pdfScroll = $("pdf-scroll");
const pdfWrap = $("pdf-canvas-wrap");
const pdfStatus = $("pdf-status");
const emptyState = $("empty-state");
const annoPopup = $("anno-popup");
const noteEditor = $("note-editor");
const noteText = $("note-text");
const notesDrawer = $("notes-drawer");
const notesList = $("notes-list");
const floatLayer = $("float-layer");
const bmDrawer = $("bm-drawer");
const bmList = $("bm-list");

const API = {
  papers: "/api/papers",
  paper: (folder, file) => `/api/paper?folder=${enc(folder)}&file=${enc(file)}`,
  annoGet: (folder, file) => `/api/annotations?folder=${enc(folder)}&file=${enc(file)}`,
};
function enc(s) { return encodeURIComponent(s); }
function uid() { return (crypto.randomUUID ? crypto.randomUUID() : "a" + Date.now() + Math.random().toString(16).slice(2)); }
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/* ----------------------------------------------------------------------- */
/* Init                                                                     */
/* ----------------------------------------------------------------------- */
window.addEventListener("DOMContentLoaded", () => {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/static/vendor/pdf.worker.min.js";
  loadPapers();
  bindToolbar();
  bindSplitter();
  bindAnnoPopup();
  bindNoteEditor();
  bindPdfSelection();
  bindPdfClicks();
  bindFontScale();
  bindTransTheme();
  bindFolderPicker();
  bindBookmarks();
});

/* ----------------------------------------------------------------------- */
/* Paper library                                                            */
/* ----------------------------------------------------------------------- */
async function loadPapers() {
  try {
    const res = await fetch(API.papers);
    state.papers = await res.json();
  } catch (e) {
    paperList.innerHTML = `<div class="hint">无法连接服务器</div>`;
    return;
  }
  renderPaperList();
}

function renderPaperList() {
  if (!state.papers.length) {
    paperList.innerHTML = `<div class="hint">未找到论文文件夹</div>`;
    return;
  }
  paperList.innerHTML = "";
  for (const p of state.papers) {
    const div = document.createElement("div");
    div.className = "paper-item";
    div.dataset.folder = p.folder;
    const htmlName = p.html[0] || "（无翻译）";
    const pdfName = p.pdf[0] || "（无 PDF）";
    div.innerHTML = `<div class="t">${esc(p.title)}</div>
      <div class="m">译：${esc(htmlName)}</div>
      <div class="m">原：${esc(pdfName)}</div>`;
    div.addEventListener("click", () => openPaper(p));
    paperList.appendChild(div);
  }
}

async function openPaper(p) {
  state.current = { folder: p.folder, html: p.html[0] || null, pdf: p.pdf[0] || null };
  document.querySelectorAll(".paper-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.folder === p.folder);
  });
  emptyState.classList.add("hidden");

  // load annotations sidecar
  state.annotations = [];
  if (state.current.html) {
    try {
      const r = await fetch(API.annoGet(p.folder, state.current.html));
      const j = await r.json();
      state.annotations = j.annotations || [];
      state.bookmarks = j.bookmarks || [];
    } catch (e) { state.annotations = []; }
  }

  // load translation
  if (state.current.html) {
    const txt = await (await fetch(API.paper(p.folder, state.current.html))).text();
    iframe.srcdoc = txt;
  } else {
    iframe.srcdoc = "<body style='font-family:sans-serif;padding:20px;color:#888'>该论文没有翻译 HTML。</body>";
  }

  // load PDF
  pdfWrap.innerHTML = "";
  state.pdfPages = {};
  if (state.current.pdf) {
    pdfStatus.style.display = "";
    pdfStatus.textContent = "正在加载 PDF…";
    renderPDF(API.paper(p.folder, state.current.pdf));
  } else {
    pdfStatus.style.display = "";
    pdfStatus.textContent = "该论文没有 PDF 原文。";
  }

  applyView();
  applyFontScale();
  renderNotes();
  renderBookmarks();
}

/* ----------------------------------------------------------------------- */
/* PDF rendering (PDF.js) + text layer + highlight overlay                  */
/* ----------------------------------------------------------------------- */
async function renderPDF(url) {
  const pdf = await pdfjsLib.getDocument(url).promise;
  pdfWrap.innerHTML = "";
  state.pdfPages = {};
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: PDF_SCALE });

    const pageWrap = document.createElement("div");
    pageWrap.className = "pdf-page";
    pageWrap.dataset.page = n;
    pageWrap.style.width = viewport.width + "px";
    pageWrap.style.height = viewport.height + "px";

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    pageWrap.appendChild(canvas);
    pdfWrap.appendChild(pageWrap);
    state.pdfPages[n] = pageWrap;

    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

    // text layer (makes original text selectable -> enables annotation)
    try {
      const textContent = await page.getTextContent();
      const tl = document.createElement("div");
      tl.className = "textLayer";
      tl.style.width = viewport.width + "px";
      tl.style.height = viewport.height + "px";
      pageWrap.appendChild(tl);
      const textLayer = new pdfjsLib.TextLayer({ textContentSource: textContent, container: tl, viewport });
      await textLayer.render();
    } catch (e) { /* text layer is optional */ }

    // highlight overlay layer (above text, below nothing)
    const hl = document.createElement("div");
    hl.className = "pdf-hl-layer";
    pageWrap.appendChild(hl);
  }
  pdfStatus.style.display = "none";

  applyFontScale();
  // redraw any saved PDF annotations
  for (const a of state.annotations) if (a.source === "pdf") drawPdfHighlight(a);
}

/* ----------------------------------------------------------------------- */
/* View modes                                                               */
/* ----------------------------------------------------------------------- */
function applyView() {
  const v = state.view;
  paneTrans.classList.toggle("hidden", v === "original");
  panePdf.classList.toggle("hidden", v === "translation");
  splitter.classList.toggle("hidden", v !== "both");
  // Clear inline flex left by splitter dragging so single-pane views go full width
  if (v !== "both") {
    paneTrans.style.flex = "";
    panePdf.style.flex = "";
  }
  document.querySelectorAll("#view-seg .seg-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === v));
  applyFontScale();
}

function bindToolbar() {
  $("btn-library").addEventListener("click", () => library.classList.toggle("collapsed"));

  document.querySelectorAll("#view-seg .seg-btn").forEach((b) =>
    b.addEventListener("click", () => { state.view = b.dataset.mode; applyView(); }));

  const btnAnno = $("btn-anno");
  btnAnno.addEventListener("click", () => {
    state.annoMode = !state.annoMode;
    btnAnno.classList.toggle("off", !state.annoMode);
    btnAnno.classList.toggle("on", state.annoMode);
    btnAnno.textContent = state.annoMode ? "🖊 标注：开" : "🖊 标注：关";
    if (!state.annoMode) annoPopup.classList.add("hidden");
  });

  const btnSync = $("btn-sync");
  btnSync.addEventListener("click", () => {
    state.syncMode = !state.syncMode;
    btnSync.classList.toggle("off", !state.syncMode);
    btnSync.classList.toggle("on", state.syncMode);
    btnSync.textContent = state.syncMode ? "🔗 同步：开" : "🔗 同步：关";
  });

  $("btn-shot").addEventListener("click", takeScreenshot);
  $("btn-notes").addEventListener("click", () => notesDrawer.classList.toggle("open"));
  $("btn-notes-close").addEventListener("click", () => notesDrawer.classList.remove("open"));
  $("btn-bookmarks").addEventListener("click", () => bmDrawer.classList.toggle("open"));
  $("bm-close").addEventListener("click", () => bmDrawer.classList.remove("open"));
  $("bm-add").addEventListener("click", addBookmark);
}

function bindTransTheme() {
  const bg = $("trans-bg"), fg = $("trans-fg"), reset = $("btn-theme-reset");
  bg.value = state.transBg; fg.value = state.transFg;
  const save = () => {
    localStorage.setItem("pr_transBg", state.transBg);
    localStorage.setItem("pr_transFg", state.transFg);
  };
  bg.addEventListener("input", () => { state.transBg = bg.value; save(); applyTransTheme(); });
  fg.addEventListener("input", () => { state.transFg = fg.value; save(); applyTransTheme(); });
  reset.addEventListener("click", () => {
    state.transBg = DEFAULT_THEME.bg; state.transFg = DEFAULT_THEME.fg;
    bg.value = state.transBg; fg.value = state.transFg; save(); applyTransTheme();
  });
}

/* ----------------------------------------------------------------------- */
/* Folder picker — let user choose literature folder                       */
/* ----------------------------------------------------------------------- */
function bindFolderPicker() {
  const btn = $("btn-pick-folder");
  const picker = $("folder-picker");
  const pathDisplay = $("folder-path");

  // Show saved folder path on load
  const savedPath = localStorage.getItem("pr_litFolder") || "";
  if (savedPath) showPath(savedPath);

  btn.addEventListener("click", () => picker.click());

  picker.addEventListener("change", async () => {
    if (!picker.files.length) return;
    // Extract folder from first file's webkitRelativePath: "folder/subfolder/file.html" → "C:/.../folder"
    const firstPath = picker.files[0].webkitRelativePath;
    const folderName = firstPath.split("/")[0];
    // We can't get the real full path from webkitdirectory (browser security),
    // so we send the folder name to server and it resolves relative to current LIT_ROOT parent.
    // Actually, better approach: send to server, server returns its resolved path.
    try {
      const resp = await fetch("/api/set-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_name: folderName }),
      });
      const data = await resp.json();
      if (data.ok && data.path) {
        localStorage.setItem("pr_litFolder", data.path);
        showPath(data.path);
        loadPapers(); // reload paper list
      } else {
        alert("切换文件夹失败：" + (data.error || "未知错误"));
      }
    } catch (e) {
      alert("请求失败：" + e.message);
    }
    // Reset picker so same folder can be re-selected
    picker.value = "";
  });

  function showPath(p) {
    pathDisplay.textContent = "📁 " + p;
    pathDisplay.title = p;
  }
}

/* ----------------------------------------------------------------------- */
/* Font scale                                                               */
/* ----------------------------------------------------------------------- */
function bindFontScale() {
  const slider = $("font-scale");
  slider.addEventListener("input", () => {
    state.fontScale = Number(slider.value) / 100;
    $("font-val").textContent = slider.value + "%";
    applyFontScale();
  });
}

function applyFontScale() {
  const s = state.fontScale;
  if (iframeDoc) iframeDoc.documentElement.style.zoom = s;
  pdfWrap.style.zoom = s;
}

/* ----------------------------------------------------------------------- */
/* Splitter (resize panes)                                                  */
/* ----------------------------------------------------------------------- */
function bindSplitter() {
  let dragging = false;
  splitter.addEventListener("mousedown", (e) => {
    dragging = true; e.preventDefault();
    // Prevent iframe from stealing mouse events during drag
    iframe.style.pointerEvents = "none";
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const rect = viewer.getBoundingClientRect();
    let w = e.clientX - rect.left;
    w = Math.max(200, Math.min(rect.width - 200, w));
    paneTrans.style.flex = `0 0 ${w}px`;
    panePdf.style.flex = "1 1 0";
  });
  window.addEventListener("mouseup", () => {
    if (dragging) { dragging = false; iframe.style.pointerEvents = ""; }
  });
}

/* ----------------------------------------------------------------------- */
/* Annotation system (translation iframe)                                    */
/* ----------------------------------------------------------------------- */
let iframeDoc = null;
let pendingRange = null; // {source, block, start, end, text} | {source:'pdf', page, rects, text}

iframe.addEventListener("load", () => {
  iframeDoc = iframe.contentDocument;
  if (!iframeDoc) return;
  injectAnnoStyles();
  markBlocks();
  bindIframeSelection();
  bindIframeClicks();
  // translation annotations
  for (const a of state.annotations) if (a.source !== "pdf") applyHtmlAnnotation(a);
  applyFontScale();
  applyTransTheme();
  bindIframeScrollSync();
});

// Apply user-chosen background / font colors to the translation iframe.
function applyTransTheme() {
  if (!iframeDoc) return;
  let st = iframeDoc.getElementById("reader-trans-theme");
  if (!st) {
    st = iframeDoc.createElement("style");
    st.id = "reader-trans-theme";
    iframeDoc.head.appendChild(st);
  }
  const bg = state.transBg, fg = state.transFg;
  st.textContent =
    /* Override EVERY element's background so dark-themed inner containers (.paper-header, .container, etc.) also change */
    `html, body { background: ${bg} !important; color: ${fg} !important; }\n` +
    `body *, body *::before, body *::after { background-color: ${bg} !important; color: ${fg} !important; border-color: ${fg}33 !important; }\n` +
    /* Preserve images / canvases / iframes from being painted over */
    `img, canvas, svg, iframe, video { background: transparent !important; }\n` +
    /* Selection highlight */
    `::selection { background: ${HL_COLORS.yellow} !important; color: #000 !important; }`;
}

function injectAnnoStyles() {
  if (iframeDoc.getElementById("anno-style")) return;
  const st = iframeDoc.createElement("style");
  st.id = "anno-style";
  st.textContent = `
    .anno-hl { border-radius:3px; cursor:pointer; padding:0 1px; }
    .anno-note-mark { font-size:.7em; color:#ffd54a; cursor:pointer; vertical-align:super; }
  `;
  iframeDoc.head.appendChild(st);
}

function markBlocks() {
  const blocks = iframeDoc.querySelectorAll(ANNO_SEL);
  blocks.forEach((b, i) => b.setAttribute("data-bidx", String(i)));
  // Also tag the body as a fallback block so annotations on unmatched elements survive reload
  if (!iframeDoc.body.hasAttribute("data-bidx")) {
    iframeDoc.body.setAttribute("data-bidx", String(blocks.length));
  }
}

function blockOf(node) {
  let el = node.nodeType === 3 ? node.parentElement : node;
  while (el && el !== iframeDoc.body) {
    if (el.matches && el.matches(ANNO_SEL)) return el;
    el = el.parentElement;
  }
  // Fallback: allow annotating any text even if it's not inside a "known" block
  // (e.g. text inside <span>, <a>, <em>, or bare text nodes in a <div>-heavy layout)
  return iframeDoc.body;
}

function offsetInBlock(block, container, off) {
  let total = 0;
  const walker = iframeDoc.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
  let n;
  while ((n = walker.nextNode())) {
    if (n === container) return total + off;
    total += n.textContent.length;
  }
  if (container === block) {
    let acc = 0;
    for (let i = 0; i < off; i++) acc += block.childNodes[i].textContent.length;
    return acc;
  }
  return total;
}

function buildRange(block, start, end) {
  const walker = iframeDoc.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
  let n, pos = 0, sNode = null, sOff = 0, eNode = null, eOff = 0;
  while ((n = walker.nextNode())) {
    const len = n.textContent.length;
    if (sNode === null && pos + len >= start) { sNode = n; sOff = start - pos; }
    if (pos + len >= end) { eNode = n; eOff = end - pos; break; }
    pos += len;
  }
  if (!sNode) { sNode = block; sOff = 0; }
  if (!eNode) { eNode = block; eOff = block.textContent.length; }
  const r = iframeDoc.createRange();
  r.setStart(sNode, sOff);
  r.setEnd(eNode, eOff);
  return r;
}

function wrapRange(block, start, end) {
  const r = buildRange(block, start, end);
  const span = iframeDoc.createElement("span");
  span.className = "anno-hl";
  span.appendChild(r.extractContents());
  r.insertNode(span);
  return span;
}

function bindIframeSelection() {
  iframeDoc.addEventListener("mouseup", () => {
    if (!state.annoMode) return;
    setTimeout(handleHtmlSelection, 10);
  });
}

function handleHtmlSelection() {
  const sel = iframeDoc.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) { annoPopup.classList.add("hidden"); return; }
  const range = sel.getRangeAt(0);
  const block = blockOf(range.startContainer);
  if (!block) { annoPopup.classList.add("hidden"); return; }
  const start = offsetInBlock(block, range.startContainer, range.startOffset);
  const endBlock = blockOf(range.endContainer);
  const end = (endBlock === block)
    ? offsetInBlock(block, range.endContainer, range.endOffset)
    : block.textContent.length;
  if (end <= start) { annoPopup.classList.add("hidden"); return; }
  pendingRange = { source: "html", block, start, end, text: block.textContent.slice(start, end) };
  positionPopup(range.getBoundingClientRect());
}

function applyHtmlAnnotation(a) {
  if (!iframeDoc) return;
  const block = iframeDoc.querySelector(`[data-bidx="${a.bidx}"]`);
  if (!block) return;
  try {
    const span = wrapRange(block, a.start, a.end);
    span.setAttribute("data-anno-id", a.id);
    span.style.background = HL_COLORS[a.color] || HL_COLORS.yellow;
    if (a.note) addNoteMark(span, a.id);
  } catch (e) { /* skip */ }
}

function bindIframeClicks() {
  iframeDoc.addEventListener("click", (e) => {
    const hl = e.target.closest && e.target.closest(".anno-hl");
    if (hl) {
      const id = hl.getAttribute("data-anno-id");
      const ann = state.annotations.find((x) => x.id === id);
      openNoteEditor(hl, ann ? ann.note : "");
    }
  });
}

/* ----------------------------------------------------------------------- */
/* Annotation system (PDF original)                                          */
/* ----------------------------------------------------------------------- */
function bindPdfSelection() {
  pdfScroll.addEventListener("mouseup", () => {
    if (!state.annoMode) return;
    setTimeout(handlePdfSelection, 10);
  });
}

function handlePdfSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  const startEl = node.nodeType === 3 ? node.parentElement : node;
  const pageWrap = startEl ? startEl.closest(".pdf-page") : null;
  if (!pageWrap) return;
  const page = Number(pageWrap.dataset.page);
  const wrapRect = pageWrap.getBoundingClientRect();
  const zoom = state.fontScale || 1;
  const rects = [];
  for (const r of range.getClientRects()) {
    rects.push({
      x: (r.left - wrapRect.left) / zoom,
      y: (r.top - wrapRect.top) / zoom,
      w: r.width / zoom,
      h: r.height / zoom,
    });
  }
  if (!rects.length) return;
  const text = (range.toString() || "").replace(/\s+/g, " ").trim();
  pendingRange = { source: "pdf", page, rects, text };
  positionPopup(range.getBoundingClientRect());
}

function drawPdfHighlight(a) {
  const pageWrap = state.pdfPages[a.page];
  if (!pageWrap) return;
  const hl = pageWrap.querySelector(".pdf-hl-layer");
  if (!hl) return;
  for (const r of a.rects) {
    const d = document.createElement("div");
    d.className = "pdf-hl" + (a.note ? " has-note" : "");
    d.setAttribute("data-anno-id", a.id);
    d.style.left = r.x + "px";
    d.style.top = r.y + "px";
    d.style.width = r.w + "px";
    d.style.height = r.h + "px";
    d.style.background = HL_COLORS[a.color] || HL_COLORS.yellow;
    hl.appendChild(d);
  }
}

function bindPdfClicks() {
  pdfScroll.addEventListener("click", (e) => {
    const mk = e.target.closest && e.target.closest(".pdf-hl");
    if (!mk) return;
    const id = mk.getAttribute("data-anno-id");
    const ann = state.annotations.find((x) => x.id === id);
    openNoteEditor(mk, ann ? ann.note : "");
  });
}

/* ----------------------------------------------------------------------- */
/* Annotation creation / popup                                              */
/* ----------------------------------------------------------------------- */
function bindAnnoPopup() {
  annoPopup.querySelectorAll(".swatch").forEach((sw) => {
    sw.addEventListener("click", () => {
      if (pendingRange) createHighlight(pendingRange, sw.dataset.color, null);
      annoPopup.classList.add("hidden");
    });
  });
  $("anno-note").addEventListener("click", () => {
    if (pendingRange) {
      const el = createHighlight(pendingRange, "yellow", "");
      openNoteEditor(el, "");
    }
    annoPopup.classList.add("hidden");
  });
  $("anno-cancel").addEventListener("click", () => annoPopup.classList.add("hidden"));
}

function positionPopup(rect) {
  annoPopup.classList.remove("hidden");
  annoPopup.style.position = "fixed";
  let x = rect.left + rect.width / 2 - 90;
  let y = rect.bottom + 8;
  x = Math.max(8, Math.min(window.innerWidth - 200, x));
  y = Math.min(window.innerHeight - 60, y);
  annoPopup.style.left = x + "px";
  annoPopup.style.top = y + "px";
}

function createHighlight(rng, color, note) {
  const id = uid();
  const ann = { id, color, note: note || "", source: rng.source || "html" };
  let el = null;
  if (rng.source === "pdf") {
    ann.page = rng.page;
    ann.rects = rng.rects;
    ann.text = rng.text || "";
    drawPdfHighlight(ann);
    el = document.querySelector(`.pdf-hl[data-anno-id="${id}"]`);
  } else {
    const span = wrapRange(rng.block, rng.start, rng.end);
    span.setAttribute("data-anno-id", id);
    span.style.background = HL_COLORS[color] || HL_COLORS.yellow;
    ann.bidx = Number(rng.block.getAttribute("data-bidx"));
    ann.start = rng.start;
    ann.end = rng.end;
    ann.text = rng.text;
    if (note) addNoteMark(span, id);
    el = span;
  }
  state.annotations.push(ann);
  saveAnnotations();
  renderNotes();
  return el;
}

function addNoteMark(span, id) {
  if (span.nextSibling && span.nextSibling.classList && span.nextSibling.classList.contains("anno-note-mark")) return;
  const m = iframeDoc.createElement("span");
  m.className = "anno-note-mark";
  m.setAttribute("data-anno-id", id);
  m.textContent = "📝";
  span.parentNode.insertBefore(m, span.nextSibling);
}

/* ----------------------------------------------------------------------- */
/* Note editor                                                              */
/* ----------------------------------------------------------------------- */
let editingId = null;

function openNoteEditor(el, note) {
  if (!el) return;
  editingId = el.getAttribute("data-anno-id");
  noteText.value = note || "";
  noteEditor.classList.remove("hidden");
  noteEditor.style.position = "fixed";
  const r = el.getBoundingClientRect();
  let x = r.left, y = r.bottom + 8;
  x = Math.max(8, Math.min(window.innerWidth - 320, x));
  y = Math.min(window.innerHeight - 200, y);
  noteEditor.style.left = x + "px";
  noteEditor.style.top = y + "px";
  noteText.focus();
}

function bindNoteEditor() {
  $("ne-save").addEventListener("click", () => {
    const ann = state.annotations.find((x) => x.id === editingId);
    if (ann) {
      ann.note = noteText.value.trim();
      if (ann.source === "pdf") {
        const mark = document.querySelector(`.pdf-hl[data-anno-id="${editingId}"]`);
        if (mark) mark.classList.toggle("has-note", !!ann.note);
      } else {
        const span = iframeDoc.querySelector(`.anno-hl[data-anno-id="${editingId}"]`);
        if (ann.note) { if (span) addNoteMark(span, editingId); }
        else { const m = iframeDoc.querySelector(`.anno-note-mark[data-anno-id="${editingId}"]`); if (m) m.remove(); }
      }
      saveAnnotations();
      renderNotes();
    }
    noteEditor.classList.add("hidden");
  });
  $("ne-cancel").addEventListener("click", () => noteEditor.classList.add("hidden"));
  $("ne-delete").addEventListener("click", () => { deleteAnnotation(editingId); noteEditor.classList.add("hidden"); });
}

function deleteAnnotation(id) {
  const ann = state.annotations.find((x) => x.id === id);
  if (!ann) return;
  if (ann.source === "pdf") {
    document.querySelectorAll(`.pdf-hl[data-anno-id="${id}"]`).forEach((e) => e.remove());
  } else {
    const span = iframeDoc.querySelector(`.anno-hl[data-anno-id="${id}"]`);
    if (span) unwrap(span);
    const m = iframeDoc.querySelector(`.anno-note-mark[data-anno-id="${id}"]`);
    if (m) m.remove();
  }
  state.annotations = state.annotations.filter((x) => x.id !== id);
  saveAnnotations();
  renderNotes();
}

function unwrap(span) {
  const parent = span.parentNode;
  while (span.firstChild) parent.insertBefore(span.firstChild, span);
  parent.removeChild(span);
  parent.normalize();
}

/* ----------------------------------------------------------------------- */
/* Notes drawer                                                             */
/* ----------------------------------------------------------------------- */
function renderNotes() {
  const withNotes = state.annotations.filter((a) => a.note && a.note.trim());
  if (!withNotes.length) {
    notesList.innerHTML = `<div class="hint">暂无笔记</div>`;
    return;
  }
  notesList.innerHTML = "";
  withNotes.forEach((a) => {
    const tag = a.source === "pdf" ? `原文 P${a.page}` : "翻译";
    const div = document.createElement("div");
    div.className = "note-item";
    div.innerHTML = `<span class="del" data-id="${a.id}">删除</span>
      <span class="ntag">${esc(tag)}</span>
      <div class="quote">${esc((a.text || "").slice(0, 60))}</div>
      <div class="body">${esc(a.note)}</div>`;
    div.addEventListener("click", (e) => {
      if (e.target.classList.contains("del")) { deleteAnnotation(a.id); return; }
      if (a.source === "pdf") {
        const pw = state.pdfPages[a.page];
        if (pw) pw.scrollIntoView({ block: "center", behavior: "smooth" });
      } else {
        const span = iframeDoc.querySelector(`.anno-hl[data-anno-id="${a.id}"]`);
        if (span) span.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });
    notesList.appendChild(div);
  });
}

/* ----------------------------------------------------------------------- */
/* Save annotations (debounced POST)                                        */
/* ----------------------------------------------------------------------- */
let saveTimer = null;
function saveAnnotations() {
  if (!state.current || !state.current.html) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fetch("/api/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder: state.current.folder,
          html: state.current.html,
          annotations: state.annotations,
          bookmarks: state.bookmarks,
        }),
      });
    } catch (e) { /* ignore */ }
  }, 300);
}

/* ----------------------------------------------------------------------- */
/* Scroll sync                                                              */
/* ----------------------------------------------------------------------- */
let syncing = false;
function ratio(el) {
  const denom = el.scrollHeight - el.clientHeight;
  return denom > 0 ? el.scrollTop / denom : 0;
}
function setIframeRatio(r) {
  const se = iframeDoc && iframeDoc.scrollingElement;
  if (!se) return;
  se.scrollTop = r * (se.scrollHeight - se.clientHeight);
}
function bindIframeScrollSync() {
  if (!iframe.contentWindow) return;
  iframe.contentWindow.addEventListener("scroll", () => {
    if (!state.syncMode || syncing) return;
    syncing = true;
    setPdfRatio(ratio(iframe.contentWindow.document.scrollingElement || iframeDoc.body));
    setTimeout(() => (syncing = false), 60);
  });
}
function setPdfRatio(r) {
  pdfScroll.scrollTop = r * (pdfScroll.scrollHeight - pdfScroll.clientHeight);
}
pdfScroll.addEventListener("scroll", () => {
  if (!state.syncMode || syncing || !iframeDoc) return;
  syncing = true;
  setIframeRatio(ratio(pdfScroll));
  setTimeout(() => (syncing = false), 60);
});

/* ----------------------------------------------------------------------- */
/* Reading-position bookmarks                                              */
/* ----------------------------------------------------------------------- */
function bindBookmarks() {
  // events bound in bindToolbar (btn-bookmarks / bm-close / bm-add)
}

// Best-effort label: the nearest heading above the current translation scroll.
function currentHeadingLabel() {
  if (!iframeDoc) return "";
  const se = iframeDoc.scrollingElement || iframeDoc.documentElement;
  const topNat = se.scrollTop; // natural (unzoomed) scroll offset
  let label = "";
  const heads = iframeDoc.querySelectorAll("h1,h2,h3,h4,h5,h6");
  for (const h of heads) {
    // rect.top is in zoomed screen px; convert to natural by dividing by zoom
    const z = state.fontScale || 1;
    const natTop = h.getBoundingClientRect().top / z + topNat;
    if (natTop <= topNat + 40) label = h.textContent.trim();
    else break;
  }
  return label;
}

function addBookmark() {
  if (!state.current || !state.current.html) { alert("请先打开一篇论文。"); return; }
  const se = iframeDoc && (iframeDoc.scrollingElement || iframeDoc.documentElement);
  const bm = {
    id: uid(),
    view: state.view,
    fontScale: state.fontScale,
    transScroll: se ? se.scrollTop : 0,
    pdfScroll: pdfScroll.scrollTop || 0,
    label: currentHeadingLabel() || ("书签 " + (state.bookmarks.length + 1)),
    created: Date.now(),
  };
  state.bookmarks.push(bm);
  saveAnnotations();
  renderBookmarks();
  bmDrawer.classList.add("open");
}

function renderBookmarks() {
  if (!state.bookmarks.length) {
    bmList.innerHTML = `<div class="hint">暂无书签。点「＋ 添加当前位置」保存阅读进度，下次一键跳回。</div>`;
    return;
  }
  // newest first
  const sorted = state.bookmarks.slice().sort((a, b) => b.created - a.created);
  bmList.innerHTML = "";
  for (const bm of sorted) {
    const viewName = bm.view === "translation" ? "翻译" : bm.view === "original" ? "原文" : "双栏";
    const t = new Date(bm.created);
    const ts = `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
    const div = document.createElement("div");
    div.className = "bm-item";
    div.innerHTML = `<div class="bm-label">🔖 ${esc(bm.label)}</div>
      <div class="bm-meta">${viewName} · ${Math.round((bm.fontScale || 1) * 100)}% · ${ts}</div>
      <div class="bm-actions">
        <button class="bm-go" data-id="${bm.id}">跳转</button>
        <button class="bm-ren" data-id="${bm.id}">重命名</button>
        <button class="bm-del" data-id="${bm.id}">删除</button>
      </div>`;
    div.addEventListener("click", (e) => {
      if (e.target.classList.contains("bm-go")) { applyBookmark(bm.id); return; }
      if (e.target.classList.contains("bm-del")) { deleteBookmark(bm.id); return; }
      if (e.target.classList.contains("bm-ren")) { renameBookmark(bm.id); return; }
    });
    bmList.appendChild(div);
  }
}

function applyBookmark(id) {
  const bm = state.bookmarks.find((x) => x.id === id);
  if (!bm) return;
  // 1) restore view
  state.view = bm.view || "both";
  applyView();
  // 2) restore zoom
  const s = bm.fontScale || 1;
  state.fontScale = s;
  const slider = $("font-scale");
  if (slider) { slider.value = Math.round(s * 100); $("font-val").textContent = Math.round(s * 100) + "%"; }
  applyFontScale();
  // 3) restore scroll positions (after view/zoom applied)
  const se = iframeDoc && (iframeDoc.scrollingElement || iframeDoc.documentElement);
  if (se && bm.view !== "original") {
    // defer one frame so layout settles after view switch
    requestAnimationFrame(() => { se.scrollTop = bm.transScroll || 0; });
  }
  if (bm.view !== "translation") {
    pdfScroll.scrollTop = bm.pdfScroll || 0;
  }
}

function renameBookmark(id) {
  const bm = state.bookmarks.find((x) => x.id === id);
  if (!bm) return;
  const name = prompt("书签名称：", bm.label);
  if (name === null) return;
  bm.label = name.trim() || bm.label;
  saveAnnotations();
  renderBookmarks();
}

function deleteBookmark(id) {
  state.bookmarks = state.bookmarks.filter((x) => x.id !== id);
  saveAnnotations();
  renderBookmarks();
}

/* ----------------------------------------------------------------------- */
/* Screenshots (region-select + floating window)                          */
/* ----------------------------------------------------------------------- */
function takeScreenshot() {
  const overlay = $("shot-overlay");
  const sel = $("shot-sel");
  overlay.classList.remove("hidden");
  sel.style.display = "none";

  let startX = 0, startY = 0, drawing = false;

  const move = (e) => {
    if (!drawing) return;
    const x1 = Math.min(startX, e.clientX), y1 = Math.min(startY, e.clientY);
    const x2 = Math.max(startX, e.clientX), y2 = Math.max(startY, e.clientY);
    sel.style.display = "block";
    sel.style.left = x1 + "px"; sel.style.top = y1 + "px";
    sel.style.width = (x2 - x1) + "px"; sel.style.height = (y2 - y1) + "px";
  };
  const finish = (e) => {
    if (!drawing) return;
    drawing = false;
    overlay.removeEventListener("mousemove", move);
    overlay.removeEventListener("mouseup", finish);
    const x1 = Math.min(startX, e.clientX), y1 = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX), h = Math.abs(e.clientY - startY);
    if (w < 8 || h < 8) { overlay.classList.add("hidden"); return; } // too small → cancel
    captureRegion(x1, y1, w, h);
  };
  const start = (e) => {
    drawing = true; startX = e.clientX; startY = e.clientY;
    sel.style.display = "none";
    overlay.addEventListener("mousemove", move);
    overlay.addEventListener("mouseup", finish);
  };
  overlay.addEventListener("mousedown", start);

  const onKey = (e) => {
    if (e.key === "Escape") { overlay.classList.add("hidden"); cleanup(); }
  };
  const cleanup = () => {
    overlay.removeEventListener("mousedown", start);
    overlay.removeEventListener("mousemove", move);
    overlay.removeEventListener("mouseup", finish);
    window.removeEventListener("keydown", onKey);
  };
  window.addEventListener("keydown", onKey);
  overlay._cleanup = cleanup;
}

async function captureRegion(selX, selY, selW, selH) {
  const overlay = $("shot-overlay");
  overlay.classList.add("hidden"); // hide mask before capture

  try {
    const transVisible = !paneTrans.classList.contains("hidden");
    const pdfVisible = !panePdf.classList.contains("hidden");
    const iframeRect = iframe.getBoundingClientRect(); // iframe viewport (excludes the 30px pane head)
    const pdfRect = pdfScroll.getBoundingClientRect();

    let finalCanvas = null;

    if (transVisible && !pdfVisible) {
      // === Only the translation pane is shown (standalone translation view) ===
      finalCanvas = await captureIframeRegion(iframeRect, selX, selY, selW, selH);
    } else if (pdfVisible && !transVisible) {
      // === Only the PDF pane is shown ===
      finalCanvas = await capturePdfRegion(pdfRect, selX, selY, selW, selH);
    } else if (transVisible && pdfVisible) {
      // === Both panes shown — route by which one(s) the selection overlaps ===
      const selRight = selX + selW, selBottom = selY + selH;
      const hitT = !(selX > iframeRect.right || selRight < iframeRect.left ||
                     selY > iframeRect.bottom || selBottom < iframeRect.top);
      const hitP = !(selX > pdfRect.right || selRight < pdfRect.left ||
                     selY > pdfRect.bottom || selBottom < pdfRect.top);
      if (hitT && hitP) finalCanvas = await captureCompositeRegion(iframeRect, pdfRect, selX, selY, selW, selH);
      else if (hitT) finalCanvas = await captureIframeRegion(iframeRect, selX, selY, selW, selH);
      else if (hitP) finalCanvas = await capturePdfRegion(pdfRect, selX, selY, selW, selH);
      else return; // selection outside both panes → nothing to capture
    }

    if (!finalCanvas) return;
    addFloatImage(finalCanvas.toDataURL("image/png"), selX, selY, selW, selH);
  } catch (e) {
    alert("截图失败：" + (e && e.message ? e.message : e));
  } finally {
    if (overlay._cleanup) overlay._cleanup();
  }
}

/* ---- Capture translation iframe region (zoom-aware; fixes blank / offset) ---- */
async function captureIframeRegion(paneRect, selX, selY, selW, selH) {
  if (!iframeDoc || !iframeDoc.body) { alert("翻译内容未加载。"); return null; }

  const z = state.fontScale || 1; // CSS zoom applied to the iframe (font slider)

  // html2canvas lays out elements via getBoundingClientRect(), which ALREADY
  // includes the CSS `zoom`. So the rendered canvas is in the *zoomed* pixel
  // space, NOT the un-zoomed `scale` space. We therefore derive the true
  // px-per-natural-content ratio empirically from the actual canvas rather
  // than assuming it equals `scale`. This keeps the crop exact at any zoom.
  const bodyCanvas = await html2canvas(iframeDoc.body, {
    backgroundColor: null,
    scale: 2,
    logging: false,
    useCORS: true,
    window: iframe.contentWindow,
  });
  if (!bodyCanvas.width || !bodyCanvas.height) return null;

  const natW = iframeDoc.body.scrollWidth || bodyCanvas.width / 2;
  const natH = iframeDoc.body.scrollHeight || bodyCanvas.height / 2;
  const rx = bodyCanvas.width / natW; // canvas px per natural px (≈ z*2 when zoomed)
  const ry = bodyCanvas.height / natH;

  const scrollLeft = iframeDoc.documentElement.scrollLeft || iframeDoc.body.scrollLeft || 0;
  const scrollTop  = iframeDoc.documentElement.scrollTop  || iframeDoc.body.scrollTop  || 0;

  // Screen selection (already zoom-scaled) → natural content px, then → canvas px.
  const natX = (selX - paneRect.left) / z + scrollLeft;
  const natY = (selY - paneRect.top) / z + scrollTop;
  const natWsel = selW / z;
  const natHsel = selH / z;

  let cx = natX * rx, cy = natY * ry;
  let cw = natWsel * rx, ch = natHsel * ry;

  // Clamp to the captured canvas (also handles selections that start off-canvas)
  if (cx < 0) { cw += cx; cx = 0; }
  if (cy < 0) { ch += cy; cy = 0; }
  if (cx + cw > bodyCanvas.width) cw = bodyCanvas.width - cx;
  if (cy + ch > bodyCanvas.height) ch = bodyCanvas.height - cy;
  if (cw <= 0 || ch <= 0) return null;

  const cropped = document.createElement("canvas");
  cropped.width = Math.round(cw); cropped.height = Math.round(ch);
  cropped.getContext("2d").drawImage(bodyCanvas, cx, cy, cw, ch, 0, 0, cw, ch);
  return cropped;
}

/* ---- Capture PDF region: read PDF.js canvases directly (zoom-aware) ---- */
async function capturePdfRegion(paneRect, selX, selY, selW, selH) {
  const S = 2; // retina output
  const z = state.fontScale || 1; // CSS zoom applied to the PDF wrap
  const outW = Math.round(selW * S);
  const outH = Math.round(selH * S);
  if (outW <= 0 || outH <= 0) return null;

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#ffffff"; // PDF pages are white
  ctx.fillRect(0, 0, outW, outH);

  const selRight = selX + selW;
  const selBottom = selY + selH;
  const pages = pdfScroll.querySelectorAll(".pdf-page");

  for (const pageWrap of pages) {
    const pRect = pageWrap.getBoundingClientRect(); // zoomed screen rect
    const overlapL = Math.max(selX, pRect.left);
    const overlapR = Math.min(selRight, pRect.right);
    const overlapT = Math.max(selY, pRect.top);
    const overlapB = Math.min(selBottom, pRect.bottom);
    if (overlapR <= overlapL || overlapB <= overlapT) continue;

    const pageCanvas = pageWrap.querySelector("canvas");
    if (!pageCanvas) continue;

    // Screen overlap → natural canvas pixels (divide out the zoom)
    let srcX = (overlapL - pRect.left) / z;
    let srcY = (overlapT - pRect.top) / z;
    let srcW = (overlapR - overlapL) / z;
    let srcH = (overlapB - overlapT) / z;

    if (srcX < 0) { srcW += srcX; srcX = 0; }
    if (srcY < 0) { srcH += srcY; srcY = 0; }
    if (srcX + srcW > pageCanvas.width) srcW = pageCanvas.width - srcX;
    if (srcY + srcH > pageCanvas.height) srcH = pageCanvas.height - srcY;
    if (srcW <= 0 || srcH <= 0) continue;

    // Destination is positioned in the (screen * S) output canvas
    const dstX = (overlapL - selX) * S;
    const dstY = (overlapT - selY) * S;
    const dstW = (overlapR - overlapL) * S;
    const dstH = (overlapB - overlapT) * S;
    ctx.drawImage(pageCanvas, srcX, srcY, srcW, srcH, dstX, dstY, dstW, dstH);
  }

  return out;
}

/* ---- Composite: selection spans both panes ---- */
async function captureCompositeRegion(transRect, pdfRect, selX, selY, selW, selH) {
  const comp = document.createElement("canvas");
  comp.width = Math.round(selW * 2); comp.height = Math.round(selH * 2); // scale=2
  const ctx = comp.getContext("2d");

  // Draw translation part (if overlapping)
  if (iframeDoc && iframeDoc.body) {
    try {
      const tCanvas = await captureIframeRegion(transRect, selX, selY, selW, selH);
      if (tCanvas) {
        const tx = Math.max(0, (transRect.left - selX) * 2);
        const ty = Math.max(0, (transRect.top - selY) * 2);
        ctx.drawImage(tCanvas, tx, ty);
      }
    } catch (_) {}
  }

  // Draw PDF part (if overlapping)
  try {
    const pCanvas = await capturePdfRegion(pdfRect, selX, selY, selW, selH);
    if (pCanvas) {
      const px = Math.max(0, (pdfRect.left - selX) * 2);
      const py = Math.max(0, (pdfRect.top - selY) * 2);
      ctx.drawImage(pCanvas, px, py);
    }
  } catch (_) {}

  return comp;
}

function addFloatImage(url, x, y, w, h) {
  const box = document.createElement("div");
  box.className = "float-img";
  // Position at selection location, size matches selection (with small padding for bar)
  box.style.left = (x || 60) + "px";
  box.style.top = (y || 80) + "px";
  box.style.width = Math.max(120, w || 320) + "px";
  box.style.height = Math.max(80, h || 220) + "px";

  const bar = document.createElement("div");
  bar.className = "fi-bar";
  bar.innerHTML = `<span class="fi-title">📌 浮窗</span>
    <button class="fi-save" title="保存图片">💾</button>
    <button class="fi-opbtn" title="透明度">◑</button>
    <button class="fi-close" title="关闭">✕</button>`;

  const img = document.createElement("img");
  img.src = url;

  const op = document.createElement("input");
  op.type = "range"; op.min = "20"; op.max = "100"; op.value = "100";
  op.className = "fi-op";
  op.title = "透明度";
  op.addEventListener("input", () => { img.style.opacity = op.value / 100; });

  // Dedicated resize handle (bottom-right) — implemented in JS so it doesn't
  // collide with the drag handler or the opacity slider.
  const resizeHandle = document.createElement("div");
  resizeHandle.className = "fi-resize";
  resizeHandle.title = "拖动调整大小";

  // Save: download as PNG
  bar.querySelector(".fi-save").addEventListener("click", (e) => {
    e.stopPropagation();
    const link = document.createElement("a");
    link.download = `screenshot_${Date.now()}.png`;
    link.href = url;
    link.click();
  });

  box.appendChild(img);
  box.appendChild(bar);
  box.appendChild(op);
  box.appendChild(resizeHandle);
  floatLayer.appendChild(box);

  // Drag from anywhere on the box (except buttons / controls / resize handle)
  box.addEventListener("mousedown", (e) => {
    if (e.target.tagName === "BUTTON" || e.target.tagName === "INPUT" || e.target.classList.contains("fi-resize")) return;
    if (box._resizing) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const ox = box.offsetLeft, oy = box.offsetTop;
    const mv = (ev) => { box.style.left = ox + ev.clientX - sx + "px"; box.style.top = oy + ev.clientY - sy + "px"; };
    const up = () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", up);
  });

  // Resize from the bottom-right handle (pointer capture => works even if the
  // cursor outruns the small handle; grows AND shrinks from the corner).
  resizeHandle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    box._resizing = true;
    try { resizeHandle.setPointerCapture(e.pointerId); } catch (_) {}
    const sx = e.clientX, sy = e.clientY;
    const ow = box.offsetWidth, oh = box.offsetHeight;
    const mv = (ev) => {
      box.style.width = Math.max(120, ow + (ev.clientX - sx)) + "px";
      box.style.height = Math.max(80, oh + (ev.clientY - sy)) + "px";
    };
    const up = () => {
      box._resizing = false;
      window.removeEventListener("mousemove", mv);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", up);
  });

  bar.querySelector(".fi-close").addEventListener("click", () => box.remove());
}
