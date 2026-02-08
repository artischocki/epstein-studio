// --- DOM references ---
const svg = document.getElementById("overlay");
window.DEBUG_MODE = true;
const DEBUG_PDF_NAME = "EFTA02731646.pdf";
const viewport = document.getElementById("viewport");
const pdfPages = document.getElementById("pdfPages");
const heatmapCanvas = document.getElementById("heatmapCanvas");
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
const annotationNotes = document.getElementById("annotationNotes");
const annotationSort = document.getElementById("annotationSort");
const annotationSortSelect = document.getElementById("annotationSortSelect");
const commitAnnotationBtn = document.getElementById("commitAnnotationBtn");
const discardAnnotationBtn = document.getElementById("discardAnnotationBtn");
const randomBtn = document.getElementById("randomBtn");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const suggestionsList = document.getElementById("pdfSuggestions");
const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".tab-panel");
const notesInput = document.getElementById("notesInput");
const boldToggle = document.getElementById("boldToggle");
const italicToggle = document.getElementById("italicToggle");
const contextMenu = document.getElementById("contextMenu");
const colorSwatch = document.getElementById("colorSwatch");
const annotationTabs = document.getElementById("annotationTabs");
const annotationViewTitle = document.getElementById("annotationViewTitle");
const annotationViewHash = document.getElementById("annotationViewHash");
const annotationViewNote = document.getElementById("annotationViewNote");
const annotationViewBack = document.getElementById("annotationViewBack");
const discussionPanel = document.getElementById("discussionPanel");
const discussionList = document.getElementById("discussionList");
const discussionForm = document.getElementById("discussionForm");
const discussionInput = document.getElementById("discussionInput");
const discussionSubmit = document.getElementById("discussionSubmit");
const discussionLoginHint = document.getElementById("discussionLoginHint");
const discussionEditBtn = document.getElementById("discussionEditBtn");
const isAuthenticated = document.body.dataset.auth === "1";

// --- Shared state (viewport, active elements, annotations) ---
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
let activeAnnotationViewOnly = false;
let annotationCounter = 0;
const annotations = new Map();
let annotationPreview = null;
const annotationAnchors = new Map();
let heatmapCtx = null;
let heatmapBase = null;
let suppressNextTextCreate = false;
let suggestionTimer = null;
let commentCache = new Map();

function formatTimestamp(value, { dateOnly = false } = {}) {
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n) => String(n).padStart(2, "0");
  const m = months[dt.getMonth()];
  const d = dt.getDate();
  const currentYear = new Date().getFullYear();
  const year = dt.getFullYear();
  const yearSuffix = year !== currentYear ? `, ${year}` : "";
  if (dateOnly) {
    return `${m} ${d}${yearSuffix}`;
  }
  const h = pad(dt.getHours());
  const min = pad(dt.getMinutes());
  if (year !== currentYear) {
    return `${m} ${d}, ${year} ${h}:${min}`;
  }
  return `${m} ${d}, ${h}:${min}`;
}

function generateHash() {
  if (window.crypto && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `h_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 10)}`;
}

sizeRange.value = DEFAULT_TEXT_SIZE;
sizeInput.value = DEFAULT_TEXT_SIZE;

// Disable editing UI for anonymous viewers.
if (!isAuthenticated) {
  document.body.classList.add("read-only");
  document.querySelectorAll(".annotation-controls input, .annotation-controls select, .annotation-controls textarea, .annotation-controls button").forEach((el) => {
    if (el.id === "annotationViewBack") return;
    el.disabled = true;
  });
  if (createAnnotationBtn) createAnnotationBtn.disabled = true;
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

// Enter annotation placement mode (preview dot follows cursor).
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

// Exit annotation placement mode.
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
    ensureAnnotationAnchor(activeAnnotationId);
  }
  updateAnnotationPanelMode();
  updateAnnotationVisibility();
}

