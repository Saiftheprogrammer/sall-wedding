// ─── Supabase ────────────────────────────────────────
const SUPABASE_URL = "https://gltvxluqxxppvygrevwg.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsdHZ4bHVxeHhwcHZ5Z3JldndnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5NzExNjcsImV4cCI6MjA5MjU0NzE2N30.8XM4gEOtKpwgfXqD_9VS3MwyiyiJeGRqSI9shVdx7KY";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Auth ────────────────────────────────────────────
const PASSWORDS = { edit: "waha", view: "SalieuAissatou" };
let userRole = localStorage.getItem("sall-role") || null; // "edit" or "view"

function canEdit() { return userRole === "edit"; }

function showLoginScreen() {
  const app = document.querySelector("#app");
  app.innerHTML = `
    <div class="login-screen">
      <h1>Sall Wedding</h1>
      <p class="login-sub">Shot List — Photography & Videography</p>
      <input type="password" id="login-pw" class="login-input" placeholder="Enter password" autofocus>
      <button class="login-btn" onclick="attemptLogin()">Enter</button>
      <div id="login-error" class="login-error"></div>
    </div>
  `;
  document.getElementById("login-pw").addEventListener("keydown", (e) => {
    if (e.key === "Enter") attemptLogin();
  });
}

function attemptLogin() {
  const pw = document.getElementById("login-pw").value;
  if (pw === PASSWORDS.edit) {
    userRole = "edit";
  } else if (pw === PASSWORDS.view) {
    userRole = "view";
  } else {
    document.getElementById("login-error").textContent = "Incorrect password";
    return;
  }
  localStorage.setItem("sall-role", userRole);
  initApp();
}

function logout() {
  userRole = null;
  localStorage.removeItem("sall-role");
  showLoginScreen();
}

// ─── State ───────────────────────────────────────────
let completedShots = {};
let groupOverrides = {};
let hiddenShots = {};
let descOverrides = {};
let orderOverrides = {};
let uploadedShots = {};
let customLocations = []; // user-created locations stored in Supabase
let locationOverrides = {}; // { locId: { name, description, icon } } for renaming
let locationOrder = []; // ordered array of location IDs
let collapsedGroups = JSON.parse(localStorage.getItem("sall-collapsed") || "{}");
let viewMode = localStorage.getItem("sall-view") || "grid";
let currentLocation = null;
let currentGroup = null;
let editMode = false;
let selectedShots = new Set();
let selectedGroupNames = new Set();
let feedStartShotId = null;

const $ = (sel) => document.querySelector(sel);

// ─── Supabase state persistence ─────────────────────
async function loadState(key) {
  const { data } = await sb.from("app_state").select("value").eq("key", key).maybeSingle();
  return data ? data.value : {};
}

async function saveState(key, value) {
  await sb.from("app_state").upsert({ key, value, updated_at: new Date().toISOString() });
}

async function loadAllState() {
  const [c, g, h, d, o, cl, lo, locOrd] = await Promise.all([
    loadState("completed"),
    loadState("groups"),
    loadState("hidden"),
    loadState("descriptions"),
    loadState("order"),
    loadState("custom_locations"),
    loadState("location_overrides"),
    loadState("location_order")
  ]);
  completedShots = c || {};
  groupOverrides = g || {};
  hiddenShots = h || {};
  descOverrides = d || {};
  orderOverrides = o || {};
  customLocations = Array.isArray(cl) ? cl : [];
  locationOverrides = lo || {};
  locationOrder = Array.isArray(locOrd) ? locOrd : [];

  // Load uploaded photos from DB
  const { data: uploads } = await sb.from("uploaded_photos").select("*");
  uploadedShots = {};
  if (uploads) {
    uploads.forEach((u) => {
      if (!uploadedShots[u.location_id]) uploadedShots[u.location_id] = [];
      uploadedShots[u.location_id].push(u);
    });
  }
}

// Debounced save helpers
let saveTimers = {};
function debouncedSave(key, value, delay = 300) {
  clearTimeout(saveTimers[key]);
  saveTimers[key] = setTimeout(() => saveState(key, value), delay);
}

