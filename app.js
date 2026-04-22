// ─── State ───────────────────────────────────────────
const STORAGE_KEY = "sall-wedding-completed";
const VIEW_KEY = "sall-wedding-view";
const COLLAPSED_KEY = "sall-wedding-collapsed";
const GROUPS_KEY = "sall-wedding-groups";
const HIDDEN_KEY = "sall-wedding-hidden";
const UPLOADS_KEY = "sall-wedding-uploads";
const DESC_KEY = "sall-wedding-descriptions";
const ORDER_KEY = "sall-wedding-order"; // { locId: [shotId, shotId, ...] }
let completedShots = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
let collapsedGroups = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || "{}");
let groupOverrides = JSON.parse(localStorage.getItem(GROUPS_KEY) || "{}");
let hiddenShots = JSON.parse(localStorage.getItem(HIDDEN_KEY) || "{}");
let uploadedShots = JSON.parse(localStorage.getItem(UPLOADS_KEY) || "{}");
let descOverrides = JSON.parse(localStorage.getItem(DESC_KEY) || "{}");
let orderOverrides = JSON.parse(localStorage.getItem(ORDER_KEY) || "{}");
let blobUrls = {}; // shotId -> objectURL (runtime cache)
let currentLocation = null;
let currentGroup = null;
let viewMode = localStorage.getItem(VIEW_KEY) || "grid";
let editMode = false;
let selectedShots = new Set();
let selectedGroupNames = new Set();
let feedStartShotId = null;

const $ = (sel) => document.querySelector(sel);

// ─── IndexedDB for image blobs ──────────────────────
let db = null;
const DB_NAME = "sall-wedding-images";
const DB_STORE = "blobs";

function openDB() {
  return new Promise((resolve, reject) => {
    if (db) { resolve(db); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => { e.target.result.createObjectStore(DB_STORE); };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e);
  });
}

async function storeBlob(key, blob) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e);
  });
}

async function getBlob(key) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e);
  });
}

async function deleteBlob(key) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e);
  });
}

function saveUploads() { localStorage.setItem(UPLOADS_KEY, JSON.stringify(uploadedShots)); }
function saveDescriptions() { localStorage.setItem(DESC_KEY, JSON.stringify(descOverrides)); }

function getShotDescription(shot) {
  if (descOverrides[shot.id] && descOverrides[shot.id].description !== undefined) {
    return descOverrides[shot.id].description;
  }
  return shot.description || "";
}

function getShotNotes(shot) {
  if (descOverrides[shot.id] && descOverrides[shot.id].notes !== undefined) {
    return descOverrides[shot.id].notes;
  }
  return shot.notes || "";
}

// ─── Persistence ─────────────────────────────────────
function saveCompleted() { localStorage.setItem(STORAGE_KEY, JSON.stringify(completedShots)); }
function saveCollapsed() { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsedGroups)); }
function saveGroups() { localStorage.setItem(GROUPS_KEY, JSON.stringify(groupOverrides)); }
function saveHidden() { localStorage.setItem(HIDDEN_KEY, JSON.stringify(hiddenShots)); }
function saveOrder() { localStorage.setItem(ORDER_KEY, JSON.stringify(orderOverrides)); }
function isHidden(shotId) { return !!hiddenShots[shotId]; }
function isCompleted(shotId) { return !!completedShots[shotId]; }

function toggleCompleted(shotId) {
  if (completedShots[shotId]) delete completedShots[shotId];
  else completedShots[shotId] = Date.now();
  saveCompleted();
}

// ─── All shots (original + uploaded) ─────────────────
function allShots(loc) {
  const uploads = (uploadedShots[loc.id] || []).map((s) => ({
    ...s,
    _uploaded: true,
    photo: s.id // for uploaded shots, photo is the blob key (same as id)
  }));
  return [...loc.shots, ...uploads];
}

// ─── Visible shots (filters out hidden, respects order) ──
function visibleShots(loc) {
  const all = allShots(loc).filter((s) => !isHidden(s.id));
  const order = orderOverrides[loc.id];
  if (!order || order.length === 0) return all;

  // Sort by custom order; shots not in order go at the end
  const orderMap = {};
  order.forEach((id, i) => { orderMap[id] = i; });
  return all.sort((a, b) => {
    const ai = orderMap[a.id] !== undefined ? orderMap[a.id] : 99999;
    const bi = orderMap[b.id] !== undefined ? orderMap[b.id] : 99999;
    return ai - bi;
  });
}

// Save current visible order to localStorage
function persistOrder(loc) {
  orderOverrides[loc.id] = visibleShots(loc).map((s) => s.id);
  saveOrder();
}