function updateAnnotationPanelMode() {
  if (!annotationControls) return;
  const tabsList = Array.from(annotationControls.querySelectorAll(".tab"));
  if (!activeAnnotationId) {
    activeAnnotationViewOnly = false;
    if (annotationTabs) annotationTabs.classList.remove("hidden");
    if (annotationViewTitle) annotationViewTitle.classList.add("hidden");
    if (annotationViewHash) annotationViewHash.classList.add("hidden");
    if (annotationViewNote) annotationViewNote.classList.add("hidden");
    if (annotationViewBack) annotationViewBack.classList.add("hidden");
    if (discussionPanel) discussionPanel.classList.add("hidden");
    if (discussionEditBtn) discussionEditBtn.classList.add("hidden");
    tabsList.forEach((tab) => {
      tab.disabled = false;
    });
    if (notesInput) {
      notesInput.readOnly = false;
      notesInput.closest(".field")?.classList.remove("hidden");
    }
    if (notesInput) notesInput.classList.remove("hidden");
    commitAnnotationBtn?.classList.remove("hidden");
    discardAnnotationBtn?.classList.remove("hidden");
    return;
  }
  if (activeAnnotationViewOnly) {
    if (annotationTabs) annotationTabs.classList.add("hidden");
    if (annotationViewTitle) annotationViewTitle.classList.remove("hidden");
    if (annotationViewHash) annotationViewHash.classList.remove("hidden");
    if (annotationViewNote) annotationViewNote.classList.remove("hidden");
    if (annotationViewBack) annotationViewBack.classList.remove("hidden");
    if (discussionPanel) discussionPanel.classList.remove("hidden");
    if (discussionEditBtn) discussionEditBtn.classList.add("hidden");
    if (notesInput) notesInput.closest(".field")?.classList.add("hidden");
    if (annotationViewTitle) {
      const ann = annotations.get(activeAnnotationId);
      const name = ann?.user || "Unknown";
      const stamp = formatTimestamp(ann?.createdAt);
      annotationViewTitle.textContent = stamp ? `${name}: ${stamp}` : `${name}:`;
    }
    if (annotationViewHash) {
      const ann = annotations.get(activeAnnotationId);
      annotationViewHash.textContent = ann?.hash ? `${ann.hash}` : "";
    }
    if (annotationViewNote) {
      const ann = annotations.get(activeAnnotationId);
      annotationViewNote.textContent = ann?.note || "";
    }
    tabsList.forEach((tab) => {
      tab.disabled = tab.dataset.tab !== "notes";
    });
    if (notesInput) notesInput.readOnly = true;
    commitAnnotationBtn?.classList.add("hidden");
    discardAnnotationBtn?.classList.add("hidden");
    setActiveTab("notes");
  } else {
    if (annotationTabs) annotationTabs.classList.remove("hidden");
    if (annotationViewTitle) annotationViewTitle.classList.add("hidden");
    if (annotationViewHash) {
      const ann = annotations.get(activeAnnotationId);
      annotationViewHash.textContent = ann?.hash ? `${ann.hash}` : "";
      annotationViewHash.classList.toggle("hidden", !ann?.hash);
    }
    if (annotationViewNote) annotationViewNote.classList.add("hidden");
    if (annotationViewBack) annotationViewBack.classList.add("hidden");
    if (discussionPanel) discussionPanel.classList.add("hidden");
    if (discussionEditBtn) discussionEditBtn.classList.add("hidden");
    if (notesInput) notesInput.classList.remove("hidden");
    tabsList.forEach((tab) => {
      tab.disabled = false;
    });
    if (notesInput) {
      notesInput.readOnly = false;
      notesInput.closest(".field")?.classList.remove("hidden");
    }
    commitAnnotationBtn?.classList.remove("hidden");
    discardAnnotationBtn?.classList.remove("hidden");
  }
}

function activateAnnotation(id, { viewOnly = false } = {}) {
  if (!id) return;
  activeAnnotationId = id;
  activeAnnotationViewOnly = viewOnly;
  const ann = annotations.get(id);
  if (notesInput && ann) {
    notesInput.value = ann.note || "";
  }
  if (annotationViewNote && ann) {
    annotationViewNote.textContent = ann.note || "";
  }
  if (annotationViewHash && ann) {
    annotationViewHash.textContent = ann.hash ? `${ann.hash}` : "";
  }
  ensureAnnotationMode();
  setAnnotationElementsVisible(id, true);
  setActiveTab("notes");
  if (activeAnnotationViewOnly) {
    loadDiscussionForAnnotation(ann?.server_id);
  }
}

function clearActiveAnnotation() {
  activeAnnotationId = null;
  activeAnnotationViewOnly = false;
  if (discussionList) discussionList.innerHTML = "";
  ensureAnnotationMode();
}

function updateAnnotationVisibility() {
  if (activeAnnotationId) {
    if (heatmapCanvas) {
      heatmapCanvas.style.display = "none";
    }
    if (annotationNotes) {
      annotationNotes.classList.add("hidden");
    }
    if (annotationSort) {
      annotationSort.classList.add("hidden");
    }
    annotations.forEach((_, id) => {
      const isActive = id === activeAnnotationId;
      setAnnotationElementsVisible(id, isActive);
      const anchor = annotationAnchors.get(id);
      if (anchor) {
        if (isActive) {
          anchor.style.display = "";
          anchor.style.opacity = "0.35";
        } else {
          anchor.style.display = "none";
          anchor.style.opacity = "";
        }
      }
    });
    return;
  }

  if (heatmapCanvas) {
    heatmapCanvas.style.display = "";
  }
  if (annotationNotes) {
    annotationNotes.classList.remove("hidden");
  }
  if (annotationSort) {
    annotationSort.classList.remove("hidden");
  }
  annotations.forEach((_, id) => {
    setAnnotationElementsVisible(id, false);
    const anchor = annotationAnchors.get(id);
    if (anchor) {
      anchor.style.display = "";
      anchor.style.opacity = "";
    }
  });
  renderNotesList();
}

// Find all visual elements that belong to one annotation.
function getAnnotationElements(id) {
  const textItems = Array.from(textLayer.querySelectorAll(".text-group")).filter(
    (group) => group.dataset.annotation === id
  );
  const hintItems = Array.from(hintLayer.querySelectorAll("g")).filter(
    (group) => group.dataset.annotation === id && !group.classList.contains("annotation-anchor")
  );
  return { textItems, hintItems };
}

// Hide/show annotation elements (anchors are controlled separately).
function setAnnotationElementsVisible(id, visible) {
  const { textItems, hintItems } = getAnnotationElements(id);
  textItems.forEach((group) => {
    group.style.display = visible ? "" : "none";
  });
  hintItems.forEach((group) => {
    group.style.display = visible ? "" : "none";
  });
}