function saveCompleted() { debouncedSave("completed", completedShots); }
function saveGroups() { debouncedSave("groups", groupOverrides); }
function saveHidden() { debouncedSave("hidden", hiddenShots); }
function saveDescriptions() { debouncedSave("descriptions", descOverrides); }
function saveOrder() { debouncedSave("order", orderOverrides); }
function saveCollapsed() { localStorage.setItem("sall-collapsed", JSON.stringify(collapsedGroups)); }

function isHidden(shotId) { return !!hiddenShots[shotId]; }
function isCompleted(shotId) { return !!completedShots[shotId]; }

function toggleCompleted(shotId) {
  if (completedShots[shotId]) delete completedShots[shotId];
  else completedShots[shotId] = Date.now();
  saveCompleted();
}

// ─── Description/notes overrides ─────────────────────
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

// ─── All shots (original + uploaded) ─────────────────
function allShots(loc) {
  const uploads = (uploadedShots[loc.id] || []).map((s) => ({
    ...s,
    _uploaded: true,
    photo: s.id
  }));
  return [...loc.shots, ...uploads];
}

// ─── Visible shots (filters out hidden, respects order) ──
function visibleShots(loc) {
  const all = allShots(loc).filter((s) => !isHidden(s.id));
  const order = orderOverrides[loc.id];
  if (!order || order.length === 0) return all;
  const orderMap = {};
  order.forEach((id, i) => { orderMap[id] = i; });
  return all.sort((a, b) => {
    const ai = orderMap[a.id] !== undefined ? orderMap[a.id] : 99999;
    const bi = orderMap[b.id] !== undefined ? orderMap[b.id] : 99999;
    return ai - bi;
  });
}

function persistOrder(loc) {
  orderOverrides[loc.id] = visibleShots(loc).map((s) => s.id);
  saveOrder();
}

