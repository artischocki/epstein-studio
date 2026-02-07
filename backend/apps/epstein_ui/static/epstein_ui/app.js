const svg = document.getElementById("overlay");
const viewport = document.getElementById("viewport");
const pdfPages = document.getElementById("pdfPages");
const hintLayer = document.getElementById("hintLayer");
const minimapSvg = document.getElementById("minimapSvg");
const minimapScroll = document.querySelector(".minimap-scroll");
const minimapJump = document.getElementById("minimapJump");
const minimapPageInput = document.getElementById("minimapPageInput");
const minimapPages = document.getElementById("minimapPages");
const minimapViewport = document.getElementById("minimapViewport");
const fileTitle = document.getElementById("fileTitle");
const textLayer = document.getElementById("textLayer");
const defs = svg.querySelector("defs");

const fontSelect = document.getElementById("fontSelect");
const sizeRange = document.getElementById("sizeRange");
const sizeInput = document.getElementById("sizeInput");
const kerningToggle = document.getElementById("kerningToggle");
const colorPicker = document.getElementById("colorPicker");
const opacityRange = document.getElementById("opacityRange");
const createAnnotationBtn = document.getElementById("createAnnotationBtn");
const annotationPrompt = document.getElementById("annotationPrompt");
const annotationControls = document.getElementById("annotationControls");
const commitAnnotationBtn = document.getElementById("commitAnnotationBtn");
const discardAnnotationBtn = document.getElementById("discardAnnotationBtn");
const randomBtn = document.getElementById("randomBtn");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".tab-panel");
const notesInput = document.getElementById("notesInput");
const boldToggle = document.getElementById("boldToggle");
const italicToggle = document.getElementById("italicToggle");
const contextMenu = document.getElementById("contextMenu");
const isAuthenticated = document.body.dataset.auth === "1";

let dragState = null;
let resizeState = null;
let panState = null;
let minimapDrag = null;
let view = { x: 0, y: 0, scale: 1 };
let isResizing = false;
let canvasSize = { width: 900, height: 520 };
let firstPageWidth = 900;
const DEFAULT_TEXT_SIZE = 24;
const VIEW_W = 900;
const VIEW_H = 520;
const PAGE_GAP = 24;
const PADDING_X = 10;
const PADDING_Y = 8;
let hasUserZoomed = false;
let activeGroup = null;
let activeTab = "text";
let arrowStart = null;
let previewArrow = null;
let arrowCounter = 0;
let activeHint = null;
let hintDrag = null;
// star notes removed
let currentPdfKey = null;
const pdfState = new Map();
let pagesMeta = [];
let autoPanActive = false;
let contextTarget = null;
let annotationCreateMode = false;
let activeAnnotationId = null;
let annotationCounter = 0;
const annotations = new Map();
let annotationPreview = null;
const annotationAnchors = new Map();
let suppressNextTextCreate = false;

sizeRange.value = DEFAULT_TEXT_SIZE;
sizeInput.value = DEFAULT_TEXT_SIZE;

if (!isAuthenticated) {
  document.body.classList.add("read-only");
  document.querySelectorAll(".panel input, .panel select, .panel textarea, .panel button").forEach((el) => {
    el.disabled = true;
  });
}

function showAnnotationControls() {
  annotationControls.classList.remove("hidden");
  createAnnotationBtn.classList.add("hidden");
}

function hideAnnotationControls() {
  annotationControls.classList.add("hidden");
  createAnnotationBtn.classList.remove("hidden");
}

function showAnnotationPrompt() {
  annotationPrompt.classList.remove("hidden");
}

function hideAnnotationPrompt() {
  annotationPrompt.classList.add("hidden");
}

function startAnnotationCreate() {
  annotationCreateMode = true;
  showAnnotationPrompt();
  if (!annotationPreview) {
    annotationPreview = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    annotationPreview.classList.add("annotation-preview");
    annotationPreview.setAttribute("r", 6);
    hintLayer.appendChild(annotationPreview);
  }
}

function stopAnnotationCreate() {
  annotationCreateMode = false;
  hideAnnotationPrompt();
  if (annotationPreview) {
    annotationPreview.remove();
    annotationPreview = null;
  }
}

function ensureAnnotationMode() {
  if (!activeAnnotationId) {
    hideAnnotationControls();
  } else {
    showAnnotationControls();
  }
}

function getAnnotationElements(id) {
  const textItems = Array.from(textLayer.querySelectorAll(".text-group")).filter(
    (group) => group.dataset.annotation === id
  );
  const hintItems = Array.from(hintLayer.querySelectorAll("g")).filter(
    (group) => group.dataset.annotation === id && !group.classList.contains("annotation-anchor")
  );
  return { textItems, hintItems };
}

function setAnnotationElementsVisible(id, visible) {
  const { textItems, hintItems } = getAnnotationElements(id);
  textItems.forEach((group) => {
    group.style.display = visible ? "" : "none";
  });
  hintItems.forEach((group) => {
    group.style.display = visible ? "" : "none";
  });
  const anchor = annotationAnchors.get(id);
  if (anchor) {
    anchor.style.display = visible ? "none" : "";
  }
}

function ensureAnnotationAnchor(id) {
  const data = annotations.get(id);
  if (!data) return null;
  let anchor = annotationAnchors.get(id);
  if (!anchor) {
    anchor = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    anchor.classList.add("annotation-anchor");
    anchor.setAttribute("r", 6);
    hintLayer.appendChild(anchor);
    annotationAnchors.set(id, anchor);
  }
  anchor.dataset.annotation = id;
  anchor.setAttribute("cx", data.x);
  anchor.setAttribute("cy", data.y);
  return anchor;
}

function discardActiveAnnotation() {
  if (!activeAnnotationId) return;
  const id = activeAnnotationId;
  const textItems = Array.from(textLayer.querySelectorAll(".text-group"));
  textItems.forEach((group) => {
    if (group.dataset.annotation === id) {
      group.remove();
    }
  });
  const hintItems = Array.from(hintLayer.querySelectorAll("g"));
  hintItems.forEach((group) => {
    if (group.dataset.annotation === id) {
      group.remove();
    }
  });
  const anchor = annotationAnchors.get(id);
  if (anchor) {
    anchor.remove();
    annotationAnchors.delete(id);
  }
  annotations.delete(id);
  activeAnnotationId = null;
  ensureAnnotationMode();
}