// ─── Resolve image src (file path or blob URL) ──────
function getShotImgSrc(shot, loc) {
  if (shot._uploaded) {
    return blobUrls[shot.id] || null;
  }
  if (shot.photo && shot.photo.length > 0) {
    return `${loc.folder}/${shot.photo}`;
  }
  return null;
}

// ─── Group resolution ────────────────────────────────
function getShotGroup(shot) {
  if (groupOverrides[shot.id] !== undefined) return groupOverrides[shot.id] || null;
  return shot.group || null;
}

function getExistingGroups(loc) {
  const groups = new Set();
  visibleShots(loc).forEach((s) => { const g = getShotGroup(s); if (g) groups.add(g); });
  return [...groups].sort();
}

// ─── Grouping ────────────────────────────────────────
function getGridItems(shots) {
  const items = [];
  const seen = {};
  shots.forEach((shot) => {
    const key = getShotGroup(shot);
    if (key && seen[key] !== undefined) items[seen[key]].shots.push(shot);
    else if (key) { seen[key] = items.length; items.push({ type: "group", name: key, shots: [shot] }); }
    else items.push({ type: "single", shot });
  });
  return items;
}

function groupShots(shots) {
  const groups = [];
  const seen = {};
  shots.forEach((shot) => {
    const key = getShotGroup(shot);
    if (key && seen[key] !== undefined) groups[seen[key]].shots.push(shot);
    else if (key) { seen[key] = groups.length; groups.push({ name: key, shots: [shot] }); }
    else groups.push({ name: null, shots: [shot] });
  });
  return groups;
}

function groupKey(locId, groupName) { return `${locId}::${groupName}`; }
function isGroupCollapsed(locId, groupName) { return !!collapsedGroups[groupKey(locId, groupName)]; }

function toggleGroup(locId, groupName) {
  const key = groupKey(locId, groupName);
  if (collapsedGroups[key]) delete collapsedGroups[key];
  else collapsedGroups[key] = true;
  saveCollapsed();
  if (currentLocation) renderShots(currentLocation);
}

function groupStats(shots) {
  return { total: shots.length, done: shots.filter((s) => isCompleted(s.id)).length };
}

// ─── Stats ───────────────────────────────────────────
function locationStats(loc) {
  const shots = visibleShots(loc);
  return { total: shots.length, done: shots.filter((s) => isCompleted(s.id)).length };
}

function getShotIndex(shot, loc) {
  return allShots(loc).indexOf(shot) + 1;
}

function totalStats() {
  let total = 0, done = 0;
  LOCATIONS.forEach((loc) => { const s = locationStats(loc); total += s.total; done += s.done; });
  return { total, done };
}