// ─── Resolve image src ──────────────────────────────
function getShotImgSrc(shot, loc) {
  if (shot._uploaded) {
    const { data } = sb.storage.from("photos").getPublicUrl(shot.file_path);
    return data?.publicUrl || null;
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
  const idx = allShots(loc).findIndex((s) => s.id === shot.id);
  return idx + 1;
}

function totalStats() {
  let total = 0, done = 0;
  getAllLocations().forEach((loc) => { const s = locationStats(loc); total += s.total; done += s.done; });
  return { total, done };
}

// ─── Location management ────────────────────────────
function saveCustomLocations() { debouncedSave("custom_locations", customLocations, 100); }
function saveLocationOverrides() { debouncedSave("location_overrides", locationOverrides, 100); }
function saveLocationOrder() { debouncedSave("location_order", locationOrder, 100); }

function getAllLocations() {
  // Merge built-in LOCATIONS with custom ones
  const builtIn = LOCATIONS.map((loc) => {
    const ov = locationOverrides[loc.id];
    if (ov) return { ...loc, name: ov.name || loc.name, description: ov.description || loc.description, icon: ov.icon || loc.icon };
    return loc;
  });
  const custom = customLocations.map((loc) => {
    const ov = locationOverrides[loc.id];
    if (ov) return { ...loc, name: ov.name || loc.name, description: ov.description || loc.description, icon: ov.icon || loc.icon };
    return loc;
  });
  const all = [...builtIn, ...custom];

  if (locationOrder.length === 0) return all;
  const orderMap = {};
  locationOrder.forEach((id, i) => { orderMap[id] = i; });
  return all.sort((a, b) => {
    const ai = orderMap[a.id] !== undefined ? orderMap[a.id] : 99999;
    const bi = orderMap[b.id] !== undefined ? orderMap[b.id] : 99999;
    return ai - bi;
  });
}

function addLocation() {
  const name = prompt("Location name:");
  if (!name || !name.trim()) return;
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  customLocations.push({
    id, name: name.trim(), icon: "📍", description: "",
    folder: `photos/${id}`, shots: []
  });
  saveCustomLocations();
  renderLocations();
}

function renameLocation(locId) {
  const locs = getAllLocations();
  const loc = locs.find((l) => l.id === locId);
  if (!loc) return;
  const newName = prompt("Rename location:", loc.name);
  if (newName === null || !newName.trim() || newName.trim() === loc.name) return;
  if (!locationOverrides[locId]) locationOverrides[locId] = {};
  locationOverrides[locId].name = newName.trim();
  saveLocationOverrides();
  renderLocations();
}

function changeLocationIcon(locId) {
  const icons = ["📍","🏠","🌿","💒","🕌","🏡","⛪","🏖️","🌅","🎪","🏰","🌸","🌳","🍽️","💃","🎶"];
  const loc = getAllLocations().find((l) => l.id === locId);
  if (!loc) return;
  const pick = prompt("Pick an emoji icon:\n\n" + icons.join("  ") + "\n\nOr type your own:", loc.icon);
  if (pick === null || !pick.trim()) return;
  if (!locationOverrides[locId]) locationOverrides[locId] = {};
  locationOverrides[locId].icon = pick.trim();
  saveLocationOverrides();
  renderLocations();
}

let locEditMode = false;
let selectedLocId = null;

function toggleLocEditMode() {
  locEditMode = !locEditMode;
  selectedLocId = null;
  renderLocations();
}

function selectLocation(locId) {
  selectedLocId = selectedLocId === locId ? null : locId;
  renderLocations();
}

function moveLocationUp(locId) {
  const locs = getAllLocations();
  if (locationOrder.length === 0) locationOrder = locs.map((l) => l.id);
  const idx = locationOrder.indexOf(locId);
  if (idx <= 0) return;
  [locationOrder[idx - 1], locationOrder[idx]] = [locationOrder[idx], locationOrder[idx - 1]];
  saveLocationOrder();
  renderLocations();
}

function moveLocationDown(locId) {
  const locs = getAllLocations();
  if (locationOrder.length === 0) locationOrder = locs.map((l) => l.id);
  const idx = locationOrder.indexOf(locId);
  if (idx === -1 || idx >= locationOrder.length - 1) return;
  [locationOrder[idx], locationOrder[idx + 1]] = [locationOrder[idx + 1], locationOrder[idx]];
  saveLocationOrder();
  renderLocations();
}

function deleteLocation(locId) {
  // Only allow deleting custom locations
  const isCustom = customLocations.some((l) => l.id === locId);
  if (!isCustom) { alert("Can't delete built-in locations"); return; }
  if (!confirm("Delete this location and all its photos?")) return;
  customLocations = customLocations.filter((l) => l.id !== locId);
  saveCustomLocations();
  locEditMode = false;
  renderLocations();
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
  const locs = getAllLocations();

  let html = `
    <div class="header">
      <div class="header-top-row">
        <h1>Sall Wedding</h1>
        <div class="header-actions">
          ${canEdit() ? `
            <button class="view-toggle" onclick="addLocation()" title="Add location">${addIcon}</button>
            <button class="view-toggle ${locEditMode ? 'active-toggle' : ''}" onclick="toggleLocEditMode()" title="Edit locations">${editIcon}</button>
          ` : ""}
          <button class="view-toggle" onclick="logout()" title="Logout">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </button>
        </div>
      </div>
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

  locs.forEach((loc, i) => {
    const s = locationStats(loc);

    if (locEditMode) {
      const isCustom = customLocations.some((l) => l.id === loc.id);
      html += `
        <div class="location-card loc-edit-card">
          <div class="location-icon" onclick="changeLocationIcon('${loc.id}')" style="cursor:pointer">${loc.icon}</div>
          <div class="location-info">
            <div class="location-name">${loc.name}</div>
            <div class="loc-edit-actions">
              <button class="loc-edit-btn" onclick="renameLocation('${loc.id}')">Rename</button>
              <button class="loc-edit-btn" onclick="moveLocationUp('${loc.id}')" ${i === 0 ? 'disabled' : ''}>▲</button>
              <button class="loc-edit-btn" onclick="moveLocationDown('${loc.id}')" ${i === locs.length - 1 ? 'disabled' : ''}>▼</button>
              ${isCustom ? `<button class="loc-edit-btn loc-delete-btn" onclick="deleteLocation('${loc.id}')">Delete</button>` : ""}
            </div>
          </div>
        </div>
      `;
    } else {
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
    }
  });

  if (locs.length === 0) {
    html += `<div class="empty-locations">No locations yet. Tap + to add one.</div>`;
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
          ${canEdit() ? `<button class="view-toggle" onclick="triggerUpload()" title="Add photos">${addIcon}</button>` : ""}
          ${canEdit() ? `<button class="view-toggle ${editMode ? 'active-toggle' : ''}" onclick="toggleEditMode()" title="Edit groups">${editIcon}</button>` : ""}
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


  app.innerHTML = html;

  if (feedStartShotId && viewMode === "list") {
    const el = document.getElementById(`shot-${feedStartShotId}`);
    if (el) {
      el.scrollIntoView({ behavior: "instant", block: "start" });
    } else {
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
    if (item.type === "group") html += renderCarouselCard(item, loc);
    else html += renderFeedCard(item.shot, loc);
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

  const ro = !canEdit() ? "readonly" : "";

  return `
    <div class="shot-card ${done ? 'completed' : ''}" id="shot-${shot.id}">
      <div class="shot-top">
        ${canEdit() ? `
          <div class="shot-checkbox" onclick="toggle('${escapedId}')">
            <svg viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"/></svg>
          </div>
        ` : ""}
        <div class="shot-body">
          <div class="shot-number">#${shotIndex}</div>
          <input class="shot-description-input" type="text" value="${desc.replace(/"/g, '&quot;')}" placeholder="${canEdit() ? 'Add description...' : ''}" ${ro} onchange="saveField('${escapedId}', 'description', this.value)" onclick="event.stopPropagation()">
          ${(notes || canEdit()) ? `<input class="shot-notes-input" type="text" value="${notes.replace(/"/g, '&quot;')}" placeholder="${canEdit() ? 'Add notes for photographer...' : ''}" ${ro} onchange="saveField('${escapedId}', 'notes', this.value)" onclick="event.stopPropagation()">` : ""}
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

    const cRo = !canEdit() ? "readonly" : "";
    slides += `
      <div class="carousel-slide" data-index="${i}">
        ${imgSrc ? `<img src="${imgSrc}" loading="lazy" alt="${displayName}">` : `<div class="grid-no-img">${displayName}</div>`}
        <div class="carousel-slide-info">
          <div class="carousel-slide-top">
            ${canEdit() ? `
              <div class="shot-checkbox ${done ? 'completed-cb' : ''}" onclick="toggle('${escapedId}')">
                <svg viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"/></svg>
              </div>
            ` : ""}
            <div class="carousel-slide-fields">
              <input class="shot-description-input carousel-input" type="text" value="${desc.replace(/"/g, '&quot;')}" placeholder="${canEdit() ? 'Add description...' : ''}" ${cRo} onchange="saveField('${escapedId}', 'description', this.value)">
              ${(notes || canEdit()) ? `<input class="shot-notes-input carousel-input" type="text" value="${notes.replace(/"/g, '&quot;')}" placeholder="${canEdit() ? 'Notes...' : ''}" ${cRo} onchange="saveField('${escapedId}', 'notes', this.value)">` : ""}
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
  currentLocation = getAllLocations().find((l) => l.id === id);
  if (currentLocation) {
    editMode = false; selectedShots.clear(); selectedGroupNames.clear(); currentGroup = null; feedStartShotId = null;
    renderShots(currentLocation);
    window.scrollTo(0, 0);
    history.pushState({ location: id }, "", `#${id}`);
  }
}