function commitActiveAnnotation() {
  if (!activeAnnotationId) return;
  const id = activeAnnotationId;
  ensureAnnotationAnchor(id);
  setAnnotationElementsVisible(id, false);
  activeAnnotationId = null;
  ensureAnnotationMode();
}

function ensureLegacyAnnotation() {
  if (activeAnnotationId) return activeAnnotationId;
  annotationCounter += 1;
  activeAnnotationId = `ann_legacy_${annotationCounter}`;
  annotations.set(activeAnnotationId, { id: activeAnnotationId, x: 0, y: 0 });
  return activeAnnotationId;
}

function setActiveTab(tabId) {
  activeTab = tabId;
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabId));
  panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tabId));
  updateTabStates();
}

function parseTranslate(transform) {
  const match = /translate\(([-\d.]+)\s+([-\d.]+)\)/.exec(transform || "");
  if (!match) {
    return { x: 0, y: 0 };
  }
  return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
}

function setTranslate(group, x, y) {
  group.setAttribute("transform", `translate(${x} ${y})`);
}

function setViewportTransform() {
  viewport.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.scale})`);
  updateMinimapViewport();
}

function clampViewX() {
  const contentWidth = canvasSize.width * view.scale;
  if (contentWidth <= VIEW_W) {
    view.x = (VIEW_W - contentWidth) / 2;
    return;
  }
  const minX = VIEW_W - contentWidth;
  view.x = Math.min(0, Math.max(minX, view.x));
}

function getGroupElements(group) {
  return {
    box: group.querySelector(".text-box"),
    handle: group.querySelector(".resize-handle"),
    foreignObject: group.querySelector("foreignObject"),
    editor: group.querySelector(".text-editor"),
  };
}

function updateBox(group) {
  const { box, handle, foreignObject, editor } = getGroupElements(group);
  const width = Math.max(20, editor.scrollWidth);
  const height = Math.max(18, editor.scrollHeight);

  foreignObject.setAttribute("x", PADDING_X);
  foreignObject.setAttribute("y", PADDING_Y);
  foreignObject.setAttribute("width", width);
  foreignObject.setAttribute("height", height);

  box.setAttribute("x", 0);
  box.setAttribute("y", 0);
  box.setAttribute("width", width + PADDING_X * 2);
  box.setAttribute("height", height + PADDING_Y * 2);

  handle.setAttribute("cx", width + PADDING_X * 2);
  handle.setAttribute("cy", height + PADDING_Y * 2);
}

function applyStylesToGroup(group) {
  const { box, handle, editor } = getGroupElements(group);
  const opacity = Math.max(0.3, Math.min(1, opacityRange.value / 100));
  editor.style.fontFamily = fontSelect.value;
  group.dataset.font = fontSelect.value;
  editor.style.fontSize = `${sizeRange.value}px`;
  sizeInput.value = sizeRange.value;
  editor.style.fontWeight = boldToggle.classList.contains("active") ? "700" : "400";
  editor.style.fontStyle = italicToggle.classList.contains("active") ? "italic" : "normal";
  const kerningOn = kerningToggle.classList.contains("active");
  editor.style.fontKerning = kerningOn ? "normal" : "none";
  editor.style.fontFeatureSettings = kerningOn ? "\"kern\" 1" : "\"kern\" 0";
  editor.style.color = colorPicker.value;
  editor.style.opacity = opacity;
  box.style.stroke = colorPicker.value;
  handle.style.fill = colorPicker.value;
  updateBox(group);
}

function setActiveGroup(group) {
  if (activeGroup && activeGroup !== group) {
    const { editor } = getGroupElements(activeGroup);
    editor.removeAttribute("contenteditable");
    editor.classList.remove("editable-text");
    activeGroup.classList.remove("active");
    stopAutoPan();
  }
  activeGroup = group;
  if (!group) return;
  group.classList.add("active");
  const { box, handle } = getGroupElements(group);
  if (box) box.style.display = "";
  if (handle) handle.style.display = "";
  const { editor } = getGroupElements(group);
  const computed = window.getComputedStyle(editor);
  const storedFont = group.dataset.font;
  if (storedFont) {
    fontSelect.value = storedFont;
  } else {
    const computedFont = computed.fontFamily || "";
    const option = Array.from(fontSelect.options).find((opt) =>
      computedFont.includes(opt.value.split(",")[0].replace(/['\"]/g, "").trim())
    );
    if (option) {
      fontSelect.value = option.value;
    }
  }
  sizeRange.value = parseFloat(computed.fontSize) || sizeRange.value;
  sizeInput.value = sizeRange.value;
  const kerningOn = computed.fontKerning !== "none";
  kerningToggle.classList.toggle("active", kerningOn);
  kerningToggle.textContent = kerningOn ? "On" : "Off";
  colorPicker.value = rgbToHex(computed.color || "#39ff14");
  opacityRange.value = Math.round((parseFloat(computed.opacity) || 1) * 100);
  boldToggle.classList.toggle("active", computed.fontWeight === "700" || computed.fontWeight === "bold");
  italicToggle.classList.toggle("active", computed.fontStyle === "italic");
  setActiveTab("text");
  updateTabStates();
}

function deactivateActiveGroup() {
  if (!activeGroup) return;
  const { editor } = getGroupElements(activeGroup);
  const text = (editor.textContent || "").trim();
  editor.removeAttribute("contenteditable");
  editor.classList.remove("editable-text");
  activeGroup.classList.remove("active");
  stopAutoPan();
  const { box, handle } = getGroupElements(activeGroup);
  if (box) box.style.display = "none";
  if (handle) handle.style.display = "none";
  const selection = window.getSelection();
  if (selection) selection.removeAllRanges();
  if (!text || text === "Text") {
    activeGroup.remove();
  }
  activeGroup = null;
  updateTabStates();
}

function ensureActiveBoxInView() {
  if (!activeGroup) return;
  const { editor } = getGroupElements(activeGroup);
  if (!editor) return;
  let caretRect = null;
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    if (editor.contains(range.startContainer)) {
      caretRect = range.getBoundingClientRect();
    }
  }
  if (!caretRect || caretRect.width === 0) {
    caretRect = editor.getBoundingClientRect();
  }
  const marginX = VIEW_W * 0.05;
  const marginY = VIEW_H * 0.05;
  const toSvgPoint = (x, y) => {
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = x;
    pt.y = y;
    const result = pt.matrixTransform(matrix.inverse());
    return { x: result.x, y: result.y };
  };
  const leftTop = toSvgPoint(caretRect.left, caretRect.top);
  const rightBottom = toSvgPoint(caretRect.right, caretRect.bottom);
  let dx = 0;
  let dy = 0;
  if (rightBottom.x > VIEW_W - marginX) {
    dx = VIEW_W - marginX - rightBottom.x;
  }
  if (leftTop.y < marginY) {
    dy = marginY - leftTop.y;
  } else if (rightBottom.y > VIEW_H - marginY) {
    dy = VIEW_H - marginY - rightBottom.y;
  }
  if (dx !== 0 || dy !== 0) {
    view.x += dx;
    view.y += dy;
    clampViewX();
    setViewportTransform();
  }
}

function startAutoPan() {
  if (autoPanActive) return;
  autoPanActive = true;
  ensureActiveBoxInView();
}

function stopAutoPan() {
  autoPanActive = false;
}

function updateTabStates() {
  const textPanel = document.querySelector('[data-panel="text"]');
  const hintsPanel = document.querySelector('[data-panel="hints"]');
  const notesPanel = document.querySelector('[data-panel="notes"]');
  if (!activeAnnotationId) {
    if (textPanel) textPanel.classList.add("disabled");
    if (hintsPanel) hintsPanel.classList.add("disabled");
    if (notesPanel) notesPanel.classList.add("disabled");
    return;
  }
  if (textPanel) {
    textPanel.classList.toggle("disabled", !activeGroup);
  }
  if (hintsPanel) {
    const editingArrow = activeHint && activeHint.dataset.type === "arrow";
    hintsPanel.classList.toggle("disabled", !editingArrow);
  }
  if (notesPanel) {
    notesPanel.classList.remove("disabled");
  }
}

function openContextMenu(x, y, target) {
  contextTarget = target;
  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
  contextMenu.style.display = "flex";
}

function closeContextMenu() {
  contextMenu.style.display = "none";
  contextTarget = null;
}

function rgbToHex(color) {
  if (color.startsWith("#")) return color;
  const match = color.match(/\d+/g);
  if (!match || match.length < 3) return "#39ff14";
  const [r, g, b] = match.map((v) => parseInt(v, 10));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function svgPointFromEvent(evt, target = svg) {
  const point = target.createSVGPoint();
  point.x = evt.clientX;
  point.y = evt.clientY;
  const screenCTM = target.getScreenCTM();
  if (!screenCTM) {
    return { x: 0, y: 0 };
  }
  const transformed = point.matrixTransform(screenCTM.inverse());
  return { x: transformed.x, y: transformed.y };
}

function svgPointInViewport(evt) {
  const base = svgPointFromEvent(evt, svg);
  return {
    x: (base.x - view.x) / view.scale,
    y: (base.y - view.y) / view.scale,
  };
}

function updateMinimapViewport() {
  const width = Math.min(canvasSize.width, VIEW_W / view.scale);
  const height = VIEW_H / view.scale;
  const x = Math.max(0, Math.min(canvasSize.width - width, -view.x / view.scale));
  const y = Math.max(0, Math.min(canvasSize.height - height, -view.y / view.scale));
  minimapViewport.setAttribute("x", x);
  minimapViewport.setAttribute("y", y);
  minimapViewport.setAttribute("width", width);
  minimapViewport.setAttribute("height", height);
}

function scrollMinimapToView() {
  if (!minimapScroll) return;
  const y = parseFloat(minimapViewport.getAttribute("y") || "0");
  const h = parseFloat(minimapViewport.getAttribute("height") || "0");
  const scale = minimapSvg.clientWidth / canvasSize.width;
  const yPx = y * scale;
  const hPx = h * scale;
  const maxScroll = Math.max(0, minimapScroll.scrollHeight - minimapScroll.clientHeight);
  const target = Math.min(maxScroll, Math.max(0, yPx + hPx / 2 - minimapScroll.clientHeight / 2));
  minimapScroll.scrollTop = target;
}

function scrollMinimapToPage(pageNum) {
  if (!minimapScroll || !pagesMeta.length) return;
  const index = Math.max(0, Math.min(pagesMeta.length - 1, pageNum - 1));
  const scale = minimapSvg.clientWidth / canvasSize.width;
  const yPx = pagesMeta[index].offsetY * scale;
  const maxScroll = Math.max(0, minimapScroll.scrollHeight - minimapScroll.clientHeight);
  minimapScroll.scrollTop = Math.min(maxScroll, Math.max(0, yPx));
}

function centerOn(x, y) {
  view.x = VIEW_W / 2 - x * view.scale;
  view.y = VIEW_H / 2 - y * view.scale;
  setViewportTransform();
}

function fitToView(force = false) {
  if (hasUserZoomed && !force) return;
  view.scale = (VIEW_W * 0.8) / Math.max(1, firstPageWidth);
  view.x = (VIEW_W - firstPageWidth * view.scale) / 2;
  view.y = 24;
  setViewportTransform();
}

function selectAllText(editor) {
  const range = document.createRange();
  range.selectNodeContents(editor);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function createTextBox(x, y) {
  if (!isAuthenticated) return null;
  if (!activeAnnotationId) return null;
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.classList.add("text-group");
  group.dataset.annotation = activeAnnotationId;
  setTranslate(group, x, y);

  const box = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  box.classList.add("text-box");
  box.setAttribute("rx", 6);

  const foreignObject = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
  const editor = document.createElement("div");
  editor.classList.add("text-editor", "editable-text");
  editor.textContent = "Text";
  editor.style.color = colorPicker.value;
  editor.setAttribute("contenteditable", "true");
  editor.setAttribute("spellcheck", "false");
  editor.addEventListener("input", () => updateBox(group));
  editor.addEventListener("focus", startAutoPan);
  editor.addEventListener("blur", stopAutoPan);
  editor.addEventListener("keyup", () => {
    if (autoPanActive) ensureActiveBoxInView();
  });
  editor.addEventListener("mouseup", () => {
    if (autoPanActive) ensureActiveBoxInView();
  });
  foreignObject.appendChild(editor);

  const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  handle.classList.add("resize-handle");
  handle.setAttribute("r", 6);

  group.appendChild(box);
  group.appendChild(foreignObject);
  group.appendChild(handle);
  textLayer.appendChild(group);

  applyStylesToGroup(group);
  setActiveGroup(group);
  selectAllText(editor);
  editor.focus();
  return group;
}

function createTextBoxFromData(data) {
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.classList.add("text-group");
  group.dataset.annotation = data.annotationId || ensureLegacyAnnotation();
  setTranslate(group, data.x, data.y);

  const box = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  box.classList.add("text-box");
  box.setAttribute("rx", 6);

  const foreignObject = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
  const editor = document.createElement("div");
  editor.classList.add("text-editor");
  editor.textContent = data.text || "";
  editor.setAttribute("spellcheck", "false");
  editor.addEventListener("input", () => updateBox(group));
  foreignObject.appendChild(editor);

  const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  handle.classList.add("resize-handle");
  handle.setAttribute("r", 6);

  group.appendChild(box);
  group.appendChild(foreignObject);
  group.appendChild(handle);
  textLayer.appendChild(group);

  editor.style.fontFamily = data.fontFamily || fontSelect.value;
  editor.style.fontSize = data.fontSize || `${sizeRange.value}px`;
  editor.style.fontWeight = data.fontWeight || "400";
  editor.style.fontStyle = data.fontStyle || "normal";
  editor.style.fontKerning = data.fontKerning || "none";
  editor.style.fontFeatureSettings = data.fontFeatureSettings || "\"kern\" 0";
  editor.style.color = data.color || colorPicker.value;
  editor.style.opacity = data.opacity ?? 1;
  group.dataset.font = editor.style.fontFamily;
  box.style.stroke = editor.style.color;
  handle.style.fill = editor.style.color;
  updateBox(group);
  return group;
}

function onDragStart(evt) {
  if (!isAuthenticated) return;
  if (!activeAnnotationId) return;
  const group = evt.target.closest(".text-group");
  if (!group) return;
  if (evt.target.closest(".text-editor")) return;
  if (evt.target.classList.contains("resize-handle")) return;
  if (isResizing) return;
  dragState = {
    group,
    start: svgPointInViewport(evt),
    origin: parseTranslate(group.getAttribute("transform") || "translate(0 0)"),
  };
  setActiveGroup(group);
  group.classList.add("dragging");
  evt.preventDefault();
}

function onDragMove(evt) {
  if (!dragState) return;
  const now = svgPointInViewport(evt);
  const dx = now.x - dragState.start.x;
  const dy = now.y - dragState.start.y;
  setTranslate(dragState.group, dragState.origin.x + dx, dragState.origin.y + dy);
}

function onDragEnd() {
  if (!dragState) return;
  dragState.group.classList.remove("dragging");
  dragState = null;
}

function onResizeStart(evt) {
  if (!isAuthenticated) return;
  if (!activeAnnotationId) return;
  const group = evt.target.closest(".text-group");
  if (!group) return;
  isResizing = true;
  svg.style.cursor = "nwse-resize";
  const { foreignObject } = getGroupElements(group);
  const start = svgPointInViewport(evt);
  resizeState = {
    group,
    start,
    startWidth: parseFloat(foreignObject.getAttribute("width") || 1),
    startSize: parseFloat(sizeRange.value),
  };
  setActiveGroup(group);
  evt.stopPropagation();
  evt.preventDefault();
}

function onResizeMove(evt) {
  if (!resizeState) return;
  const now = svgPointInViewport(evt);
  const targetDx = now.x - resizeState.start.x;
  const scaleFactor = Math.max(0.2, (resizeState.startWidth + targetDx) / resizeState.startWidth);
  const nextSize = Math.max(12, Math.min(72, resizeState.startSize * scaleFactor));
  sizeRange.value = nextSize;
  applyStylesToGroup(resizeState.group);
}

function onResizeEnd() {
  resizeState = null;
  isResizing = false;
  svg.style.cursor = "";
}

function onPanStart(evt) {
  if (isResizing) return;
  if (evt.target.closest(".text-editor")) return;
  if (evt.target.closest(".text-group")) return;
  if (!evt.ctrlKey && evt.button !== 1) return;
  panState = {
    start: svgPointFromEvent(evt, svg),
    origin: { ...view },
  };
  evt.preventDefault();
}

function onPanMove(evt) {
  if (!panState) return;
  const now = svgPointFromEvent(evt, svg);
  const dx = now.x - panState.start.x;
  const dy = now.y - panState.start.y;
  view.x = panState.origin.x + dx;
  view.y = panState.origin.y + dy;
  clampViewX();
  setViewportTransform();
}

function onPanEnd() {
  panState = null;
}

function onWheel(evt) {
  const zoomFactor = Math.exp(-evt.deltaY * 0.0008);
  const nextScale = Math.max(0.2, view.scale * zoomFactor);
  const point = svgPointFromEvent(evt, svg);

  const wx = (point.x - view.x) / view.scale;
  const wy = (point.y - view.y) / view.scale;

  view.scale = nextScale;
  view.x = point.x - wx * view.scale;
  view.y = point.y - wy * view.scale;
  clampViewX();
  setViewportTransform();
  hasUserZoomed = true;
  evt.preventDefault();
}

function onMinimapStart(evt) {
  minimapDrag = true;
  const point = svgPointFromEvent(evt, minimapSvg);
  centerOn(point.x, point.y);
}

function onMinimapMove(evt) {
  if (!minimapDrag) return;
  const point = svgPointFromEvent(evt, minimapSvg);
  centerOn(point.x, point.y);
}

function onMinimapEnd() {
  minimapDrag = null;
}

function addArrow(start, end) {
  if (!activeAnnotationId) return null;
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.classList.add("hint-arrow", "hint-arrow-line");
  line.setAttribute("x1", start.x);
  line.setAttribute("y1", start.y);
  attachArrowMarker(line, start, end);

  const hit = document.createElementNS("http://www.w3.org/2000/svg", "line");
  hit.classList.add("hint-hit");
  hit.setAttribute("x1", start.x);
  hit.setAttribute("y1", start.y);
  hit.setAttribute("x2", end.x);
  hit.setAttribute("y2", end.y);

  const startHandle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  startHandle.classList.add("hint-handle");
  startHandle.setAttribute("r", 6);
  startHandle.setAttribute("cx", start.x);
  startHandle.setAttribute("cy", start.y);

  const endHandle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  endHandle.classList.add("hint-handle");
  endHandle.setAttribute("r", 6);
  endHandle.setAttribute("cx", end.x);
  endHandle.setAttribute("cy", end.y);

  group.appendChild(hit);
  group.appendChild(line);
  group.appendChild(startHandle);
  group.appendChild(endHandle);
  group.dataset.type = "arrow";
  group.dataset.annotation = activeAnnotationId;
  hideHintHandles(group);
  hintLayer.appendChild(group);
  return group;
}

function addArrowFromData(data) {
  const prev = activeAnnotationId;
  activeAnnotationId = data.annotationId || prev || ensureLegacyAnnotation();
  addArrow({ x: data.x1, y: data.y1 }, { x: data.x2, y: data.y2 });
  activeAnnotationId = prev;
}

function attachArrowMarker(line, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const size = Math.min(13, Math.max(8, length * 0.2));
  const trim = size;
  const ux = dx / (length || 1);
  const uy = dy / (length || 1);
  const tipX = end.x - ux * trim;
  const tipY = end.y - uy * trim;
  line.dataset.rawX1 = start.x;
  line.dataset.rawY1 = start.y;
  line.dataset.rawX2 = end.x;
  line.dataset.rawY2 = end.y;
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
  const markerId = `arrowhead-${arrowCounter++}`;
  marker.setAttribute("id", markerId);
  marker.setAttribute("markerUnits", "userSpaceOnUse");
  marker.setAttribute("markerWidth", size);
  marker.setAttribute("markerHeight", size * 0.7);
  marker.setAttribute("refX", 0);
  marker.setAttribute("refY", size * 0.35);
  marker.setAttribute("viewBox", `0 0 ${size} ${size * 0.7}`);
  marker.setAttribute("orient", "auto");
  const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  polygon.setAttribute("points", `${size} ${size * 0.35}, 0 0, 0 ${size * 0.7}`);
  polygon.setAttribute("fill", "#ff2d2d");
  marker.appendChild(polygon);
  defs.appendChild(marker);
  line.setAttribute("x2", tipX);
  line.setAttribute("y2", tipY);
  line.setAttribute("marker-end", `url(#${markerId})`);
  line._marker = marker;
}