// ─── Icons ───────────────────────────────────────────
const gridIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`;
const listIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="7" rx="1"/><rect x="3" y="14" width="18" height="7" rx="1"/></svg>`;
const editIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const stackIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="1"><rect x="2" y="6" width="14" height="14" rx="2" fill="none" stroke-width="2"/><path d="M8 2h10a2 2 0 0 1 2 2v10" fill="none" stroke-width="2"/></svg>`;
const addIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;

// ─── Render: Location list ───────────────────────────
function renderLocations() {
  const app = $("#app");
  const stats = totalStats();

  let html = `
    <div class="header">
      <h1>Sall Wedding</h1>
      <div class="header-sub">Shot List — Photography & Videography</div>
      ${stats.total > 0 ? `
        <div class="progress-summary">
          <span>${stats.done}/${stats.total} shots</span>
          <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${stats.total ? (stats.done/stats.total*100) : 0}%"></div></div>
          <span>${stats.total ? Math.round(stats.done/stats.total*100) : 0}%</span>
        </div>
      ` : ""}
    </div>
    <div class="locations">
  `;

  LOCATIONS.forEach((loc) => {
    const s = locationStats(loc);
    html += `
      <div class="location-card" onclick="openLocation('${loc.id}')">
        <div class="location-icon">${loc.icon}</div>
        <div class="location-info">
          <div class="location-name">${loc.name}</div>
          <div class="location-desc">${loc.description}</div>
          ${s.total > 0 ? `
            <div class="location-progress">
              <div class="location-progress-bar"><div class="location-progress-fill" style="width:${s.done/s.total*100}%"></div></div>
              <div class="location-progress-text">${s.done}/${s.total}</div>
            </div>
          ` : `<div class="location-progress-text" style="margin-top:6px;font-size:12px;color:var(--text-muted)">No shots added yet</div>`}
        </div>
        <div class="location-arrow">›</div>
      </div>
    `;
  });

  if (!LOCATIONS.some((l) => allShots(l).length > 0)) {
    html += `<div class="empty-locations">Add reference photos to <code>photos/</code> folders and configure <code>shots.js</code></div>`;
  }

  html += `</div>`;
  app.innerHTML = html;
}

// ─── Render: Shots view ─────────────────────────────
function renderShots(loc) {
  const app = $("#app");
  const s = locationStats(loc);

  if (currentGroup) { renderGroupDetail(loc, currentGroup); return; }

  let html = `
    <div class="header">
      <div class="header-top-row">
        <button class="back-btn" onclick="goBack()">← Back</button>
        <div class="header-actions">
          <button class="view-toggle" onclick="triggerUpload()" title="Add photos">${addIcon}</button>
          <button class="view-toggle ${editMode ? 'active-toggle' : ''}" onclick="toggleEditMode()" title="Edit groups">${editIcon}</button>
          <button class="view-toggle" onclick="toggleView()" title="Switch view">
            ${viewMode === "grid" ? listIcon : gridIcon}
          </button>
        </div>
      </div>
      <h1>${loc.icon} ${loc.name}</h1>
      <div class="header-sub">${loc.description}</div>
      ${s.total > 0 ? `
        <div class="progress-summary">
          <span>${s.done}/${s.total} shots</span>
          <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${s.total ? (s.done/s.total*100) : 0}%"></div></div>
          <span>${s.total ? Math.round(s.done/s.total*100) : 0}%</span>
        </div>
      ` : ""}
      ${editMode ? renderEditBar(loc) : ""}
    </div>
  `;

  const visible = visibleShots(loc);
  if (visible.length === 0) {
    html += `<div class="shot-list"><div class="empty-shots">No shots to show.</div></div>`;
  } else if (viewMode === "grid") {
    html += renderFlatGrid(loc);
  } else {
    html += renderFeed(visible, loc);
  }

  const hiddenCount = allShots(loc).filter((s) => isHidden(s.id)).length;
  if (visible.length > 0 || hiddenCount > 0) {
    html += `<div class="reset-section">`;
    if (visible.length > 0) {
      html += `<button class="reset-btn" onclick="resetLocation('${loc.id}')">Reset all for ${loc.name}</button>`;
    }
    if (hiddenCount > 0) {
      html += `<button class="reset-btn restore-btn" onclick="restoreDeleted('${loc.id}')">Restore ${hiddenCount} deleted shot${hiddenCount > 1 ? 's' : ''}</button>`;
    }
    html += `</div>`;
  }

  app.innerHTML = html;

  // If we came from tapping a grid tile, scroll to that shot or its group carousel
  if (feedStartShotId && viewMode === "list") {
    const el = document.getElementById(`shot-${feedStartShotId}`);
    if (el) {
      el.scrollIntoView({ behavior: "instant", block: "start" });
    } else {
      // Shot might be inside a carousel — find the group card
      const shot = allShots(loc).find((s) => s.id === feedStartShotId);
      if (shot) {
        const groupName = getShotGroup(shot);
        if (groupName) {
          const groupEl = document.getElementById(`group-${groupName.replace(/\s+/g, '-')}`);
          if (groupEl) groupEl.scrollIntoView({ behavior: "instant", block: "start" });
        }
      }
    }
    feedStartShotId = null;
  }
}

// ─── Grid view (Instagram-style) ────────────────────
function renderFlatGrid(loc) {
  const items = getGridItems(visibleShots(loc));
  let html = `<div class="shot-grid-container"><div class="shot-grid">`;
  items.forEach((item) => {
    if (item.type === "group") html += renderGroupTile(item, loc);
    else html += renderGridCard(item.shot, loc);
  });
  html += `</div></div>`;
  return html;
}

function renderGroupTile(group, loc) {
  const gs = groupStats(group.shots);
  const firstShot = group.shots[0];
  const imgSrc = getShotImgSrc(firstShot, loc);
  const escapedName = group.name.replace(/'/g, "\\'");
  const allDone = gs.done === gs.total;

  if (editMode) {
    const isSelected = selectedGroupNames.has(group.name);
    const isMoveSource = moveMode && moveSrcId === `group:${group.name}`;
    const tapAction = moveMode
      ? (isMoveSource ? `cancelMove()` : `moveToPosition('group:${escapedName}')`)
      : `toggleSelectGroup('${escapedName}')`;
    return `
      <div class="grid-card ${isSelected ? 'selected' : ''} ${isMoveSource ? 'move-source' : ''} ${moveMode && !isMoveSource ? 'move-target' : ''} edit-group-tile" onclick="${tapAction}">
        <div class="grid-img">
          ${imgSrc ? `<img src="${imgSrc}" loading="lazy" alt="${group.name}">` : `<div class="grid-no-img">${group.name}</div>`}
          <div class="grid-stack-badge">${stackIcon} ${group.shots.length}</div>
          ${isSelected ? `<div class="grid-select-overlay"><svg viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"/></svg></div>` : ""}
        </div>
        <div class="grid-bottom">
          <span class="grid-label grid-group-label">${group.name}</span>
          ${!moveMode ? `<span class="grid-edit-link" onclick="event.stopPropagation(); openGroupForEdit('${escapedName}')">Edit</span>` : ""}
        </div>
      </div>
    `;
  }

  return `
    <div class="grid-card ${allDone ? 'completed' : ''}" onclick="openGroup('${escapedName}')">
      <div class="grid-img">
        ${imgSrc ? `<img src="${imgSrc}" loading="lazy" alt="${group.name}">` : `<div class="grid-no-img">${group.name}</div>`}
        <div class="grid-stack-badge">${stackIcon} ${group.shots.length}</div>
        ${allDone ? `<div class="grid-check-overlay"><svg viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"/></svg></div>` : ""}
      </div>
      <div class="grid-bottom">
        <span class="grid-label grid-group-label">${group.name}</span>
        <span class="grid-group-count">${gs.done}/${gs.total}</span>
      </div>
    </div>
  `;
}

function renderGridCard(shot, loc) {
  const done = isCompleted(shot.id);
  const imgSrc = getShotImgSrc(shot, loc);
  const shotIndex = getShotIndex(shot, loc);
  const isSelected = selectedShots.has(shot.id);

  if (editMode) {
    const isMoveSource = moveMode && moveSrcId === shot.id;
    const tapAction = moveMode
      ? (isMoveSource ? `cancelMove()` : `moveToPosition('${shot.id}')`)
      : `toggleSelect('${shot.id}')`;
    return `
      <div class="grid-card ${isSelected ? 'selected' : ''} ${isMoveSource ? 'move-source' : ''} ${moveMode && !isMoveSource ? 'move-target' : ''}" onclick="${tapAction}">
        <div class="grid-img">
          ${imgSrc ? `<img src="${imgSrc}" loading="lazy" alt="Shot ${shotIndex}">` : `<div class="grid-no-img">No image</div>`}
          <div class="grid-number">#${shotIndex}</div>
          ${isSelected ? `<div class="grid-select-overlay"><svg viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"/></svg></div>` : ""}
        </div>
        <div class="grid-bottom"><span class="grid-label">${getShotGroup(shot) || "No group"}</span></div>
      </div>
    `;
  }

  return `
    <div class="grid-card ${done ? 'completed' : ''}" onclick="openFeedAt('${shot.id}')">
      <div class="grid-img">
        ${imgSrc ? `<img src="${imgSrc}" loading="lazy" alt="Shot ${shotIndex}">` : `<div class="grid-no-img">No image</div>`}
        <div class="grid-number">#${shotIndex}</div>
        ${done ? `<div class="grid-check-overlay"><svg viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"/></svg></div>` : ""}
      </div>
      <div class="grid-bottom">
        <span class="grid-label">${getShotDescription(shot) || `Shot ${shotIndex}`}</span>
      </div>
    </div>
  `;
}

// ─── Feed view (scrollable list — groups become carousels) ─
function renderFeed(shots, loc) {
  const items = getGridItems(shots);
  let html = `<div class="shot-list">`;
  items.forEach((item) => {
    if (item.type === "group") {
      html += renderCarouselCard(item, loc);
    } else {
      html += renderFeedCard(item.shot, loc);
    }
  });
  html += `</div>`;
  return html;
}

function renderFeedCard(shot, loc) {
  const done = isCompleted(shot.id);
  const imgSrc = getShotImgSrc(shot, loc);
  const shotIndex = getShotIndex(shot, loc);
  const desc = getShotDescription(shot);
  const notes = getShotNotes(shot);
  const displayName = desc || `Shot ${shotIndex}`;
  const escapedId = shot.id.replace(/'/g, "\\'");

  if (editMode) {
    const isSelected = selectedShots.has(shot.id);
    return `
      <div class="shot-card ${isSelected ? 'selected' : ''}" id="shot-${shot.id}" onclick="toggleSelect('${shot.id}')">
        <div class="shot-top">
          <div class="shot-select-checkbox ${isSelected ? 'checked' : ''}">
            <svg viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"/></svg>
          </div>
          <div class="shot-body">
            <div class="shot-number">#${shotIndex}</div>
            <div class="shot-description">${displayName}</div>
            <div class="shot-meta">
              <span class="shot-tag ${getShotGroup(shot) ? 'has-group' : 'no-group'}">${getShotGroup(shot) || "No group"}</span>
            </div>
          </div>
        </div>
        ${imgSrc ? `<div class="shot-ref"><img src="${imgSrc}" loading="lazy" alt="${displayName}"></div>` : ""}
      </div>
    `;
  }

  return `
    <div class="shot-card ${done ? 'completed' : ''}" id="shot-${shot.id}">
      <div class="shot-top">
        <div class="shot-checkbox" onclick="toggle('${escapedId}')">
          <svg viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"/></svg>
        </div>
        <div class="shot-body">
          <div class="shot-number">#${shotIndex}</div>
          <input class="shot-description-input" type="text" value="${desc.replace(/"/g, '&quot;')}" placeholder="Add description..." onchange="saveField('${escapedId}', 'description', this.value)" onclick="event.stopPropagation()">
          <input class="shot-notes-input" type="text" value="${notes.replace(/"/g, '&quot;')}" placeholder="Add notes for photographer..." onchange="saveField('${escapedId}', 'notes', this.value)" onclick="event.stopPropagation()">
        </div>
      </div>
      ${imgSrc ? `<div class="shot-ref"><img src="${imgSrc}" loading="lazy" alt="${displayName}"></div>` : ""}
    </div>
  `;
}

// ─── Carousel card for grouped shots ─────────────────
let carouselCounter = 0;

function renderCarouselCard(group, loc) {
  const gs = groupStats(group.shots);
  const carouselId = `carousel-${carouselCounter++}`;

  let slides = "";
  let dots = "";
  group.shots.forEach((shot, i) => {
    const imgSrc = getShotImgSrc(shot, loc);
    const shotIndex = getShotIndex(shot, loc);
    const done = isCompleted(shot.id);
    const desc = getShotDescription(shot);
    const notes = getShotNotes(shot);
    const displayName = desc || `Shot ${shotIndex}`;
    const escapedId = shot.id.replace(/'/g, "\\'");

    slides += `
      <div class="carousel-slide" data-index="${i}">
        ${imgSrc ? `<img src="${imgSrc}" loading="lazy" alt="${displayName}">` : `<div class="grid-no-img">${displayName}</div>`}
        <div class="carousel-slide-info">
          <div class="carousel-slide-top">
            <div class="shot-checkbox ${done ? 'completed-cb' : ''}" onclick="toggle('${escapedId}')">
              <svg viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"/></svg>
            </div>
            <div class="carousel-slide-fields">
              <input class="shot-description-input carousel-input" type="text" value="${desc.replace(/"/g, '&quot;')}" placeholder="Add description..." onchange="saveField('${escapedId}', 'description', this.value)">
              <input class="shot-notes-input carousel-input" type="text" value="${notes.replace(/"/g, '&quot;')}" placeholder="Notes..." onchange="saveField('${escapedId}', 'notes', this.value)">
            </div>
          </div>
        </div>
      </div>
    `;
    dots += `<div class="carousel-dot ${i === 0 ? 'active' : ''}" data-carousel="${carouselId}" data-dot="${i}"></div>`;
  });

  return `
    <div class="shot-card" id="group-${group.name.replace(/\s+/g, '-')}">
      <div class="carousel-header">
        <span class="carousel-group-name">${group.name}</span>
        <span class="carousel-group-count">${gs.done}/${gs.total}</span>
      </div>
      <div class="carousel" id="${carouselId}" onscroll="onCarouselScroll('${carouselId}', ${group.shots.length})">
        ${slides}
      </div>
      <div class="carousel-dots" id="${carouselId}-dots">
        ${dots}
      </div>
    </div>
  `;
}

function onCarouselScroll(carouselId, count) {
  const carousel = document.getElementById(carouselId);
  if (!carousel) return;
  const slideWidth = carousel.offsetWidth;
  const activeIndex = Math.round(carousel.scrollLeft / slideWidth);
  const dots = document.querySelectorAll(`[data-carousel="${carouselId}"]`);
  dots.forEach((dot) => {
    dot.classList.toggle("active", parseInt(dot.dataset.dot) === activeIndex);
  });
}

// ─── Group detail view ──────────────────────────────
function renderGroupDetail(loc, groupName) {
  const app = $("#app");
  const shots = visibleShots(loc).filter((s) => getShotGroup(s) === groupName);
  const gs = groupStats(shots);
  const escapedName = groupName.replace(/'/g, "\\'");

  let html = `
    <div class="header">
      <div class="header-top-row">
        <button class="back-btn" onclick="closeGroup()">← ${loc.name}</button>
      </div>
      <div class="group-title-row">
        <h1>${groupName}</h1>
        <button class="group-rename-btn" onclick="renameGroup('${escapedName}')">Rename</button>
      </div>
      <div class="header-sub">${gs.total} shots in this group</div>
      ${editMode ? `
        <div class="edit-bar">
          <span class="edit-bar-label">${selectedShots.size} selected</span>
          <button class="edit-bar-btn edit-bar-btn-dim" onclick="removeGroupFromSelected()">Remove from group</button>
          <button class="edit-bar-btn edit-bar-btn-danger" onclick="deleteSelected()">Delete</button>
        </div>
      ` : `
        <div class="progress-summary">
          <span>${gs.done}/${gs.total} shots</span>
          <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${gs.total ? (gs.done/gs.total*100) : 0}%"></div></div>
          <span>${gs.total ? Math.round(gs.done/gs.total*100) : 0}%</span>
        </div>
      `}
    </div>
  `;

  if (editMode) {
    // Show grid of individual shots for selection
    html += `<div class="shot-grid-container"><div class="shot-grid">`;
    shots.forEach((shot) => {
      const isSelected = selectedShots.has(shot.id);
      const shotIndex = getShotIndex(shot, loc);
      const imgSrc = getShotImgSrc(shot, loc);
      html += `
        <div class="grid-card ${isSelected ? 'selected' : ''}" onclick="toggleSelect('${shot.id}')">
          <div class="grid-img">
            ${imgSrc ? `<img src="${imgSrc}" loading="lazy" alt="Shot ${shotIndex}">` : `<div class="grid-no-img">No image</div>`}
            <div class="grid-number">#${shotIndex}</div>
            ${isSelected ? `<div class="grid-select-overlay"><svg viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"/></svg></div>` : ""}
          </div>
          <div class="grid-bottom"><span class="grid-label">Shot ${shotIndex}</span></div>
        </div>
      `;
    });
    html += `</div></div>`;
  } else {
    html += renderFeed(shots, loc);
  }

  app.innerHTML = html;
}

// ─── Actions ─────────────────────────────────────────
async function openLocation(id) {
  currentLocation = LOCATIONS.find((l) => l.id === id);
  if (currentLocation) {
    editMode = false; selectedShots.clear(); selectedGroupNames.clear(); currentGroup = null; feedStartShotId = null;
    await loadBlobUrls(currentLocation);
    renderShots(currentLocation);
    window.scrollTo(0, 0);
    history.pushState({ location: id }, "", `#${id}`);
  }
}