function goBack() {
  if (viewMode === "list" && feedStartShotId === null && currentLocation && !currentGroup) {
    viewMode = "grid";
    localStorage.setItem("sall-view", viewMode);
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
  feedStartShotId = shotId;
  viewMode = "list";
  localStorage.setItem("sall-view", viewMode);
  if (currentLocation) renderShots(currentLocation);
}

function openGroup(groupName) {
  if (currentLocation) {
    const firstShot = visibleShots(currentLocation).find((s) => getShotGroup(s) === groupName);
    if (firstShot) { openFeedAt(firstShot.id); return; }
  }
  currentGroup = groupName;
  if (currentLocation) renderShots(currentLocation);
  window.scrollTo(0, 0);
}

function openGroupForEdit(groupName) {
  currentGroup = groupName;
  selectedShots.clear(); selectedGroupNames.clear();
  if (currentLocation) renderShots(currentLocation);
  window.scrollTo(0, 0);
}

function closeGroup() {
  currentGroup = null; editMode = false;
  selectedShots.clear(); selectedGroupNames.clear();
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
  localStorage.setItem("sall-view", viewMode);
  if (currentLocation) renderShots(currentLocation);
}

function toggleEditMode() {
  editMode = !editMode;
  selectedShots.clear(); selectedGroupNames.clear();
  moveMode = false; moveSrcId = null;
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

  selectedShots.forEach((shotId) => { hiddenShots[shotId] = true; });
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
    const name = getNextGroupName();
    selectedShots.forEach((shotId) => { groupOverrides[shotId] = name; });
  } else {
    const targetGroup = groupNames[0];
    selectedShots.forEach((shotId) => { groupOverrides[shotId] = targetGroup; });
    for (let i = 1; i < groupNames.length; i++) {
      if (currentLocation) {
        allShots(currentLocation).forEach((shot) => {
          if (getShotGroup(shot) === groupNames[i]) groupOverrides[shot.id] = targetGroup;
        });
      }
    }
  }

  saveGroups(); selectedShots.clear(); selectedGroupNames.clear(); editMode = false;
  if (currentLocation) renderShots(currentLocation);
}