function hideHintHandles(group) {
  group.querySelectorAll(".hint-handle").forEach((h) => (h.style.display = "none"));
}

function showHintHandles(group) {
  group.querySelectorAll(".hint-handle").forEach((h) => (h.style.display = ""));
}

function setActiveHint(group) {
  if (activeHint && activeHint !== group) {
    hideHintHandles(activeHint);
  }
  activeHint = group;
  if (!group) return;
  if (group.dataset.type === "arrow") {
    showHintHandles(group);
  }
  updateTabStates();
}

function handleHintsClick(point) {
  if (!activeAnnotationId) return;
  if (!arrowStart) {
    arrowStart = point;
    if (previewArrow) {
      previewArrow.remove();
    }
    previewArrow = document.createElementNS("http://www.w3.org/2000/svg", "line");
    previewArrow.classList.add("hint-arrow");
    previewArrow.setAttribute("x1", arrowStart.x);
    previewArrow.setAttribute("y1", arrowStart.y);
    previewArrow.setAttribute("x2", arrowStart.x);
    previewArrow.setAttribute("y2", arrowStart.y);
    attachArrowMarker(previewArrow, arrowStart, arrowStart);
    hintLayer.appendChild(previewArrow);
    return;
  }
  addArrow(arrowStart, point);
  arrowStart = null;
  if (previewArrow) {
    previewArrow.remove();
    previewArrow = null;
  }
}

