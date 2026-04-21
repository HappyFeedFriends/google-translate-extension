const MIN_TEXT_LENGTH = 1;
const MAX_TEXT_LENGTH = 800;
const TRIGGER_OFFSET = 12;
const PANEL_OFFSET = 14;
const DEFAULT_THEME = "classic";

const state = {
  selectedText: "",
  selectionRect: null,
  panelAnchorRect: null,
  targetLanguage: "ru",
  popupTheme: DEFAULT_THEME,
  requestId: 0,
  hideTimer: null,
  isPointerInsideUi: false
};

const quickAction = createQuickAction();
const panel = createPanel();

document.documentElement.append(quickAction.root, panel.root);

init();

async function init() {
  await loadSettings();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") {
      return;
    }

    if (changes.targetLanguage?.newValue) {
      state.targetLanguage = changes.targetLanguage.newValue;
      panel.language.textContent = state.targetLanguage.toUpperCase();
    }

    if (changes.popupTheme?.newValue) {
      applyTheme(changes.popupTheme.newValue);
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "OPEN_TRANSLATION_PANEL") {
      openFromText(message.text || "");
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === "HIDE_TRANSLATION_PANEL") {
      hideAllUi();
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });

  document.addEventListener("mouseup", scheduleSelectionSync, true);
  document.addEventListener("keyup", scheduleSelectionSync, true);
  document.addEventListener("selectionchange", scheduleSelectionSync, true);
  document.addEventListener("mousedown", handlePointerDown, true);
  document.addEventListener("scroll", handleViewportChange, true);
  window.addEventListener("resize", handleViewportChange, true);
}

async function loadSettings() {
  const {
    targetLanguage = "ru",
    popupTheme = DEFAULT_THEME
  } = await chrome.storage.sync.get(["targetLanguage", "popupTheme"]);
  state.targetLanguage = targetLanguage;
  panel.language.textContent = state.targetLanguage.toUpperCase();
  applyTheme(popupTheme);
}

function createQuickAction() {
  const root = document.createElement("button");
  root.className = "selection-translator-trigger";
  root.type = "button";
  root.hidden = true;
  root.setAttribute("aria-label", "Открыть перевод");
  root.innerHTML = `<span class="selection-translator-trigger__icon">文A</span>`;
  root.addEventListener("click", () => {
    if (!state.selectedText) {
      return;
    }

    openPanel();
  });

  bindUiHoverState(root);

  return { root };
}

function createPanel() {
  const root = document.createElement("div");
  root.className = "selection-translator-panel";
  root.hidden = true;

  const card = document.createElement("div");
  card.className = "selection-translator-panel__card";

  const header = document.createElement("div");
  header.className = "selection-translator-panel__header";

  const meta = document.createElement("div");
  meta.className = "selection-translator-panel__meta";

  const heading = document.createElement("div");
  heading.className = "selection-translator-panel__heading";

  const badge = document.createElement("span");
  badge.className = "selection-translator-panel__badge";
  badge.textContent = "Перевод";

  const language = document.createElement("span");
  language.className = "selection-translator-panel__language";

  const statusDot = document.createElement("span");
  statusDot.className = "selection-translator-panel__status-dot";

  meta.append(badge, language, statusDot);

  const closeButton = document.createElement("button");
  closeButton.className = "selection-translator-panel__icon-button";
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", hideAllUi);

  heading.append(meta);
  header.append(heading, closeButton);

  const original = document.createElement("div");
  original.className = "selection-translator-panel__original";

  const status = document.createElement("div");
  status.className = "selection-translator-panel__status";

  const translation = document.createElement("div");
  translation.className = "selection-translator-panel__translation";

  const actions = document.createElement("div");
  actions.className = "selection-translator-panel__actions";

  const copyButton = document.createElement("button");
  copyButton.className = "selection-translator-panel__button selection-translator-panel__button--secondary";
  copyButton.type = "button";
  copyButton.textContent = "Копировать";
  copyButton.addEventListener("click", copyTranslation);

  actions.append(copyButton);
  card.append(header, original, status, translation, actions);
  root.appendChild(card);

  bindUiHoverState(root);

  return {
    root,
    language,
    original,
    status,
    translation,
    copyButton
  };
}

function bindUiHoverState(element) {
  element.addEventListener("mouseenter", () => {
    state.isPointerInsideUi = true;
    clearHideTimer();
  });

  element.addEventListener("mouseleave", () => {
    state.isPointerInsideUi = false;
    scheduleHideIfNeeded();
  });
}

function handlePointerDown(event) {
  if (quickAction.root.contains(event.target) || panel.root.contains(event.target)) {
    return;
  }

  scheduleHideIfNeeded(true);
}

function scheduleSelectionSync() {
  clearHideTimer();
  state.hideTimer = window.setTimeout(syncSelectionState, 20);
}

function syncSelectionState() {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    if (!panel.root.hidden) {
      return;
    }

    scheduleHideIfNeeded();
    return;
  }

  const normalizedText = selection.toString().replace(/\s+/g, " ").trim();

  if (normalizedText.length < MIN_TEXT_LENGTH || normalizedText.length > MAX_TEXT_LENGTH) {
    hideAllUi();
    return;
  }

  const range = selection.getRangeAt(0);
  const rect = getAnchorRect(range);

  if (!rect) {
    hideAllUi();
    return;
  }

  state.selectedText = normalizedText;
  state.selectionRect = rect;

  showQuickAction();

  if (!panel.root.hidden) {
    panel.root.hidden = true;
  }
}

function getAnchorRect(range) {
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width || rect.height);

  if (rects.length > 0) {
    return rects[rects.length - 1];
  }

  const rect = range.getBoundingClientRect();
  return rect.width || rect.height ? rect : null;
}

