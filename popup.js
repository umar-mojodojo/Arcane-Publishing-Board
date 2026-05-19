const DEFAULT_SETTINGS = {
  tenant: "mojodojo",
  sort: "dueDate",
  sortReverse: false,
  workflowStatus: "",
  contentType: "",
  excludeClients: "",
  startDate: "2025-12-01",
  endDate: "2027-01-31",
};

const SETTINGS_KEY = "contentCalendarSettings";
const CACHE_KEY = "contentCalendarCache";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const $ = (id) => document.getElementById(id);
const settingsBtn = $("settings-btn");
const settingsOverlay = $("settings-overlay");
const settingsClose = $("settings-close");
const settingsCancel = $("settings-cancel");
const settingsSave = $("settings-save");
const settingTenant = $("setting-tenant");
const settingSort = $("setting-sort");
const settingSortReverse = $("setting-sort-reverse");
const settingStatusInput = $("setting-status-input");
const workflowStatusDropdown = $("workflow-status-dropdown");
const workflowStatusTags = $("workflow-status-tags");
const settingContentType = $("setting-content-type");
const settingExcludeClientsInput = $("setting-exclude-clients-input");
const excludeClientsDropdown = $("exclude-clients-dropdown");
const excludeClientsTags = $("exclude-clients-tags");
const settingDateStart = $("setting-date-start");
const settingDateEnd = $("setting-date-end");
const statusesList = $("statuses-list");

let availableClientsForExclude = [];
let selectedExcludedClients = [];
let selectedWorkflowStatuses = [];
const statusEl = $("status");
const resultsEl = $("results");
const refreshBtn = $("refresh-btn");
const itemCount = $("item-count");
const copyAllBtn = $("copy-all-btn");
const copySelectedBtn = $("copy-selected-btn");
const copySection = $("copy-section");

let settings = { ...DEFAULT_SETTINGS };
let allPieces = [];
let filteredPieces = [];
let availableStatuses = new Set();
let selectedIndices = new Set();

// ──────────────────────────────────────────────────────────
// Storage helpers
// ──────────────────────────────────────────────────────────
const hasChromeStorage = typeof chrome !== "undefined" && chrome.storage?.local;

async function loadSettings() {
  if (!hasChromeStorage) {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
  }
  const r = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(r[SETTINGS_KEY] || {}) };
}

async function saveSettings(value) {
  if (!hasChromeStorage) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
    return;
  }
  await chrome.storage.local.set({ [SETTINGS_KEY]: value });
}

async function loadCache() {
  if (!hasChromeStorage) {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  }
  const r = await chrome.storage.local.get(CACHE_KEY);
  return r[CACHE_KEY] || null;
}

async function saveCache(cache) {
  if (!hasChromeStorage) {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    return;
  }
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}

// ──────────────────────────────────────────────────────────
// GraphQL API
// ──────────────────────────────────────────────────────────
function gqlUrl() {
  const tenant = (settings.tenant || "").trim();
  if (!tenant) throw new Error("Set the tenant in Settings first.");
  return `https://new.simpleonboarding.com.au/${tenant}/graphql`;
}