function handleNotesClick() {
  return;
}

function onTextClick(evt) {
  if (!isAuthenticated) return;
  if (!activeAnnotationId) return;
  if (activeTab !== "text") return;
  if (evt.target.classList.contains("resize-handle")) return;
  const group = evt.target.closest(".text-group");
  if (group) {
    const { editor } = getGroupElements(group);
    setActiveGroup(group);
    editor.setAttribute("contenteditable", "true");
    editor.classList.add("editable-text");
    if (evt.detail >= 3) {
      selectAllText(editor);
    } else if (evt.detail === 2) {
      if (document.caretRangeFromPoint) {
        const range = document.caretRangeFromPoint(evt.clientX, evt.clientY);
        if (range && editor.contains(range.startContainer)) {
          const wordRange = range.cloneRange();
          wordRange.expand("word");
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(wordRange);
        }
      }
    } else {
      const setCaretAtPoint = (x, y) => {
        if (document.caretPositionFromPoint) {
          const pos = document.caretPositionFromPoint(x, y);
          if (pos && editor.contains(pos.offsetNode)) {
            const range = document.createRange();
            range.setStart(pos.offsetNode, pos.offset);
            range.collapse(true);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            return true;
          }
        } else if (document.caretRangeFromPoint) {
          const range = document.caretRangeFromPoint(x, y);
          if (range && editor.contains(range.startContainer)) {
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            return true;
          }
        }
        return false;
      };
      setCaretAtPoint(evt.clientX, evt.clientY);
    }
    editor.focus();
    evt.preventDefault();
    return;
  }
  const point = svgPointInViewport(evt);
  if (activeGroup) {
    const { editor } = getGroupElements(activeGroup);
    if (editor && editor.isContentEditable) return;
  }
  if (suppressNextTextCreate) {
    suppressNextTextCreate = false;
    return;
  }
  createTextBox(point.x, point.y);
}