function goBack() {
  if (viewMode === "list" && feedStartShotId === null && currentLocation && !currentGroup) {
    // If in feed view (came from grid tap), go back to grid
    viewMode = "grid";
    localStorage.setItem(VIEW_KEY, viewMode);
    renderShots(currentLocation);
    window.scrollTo(0, 0);
    return;
  }
  editMode = false; selectedShots.clear(); selectedGroupNames.clear(); currentGroup = null;
  currentLocation = null;
  renderLocations();
  window.scrollTo(0, 0);
  history.pushState({}, "", " ");
}

function openFeedAt(shotId) {
  // Switch to list/feed view scrolled to this shot
  feedStartShotId = shotId;
  viewMode = "list";
  localStorage.setItem(VIEW_KEY, viewMode);
  if (currentLocation) renderShots(currentLocation);
}

function openGroup(groupName) {
  // Find the first shot in this group and open feed at that point
  if (currentLocation) {
    const firstShot = currentLocation.shots.find((s) => getShotGroup(s) === groupName);
    if (firstShot) {
      openFeedAt(firstShot.id);
      return;
    }
  }
  currentGroup = groupName;
  if (currentLocation) renderShots(currentLocation);
  window.scrollTo(0, 0);
}

function openGroupForEdit(groupName) {
  currentGroup = groupName;
  selectedShots.clear();
  selectedGroupNames.clear();
  if (currentLocation) renderShots(currentLocation);
  window.scrollTo(0, 0);
}