function removeGroupFromSelected() {
  if (selectedShots.size === 0 && selectedGroupNames.size === 0) return;
  selectedShots.forEach((shotId) => { groupOverrides[shotId] = ""; });
  if (currentLocation) {
    selectedGroupNames.forEach((groupName) => {
      allShots(currentLocation).forEach((shot) => {
        if (getShotGroup(shot) === groupName) groupOverrides[shot.id] = "";
      });
    });
  }

  saveGroups(); selectedShots.clear(); selectedGroupNames.clear(); editMode = false;

  if (currentGroup && currentLocation) {
    const remaining = visibleShots(currentLocation).filter((s) => getShotGroup(s) === currentGroup);
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
  const loc = getAllLocations().find((l) => l.id === locId);
  if (!loc) return;
  allShots(loc).forEach((s) => { delete hiddenShots[s.id]; });
  saveHidden();
  renderShots(loc);
}

function resetLocation(locId) {
  const loc = getAllLocations().find((l) => l.id === locId);
  if (!loc) return;
  if (!confirm(`Reset all checkboxes for ${loc.name}?`)) return;
  allShots(loc).forEach((s) => { delete completedShots[s.id]; });
  saveCompleted();
  renderShots(loc);
}

// ─── Reorder (tap to move) ───────────────────────────
let moveMode = false;
let moveSrcId = null;

function enterMoveMode() {
  if (selectedShots.size === 1 && selectedGroupNames.size === 0) {
    moveSrcId = [...selectedShots][0];
  } else if (selectedGroupNames.size === 1 && selectedShots.size === 0) {
    moveSrcId = "group:" + [...selectedGroupNames][0];
  } else { return; }
  moveMode = true;
  selectedShots.clear(); selectedGroupNames.clear();
  if (currentLocation) renderShots(currentLocation);
}

function cancelMove() {
  moveMode = false; moveSrcId = null;
  if (currentLocation) renderShots(currentLocation);
}

function moveToPosition(targetId) {
  if (!moveMode || !moveSrcId || !currentLocation) return;
  if (!orderOverrides[currentLocation.id]) {
    orderOverrides[currentLocation.id] = visibleShots(currentLocation).map((s) => s.id);
  }
  const order = orderOverrides[currentLocation.id];
  const fromIds = moveSrcId.startsWith("group:") ?
    visibleShots(currentLocation).filter((s) => getShotGroup(s) === moveSrcId.slice(6)).map((s) => s.id) :
    [moveSrcId];
  const toIsGroup = targetId.startsWith("group:");
  const targetShotId = toIsGroup ?
    visibleShots(currentLocation).find((s) => getShotGroup(s) === targetId.slice(6))?.id :
    targetId;
  const remaining = order.filter((id) => !fromIds.includes(id));
  let insertIdx = remaining.indexOf(targetShotId);
  if (insertIdx === -1) insertIdx = remaining.length;
  remaining.splice(insertIdx, 0, ...fromIds);
  orderOverrides[currentLocation.id] = remaining;
  saveOrder();
  moveMode = false; moveSrcId = null;
  renderShots(currentLocation);
}

// ─── Inline editing ──────────────────────────────────
function saveField(shotId, field, value) {
  if (!descOverrides[shotId]) descOverrides[shotId] = {};
  descOverrides[shotId][field] = value;
  saveDescriptions();
}

// ─── Upload (Supabase Storage) ───────────────────────
function triggerUpload() {
  if (!currentLocation) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = true;
  input.onchange = (e) => handleUpload(e.target.files);
  input.click();
}

// Compress image before upload — reduces file size significantly on mobile
function compressImage(file, maxWidth = 1600, quality = 0.8) {
  return new Promise((resolve) => {
    // If file is small enough already (<500KB), skip compression
    if (file.size < 500000) { resolve(file); return; }

    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      let w = img.width;
      let h = img.height;

      if (w > maxWidth) {
        h = Math.round(h * maxWidth / w);
        w = maxWidth;
      }

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        resolve(blob || file);
      }, "image/jpeg", quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file); // fallback to original
    };
    img.src = url;
  });
}