// Create or update the annotation anchor dot.
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
  if (data.isOwner === false) {
    anchor.classList.add("annotation-anchor-other");
  } else {
    anchor.classList.remove("annotation-anchor-other");
  }
  anchor.setAttribute("cx", data.x);
  anchor.setAttribute("cy", data.y);
  return anchor;
}

// Drop active annotation and its elements, then persist.
function removeAnnotationById(id, { persist = true } = {}) {
  if (!id) return;
  const { textItems, hintItems } = getAnnotationElements(id);
  textItems.forEach((group) => group.remove());
  hintItems.forEach((group) => group.remove());
  const anchor = annotationAnchors.get(id);
  if (anchor) {
    anchor.remove();
    annotationAnchors.delete(id);
  }
  annotations.delete(id);
  if (activeAnnotationId === id) {
    activeAnnotationId = null;
  }
  ensureAnnotationMode();
  if (persist) {
    saveAnnotationsForPdf();
  }
  rebuildHeatmapBase();
  renderHeatmap();
}

function discardActiveAnnotation() {
  if (!activeAnnotationId) return;
  if (activeAnnotationViewOnly) {
    clearActiveAnnotation();
    return;
  }
  removeAnnotationById(activeAnnotationId);
}

// Collapse active annotation into its anchor, then persist.
function commitActiveAnnotation() {
  if (!activeAnnotationId) return;
  if (activeAnnotationViewOnly) {
    clearActiveAnnotation();
    return;
  }
  const id = activeAnnotationId;
  const { textItems, hintItems } = getAnnotationElements(id);
  const note = (annotations.get(id)?.note || "").trim();
  const isEmpty = textItems.length === 0 && hintItems.length === 0 && note.length === 0;
  if (isEmpty) {
    alert("Empty annotation discarded. Add a note, text, or hint before committing.");
    removeAnnotationById(id);
    return;
  }
  ensureAnnotationAnchor(id);
  setAnnotationElementsVisible(id, false);
  activeAnnotationId = null;
  ensureAnnotationMode();
  saveAnnotationsForPdf();
  rebuildHeatmapBase();
  renderHeatmap();
  renderNotesList();
}

function ensureLegacyAnnotation() {
  if (activeAnnotationId) return activeAnnotationId;
  annotationCounter += 1;
  activeAnnotationId = `ann_legacy_${annotationCounter}`;
  const hash = generateHash();
  annotations.set(hash, {
    id: hash,
    clientId: hash,
    x: 0,
    y: 0,
    isOwner: true,
    hash,
    createdAt: new Date().toISOString(),
  });
  activeAnnotationId = hash;
  return activeAnnotationId;
}

function renderNotesList() {
  if (!annotationNotes) return;
  annotationNotes.innerHTML = "";
  const items = Array.from(annotations.values()).filter((ann) => (ann.note || "").trim().length > 0);
  if (!items.length) return;

  const mine = items.filter((ann) => ann.isOwner);
  const others = items.filter((ann) => !ann.isOwner);

  mine.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const sortMode = annotationSortSelect?.value || "upvotes";
  if (sortMode === "newest") {
    others.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  } else if (sortMode === "oldest") {
    others.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  } else {
    others.sort((a, b) => (b.upvotes || 0) - (b.downvotes || 0) - ((a.upvotes || 0) - (a.downvotes || 0)));
  }

  const renderSection = (title, list, showHeader, showSort = false) => {
    if (!list.length) return;
    if (showHeader) {
      const header = document.createElement("div");
      header.className = "annotation-section-title";
      header.textContent = title;
      if (showSort && annotationSort) {
        const row = document.createElement("div");
        row.className = "annotation-section-row";
        row.appendChild(header);
        row.appendChild(annotationSort);
        annotationNotes.appendChild(row);
      } else {
        annotationNotes.appendChild(header);
      }
    }
    if (showSort && annotationSort) {
      annotationSort.classList.remove("hidden");
    }
    list.forEach((ann) => {
    const wrapper = document.createElement("div");
    wrapper.className = "annotation-note";
    wrapper.dataset.annotation = ann.id;

    const meta = document.createElement("div");
    meta.className = "annotation-note-meta";
    const stamp = formatTimestamp(ann.createdAt, { dateOnly: true });
    if (ann.isOwner) {
      meta.textContent = stamp ? `By you • ${stamp}` : "By you";
    } else {
      const author = ann.user ? `By ${ann.user}` : "By Unknown";
      meta.textContent = stamp ? `${author} • ${stamp}` : author;
    }

    const text = document.createElement("div");
    text.className = "annotation-note-text";
    text.textContent = ann.note;

    const actions = document.createElement("div");
    actions.className = "annotation-note-actions";

    const upBtn = document.createElement("button");
    upBtn.className = "vote-btn up";
    upBtn.innerHTML = `<img class="vote-icon" src="/static/epstein_ui/icons/arrow-big-up.svg" alt="" />`;
    if (ann.userVote === 1) {
      upBtn.classList.add("active");
    }
    upBtn.disabled = !isAuthenticated || !ann.server_id || ann.isOwner;

    const downBtn = document.createElement("button");
    downBtn.className = "vote-btn down";
    downBtn.innerHTML = `<img class="vote-icon" src="/static/epstein_ui/icons/arrow-big-down.svg" alt="" />`;
    if (ann.userVote === -1) {
      downBtn.classList.add("active");
    }
    downBtn.disabled = !isAuthenticated || !ann.server_id || ann.isOwner;

    upBtn.addEventListener("click", async (evt) => {
      evt.stopPropagation();
      if (!ann.server_id) return;
      const result = await sendVote(ann.server_id, 1);
      if (!result) return;
      ann.upvotes = result.upvotes;
      ann.downvotes = result.downvotes;
      ann.userVote = result.user_vote || 0;
      renderNotesList();
    });
    downBtn.addEventListener("click", async (evt) => {
      evt.stopPropagation();
      if (!ann.server_id) return;
      const result = await sendVote(ann.server_id, -1);
      if (!result) return;
      ann.upvotes = result.upvotes;
      ann.downvotes = result.downvotes;
      ann.userVote = result.user_vote || 0;
      renderNotesList();
    });

    const score = document.createElement("span");
    score.className = "vote-score";
    score.textContent = (ann.upvotes || 0) - (ann.downvotes || 0);

    actions.appendChild(upBtn);
    actions.appendChild(downBtn);
    actions.appendChild(score);
    wrapper.appendChild(meta);
    wrapper.appendChild(text);
    wrapper.appendChild(actions);
    annotationNotes.appendChild(wrapper);

    wrapper.addEventListener("mouseenter", () => {
      const anchor = annotationAnchors.get(ann.id);
      if (anchor) {
        anchor.setAttribute("r", "10");
      }
      if (!activeAnnotationId && !activeAnnotationViewOnly) {
        setAnnotationElementsVisible(ann.id, true);
      }
    });
    wrapper.addEventListener("mouseleave", () => {
      const anchor = annotationAnchors.get(ann.id);
      if (anchor) {
        anchor.setAttribute("r", "6");
      }
      if (!activeAnnotationId && !activeAnnotationViewOnly) {
        setAnnotationElementsVisible(ann.id, false);
      }
    });
    wrapper.addEventListener("click", () => {
      if (ann.isOwner) {
        if (activeAnnotationId === ann.id && activeAnnotationViewOnly) {
          clearActiveAnnotation();
          return;
        }
        activateAnnotation(ann.id, { viewOnly: true });
        return;
      }
      if (activeAnnotationId === ann.id && activeAnnotationViewOnly) {
        clearActiveAnnotation();
        return;
      }
      activateAnnotation(ann.id, { viewOnly: true });
    });
    });
  };

  renderSection("Your annotations", mine, mine.length > 0, false);
  renderSection("Other annotations", others, mine.length > 0, true);
}