function closeGroup() {
  currentGroup = null;
  editMode = false;
  selectedShots.clear();
  selectedGroupNames.clear();
  if (currentLocation) renderShots(currentLocation);
  window.scrollTo(0, 0);
}

function toggle(shotId) {
  toggleCompleted(shotId);
  if (currentLocation) renderShots(currentLocation);
}

function toggleView() {
  viewMode = viewMode === "grid" ? "list" : "grid";
  feedStartShotId = null;
  localStorage.setItem(VIEW_KEY, viewMode);
  if (currentLocation) renderShots(currentLocation);
}

function toggleEditMode() {
  editMode = !editMode;
  selectedShots.clear();
  selectedGroupNames.clear();
  moveMode = false;
  moveSrcId = null;
  if (currentLocation) renderShots(currentLocation);
}

function toggleSelect(shotId) {
  if (selectedShots.has(shotId)) selectedShots.delete(shotId);
  else selectedShots.add(shotId);
  if (currentLocation) renderShots(currentLocation);
}

function toggleSelectGroup(groupName) {
  if (selectedGroupNames.has(groupName)) selectedGroupNames.delete(groupName);
  else selectedGroupNames.add(groupName);
  if (currentLocation) renderShots(currentLocation);
}

function renderEditBar(loc) {
  if (moveMode) {
    return `
      <div class="edit-bar move-bar">
        <span class="edit-bar-label">Tap where to place it</span>
        <button class="edit-bar-btn edit-bar-btn-dim" onclick="cancelMove()">Cancel</button>
      </div>
    `;
  }
  const totalSelected = selectedShots.size + selectedGroupNames.size;
  const canMove = totalSelected === 1;
  return `
    <div class="edit-bar">
      <span class="edit-bar-label">${totalSelected} selected</span>
      ${canMove ? `<button class="edit-bar-btn" onclick="enterMoveMode()">Move</button>` : ""}
      <button class="edit-bar-btn" onclick="smartGroup()">Group</button>
      <button class="edit-bar-btn edit-bar-btn-dim" onclick="removeGroupFromSelected()">Ungroup</button>
      <button class="edit-bar-btn edit-bar-btn-danger" onclick="deleteSelected()">Delete</button>
    </div>
  `;
}