async function fetchContentData() {
  const r = await fetch(gqlUrl(), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", accept: "*/*" },
    body: JSON.stringify({
      operationName: "GetContentCalendarData",
      variables: {
        startDate: settings.startDate,
        endDate: settings.endDate,
      },
      query: `query GetContentCalendarData($startDate: String, $endDate: String) {
  contentCalendarData(startDate: $startDate, endDate: $endDate) {
    id
    name
    project {
      id
      name
      __typename
    }
    pieces {
      id
      title
      contentType
      contentLink
      dueDate
      workflowStatus
      workflowPhase
      assignedTo {
        id
        name
        __typename
      }
      __typename
    }
    __typename
  }
}`,
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (j.errors) throw new Error(j.errors[0]?.message || "GraphQL error");
  return j.data?.contentCalendarData || [];
}

// ──────────────────────────────────────────────────────────
// Data processing
// ──────────────────────────────────────────────────────────
function processData(calendarData) {
  const pieces = [];
  availableStatuses.clear();

  for (const client of calendarData) {
    for (const piece of client.pieces || []) {
      availableStatuses.add(piece.workflowStatus);
      pieces.push({
        id: piece.id,
        title: piece.title || "",
        contentType: piece.contentType || "",
        contentLink: piece.contentLink || "",
        dueDate: piece.dueDate || "",
        workflowStatus: piece.workflowStatus || "",
        clientName: client.name || "",
        clientId: client.id || "",
        projectName: client.project?.name || "",
        assignedTo: piece.assignedTo?.name || "",
      });
    }
  }

  return pieces;
}

function isArticleType(contentType) {
  const lower = (contentType || "").toLowerCase();
  return /blog|landing|page|article|post/i.test(lower) && !/social/i.test(lower);
}

function isSocialType(contentType) {
  const lower = (contentType || "").toLowerCase();
  return /social|tweet|post|story|pin/i.test(lower);
}

function matchesContentTypeFilter(contentType) {
  if (!settings.contentType) return true;
  if (settings.contentType === "articles") return isArticleType(contentType);
  if (settings.contentType === "social") return isSocialType(contentType);
  return true;
}

function formatStatusLabel(status) {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function sortPieces(pieces) {
  const sorted = [...pieces];
  switch (settings.sort) {
    case "dueDate":
      sorted.sort((a, b) => {
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return new Date(a.dueDate) - new Date(b.dueDate);
      });
      break;
    case "clientName":
      sorted.sort((a, b) => a.clientName.localeCompare(b.clientName));
      break;
    case "contentType":
      sorted.sort((a, b) => a.contentType.localeCompare(b.contentType));
      break;
    case "assignedTo":
      sorted.sort((a, b) => (a.assignedTo || "").localeCompare(b.assignedTo || ""));
      break;
  }
  if (settings.sortReverse) {
    sorted.reverse();
  }
  return sorted;
}

function filterPieces() {
  selectedIndices.clear();
  const excludedClientsList = settings.excludeClients
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const selectedStatusesList = settings.workflowStatus
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  filteredPieces = allPieces.filter((p) => {
    const statusMatch = selectedStatusesList.length === 0 || selectedStatusesList.includes(p.workflowStatus);
    const typeMatch = matchesContentTypeFilter(p.contentType);
    const clientMatch = !excludedClientsList.includes(p.clientName);
    return statusMatch && typeMatch && clientMatch;
  });

  filteredPieces = sortPieces(filteredPieces);
  renderResults();
}

// ──────────────────────────────────────────────────────────
// Rendering
// ──────────────────────────────────────────────────────────
function setStatus(text, kind = "") {
  if (!text) {
    statusEl.hidden = true;
    statusEl.textContent = "";
    statusEl.className = "status";
    return;
  }
  statusEl.hidden = false;
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? ` ${kind}` : "");
}

function renderResults() {
  resultsEl.innerHTML = "";
  copySection.classList.add("hidden");

  if (filteredPieces.length === 0) {
    setStatus(
      allPieces.length
        ? "— no pieces with this status —"
        : "— no pieces loaded —"
    );
    return;
  }
  setStatus("");

  filteredPieces.forEach((piece, i) => {
    const item = document.createElement("div");
    item.className = "result" + (selectedIndices.has(i) ? " active" : "");
    item.setAttribute("role", "option");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "result-checkbox";
    checkbox.checked = selectedIndices.has(i);
    checkbox.addEventListener("change", (e) => {
      e.stopPropagation();
      if (e.target.checked) {
        selectedIndices.add(i);
      } else {
        selectedIndices.delete(i);
      }
      updateResultsUI();
      updateCopySection();
    });

    const content = document.createElement("div");
    content.className = "result-content";

    const title = document.createElement("div");
    title.className = "result-title";
    title.textContent = piece.title;
    content.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "result-meta";

    if (piece.clientName) {
      const clientLink = document.createElement("a");
      clientLink.className = "result-client";
      clientLink.textContent = piece.clientName;
      clientLink.href = `https://new.simpleonboarding.com.au/client/${piece.clientId}/content-calendar`;
      clientLink.target = "_blank";
      clientLink.rel = "noopener noreferrer";
      clientLink.addEventListener("click", (e) => e.stopPropagation());
      meta.appendChild(clientLink);
    }

    if (piece.clientName && piece.contentType) {
      const divider1 = document.createElement("span");
      divider1.className = "result-divider";
      divider1.textContent = "•";
      meta.appendChild(divider1);
    }

    const typeSpan = document.createElement("span");
    typeSpan.textContent = piece.contentType;
    meta.appendChild(typeSpan);

    if (piece.dueDate) {
      const divider3 = document.createElement("span");
      divider3.className = "result-divider";
      divider3.textContent = "•";
      meta.appendChild(divider3);

      const date = new Date(piece.dueDate);
      const month = date.toLocaleString("en-US", { month: "short" });
      const year = date.getFullYear();
      const currentYear = new Date().getFullYear();
      const dueText = year !== currentYear ? `${month} ${year}` : month;

      const dueSpan = document.createElement("span");
      dueSpan.textContent = dueText;
      meta.appendChild(dueSpan);
    }

    if (piece.assignedTo) {
      const divider2 = document.createElement("span");
      divider2.className = "result-divider";
      divider2.textContent = "•";
      meta.appendChild(divider2);

      const firstName = piece.assignedTo.split(" ")[0];
      const assignedSpan = document.createElement("span");
      assignedSpan.textContent = firstName;
      meta.appendChild(assignedSpan);
    }

    content.appendChild(meta);

    item.appendChild(checkbox);
    item.appendChild(content);

    item.addEventListener("click", (e) => {
      if (e.target !== checkbox) {
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event("change"));
      }
    });

    resultsEl.appendChild(item);
  });

  updateCopySection();
  updateItemCount();
}

function updateResultsUI() {
  const items = resultsEl.querySelectorAll(".result");
  items.forEach((el, i) => {
    el.classList.toggle("active", selectedIndices.has(i));
  });
}

function updateCopySection() {
  if (selectedIndices.size > 0 || filteredPieces.length > 0) {
    copySection.classList.remove("hidden");
  } else {
    copySection.classList.add("hidden");
  }

  if (selectedIndices.size > 0) {
    copySelectedBtn.classList.remove("btn-secondary");
    copySelectedBtn.classList.add("btn-primary");
  } else {
    copySelectedBtn.classList.remove("btn-primary");
    copySelectedBtn.classList.add("btn-secondary");
  }
}

function updateItemCount() {
  itemCount.textContent = filteredPieces.length === 1
    ? "1 item"
    : `${filteredPieces.length} items`;
}

// ──────────────────────────────────────────────────────────
// Clipboard
// ──────────────────────────────────────────────────────────
async function copyToClipboard(pieces) {
  const rows = pieces.map((p) => [p.clientName, p.title, p.contentType, p.contentLink].join("\t")).join("\n");
  try {
    await navigator.clipboard.writeText(rows);
    setStatus("Copied to clipboard!", "");
    setTimeout(() => setStatus(""), 2000);
  } catch (e) {
    setStatus(`Couldn't copy: ${e.message}`, "err");
  }
}

// ──────────────────────────────────────────────────────────
// Settings panel
// ──────────────────────────────────────────────────────────
function renderExcludeClientsTags() {
  excludeClientsTags.innerHTML = "";
  selectedExcludedClients.forEach((client) => {
    const tag = document.createElement("span");
    tag.className = "exclude-client-tag";
    tag.innerHTML = `${client} <button type="button" class="tag-remove" aria-label="Remove ${client}">×</button>`;
    tag.querySelector(".tag-remove").addEventListener("click", () => {
      selectedExcludedClients = selectedExcludedClients.filter((c) => c !== client);
      settings.excludeClients = selectedExcludedClients.join(", ");
      renderExcludeClientsTags();
    });
    excludeClientsTags.appendChild(tag);
  });
}

function updateExcludeClientsDropdown() {
  const query = settingExcludeClientsInput.value.trim().toLowerCase();
  const filtered = availableClientsForExclude.filter(
    (client) =>
      client.toLowerCase().includes(query) &&
      !selectedExcludedClients.includes(client)
  );

  if (query && filtered.length > 0) {
    excludeClientsDropdown.innerHTML = "";
    filtered.forEach((client) => {
      const option = document.createElement("div");
      option.className = "exclude-client-option";
      option.textContent = client;
      option.addEventListener("click", () => {
        selectedExcludedClients.push(client);
        settings.excludeClients = selectedExcludedClients.join(", ");
        settingExcludeClientsInput.value = "";
        renderExcludeClientsTags();
        updateExcludeClientsDropdown();
      });
      excludeClientsDropdown.appendChild(option);
    });
    excludeClientsDropdown.hidden = false;
  } else {
    excludeClientsDropdown.hidden = true;
  }
}

function initializeExcludeClientsInput() {
  availableClientsForExclude = [...new Set(allPieces.map((p) => p.clientName))].sort();
  selectedExcludedClients = settings.excludeClients
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  settingExcludeClientsInput.addEventListener("input", updateExcludeClientsDropdown);
  settingExcludeClientsInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && excludeClientsDropdown.children.length > 0) {
      e.preventDefault();
      excludeClientsDropdown.children[0].click();
    }
  });

  renderExcludeClientsTags();
}

function renderWorkflowStatusTags() {
  workflowStatusTags.innerHTML = "";
  selectedWorkflowStatuses.forEach((status) => {
    const tag = document.createElement("span");
    tag.className = "exclude-client-tag";
    const displayLabel = formatStatusLabel(status);
    tag.innerHTML = `${displayLabel} <button type="button" class="tag-remove" aria-label="Remove ${displayLabel}">×</button>`;
    tag.querySelector(".tag-remove").addEventListener("click", () => {
      selectedWorkflowStatuses = selectedWorkflowStatuses.filter((s) => s !== status);
      settings.workflowStatus = selectedWorkflowStatuses.join(", ");
      renderWorkflowStatusTags();
    });
    workflowStatusTags.appendChild(tag);
  });
}

function updateWorkflowStatusDropdown() {
  const query = settingStatusInput.value.trim().toLowerCase();
  const filtered = Array.from(availableStatuses).filter(
    (status) =>
      formatStatusLabel(status).toLowerCase().includes(query) &&
      !selectedWorkflowStatuses.includes(status)
  );

  if (query && filtered.length > 0) {
    workflowStatusDropdown.innerHTML = "";
    filtered.forEach((status) => {
      const option = document.createElement("div");
      option.className = "exclude-client-option";
      option.textContent = formatStatusLabel(status);
      option.addEventListener("click", () => {
        selectedWorkflowStatuses.push(status);
        settings.workflowStatus = selectedWorkflowStatuses.join(", ");
        settingStatusInput.value = "";
        renderWorkflowStatusTags();
        updateWorkflowStatusDropdown();
      });
      workflowStatusDropdown.appendChild(option);
    });
    workflowStatusDropdown.hidden = false;
  } else {
    workflowStatusDropdown.hidden = true;
  }
}

function initializeWorkflowStatusInput() {
  selectedWorkflowStatuses = settings.workflowStatus
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  settingStatusInput.addEventListener("input", updateWorkflowStatusDropdown);
  settingStatusInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && workflowStatusDropdown.children.length > 0) {
      e.preventDefault();
      workflowStatusDropdown.children[0].click();
    }
  });

  renderWorkflowStatusTags();
}

function openSettings() {
  settingTenant.value = settings.tenant || "";
  settingSort.value = settings.sort || "dueDate";
  settingSortReverse.value = settings.sortReverse ? "true" : "false";
  settingContentType.value = settings.contentType || "";
  settingDateStart.value = settings.startDate || "";
  settingDateEnd.value = settings.endDate || "";
  initializeWorkflowStatusInput();
  initializeExcludeClientsInput();
  settingsOverlay.classList.remove("hidden");
  settingTenant.focus();
}

function closeSettings() {
  settingsOverlay.classList.add("hidden");
  refreshBtn.focus();
}

async function saveSettingsFromForm() {
  const tenant = settingTenant.value.trim() || DEFAULT_SETTINGS.tenant;
  const sort = settingSort.value || "dueDate";
  const sortReverse = settingSortReverse.value === "true";
  const workflowStatus = selectedWorkflowStatuses.join(", ");
  const contentType = settingContentType.value || "";
  const excludeClients = selectedExcludedClients.join(", ");
  const startDate = settingDateStart.value || DEFAULT_SETTINGS.startDate;
  const endDate = settingDateEnd.value || DEFAULT_SETTINGS.endDate;

  const prevTenant = settings.tenant;
  settings = {
    tenant,
    sort,
    sortReverse,
    workflowStatus,
    contentType,
    excludeClients,
    startDate,
    endDate,
  };
  await saveSettings(settings);
  closeSettings();

  if (prevTenant !== settings.tenant) {
    allPieces = [];
    await loadData();
  } else {
    filterPieces();
  }
}

settingsBtn.addEventListener("click", openSettings);
settingsClose.addEventListener("click", closeSettings);
settingsCancel.addEventListener("click", closeSettings);
settingsSave.addEventListener("click", saveSettingsFromForm);

// ──────────────────────────────────────────────────────────
// Data loading
// ──────────────────────────────────────────────────────────
async function loadData(forceFresh = false) {
  refreshBtn.disabled = true;

  const cache = await loadCache();
  const now = Date.now();
  const fresh =
    cache &&
    cache.tenant === settings.tenant &&
    cache.startDate === settings.startDate &&
    cache.endDate === settings.endDate &&
    now - cache.at < CACHE_TTL_MS;

  if (cache && cache.tenant === settings.tenant && !forceFresh) {
    allPieces = cache.pieces || [];
    availableStatuses = new Set(cache.statuses || []);
    filterPieces();
  }

  if (fresh && !forceFresh) {
    refreshBtn.disabled = false;
    return;
  }

  try {
    const calendarData = await fetchContentData();
    allPieces = processData(calendarData);
    await saveCache({
      tenant: settings.tenant,
      startDate: settings.startDate,
      endDate: settings.endDate,
      pieces: allPieces,
      statuses: Array.from(availableStatuses),
      at: Date.now(),
    });
    filterPieces();
    setStatus("Data loaded successfully!");
    setTimeout(() => setStatus(""), 2000);
  } catch (e) {
    setStatus(
      `Couldn't load: ${e.message}. Make sure you're logged in to SimpleOnboarding.`,
      "err"
    );
  } finally {
    refreshBtn.disabled = false;
  }
}

// ──────────────────────────────────────────────────────────
// Event listeners
// ──────────────────────────────────────────────────────────
refreshBtn.addEventListener("click", () => {
  selectedIndices.clear();
  loadData(true);
});

copyAllBtn.addEventListener("click", () => {
  copyToClipboard(filteredPieces);
});

copySelectedBtn.addEventListener("click", () => {
  const selected = Array.from(selectedIndices).map((i) => filteredPieces[i]);
  copyToClipboard(selected);
});

// ──────────────────────────────────────────────────────────
// Init
// ──────────────────────────────────────────────────────────
(async function init() {
  settings = await loadSettings();
  await loadData();
})();
