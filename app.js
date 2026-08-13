/* =========================================================================
 * Paper Reader — app.js  (vanilla JS, no build step)
 * Features: dual-pane reader, view switch, in-app floating screenshots,
 *           font-scale slider, annotations on BOTH translation HTML and PDF.
 * ========================================================================= */
"use strict";

const ANNO_SEL = "p, .fig-caption, h2, h3, li"; // annotatable blocks in translation HTML
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
  annoMode: false,
  syncMode: false,
  view: "both",
  fontScale: 1,         // 1 == 100%
  pdfPages: {},         // page number -> .pdf-page wrapper element
};

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
  bindIframeScrollSync();
});

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
}

function blockOf(node) {
  let el = node.nodeType === 3 ? node.parentElement : node;
  while (el && el !== iframeDoc.body) {
    if (el.matches && el.matches(ANNO_SEL)) return el;
    el = el.parentElement;
  }
  return null;
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

async function captureRegion(x, y, w, h) {
  const overlay = $("shot-overlay");
  overlay.classList.add("hidden"); // hide before capture so the mask isn't included
  try {
    const rect = viewer.getBoundingClientRect();
    const canvas = await html2canvas(viewer, {
      backgroundColor: null,
      scale: 2,
      logging: false,
      useCORS: true,
    });
    // map selection (viewport coords) -> canvas pixels, accounting for scroll
    const scaleX = canvas.width / viewer.scrollWidth;
    const scaleY = canvas.height / viewer.scrollHeight;
    const elX = (x - rect.left) + viewer.scrollLeft;
    const elY = (y - rect.top) + viewer.scrollTop;
    const cx = Math.max(0, elX * scaleX);
    const cy = Math.max(0, elY * scaleY);
    const cw = Math.min(canvas.width - cx, w * scaleX);
    const ch = Math.min(canvas.height - cy, h * scaleY);
    if (cw <= 0 || ch <= 0) { alert("所选区域不在阅读区内。"); return; }
    const cropped = document.createElement("canvas");
    cropped.width = Math.round(cw); cropped.height = Math.round(ch);
    cropped.getContext("2d").drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);
    addFloatImage(cropped.toDataURL("image/png"));
  } catch (e) {
    alert("截图失败：" + (e && e.message ? e.message : e));
  } finally {
    if (overlay._cleanup) overlay._cleanup();
  }
}

function addFloatImage(url) {
  const box = document.createElement("div");
  box.className = "float-img";
  box.style.left = "60px";
  box.style.top = "80px";
  box.style.width = "320px";
  box.style.height = "220px";

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
  floatLayer.appendChild(box);

  // Drag from anywhere on the box (except buttons / controls)
  box.addEventListener("mousedown", (e) => {
    if (e.target.tagName === "BUTTON" || e.target.tagName === "INPUT") return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const ox = box.offsetLeft, oy = box.offsetTop;
    const mv = (ev) => { box.style.left = ox + ev.clientX - sx + "px"; box.style.top = oy + ev.clientY - sy + "px"; };
    const up = () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", up);
  });
  bar.querySelector(".fi-close").addEventListener("click", () => box.remove());
}