function deleteSelected() {
  const shotCount = selectedShots.size;
  let groupShotCount = 0;
  if (currentLocation) {
    selectedGroupNames.forEach((groupName) => {
      groupShotCount += visibleShots(currentLocation).filter((s) => getShotGroup(s) === groupName).length;
    });
  }
  const total = shotCount + groupShotCount;
  if (total === 0) return;

  if (!confirm(`Delete ${total} shot${total > 1 ? 's' : ''}? You can restore them later.`)) return;

  // Hide individual shots
  selectedShots.forEach((shotId) => { hiddenShots[shotId] = true; });

  // Hide all shots in selected groups
  if (currentLocation) {
    selectedGroupNames.forEach((groupName) => {
      allShots(currentLocation).forEach((shot) => {
        if (getShotGroup(shot) === groupName) hiddenShots[shot.id] = true;
      });
    });
  }

  saveHidden(); selectedShots.clear(); selectedGroupNames.clear(); editMode = false;

  if (currentGroup && currentLocation) {
    const remaining = visibleShots(currentLocation).filter((s) => getShotGroup(s) === currentGroup);
    if (remaining.length === 0) currentGroup = null;
  }

  if (currentLocation) renderShots(currentLocation);
}

function getNextGroupName() {
  const existing = currentLocation ? getExistingGroups(currentLocation) : [];
  let n = existing.length + 1;
  while (existing.includes(`Group ${n}`)) n++;
  return `Group ${n}`;
}