function clearPages(container) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
}

function clearOverlays() {
  while (textLayer.firstChild) {
    textLayer.removeChild(textLayer.firstChild);
  }
  while (hintLayer.firstChild) {
    hintLayer.removeChild(hintLayer.firstChild);
  }
  annotationAnchors.forEach((anchor) => anchor.remove());
  annotationAnchors.clear();
  activeGroup = null;
  activeHint = null;
  annotations.clear();
  activeAnnotationId = null;
  annotationCounter = 0;
  stopAnnotationCreate();
  ensureAnnotationMode();
  updateTabStates();
}

function serializeCurrentState() {
  if (!currentPdfKey) return;
  const annotationItems = Array.from(annotations.values());
  const textItems = Array.from(textLayer.querySelectorAll(".text-group")).map((group) => {
    const { editor } = getGroupElements(group);
    const pos = parseTranslate(group.getAttribute("transform") || "translate(0 0)");
    const computed = window.getComputedStyle(editor);
    return {
      annotationId: group.dataset.annotation || "",
      x: pos.x,
      y: pos.y,
      text: editor.textContent || "",
      fontFamily: group.dataset.font || computed.fontFamily,
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      fontStyle: computed.fontStyle,
      fontKerning: computed.fontKerning,
      fontFeatureSettings: computed.fontFeatureSettings,
      color: computed.color,
      opacity: parseFloat(computed.opacity) || 1,
    };
  });
  const arrows = Array.from(hintLayer.querySelectorAll('g[data-type="arrow"]')).map((group) => {
    const line = group.querySelector(".hint-arrow-line");
    const handles = group.querySelectorAll(".hint-handle");
    if (handles.length === 2) {
      return {
        annotationId: group.dataset.annotation || "",
        x1: parseFloat(handles[0].getAttribute("cx")),
        y1: parseFloat(handles[0].getAttribute("cy")),
        x2: parseFloat(handles[1].getAttribute("cx")),
        y2: parseFloat(handles[1].getAttribute("cy")),
      };
    }
    return {
      annotationId: group.dataset.annotation || "",
      x1: parseFloat(line.getAttribute("x1")),
      y1: parseFloat(line.getAttribute("y1")),
      x2: parseFloat(line.dataset.rawX2 || line.getAttribute("x2")),
      y2: parseFloat(line.dataset.rawY2 || line.getAttribute("y2")),
    };
  });
  pdfState.set(currentPdfKey, { annotations: annotationItems, textItems, arrows });
}

