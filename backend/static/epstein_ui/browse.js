const list = document.getElementById("browseList");
const moreBtn = document.getElementById("browseMore");
const sortSelect = document.getElementById("browseSort");
const notificationDots = document.querySelectorAll(".notif-dot");
const randomBtn = document.getElementById("browseRandom");
const searchInput = document.getElementById("browseSearch");
const searchBtn = document.getElementById("browseSearchBtn");
const browseCount = document.getElementById("browseCount");
const staticUiBase = window.STATIC_EPSTEIN_UI_BASE || "/static/epstein_ui/";

function uiIconPath(filename) {
  return `${staticUiBase}icons/${filename}`;
}

let page = 1;
let loading = false;
let hasMore = true;
let currentSort = sortSelect ? sortSelect.value : "name";
let currentQuery = "";

function setLoading(state) {
  loading = state;
  if (moreBtn) {
    moreBtn.disabled = state;
    moreBtn.textContent = state ? "Loading..." : "Load More";
  }
}

function appendCard(item) {
  const link = document.createElement("a");
  link.className = "browse-card";
  link.href = `/${encodeURIComponent(item.slug || item.filename.replace(/\.pdf$/i, ""))}`;
  const name = document.createElement("span");
  name.textContent = item.filename;
  const meta = document.createElement("div");
  meta.className = "browse-meta";
  const voteWrap = document.createElement("span");
  voteWrap.className = "browse-meta-item";
  const voteIcon = document.createElement("img");
  voteIcon.src = uiIconPath("thumbs-up.svg");
  voteIcon.alt = "";
  const voteCount = document.createElement("span");
  voteCount.textContent = item.upvotes ?? 0;
  voteWrap.appendChild(voteIcon);
  voteWrap.appendChild(voteCount);

  const annWrap = document.createElement("span");
  annWrap.className = "browse-meta-item";
  const annIcon = document.createElement("img");
  annIcon.src = uiIconPath("pencil.svg");
  annIcon.alt = "";
  const annCount = document.createElement("span");
  annCount.textContent = item.annotations ?? 0;
  annWrap.appendChild(annIcon);
  annWrap.appendChild(annCount);

  meta.appendChild(voteWrap);
  meta.appendChild(annWrap);
  link.appendChild(name);
  link.appendChild(meta);
  list.appendChild(link);
}

async function loadPage() {
  if (loading || !hasMore) return;
  setLoading(true);
  try {
    const response = await fetch(
      `/browse-list/?page=${page}&sort=${encodeURIComponent(currentSort)}&q=${encodeURIComponent(currentQuery)}`
    );
    if (!response.ok) {
      throw new Error("Failed to load");
    }
    const data = await response.json();
    (data.items || []).forEach(appendCard);
    hasMore = Boolean(data.has_more);
    if (browseCount && typeof data.total === "number") {
      browseCount.textContent = `(${data.total})`;
    }
    page += 1;
    if (!hasMore && moreBtn) {
      moreBtn.classList.add("hidden");
    }
  } catch (err) {
    console.error(err);
  } finally {
    setLoading(false);
  }
}

if (moreBtn) {
  moreBtn.addEventListener("click", loadPage);
}

if (sortSelect) {
  sortSelect.addEventListener("change", () => {
    currentSort = sortSelect.value;
    page = 1;
    hasMore = true;
    list.innerHTML = "";
    if (moreBtn) moreBtn.classList.remove("hidden");
    loadPage();
  });
}

if (randomBtn) {
  randomBtn.addEventListener("click", async () => {
    randomBtn.disabled = true;
    randomBtn.textContent = "Loading...";
    try {
      const response = await fetch("/random-pdf/");
      if (!response.ok) throw new Error("Failed");
      const data = await response.json();
      if (data.pdf) {
        const slug = data.pdf.replace(/\.pdf$/i, "");
        window.location.href = `/${encodeURIComponent(slug)}`;
      }
    } catch (err) {
      console.error(err);
    } finally {
      randomBtn.disabled = false;
      randomBtn.textContent = "Random File";
    }
  });
}

function triggerSearch() {
  currentQuery = searchInput ? searchInput.value.trim() : "";
  page = 1;
  hasMore = true;
  list.innerHTML = "";
  if (moreBtn) moreBtn.classList.remove("hidden");
  loadPage();
}

if (searchBtn) {
  searchBtn.addEventListener("click", triggerSearch);
}

if (searchInput) {
  searchInput.addEventListener("keydown", (evt) => {
    if (evt.key === "Enter") triggerSearch();
  });
}

function updateNotificationDots(count) {
  notificationDots.forEach((dot) => {
    if (!dot) return;
    dot.classList.toggle("hidden", !count);
  });
}

function loadNotificationCount() {
  if (document.body.dataset.auth !== "1") return;
  fetch("/notifications-count/")
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      if (!data) return;
      updateNotificationDots(data.count || 0);
    })
    .catch((err) => console.error(err));
}

loadPage();
loadNotificationCount();