function smartGroup() {
  if (selectedShots.size + selectedGroupNames.size < 2) return;

  const groupNames = [...selectedGroupNames];

  if (groupNames.length === 0) {
    // Only ungrouped photos selected → create new group
    const name = getNextGroupName();
    selectedShots.forEach((shotId) => { groupOverrides[shotId] = name; });
  } else {
    // Use the first selected group name as the target
    const targetGroup = groupNames[0];

    // Add all selected ungrouped photos to that group
    selectedShots.forEach((shotId) => { groupOverrides[shotId] = targetGroup; });

    // Merge any other selected groups into the target
    for (let i = 1; i < groupNames.length; i++) {
      const otherGroup = groupNames[i];
      if (currentLocation) {
        allShots(currentLocation).forEach((shot) => {
          if (getShotGroup(shot) === otherGroup) {
            groupOverrides[shot.id] = targetGroup;
          }
        });
      }
    }
  }

  saveGroups();
  selectedShots.clear();
  selectedGroupNames.clear();
  editMode = false;
  if (currentLocation) renderShots(currentLocation);
}

function removeGroupFromSelected() {
  if (selectedShots.size === 0 && selectedGroupNames.size === 0) return;

  // Ungroup individual shots
  selectedShots.forEach((shotId) => { groupOverrides[shotId] = ""; });

  // Ungroup all shots in selected groups
  if (currentLocation) {
    selectedGroupNames.forEach((groupName) => {
      allShots(currentLocation).forEach((shot) => {
        if (getShotGroup(shot) === groupName) groupOverrides[shot.id] = "";
      });
    });
  }

  saveGroups(); selectedShots.clear(); selectedGroupNames.clear(); editMode = false;

  // If we're inside a group and removed all shots, go back to grid
  if (currentGroup && currentLocation) {
    const remaining = currentLocation.shots.filter((s) => getShotGroup(s) === currentGroup);
    if (remaining.length === 0) currentGroup = null;
  }

  if (currentLocation) renderShots(currentLocation);
}

function renameGroup(oldName) {
  const newName = prompt(`Rename group:`, oldName);
  if (newName === null || newName.trim() === "" || newName.trim() === oldName) return;
  const trimmed = newName.trim();
  if (currentLocation) {
    allShots(currentLocation).forEach((shot) => {
      if (getShotGroup(shot) === oldName) groupOverrides[shot.id] = trimmed;
    });
  }
  saveGroups();
  if (currentGroup === oldName) currentGroup = trimmed;
  if (currentLocation) renderShots(currentLocation);
}