function loadStateForPdf(key) {
  clearOverlays();
  const state = pdfState.get(key);
  annotations.clear();
  activeAnnotationId = null;
  if (!state) {
    ensureAnnotationMode();
    return;
  }
  (state.annotations || []).forEach((annotation) => {
    annotations.set(annotation.id, annotation);
  });
  state.textItems.forEach((item) => createTextBoxFromData(item));
  state.arrows.forEach((item) => addArrowFromData(item));
  (state.annotations || []).forEach((annotation) => {
    ensureAnnotationAnchor(annotation.id);
    setAnnotationElementsVisible(annotation.id, false);
  });
  activeAnnotationId = null;
  ensureAnnotationMode();
}

function buildPageImages(container, pages, withLabels = false) {
  clearPages(container);
  let offsetY = 0;
  let maxWidth = 0;
  pagesMeta = [];
  pages.forEach((page, index) => {
    const pageGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const img = document.createElementNS("http://www.w3.org/2000/svg", "image");
    img.setAttribute("href", page.url);
    img.setAttribute("x", 0);
    img.setAttribute("y", offsetY);
    img.setAttribute("width", page.width);
    img.setAttribute("height", page.height);
    pageGroup.appendChild(img);
    if (withLabels) {
      const labelRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      const labelText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      const label = `${index + 1}`;
      labelText.textContent = label;
      labelText.setAttribute("x", 24);
      labelText.setAttribute("y", offsetY + page.height - 56);
      labelText.setAttribute("fill", "#f3f5f7");
      labelText.setAttribute("font-size", "96");
      labelText.setAttribute("font-family", "Calibri, 'Segoe UI', sans-serif");
      labelText.setAttribute("font-weight", "700");
      labelText.setAttribute("dominant-baseline", "middle");
      labelText.setAttribute("alignment-baseline", "central");
      labelText.setAttribute("text-anchor", "start");
      const approxWidth = Math.max(96, label.length * 48);
      labelRect.setAttribute("x", 0);
      labelRect.setAttribute("y", offsetY + page.height - 112);
      labelRect.setAttribute("width", approxWidth + 24);
      labelRect.setAttribute("height", 112);
      labelRect.setAttribute("fill", "#2a2f33");
      labelRect.setAttribute("stroke", "#8a8f94");
      labelRect.setAttribute("stroke-width", "2");
      labelRect.setAttribute("rx", "0");
      pageGroup.appendChild(labelRect);
      pageGroup.appendChild(labelText);
    }

    container.appendChild(pageGroup);
    pagesMeta.push({ offsetY, height: page.height });
    offsetY += page.height + (index < pages.length - 1 ? PAGE_GAP : 0);
    maxWidth = Math.max(maxWidth, page.width);
  });
  return { width: maxWidth, height: offsetY };
}