function showQuickAction() {
  quickAction.root.hidden = false;
  positionQuickAction();
}

function positionQuickAction() {
  if (!state.selectionRect) {
    return;
  }

  const rect = state.selectionRect;
  const root = quickAction.root;

  root.style.left = "0px";
  root.style.top = "0px";

  const bubbleRect = root.getBoundingClientRect();
  const left = rect.left + window.scrollX + rect.width / 2 - bubbleRect.width / 2;
  const top = rect.bottom + window.scrollY + TRIGGER_OFFSET;

  root.style.left = `${clampToViewportX(left, bubbleRect.width)}px`;
  root.style.top = `${clampToViewportY(top, bubbleRect.height)}px`;
}

function openFromText(text) {
  const normalizedText = text.replace(/\s+/g, " ").trim();

  if (normalizedText.length < MIN_TEXT_LENGTH || normalizedText.length > MAX_TEXT_LENGTH) {
    hideAllUi();
    return;
  }

  state.selectedText = normalizedText;

  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
    state.selectionRect = getAnchorRect(selection.getRangeAt(0));
  }

  openPanel();
}

function openPanel() {
  if (!state.selectedText) {
    return;
  }

  state.panelAnchorRect = cloneRect(state.selectionRect) || state.panelAnchorRect;
  panel.original.textContent = state.selectedText;
  panel.translation.textContent = "";
  panel.status.textContent = "Переводим...";
  panel.language.textContent = state.targetLanguage.toUpperCase();
  panel.copyButton.disabled = true;
  panel.root.hidden = false;
  quickAction.root.hidden = true;
  positionPanel();
  requestTranslation();
}

function positionPanel() {
  const root = panel.root;

  root.style.left = "0px";
  root.style.top = "0px";

  const panelRect = root.getBoundingClientRect();
  const selectionRect = state.panelAnchorRect;

  if (!selectionRect) {
    const fallbackLeft = window.scrollX + window.innerWidth / 2 - panelRect.width / 2;
    const fallbackTop = window.scrollY + window.innerHeight - panelRect.height - 24;
    root.style.left = `${clampToViewportX(fallbackLeft, panelRect.width)}px`;
    root.style.top = `${clampToViewportY(fallbackTop, panelRect.height)}px`;
    return;
  }

  const desiredLeft = selectionRect.left + window.scrollX + selectionRect.width / 2 - panelRect.width / 2;
  const showAbove = selectionRect.top >= panelRect.height + PANEL_OFFSET + 8;
  const desiredTop = showAbove
    ? selectionRect.top + window.scrollY - panelRect.height - PANEL_OFFSET
    : selectionRect.bottom + window.scrollY + PANEL_OFFSET + 48;

  root.style.left = `${clampToViewportX(desiredLeft, panelRect.width)}px`;
  root.style.top = `${clampToViewportY(desiredTop, panelRect.height)}px`;
}

async function requestTranslation() {
  if (!state.selectedText) {
    return;
  }

  const requestId = ++state.requestId;
  panel.copyButton.disabled = true;
  panel.status.textContent = "Переводим...";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "TRANSLATE_SELECTION",
      text: state.selectedText,
      targetLanguage: state.targetLanguage
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Не удалось получить перевод");
    }

    if (requestId !== state.requestId) {
      return;
    }

    panel.translation.textContent = response.translation;
    panel.status.textContent = `Определён язык: ${response.detectedLanguage}`;
  } catch (error) {
    if (requestId !== state.requestId) {
      return;
    }

    panel.translation.textContent = "";
    panel.status.textContent = error instanceof Error ? error.message : "Ошибка перевода";
  } finally {
    if (requestId === state.requestId) {
      panel.copyButton.disabled = false;
    }
  }
}

async function copyTranslation() {
  const text = panel.translation.textContent.trim();

  if (!text) {
    panel.status.textContent = "Сначала получите перевод";
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    panel.status.textContent = "Перевод скопирован";
  } catch (_error) {
    panel.status.textContent = "Не удалось скопировать";
  }
}

function handleViewportChange() {
  if (!quickAction.root.hidden) {
    positionQuickAction();
  }

  if (!panel.root.hidden) {
    positionPanel();
  }
}

function scheduleHideIfNeeded(force = false) {
  clearHideTimer();

  state.hideTimer = window.setTimeout(() => {
    const selection = window.getSelection();
    const hasSelection = selection && !selection.isCollapsed && selection.toString().trim();

    if (!panel.root.hidden && !force) {
      return;
    }

    if (force || (!hasSelection && !state.isPointerInsideUi)) {
      hideAllUi();
    }
  }, force ? 0 : 160);
}

function clearHideTimer() {
  if (state.hideTimer) {
    window.clearTimeout(state.hideTimer);
    state.hideTimer = null;
  }
}

function hideAllUi() {
  state.selectedText = "";
  state.selectionRect = null;
  state.panelAnchorRect = null;
  state.requestId += 1;
  quickAction.root.hidden = true;
  panel.root.hidden = true;
}

function applyTheme(theme) {
  const normalizedTheme = theme === "dia" ? "dia" : DEFAULT_THEME;
  state.popupTheme = normalizedTheme;
  quickAction.root.dataset.theme = normalizedTheme;
  panel.root.dataset.theme = normalizedTheme;
}

function cloneRect(rect) {
  if (!rect) {
    return null;
  }

  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height
  };
}

function clampToViewportX(left, width) {
  const min = window.scrollX + 8;
  const max = window.scrollX + window.innerWidth - width - 8;
  return Math.min(Math.max(left, min), Math.max(min, max));
}

function clampToViewportY(top, height) {
  const min = window.scrollY + 8;
  const max = window.scrollY + window.innerHeight - height - 8;
  return Math.min(Math.max(top, min), Math.max(min, max));
}