function restoreDeleted(locId) {
  const loc = LOCATIONS.find((l) => l.id === locId);
  if (!loc) return;
  allShots(loc).forEach((s) => { delete hiddenShots[s.id]; });
  saveHidden();
  renderShots(loc);
}

function resetLocation(locId) {
  const loc = LOCATIONS.find((l) => l.id === locId);
  if (!loc) return;
  if (!confirm(`Reset all checkboxes for ${loc.name}?`)) return;
  allShots(loc).forEach((s) => { delete completedShots[s.id]; });
  saveCompleted();
  renderShots(loc);
}

// ─── Reorder (tap to move) ───────────────────────────
let moveMode = false; // true when waiting for user to tap a target position
let moveSrcId = null; // the shot/group ID being moved

function enterMoveMode() {
  // Collect what's being moved — exactly 1 selected item (shot or group)
  if (selectedShots.size === 1 && selectedGroupNames.size === 0) {
    moveSrcId = [...selectedShots][0];
  } else if (selectedGroupNames.size === 1 && selectedShots.size === 0) {
    moveSrcId = "group:" + [...selectedGroupNames][0];
  } else {
    return;
  }
  moveMode = true;
  selectedShots.clear();
  selectedGroupNames.clear();
  if (currentLocation) renderShots(currentLocation);
}

function cancelMove() {
  moveMode = false;
  moveSrcId = null;
  if (currentLocation) renderShots(currentLocation);
}

function moveToPosition(targetId) {
  if (!moveMode || !moveSrcId || !currentLocation) return;

  // Ensure we have an order array
  if (!orderOverrides[currentLocation.id]) {
    orderOverrides[currentLocation.id] = visibleShots(currentLocation).map((s) => s.id);
  }
  const order = orderOverrides[currentLocation.id];

  // Get source shot IDs
  const fromIds = moveSrcId.startsWith("group:") ?
    visibleShots(currentLocation).filter((s) => getShotGroup(s) === moveSrcId.slice(6)).map((s) => s.id) :
    [moveSrcId];

  // Get target shot ID
  const toIsGroup = targetId.startsWith("group:");
  const targetShotId = toIsGroup ?
    visibleShots(currentLocation).find((s) => getShotGroup(s) === targetId.slice(6))?.id :
    targetId;

  // Remove source from order
  const remaining = order.filter((id) => !fromIds.includes(id));

  // Insert at target position
  let insertIdx = remaining.indexOf(targetShotId);
  if (insertIdx === -1) insertIdx = remaining.length;
  remaining.splice(insertIdx, 0, ...fromIds);

  orderOverrides[currentLocation.id] = remaining;
  saveOrder();

  moveMode = false;
  moveSrcId = null;
  renderShots(currentLocation);
}

// ─── Inline editing ──────────────────────────────────
function saveField(shotId, field, value) {
  if (!descOverrides[shotId]) descOverrides[shotId] = {};
  descOverrides[shotId][field] = value;
  saveDescriptions();
}

// ─── Upload ──────────────────────────────────────────
function triggerUpload() {
  if (!currentLocation) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = true;
  input.onchange = (e) => handleUpload(e.target.files);
  input.click();
}

async function handleUpload(files) {
  if (!currentLocation || !files || files.length === 0) return;
  const locId = currentLocation.id;
  if (!uploadedShots[locId]) uploadedShots[locId] = [];

  for (const file of files) {
    const shotId = `upload-${locId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const blob = file;

    await storeBlob(shotId, blob);
    blobUrls[shotId] = URL.createObjectURL(blob);

    uploadedShots[locId].push({
      id: shotId,
      description: "",
      notes: "",
      type: "photo",
      priority: "must-have"
    });
  }

  saveUploads();
  renderShots(currentLocation);
}

// Load blob URLs for uploaded shots on location open
async function loadBlobUrls(loc) {
  const uploads = uploadedShots[loc.id] || [];
  for (const shot of uploads) {
    if (!blobUrls[shot.id]) {
      const blob = await getBlob(shot.id);
      if (blob) blobUrls[shot.id] = URL.createObjectURL(blob);
    }
  }
}

// ─── Browser navigation ─────────────────────────────
window.addEventListener("popstate", async () => {
  const hash = window.location.hash.replace("#", "");
  if (hash) {
    const loc = LOCATIONS.find((l) => l.id === hash);
    if (loc) {
      currentLocation = loc; currentGroup = null;
      await loadBlobUrls(loc);
      renderShots(loc);
      return;
    }
  }
  currentLocation = null; currentGroup = null; renderLocations();
});

// ─── Init ────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  const hash = window.location.hash.replace("#", "");
  if (hash) {
    const loc = LOCATIONS.find((l) => l.id === hash);
    if (loc) {
      currentLocation = loc;
      await loadBlobUrls(loc);
      renderShots(loc);
      return;
    }
  }
  renderLocations();
});