function renderDiscussion(annotationId, comments) {
  if (!discussionList) return;
  discussionList.innerHTML = "";
  if (!annotationId) return;
  const byParent = new Map();
  comments.forEach((c) => {
    const key = c.parent_id || "root";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(c);
  });
  const renderNode = (comment, depth) => {
    const item = document.createElement("div");
    item.className = "comment";
    const currentUserName = document.body.dataset.user || "";
    if (comment.user === currentUserName) {
      item.classList.add("comment-own");
    }
    if (depth > 0) {
      item.style.marginLeft = `${Math.min(depth, 6) * 18}px`;
    }
    const meta = document.createElement("div");
    meta.className = "comment-meta";
    const stamp = formatTimestamp(comment.created_at);
    const author = comment.user === currentUserName ? "You" : comment.user;
    meta.textContent = stamp ? `${author} • ${stamp}` : author;
    const body = document.createElement("div");
    body.className = "comment-body";
    body.textContent = comment.body;

    const actions = document.createElement("div");
    actions.className = "comment-actions";
    const upBtn = document.createElement("button");
    upBtn.className = "vote-btn up";
    upBtn.innerHTML = `<img class="vote-icon" src="/static/epstein_ui/icons/arrow-big-up.svg" alt="" />`;
    if (comment.user_vote === 1) upBtn.classList.add("active");
    const commentOwner = comment.user === currentUserName;
    upBtn.disabled = !isAuthenticated || commentOwner;
    upBtn.addEventListener("click", async (evt) => {
      evt.stopPropagation();
      const result = await sendCommentVote(comment.id, 1);
      if (!result) return;
      comment.upvotes = result.upvotes;
      comment.downvotes = result.downvotes;
      comment.user_vote = result.user_vote || 0;
      renderDiscussion(annotationId, comments);
    });

    const downBtn = document.createElement("button");
    downBtn.className = "vote-btn down";
    downBtn.innerHTML = `<img class="vote-icon" src="/static/epstein_ui/icons/arrow-big-down.svg" alt="" />`;
    if (comment.user_vote === -1) downBtn.classList.add("active");
    downBtn.disabled = !isAuthenticated || commentOwner;
    downBtn.addEventListener("click", async (evt) => {
      evt.stopPropagation();
      const result = await sendCommentVote(comment.id, -1);
      if (!result) return;
      comment.upvotes = result.upvotes;
      comment.downvotes = result.downvotes;
      comment.user_vote = result.user_vote || 0;
      renderDiscussion(annotationId, comments);
    });

    const score = document.createElement("span");
    score.className = "vote-score";
    score.textContent = (comment.upvotes || 0) - (comment.downvotes || 0);

    const replyBtn = document.createElement("span");
    replyBtn.className = "comment-reply";
    replyBtn.textContent = "Reply";
    replyBtn.addEventListener("click", () => {
      if (!isAuthenticated) return;
      const existing = item.querySelector(".comment-reply-form");
      if (existing) {
        existing.remove();
        return;
      }
      const form = document.createElement("div");
      form.className = "comment-reply-form discussion-form";
      const input = document.createElement("textarea");
      input.rows = 2;
      input.placeholder = "Write a reply...";
      const btn = document.createElement("button");
      btn.className = "btn btn-secondary";
      btn.textContent = "Reply";
      btn.addEventListener("click", async () => {
        const text = input.value.trim();
        if (!text) return;
        const result = await sendComment(annotationId, text, comment.id);
        if (!result) return;
        comments.push(result);
        renderDiscussion(annotationId, comments);
      });
      form.appendChild(input);
      form.appendChild(btn);
      item.appendChild(form);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "comment-delete";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    const canDelete = isAuthenticated && currentUserName && comment.user === currentUserName;
    deleteBtn.classList.toggle("hidden", !canDelete);
    deleteBtn.disabled = !canDelete;
    deleteBtn.addEventListener("click", async () => {
      if (!canDelete) return;
      if (!window.confirm("Delete this comment and all replies?")) return;
      const result = await deleteComment(comment.id);
      if (!result || !result.ok) return;
      const removeIds = new Set([comment.id]);
      let changed = true;
      while (changed) {
        changed = false;
        comments.forEach((c) => {
          if (c.parent_id && removeIds.has(c.parent_id) && !removeIds.has(c.id)) {
            removeIds.add(c.id);
            changed = true;
          }
        });
      }
      const next = comments.filter((c) => !removeIds.has(c.id));
      comments.length = 0;
      next.forEach((c) => comments.push(c));
      renderDiscussion(annotationId, comments);
    });

    actions.appendChild(upBtn);
    actions.appendChild(downBtn);
    actions.appendChild(score);
    actions.appendChild(replyBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(meta);
    item.appendChild(body);
    item.appendChild(actions);
    discussionList.appendChild(item);

    const children = byParent.get(comment.id) || [];
    children.forEach((child) => renderNode(child, depth + 1));
  };
  const roots = byParent.get("root") || [];
  roots.forEach((comment) => renderNode(comment, 0));
}

async function loadDiscussionForAnnotation(annotationId) {
  if (!discussionPanel) return;
  if (!annotationId) {
    discussionPanel.classList.add("hidden");
    return;
  }
  discussionPanel.classList.remove("hidden");
  if (discussionLoginHint) {
    discussionLoginHint.classList.toggle("hidden", isAuthenticated);
  }
  if (discussionForm) {
    discussionForm.classList.toggle("hidden", !isAuthenticated);
  }
  if (discussionEditBtn) {
    const ann = annotations.get(activeAnnotationId);
    discussionEditBtn.classList.toggle("hidden", !(ann && ann.isOwner && isAuthenticated));
  }
  if (commentCache.has(annotationId)) {
    renderDiscussion(annotationId, commentCache.get(annotationId));
  }
  try {
    const response = await fetch(`/annotation-comments/?annotation_id=${annotationId}`);
    if (!response.ok) return;
    const data = await response.json();
    const comments = data.comments || [];
    commentCache.set(annotationId, comments);
    renderDiscussion(annotationId, comments);
  } catch (err) {
    console.error(err);
  }
}

async function sendComment(annotationId, body, parentId = null) {
  try {
    const response = await fetch("/annotation-comments/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ annotation_id: annotationId, body, parent_id: parentId }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.comment || null;
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function sendCommentVote(commentId, value) {
  try {
    const response = await fetch("/comment-votes/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment_id: commentId, value }),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function deleteComment(commentId) {
  try {
    const response = await fetch("/comment-delete/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment_id: commentId }),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function sendVote(annotationId, value) {
  try {
    const response = await fetch("/annotation-votes/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ annotation_id: annotationId, value }),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    console.error(err);
    return null;
  }
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
  updateHeatmapTransform();
}

// --- Heatmap: build in PDF coordinate space, then draw into viewport transform ---
function ensureHeatmapCanvas() {
  if (!heatmapCanvas) return;
  if (!heatmapCtx) {
    heatmapCtx = heatmapCanvas.getContext("2d");
  }
  const svgRect = svg.getBoundingClientRect();
  const parentRect = heatmapCanvas.parentElement?.getBoundingClientRect();
  if (!parentRect) return;
  const dpr = window.devicePixelRatio || 1;
  heatmapCanvas.style.left = `${svgRect.left - parentRect.left}px`;
  heatmapCanvas.style.top = `${svgRect.top - parentRect.top}px`;
  heatmapCanvas.style.width = `${svgRect.width}px`;
  heatmapCanvas.style.height = `${svgRect.height}px`;
  const targetW = Math.max(1, Math.round(svgRect.width * dpr));
  const targetH = Math.max(1, Math.round(svgRect.height * dpr));
  if (heatmapCanvas.width !== targetW || heatmapCanvas.height !== targetH) {
    heatmapCanvas.width = targetW;
    heatmapCanvas.height = targetH;
  }
}

function updateHeatmapTransform() {
  renderHeatmap();
}

// Render a density map into an offscreen canvas in PDF coordinates.
function rebuildHeatmapBase() {
  heatmapBase = null;
  const items = Array.from(annotations.values());
  if (!items.length) return;

  const off = document.createElement("canvas");
  off.width = canvasSize.width;
  off.height = canvasSize.height;
  const offCtx = off.getContext("2d");
  offCtx.clearRect(0, 0, off.width, off.height);
  offCtx.filter = "blur(18px)";

  const radius = 70;
  items.forEach((ann) => {
    const grad = offCtx.createRadialGradient(ann.x, ann.y, 0, ann.x, ann.y, radius);
    grad.addColorStop(0, "rgba(0,0,0,0.6)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    offCtx.fillStyle = grad;
    offCtx.beginPath();
    offCtx.arc(ann.x, ann.y, radius, 0, Math.PI * 2);
    offCtx.fill();
  });

  const img = offCtx.getImageData(0, 0, off.width, off.height);
  const data = img.data;
  const ramp = [
    { t: 0.0, c: [30, 76, 255] },
    { t: 0.45, c: [59, 214, 255] },
    { t: 0.75, c: [255, 232, 74] },
    { t: 1.0, c: [255, 59, 47] },
  ];
  const lerp = (a, b, t) => a + (b - a) * t;
  const colorAt = (t) => {
    let i = 0;
    while (i < ramp.length - 1 && t > ramp[i + 1].t) i += 1;
    const left = ramp[i];
    const right = ramp[i + 1];
    const local = (t - left.t) / Math.max(1e-6, right.t - left.t);
    return [
      Math.round(lerp(left.c[0], right.c[0], local)),
      Math.round(lerp(left.c[1], right.c[1], local)),
      Math.round(lerp(left.c[2], right.c[2], local)),
    ];
  };

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    if (alpha <= 0.02) {
      data[i + 3] = 0;
      continue;
    }
    const t = Math.min(1, alpha);
    const [r, g, b] = colorAt(t);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = Math.round(255 * (0.5 * t));
  }
  heatmapBase = document.createElement("canvas");
  heatmapBase.width = off.width;
  heatmapBase.height = off.height;
  heatmapBase.getContext("2d").putImageData(img, 0, 0);
}

// Draw the base heatmap into the visible canvas using the current view transform.
function renderHeatmap() {
  if (!heatmapCanvas) return;
  ensureHeatmapCanvas();
  if (!heatmapCtx) return;
  heatmapCtx.clearRect(0, 0, heatmapCanvas.width, heatmapCanvas.height);
  if (!heatmapBase) return;
  const baseScale = Math.min(heatmapCanvas.width / VIEW_W, heatmapCanvas.height / VIEW_H);
  const baseOffsetX = (heatmapCanvas.width - VIEW_W * baseScale) / 2;
  const baseOffsetY = (heatmapCanvas.height - VIEW_H * baseScale) / 2;
  const scaleX = baseScale * view.scale;
  const scaleY = baseScale * view.scale;
  const translateX = baseOffsetX + baseScale * view.x;
  const translateY = baseOffsetY + baseScale * view.y;
  heatmapCtx.setTransform(
    scaleX,
    0,
    0,
    scaleY,
    translateX,
    translateY
  );
  heatmapCtx.drawImage(heatmapBase, 0, 0);
  heatmapCtx.setTransform(1, 0, 0, 1, 0, 0);
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
  if (document.activeElement !== sizeInput) {
    sizeInput.value = sizeRange.value;
  }
  editor.style.fontWeight = boldToggle.classList.contains("active") ? "700" : "400";
  editor.style.fontStyle = italicToggle.classList.contains("active") ? "italic" : "normal";
  const kerningOn = kerningToggle.classList.contains("active");
  editor.style.fontKerning = kerningOn ? "normal" : "none";
  editor.style.fontFeatureSettings = kerningOn ? "\"kern\" 1" : "\"kern\" 0";
  editor.style.color = colorPicker.value;
  editor.style.opacity = opacity;
  box.style.stroke = colorPicker.value;
  handle.style.fill = colorPicker.value;
  if (colorSwatch) {
    const swatch = colorSwatch.querySelector(".swatch-letter");
    if (swatch) swatch.style.color = colorPicker.value;
  }
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
  const annId = group.dataset.annotation;
  if (annId) {
    const ann = annotations.get(annId);
    if (ann && ann.isOwner === false) {
      activeGroup = null;
      return;
    }
  }
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
  if (colorSwatch) {
    const swatch = colorSwatch.querySelector(".swatch-letter");
    if (swatch) swatch.style.color = colorPicker.value;
  }
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
  if (activeAnnotationViewOnly) {
    if (textPanel) textPanel.classList.add("disabled");
    if (hintsPanel) hintsPanel.classList.add("disabled");
    if (notesPanel) notesPanel.classList.remove("disabled");
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
  const ann = annotations.get(activeAnnotationId);
  if (ann && ann.isOwner === false) return null;
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
  requestAnimationFrame(() => {
    if (!group.isConnected) return;
    const { editor } = getGroupElements(group);
    if (!editor) return;
    const boxWidth = Math.max(20, editor.scrollWidth) + PADDING_X * 2;
    const boxHeight = Math.max(18, editor.scrollHeight) + PADDING_Y * 2;
    setTranslate(group, x - boxWidth / 2, y - boxHeight / 2);
  });
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
  if (!isAuthenticated && !activeAnnotationViewOnly) return;
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
  const ann = annotations.get(activeAnnotationId);
  if (ann && ann.isOwner === false) return;
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
    const annId = group.dataset.annotation;
    const ann = annId ? annotations.get(annId) : null;
    if (ann && ann.isOwner === false) return;
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
  if (heatmapCtx) {
    heatmapCtx.clearRect(0, 0, heatmapCanvas.width, heatmapCanvas.height);
  }
  heatmapBase = null;
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
  renderHeatmap();
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
  commentCache.clear();
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
  rebuildHeatmapBase();
  renderHeatmap();
  renderNotesList();
}

async function loadAnnotationsForPdf(pdfName) {
  if (!pdfName) return;
  try {
    const response = await fetch(`/annotations/?pdf=${encodeURIComponent(pdfName)}`);
    if (!response.ok) return;
    const data = await response.json();
    if (!data.annotations) return;
    const annotationsPayload = [];
    const textItems = [];
    const arrows = [];
    data.annotations.forEach((ann) => {
      const key = ann.hash || ann.id;
      annotationsPayload.push({
        id: key,
        clientId: ann.id,
        server_id: ann.server_id,
        x: ann.x,
        y: ann.y,
        note: ann.note || "",
        user: ann.user || "",
        isOwner: ann.is_owner ?? false,
        upvotes: ann.upvotes || 0,
        downvotes: ann.downvotes || 0,
        userVote: ann.user_vote || 0,
        hash: ann.hash || "",
        createdAt: ann.created_at || "",
      });
      (ann.textItems || []).forEach((item) => {
        textItems.push({
          annotationId: key,
          x: item.x,
          y: item.y,
          text: item.text || "",
          fontFamily: item.fontFamily,
          fontSize: item.fontSize,
          fontWeight: item.fontWeight,
          fontStyle: item.fontStyle,
          fontKerning: item.fontKerning,
          fontFeatureSettings: item.fontFeatureSettings,
          color: item.color,
          opacity: item.opacity,
        });
      });
      (ann.arrows || []).forEach((arrow) => {
        arrows.push({
          annotationId: key,
          x1: arrow.x1,
          y1: arrow.y1,
          x2: arrow.x2,
          y2: arrow.y2,
        });
      });
    });
    pdfState.set(pdfName, { annotations: annotationsPayload, textItems, arrows });
    loadStateForPdf(pdfName);
    rebuildHeatmapBase();
    renderHeatmap();
  } catch (err) {
    console.error(err);
  }
}

async function saveAnnotationsForPdf() {
  if (!currentPdfKey) return;
  if (!isAuthenticated) return;
  const payload = {
    pdf: currentPdfKey,
    annotations: Array.from(annotations.values()).map((ann) => {
      const textItems = Array.from(textLayer.querySelectorAll(".text-group"))
        .filter((group) => group.dataset.annotation === ann.id)
        .map((group) => {
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
      const arrows = Array.from(hintLayer.querySelectorAll('g[data-type="arrow"]'))
        .filter((group) => group.dataset.annotation === ann.id)
        .map((group) => {
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
      return {
        id: ann.clientId || ann.id,
        x: ann.x,
        y: ann.y,
        note: ann.note || "",
        hash: ann.hash || "",
        textItems,
        arrows,
      };
    }),
  };
  try {
    await fetch("/annotations/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error(err);
  }
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
    fileTitle.textContent = pdfName.replace(/\.pdf$/i, "");
    currentPdfKey = pdfName;
    const slug = pdfName.replace(/\.pdf$/i, "");
    if (slug) {
      window.history.replaceState({}, "", `/${encodeURIComponent(slug)}`);
    }
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
      loadAnnotationsForPdf(data.pdf || "");
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
      loadAnnotationsForPdf(data.pdf || "");
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
    if (document.activeElement !== sizeInput) {
      sizeInput.value = sizeRange.value;
    }
    applyStylesToGroup(activeGroup);
  }
});
sizeInput.addEventListener("input", () => {
  const raw = sizeInput.value.trim();
  if (!raw || raw === "-" || raw === "." || raw === "-.") return;
  if (raw.endsWith(".")) return;
  const value = parseFloat(raw);
  if (Number.isNaN(value)) return;
  const min = parseFloat(sizeInput.min || "0");
  const max = parseFloat(sizeInput.max || "0");
  if (!Number.isNaN(min) && value < min) return;
  if (!Number.isNaN(max) && value > max) return;
  sizeRange.value = value;
  if (activeGroup) {
    applyStylesToGroup(activeGroup);
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
  if (colorSwatch) {
    const swatch = colorSwatch.querySelector(".swatch-letter");
    if (swatch) swatch.style.color = colorPicker.value;
  }
  if (activeGroup) {
    applyStylesToGroup(activeGroup);
  }
});
if (colorSwatch && colorPicker) {
  colorSwatch.addEventListener("click", () => colorPicker.click());
}
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
searchInput.addEventListener("input", () => {
  if (!suggestionsList) return;
  if (suggestionTimer) {
    clearTimeout(suggestionTimer);
  }
  const query = searchInput.value.trim();
  suggestionTimer = setTimeout(async () => {
    try {
      const response = await fetch(`/search-suggestions/?q=${encodeURIComponent(query)}`);
      if (!response.ok) return;
      const data = await response.json();
      suggestionsList.innerHTML = "";
      (data.suggestions || []).forEach((name) => {
        const option = document.createElement("option");
        option.value = name.replace(/\.pdf$/i, "");
        suggestionsList.appendChild(option);
      });
    } catch (err) {
      console.error(err);
    }
  }, 120);
});

notesInput.addEventListener("input", () => {
  if (!activeAnnotationId) return;
  const annotation = annotations.get(activeAnnotationId);
  if (annotation) {
    annotation.note = notesInput.value;
  }
  renderNotesList();
});

textLayer.addEventListener("pointerdown", (evt) => {
  const group = evt.target.closest(".text-group");
  if (group) {
    if (group.dataset.annotation) {
      const annId = group.dataset.annotation;
      const ann = annId ? annotations.get(annId) : null;
      if (ann && ann.isOwner === false) {
        activateAnnotation(annId, { viewOnly: true });
        return;
      }
      if (!isAuthenticated) return;
      activateAnnotation(annId, { viewOnly: false });
    }
    if (!isAuthenticated) return;
    setActiveGroup(group);
  }
  if (!isAuthenticated) return;
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
  if (group.dataset.annotation) {
    const ann = annotations.get(group.dataset.annotation);
    if (ann && ann.isOwner === false) return;
  }
  evt.preventDefault();
  openContextMenu(evt.clientX, evt.clientY, { type: "text", group });
});
hintLayer.addEventListener("pointerdown", (evt) => {
  if (evt.button !== 0) return;
  if (arrowStart) return;
  const anchor = evt.target.closest(".annotation-anchor");
  if (anchor) {
    const annId = anchor.dataset.annotation;
    if (annId) {
      const ann = annotations.get(annId);
      if (!isAuthenticated || (ann && ann.isOwner === false)) {
        activateAnnotation(annId, { viewOnly: true });
      } else {
        activateAnnotation(annId, { viewOnly: false });
      }
    }
    evt.preventDefault();
    evt.stopPropagation();
    return;
  }
  const group = evt.target.closest("g");
  if (!group) return;
  if (group.dataset.annotation) {
    const annId = group.dataset.annotation;
    const ann = annId ? annotations.get(annId) : null;
    if (!isAuthenticated || (ann && ann.isOwner === false)) {
      activateAnnotation(annId, { viewOnly: true });
      return;
    }
    activeAnnotationId = annId;
    ensureAnnotationMode();
  }
  if (group.dataset.type === "arrow") {
    if (!isAuthenticated) return;
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
  const anchor = evt.target.closest(".annotation-anchor");
  if (anchor) {
    const ann = annotations.get(anchor.dataset.annotation);
    if (ann && ann.isOwner === false) return;
    evt.preventDefault();
    openContextMenu(evt.clientX, evt.clientY, { type: "annotation", id: anchor.dataset.annotation });
    return;
  }
  const group = evt.target.closest("g");
  if (!group) return;
  if (group.dataset.annotation) {
    const ann = annotations.get(group.dataset.annotation);
    if (ann && ann.isOwner === false) return;
  }
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
    activeAnnotationViewOnly = false;
    const hash = generateHash();
    annotations.set(hash, {
      id: hash,
      clientId: hash,
      x: point.x,
      y: point.y,
      isOwner: true,
      hash,
      createdAt: new Date().toISOString(),
    });
    activeAnnotationId = hash;
    stopAnnotationCreate();
    activateAnnotation(activeAnnotationId, { viewOnly: false });
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
  const { type, group, id } = contextTarget;
  if (action === "delete") {
    if (type === "text") {
      if (activeGroup === group) activeGroup = null;
      group.remove();
    } else if (type === "arrow") {
      if (activeHint === group) activeHint = null;
      group.remove();
    } else if (type === "annotation") {
      removeAnnotationById(id);
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
    } else if (type === "annotation") {
      if (id) {
        activeAnnotationId = id;
        ensureAnnotationMode();
        setAnnotationElementsVisible(id, true);
        setActiveTab("notes");
      }
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
  if (activeAnnotationViewOnly) {
    clearActiveAnnotation();
    return;
  }
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

if (annotationViewBack) {
  annotationViewBack.addEventListener("click", () => {
    clearActiveAnnotation();
  });
}

if (discussionSubmit) {
  discussionSubmit.addEventListener("click", async () => {
    if (!isAuthenticated) return;
    const ann = annotations.get(activeAnnotationId);
    if (!ann || !ann.server_id) return;
    const body = discussionInput.value.trim();
    if (!body) return;
    const result = await sendComment(ann.server_id, body);
    if (!result) return;
    const list = commentCache.get(ann.server_id) || [];
    list.push(result);
    commentCache.set(ann.server_id, list);
    discussionInput.value = "";
    renderDiscussion(ann.server_id, list);
  });
}

if (discussionEditBtn) {
  discussionEditBtn.addEventListener("click", () => {
    const ann = annotations.get(activeAnnotationId);
    if (!ann || !ann.isOwner || !isAuthenticated) return;
    activateAnnotation(activeAnnotationId, { viewOnly: false });
  });
}

if (annotationSortSelect) {
  annotationSortSelect.addEventListener("change", () => {
    renderNotesList();
  });
}

setActiveTab("notes");
setViewportTransform();
if (window.DEBUG_MODE) {
  searchInput.value = DEBUG_PDF_NAME;
  searchPdf();
} else {
  const slug = window.location.pathname.replace(/^\/+|\/+$/g, "");
  if (slug) {
    searchInput.value = slug;
    searchPdf();
  } else {
    fetchRandomPdf();
  }
}
window.addEventListener("resize", () => fitToView(true));
ensureAnnotationMode();