function syncPages(pages, pdfName) {
  serializeCurrentState();
  const size = buildPageImages(pdfPages, pages, false);
  buildPageImages(minimapPages, pages, true);

  canvasSize = size;
  if (pages[0]) {
    firstPageWidth = pages[0].width || canvasSize.width;
  }
  minimapSvg.setAttribute("viewBox", `0 0 ${canvasSize.width} ${canvasSize.height}`);
  const minimapHeight = (minimapSvg.clientWidth || 1) * (canvasSize.height / canvasSize.width);
  minimapSvg.style.height = `${minimapHeight}px`;
  hasUserZoomed = false;
  fitToView(true);
  if (pdfName) {
    fileTitle.textContent = pdfName;
    currentPdfKey = pdfName;
  }
  loadStateForPdf(currentPdfKey);
}

async function fetchRandomPdf() {
  randomBtn.disabled = true;
  randomBtn.textContent = "Loading...";
  try {
    const response = await fetch("/random-pdf/");
    if (!response.ok) {
      throw new Error("Failed to fetch PDF");
    }
    const data = await response.json();
    if (data.pages && data.pages.length) {
      syncPages(data.pages, data.pdf || "");
    }
  } catch (err) {
    console.error(err);
  } finally {
    randomBtn.disabled = false;
    randomBtn.textContent = "Random PDF";
  }
}

async function searchPdf() {
  const query = searchInput.value.trim();
  if (!query) return;
  searchBtn.disabled = true;
  searchBtn.textContent = "Loading...";
  try {
    const response = await fetch(`/search-pdf/?q=${encodeURIComponent(query)}`);
    if (!response.ok) {
      throw new Error("No match");
    }
    const data = await response.json();
    if (data.pages && data.pages.length) {
      syncPages(data.pages, data.pdf || "");
    }
  } catch (err) {
    console.error(err);
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = "Open";
  }
}

fontSelect.addEventListener("change", () => {
  if (activeGroup) {
    applyStylesToGroup(activeGroup);
  }
});
sizeRange.addEventListener("input", () => {
  if (activeGroup) {
    sizeInput.value = sizeRange.value;
    applyStylesToGroup(activeGroup);
  }
});
sizeInput.addEventListener("input", () => {
  const value = parseFloat(sizeInput.value);
  if (!Number.isNaN(value)) {
    sizeRange.value = value;
    if (activeGroup) {
      applyStylesToGroup(activeGroup);
    }
  }
});
kerningToggle.addEventListener("click", () => {
  kerningToggle.classList.toggle("active");
  kerningToggle.textContent = kerningToggle.classList.contains("active") ? "On" : "Off";
  if (activeGroup) {
    applyStylesToGroup(activeGroup);
  }
});
colorPicker.addEventListener("input", () => {
  if (activeGroup) {
    applyStylesToGroup(activeGroup);
  }
});
opacityRange.addEventListener("input", () => {
  if (activeGroup) {
    applyStylesToGroup(activeGroup);
  }
});
boldToggle.addEventListener("click", () => {
  boldToggle.classList.toggle("active");
  if (activeGroup) {
    applyStylesToGroup(activeGroup);
  }
});
italicToggle.addEventListener("click", () => {
  italicToggle.classList.toggle("active");
  if (activeGroup) {
    applyStylesToGroup(activeGroup);
  }
});
randomBtn.addEventListener("click", fetchRandomPdf);
searchBtn.addEventListener("click", searchPdf);
searchInput.addEventListener("keydown", (evt) => {
  if (evt.key === "Enter") {
    searchPdf();
  }
});

notesInput.addEventListener("input", () => {
  if (!activeAnnotationId) return;
  const annotation = annotations.get(activeAnnotationId);
  if (annotation) {
    annotation.note = notesInput.value;
  }
});

