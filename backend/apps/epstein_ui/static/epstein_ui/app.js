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
const resetBtn = document.getElementById("resetBtn");
const randomBtn = document.getElementById("randomBtn");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".tab-panel");
const notesInput = document.getElementById("notesInput");
const boldToggle = document.getElementById("boldToggle");
const italicToggle = document.getElementById("italicToggle");
const contextMenu = document.getElementById("contextMenu");

let dragState = null;
let resizeState = null;
let panState = null;
let minimapDrag = null;
let view = { x: 0, y: 0, scale: 1 };
let isResizing = false;
let canvasSize = { width: 900, height: 520 };
let firstPageWidth = 900;
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
let starDrag = null;
let currentPdfKey = null;
const pdfState = new Map();
let pagesMeta = [];
let contextTarget = null;

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
  }
  activeGroup = group;
  if (!group) return;
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
  const selection = window.getSelection();
  if (selection) selection.removeAllRanges();
  if (!text || text === "Text") {
    activeGroup.remove();
  }
  activeGroup = null;
  updateTabStates();
}

function updateTabStates() {
  const textPanel = document.querySelector('[data-panel="text"]');
  const hintsPanel = document.querySelector('[data-panel="hints"]');
  const notesPanel = document.querySelector('[data-panel="notes"]');
  if (textPanel) {
    textPanel.classList.toggle("disabled", !activeGroup);
  }
  if (hintsPanel) {
    const editingArrow = activeHint && activeHint.dataset.type === "arrow";
    hintsPanel.classList.toggle("disabled", !editingArrow);
  }
  if (notesPanel) {
    const editingStar = activeHint && activeHint.dataset.type === "star";
    notesPanel.classList.toggle("disabled", !editingStar);
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
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.classList.add("text-group");
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
  foreignObject.appendChild(editor);

  const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  handle.classList.add("resize-handle");
  handle.setAttribute("r", 6);

  group.appendChild(box);
  group.appendChild(foreignObject);
  group.appendChild(handle);
  textLayer.appendChild(group);

  setActiveGroup(group);
  applyStylesToGroup(group);
  selectAllText(editor);
  editor.focus();
  return group;
}

function createTextBoxFromData(data) {
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.classList.add("text-group");
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

function addStar(point) {
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const size = 10;
  const cx = point.x;
  const cy = point.y;
  const points = [
    [0, -size],
    [size * 0.4, -size * 0.2],
    [size, -size * 0.2],
    [size * 0.55, size * 0.25],
    [size * 0.7, size],
    [0, size * 0.5],
    [-size * 0.7, size],
    [-size * 0.55, size * 0.25],
    [-size, -size * 0.2],
    [-size * 0.4, -size * 0.2],
  ]
    .map(([x, y]) => `${cx + x},${cy + y}`)
    .join(" ");
  const star = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  star.classList.add("hint-star");
  star.setAttribute("points", points);
  const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  handle.classList.add("hint-star-handle");
  handle.setAttribute("r", 4);
  handle.setAttribute("cx", cx);
  handle.setAttribute("cy", cy);
  handle.style.display = "none";
  group.appendChild(star);
  group.appendChild(handle);
  group.dataset.type = "star";
  group.dataset.cx = cx;
  group.dataset.cy = cy;
  group.dataset.note = "";
  hintLayer.appendChild(group);
  return group;
}

function addStarFromData(data) {
  const group = addStar({ x: data.cx, y: data.cy });
  if (!group) return;
  group.dataset.note = data.note || "";
}

function addArrow(start, end) {
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
  hideHintHandles(group);
  hintLayer.appendChild(group);
  return group;
}

function addArrowFromData(data) {
  addArrow({ x: data.x1, y: data.y1 }, { x: data.x2, y: data.y2 });
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
  const starHandle = group.querySelector(".hint-star-handle");
  if (starHandle) starHandle.style.display = "none";
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
  } else if (group.dataset.type === "star") {
    const handle = group.querySelector(".hint-star-handle");
    if (handle) handle.style.display = "";
    setActiveTab("notes");
    notesInput.value = group.dataset.note || "";
    notesInput.focus();
  }
  updateTabStates();
}

function updateStarPosition(group, cx, cy) {
  const size = 10;
  const points = [
    [0, -size],
    [size * 0.4, -size * 0.2],
    [size, -size * 0.2],
    [size * 0.55, size * 0.25],
    [size * 0.7, size],
    [0, size * 0.5],
    [-size * 0.7, size],
    [-size * 0.55, size * 0.25],
    [-size, -size * 0.2],
    [-size * 0.4, -size * 0.2],
  ]
    .map(([x, y]) => `${cx + x},${cy + y}`)
    .join(" ");
  const star = group.querySelector(".hint-star");
  const handle = group.querySelector(".hint-star-handle");
  if (star) star.setAttribute("points", points);
  if (handle) {
    handle.setAttribute("cx", cx);
    handle.setAttribute("cy", cy);
  }
  group.dataset.cx = cx;
  group.dataset.cy = cy;
}

function handleHintsClick(point) {
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

function handleNotesClick(point) {
  addStar(point);
}

function onDoubleClick(evt) {
  if (activeTab !== "text") return;
  const group = evt.target.closest(".text-group");
  if (group) {
    const { editor } = getGroupElements(group);
    setActiveGroup(group);
    editor.setAttribute("contenteditable", "true");
    editor.classList.add("editable-text");
    selectAllText(editor);
    editor.focus();
    evt.preventDefault();
    return;
  }
  const point = svgPointInViewport(evt);
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
  activeGroup = null;
  activeHint = null;
  updateTabStates();
}

function serializeCurrentState() {
  if (!currentPdfKey) return;
  const textItems = Array.from(textLayer.querySelectorAll(".text-group")).map((group) => {
    const { editor } = getGroupElements(group);
    const pos = parseTranslate(group.getAttribute("transform") || "translate(0 0)");
    const computed = window.getComputedStyle(editor);
    return {
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
        x1: parseFloat(handles[0].getAttribute("cx")),
        y1: parseFloat(handles[0].getAttribute("cy")),
        x2: parseFloat(handles[1].getAttribute("cx")),
        y2: parseFloat(handles[1].getAttribute("cy")),
      };
    }
    return {
      x1: parseFloat(line.getAttribute("x1")),
      y1: parseFloat(line.getAttribute("y1")),
      x2: parseFloat(line.dataset.rawX2 || line.getAttribute("x2")),
      y2: parseFloat(line.dataset.rawY2 || line.getAttribute("y2")),
    };
  });
  const stars = Array.from(hintLayer.querySelectorAll('g[data-type="star"]')).map((group) => ({
    cx: parseFloat(group.dataset.cx || 0),
    cy: parseFloat(group.dataset.cy || 0),
    note: group.dataset.note || "",
  }));
  pdfState.set(currentPdfKey, { textItems, arrows, stars });
}

function loadStateForPdf(key) {
  clearOverlays();
  const state = pdfState.get(key);
  if (!state) return;
  state.textItems.forEach((item) => createTextBoxFromData(item));
  state.arrows.forEach((item) => addArrowFromData(item));
  state.stars.forEach((item) => addStarFromData(item));
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
resetBtn.addEventListener("click", () => {
  if (activeGroup) {
    setTranslate(activeGroup, 180, 250);
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
  if (activeHint && activeHint.dataset.type === "star") {
    activeHint.dataset.note = notesInput.value;
  }
});

textLayer.addEventListener("pointerdown", onDragStart);
textLayer.addEventListener("dblclick", onDoubleClick);
textLayer.addEventListener("contextmenu", (evt) => {
  const group = evt.target.closest(".text-group");
  if (!group) return;
  evt.preventDefault();
  openContextMenu(evt.clientX, evt.clientY, { type: "text", group });
});
hintLayer.addEventListener("pointerdown", (evt) => {
  if (arrowStart) return;
  const group = evt.target.closest("g");
  if (!group) return;
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
  } else if (group.dataset.type === "star") {
    setActiveHint(group);
    if (evt.target.classList.contains("hint-star-handle")) {
      starDrag = { group };
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
  const group = evt.target.closest("g");
  if (!group) return;
  evt.preventDefault();
  if (group.dataset.type === "arrow") {
    openContextMenu(evt.clientX, evt.clientY, { type: "arrow", group });
  } else if (group.dataset.type === "star") {
    openContextMenu(evt.clientX, evt.clientY, { type: "star", group });
  }
});
svg.addEventListener("pointerdown", (evt) => {
  if (evt.ctrlKey || evt.button === 1) {
    onPanStart(evt);
    return;
  }
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
      evt.preventDefault();
      return;
    }
    const point = svgPointInViewport(evt);
    handleNotesClick(point);
    evt.preventDefault();
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
svg.addEventListener("dblclick", onDoubleClick);
textLayer.addEventListener("pointerdown", (evt) => {
  if (evt.target.classList.contains("resize-handle")) {
    onResizeStart(evt);
  }
});
window.addEventListener("pointermove", (evt) => {
  onDragMove(evt);
  onResizeMove(evt);
  onPanMove(evt);
  onMinimapMove(evt);
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
  if (starDrag) {
    const point = svgPointInViewport(evt);
    updateStarPosition(starDrag.group, point.x, point.y);
  }
});
window.addEventListener("pointerup", () => {
  onDragEnd();
  onResizeEnd();
  onPanEnd();
  onMinimapEnd();
  hintDrag = null;
  starDrag = null;
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
  const action = evt.target.dataset.action;
  if (!action || !contextTarget) return;
  const { type, group } = contextTarget;
  if (action === "delete") {
    if (type === "text") {
      if (activeGroup === group) activeGroup = null;
      group.remove();
    } else if (type === "arrow" || type === "star") {
      if (activeHint === group) activeHint = null;
      group.remove();
    }
  }
  if (action === "edit") {
    if (type === "text") {
      setActiveGroup(group);
      const { editor } = getGroupElements(group);
      editor.setAttribute("contenteditable", "true");
      editor.classList.add("editable-text");
      editor.focus();
    } else if (type === "arrow") {
      setActiveTab("hints");
      setActiveHint(group);
    } else if (type === "star") {
      setActiveTab("notes");
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
    }
  }
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => setActiveTab(tab.dataset.tab));
});

setActiveTab("text");
setViewportTransform();
fetchRandomPdf();
window.addEventListener("resize", () => fitToView(true));