async function uploadOneFile(file, locId, retries = 2) {
  const shotId = `u-${locId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const filePath = `${locId}/${shotId}.jpg`;

  const compressed = await compressImage(file);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { error } = await sb.storage.from("photos").upload(filePath, compressed, {
        cacheControl: '3600',
        contentType: 'image/jpeg',
        upsert: false
      });
      if (error) {
        if (attempt < retries) { await new Promise((r) => setTimeout(r, 1000)); continue; }
        console.error("Storage upload failed:", file.name, error.message);
        return null;
      }

      const { error: dbError } = await sb.from("uploaded_photos").insert({
        id: shotId,
        location_id: locId,
        file_path: filePath
      });
      if (dbError) {
        console.error("DB insert failed:", file.name, dbError.message);
        return null;
      }

      return { id: shotId, location_id: locId, file_path: filePath };
    } catch (e) {
      if (attempt < retries) { await new Promise((r) => setTimeout(r, 1000)); continue; }
      console.error("Upload exception:", file.name, e);
      return null;
    }
  }
  return null;
}

async function handleUpload(files) {
  if (!currentLocation || !files || files.length === 0) return;
  const locId = currentLocation.id;
  if (!uploadedShots[locId]) uploadedShots[locId] = [];

  const fileList = [...files];
  const total = fileList.length;
  let done = 0;
  let failed = 0;

  // Show uploading indicator
  const toast = document.createElement("div");
  toast.className = "upload-toast";
  toast.textContent = `Uploading 0/${total}...`;
  document.body.appendChild(toast);

  // Upload one at a time with compression and retry
  for (const file of fileList) {
    toast.textContent = `Uploading ${done + 1}/${total}...`;

    const result = await uploadOneFile(file, locId);
    if (result) {
      uploadedShots[locId].push(result);
      done++;
    } else {
      failed++;
    }
  }

  toast.textContent = failed > 0 ? `Done: ${done} uploaded, ${failed} failed` : `${done} photo${done > 1 ? 's' : ''} uploaded`;
  setTimeout(() => toast.remove(), 2000);
  if (currentLocation) renderShots(currentLocation);
}

// ─── Browser navigation ─────────────────────────────
window.addEventListener("popstate", () => {
  const hash = window.location.hash.replace("#", "");
  if (hash) {
    const loc = getAllLocations().find((l) => l.id === hash);
    if (loc) { currentLocation = loc; currentGroup = null; renderShots(loc); return; }
  }
  currentLocation = null; currentGroup = null; renderLocations();
});

// ─── Init ────────────────────────────────────────────
async function initApp() {
  await loadAllState();
  const hash = window.location.hash.replace("#", "");
  if (hash) {
    const loc = getAllLocations().find((l) => l.id === hash);
    if (loc) { currentLocation = loc; renderShots(loc); return; }
  }
  renderLocations();
}

document.addEventListener("DOMContentLoaded", () => {
  if (userRole) {
    initApp();
  } else {
    showLoginScreen();
  }
});