textLayer.addEventListener("pointerdown", (evt) => {
  if (!isAuthenticated) return;
  const group = evt.target.closest(".text-group");
  if (group) {
    if (group.dataset.annotation) {
      activeAnnotationId = group.dataset.annotation;
      ensureAnnotationMode();
    }
    setActiveGroup(group);
  }
  onDragStart(evt);
});
svg.addEventListener("click", (evt) => {
  if (evt.button && evt.button !== 0) return;
  if (annotationCreateMode) return;
  if (isResizing) return;
  onTextClick(evt);
});
textLayer.addEventListener("contextmenu", (evt) => {
  if (!isAuthenticated) return;
  const group = evt.target.closest(".text-group");
  if (!group) return;
  evt.preventDefault();
  openContextMenu(evt.clientX, evt.clientY, { type: "text", group });
});
hintLayer.addEventListener("pointerdown", (evt) => {
  if (!isAuthenticated) return;
  if (arrowStart) return;
  const anchor = evt.target.closest(".annotation-anchor");
  if (anchor) {
    const annId = anchor.dataset.annotation;
    if (annId) {
      activeAnnotationId = annId;
      ensureAnnotationMode();
      setAnnotationElementsVisible(annId, true);
      setActiveTab("notes");
    }
    evt.preventDefault();
    evt.stopPropagation();
    return;
  }
  const group = evt.target.closest("g");
  if (!group) return;
  if (group.dataset.annotation) {
    activeAnnotationId = group.dataset.annotation;
    ensureAnnotationMode();
  }
  if (group.dataset.type === "arrow") {
    setActiveHint(group);
    if (evt.target.classList.contains("hint-handle")) {
      const handles = group.querySelectorAll(".hint-handle");
      hintDrag = {
        group,
        handleIndex: evt.target === handles[0] ? 0 : 1,
      };
      evt.preventDefault();
      evt.stopPropagation();
      return;
    }
    evt.preventDefault();
    evt.stopPropagation();
    return;
  }
});
hintLayer.addEventListener("contextmenu", (evt) => {
  if (!isAuthenticated) return;
  const group = evt.target.closest("g");
  if (!group) return;
  evt.preventDefault();
  if (group.dataset.type === "arrow") {
    openContextMenu(evt.clientX, evt.clientY, { type: "arrow", group });
  }
});
svg.addEventListener("pointerdown", (evt) => {
  if (evt.ctrlKey || evt.button === 1) {
    onPanStart(evt);
    return;
  }
  if (annotationCreateMode) {
    const point = svgPointInViewport(evt);
    annotationCounter += 1;
    activeAnnotationId = `ann_${Date.now()}_${annotationCounter}`;
    annotations.set(activeAnnotationId, { id: activeAnnotationId, x: point.x, y: point.y });
    stopAnnotationCreate();
    showAnnotationControls();
    setActiveTab("notes");
    evt.preventDefault();
    return;
  }
  if (!isAuthenticated) return;
  if (activeTab === "hints") {
    if (activeHint) {
      hideHintHandles(activeHint);
      activeHint = null;
      updateTabStates();
      evt.preventDefault();
      return;
    }
    const point = svgPointInViewport(evt);
    handleHintsClick(point);
    evt.preventDefault();
    return;
  }
  if (activeTab === "notes") {
    if (activeHint) {
      hideHintHandles(activeHint);
      activeHint = null;
      updateTabStates();
    }
    return;
  }
  onPanStart(evt);
  if (!evt.target.closest(".text-group") && !evt.target.closest("g")) {
    if (activeHint) {
      hideHintHandles(activeHint);
      activeHint = null;
      updateTabStates();
    }
    if (activeGroup) {
      deactivateActiveGroup();
    }
  }
});
textLayer.addEventListener("pointerdown", (evt) => {
  if (!isAuthenticated) return;
  if (evt.target.classList.contains("resize-handle")) {
    onResizeStart(evt);
  }
});
window.addEventListener("pointermove", (evt) => {
  onDragMove(evt);
  onResizeMove(evt);
  onPanMove(evt);
  onMinimapMove(evt);
  if (annotationCreateMode && annotationPreview) {
    const point = svgPointInViewport(evt);
    annotationPreview.setAttribute("cx", point.x);
    annotationPreview.setAttribute("cy", point.y);
  }
  if (activeTab === "hints" && arrowStart && previewArrow) {
    const point = svgPointInViewport(evt);
    if (previewArrow._marker) {
      previewArrow._marker.remove();
    }
    attachArrowMarker(previewArrow, arrowStart, point);
  }
  if (hintDrag) {
    const point = svgPointInViewport(evt);
    const line = hintDrag.group.querySelector(".hint-arrow-line");
    const hit = hintDrag.group.querySelector(".hint-hit");
    const handles = hintDrag.group.querySelectorAll(".hint-handle");
    if (hintDrag.handleIndex === 0) {
      line.setAttribute("x1", point.x);
      line.setAttribute("y1", point.y);
      hit.setAttribute("x1", point.x);
      hit.setAttribute("y1", point.y);
      handles[0].setAttribute("cx", point.x);
      handles[0].setAttribute("cy", point.y);
    } else {
      line.setAttribute("x2", point.x);
      line.setAttribute("y2", point.y);
      hit.setAttribute("x2", point.x);
      hit.setAttribute("y2", point.y);
      handles[1].setAttribute("cx", point.x);
      handles[1].setAttribute("cy", point.y);
    }
    if (line._marker) {
      line._marker.remove();
    }
    attachArrowMarker(
      line,
      { x: parseFloat(handles[0].getAttribute("cx")), y: parseFloat(handles[0].getAttribute("cy")) },
      { x: parseFloat(handles[1].getAttribute("cx")), y: parseFloat(handles[1].getAttribute("cy")) }
    );
  }
});
window.addEventListener("pointerup", () => {
  onDragEnd();
  onResizeEnd();
  onPanEnd();
  onMinimapEnd();
  hintDrag = null;
});
svg.addEventListener("wheel", onWheel, { passive: false });
minimapSvg.addEventListener("pointerdown", onMinimapStart);
minimapJump.addEventListener("click", scrollMinimapToView);
minimapPageInput.addEventListener("change", () => {
  const value = parseInt(minimapPageInput.value, 10);
  if (!Number.isNaN(value)) {
    scrollMinimapToPage(value);
  }
});

contextMenu.addEventListener("click", (evt) => {
  if (!isAuthenticated) return;
  const action = evt.target.dataset.action;
  if (!action || !contextTarget) return;
  const { type, group } = contextTarget;
  if (action === "delete") {
    if (type === "text") {
      if (activeGroup === group) activeGroup = null;
      group.remove();
    } else if (type === "arrow") {
      if (activeHint === group) activeHint = null;
      group.remove();
    }
  }
  if (action === "edit") {
    if (type === "text") {
      if (group.dataset.annotation) {
        activeAnnotationId = group.dataset.annotation;
        ensureAnnotationMode();
      }
      setActiveGroup(group);
      const { editor } = getGroupElements(group);
      editor.setAttribute("contenteditable", "true");
      editor.classList.add("editable-text");
      editor.focus();
    } else if (type === "arrow") {
      if (group.dataset.annotation) {
        activeAnnotationId = group.dataset.annotation;
        ensureAnnotationMode();
      }
      setActiveTab("hints");
      setActiveHint(group);
    }
  }
  closeContextMenu();
});

window.addEventListener("click", () => {
  closeContextMenu();
});

updateTabStates();

window.addEventListener("pointerdown", (evt) => {
  if (evt.target.closest(".context-menu")) return;
  if (evt.target.closest(".text-editor")) return;
  if (evt.target.closest(".panel")) return;
  if (!evt.target.closest(".text-group")) {
    if (activeGroup) {
      deactivateActiveGroup();
      suppressNextTextCreate = true;
    }
  }
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => setActiveTab(tab.dataset.tab));
});

createAnnotationBtn.addEventListener("click", () => {
  if (!isAuthenticated) return;
  startAnnotationCreate();
});

commitAnnotationBtn.addEventListener("click", () => {
  if (!isAuthenticated) return;
  commitActiveAnnotation();
});

discardAnnotationBtn.addEventListener("click", () => {
  if (!isAuthenticated) return;
  discardActiveAnnotation();
});

setActiveTab("notes");
setViewportTransform();
fetchRandomPdf();
window.addEventListener("resize", () => fitToView(true));
ensureAnnotationMode();
