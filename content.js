const MIN_TEXT_LENGTH = 1;
const TRIGGER_OFFSET = 12;
const PANEL_OFFSET = 14;
const DEFAULT_THEME = "classic";
const LANGUAGE_OPTIONS = [
  { value: "ru", label: "Русский" },
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Francais" },
  { value: "es", label: "Espanol" },
  { value: "it", label: "Italiano" },
  { value: "tr", label: "Turkce" },
  { value: "kk", label: "Kazakh" },
  { value: "uz", label: "Uzbek" },
  { value: "zh-CN", label: "Chinese (Simplified)" },
  { value: "ja", label: "Japanese" }
];

const state = {
  selectedText: "",
  selectionRect: null,
  panelAnchorRect: null,
  targetLanguage: "ru",
  popupTheme: DEFAULT_THEME,
  requestId: 0,
  hideTimer: null,
  isPointerInsideUi: false,
  isLanguageMenuOpen: false
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

  const language = document.createElement("button");
  language.className = "selection-translator-panel__language";
  language.type = "button";
  language.addEventListener("click", toggleLanguageMenu);

  meta.append(badge, language);

  heading.append(meta);
  header.append(heading);

  const languageMenu = document.createElement("div");
  languageMenu.className = "selection-translator-panel__language-menu";
  languageMenu.hidden = true;

  for (const option of LANGUAGE_OPTIONS) {
    const item = document.createElement("button");
    item.className = "selection-translator-panel__language-option";
    item.type = "button";
    item.textContent = option.label;
    item.dataset.value = option.value;
    item.addEventListener("click", () => {
      selectTargetLanguage(option.value);
    });
    languageMenu.appendChild(item);
  }

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
  root.append(card, languageMenu);

  bindUiHoverState(root);

  return {
    root,
    card,
    language,
    languageMenu,
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
  if (quickAction.root.contains(event.target)) {
    return;
  }

  if (panel.root.contains(event.target)) {
    const clickedInsideLanguageControls = panel.language.contains(event.target) || panel.languageMenu.contains(event.target);

    if (!clickedInsideLanguageControls) {
      closeLanguageMenu();
    }

    return;
  }

  closeLanguageMenu();
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

  if (normalizedText.length < MIN_TEXT_LENGTH) {
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

  if (!panel.root.hidden) {
    return;
  }

  showQuickAction();
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

  if (normalizedText.length < MIN_TEXT_LENGTH) {
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
  syncLanguageMenuSelection();
  closeLanguageMenu();
  panel.copyButton.disabled = true;
  panel.root.hidden = false;
  quickAction.root.hidden = true;
  positionPanel();
  window.requestAnimationFrame(() => {
    if (!panel.root.hidden) {
      positionPanel();
    }
  });
  requestTranslation();
}

function positionPanel() {
  const root = panel.root;
  const viewportPadding = 8;

  resetPanelSizeConstraints();
  root.style.left = "0px";
  root.style.top = "0px";

  const selectionRect = state.panelAnchorRect;

  if (!selectionRect) {
    const fallbackMaxHeight = window.innerHeight - 24 - viewportPadding * 2;
    applyPanelSizeConstraints(fallbackMaxHeight);
    const fallbackRect = root.getBoundingClientRect();
    const fallbackLeft = window.scrollX + window.innerWidth / 2 - fallbackRect.width / 2;
    const fallbackTop = window.scrollY + window.innerHeight - fallbackRect.height - 24;
    root.style.left = `${clampToViewportX(fallbackLeft, fallbackRect.width)}px`;
    root.style.top = `${clampToViewportY(fallbackTop, fallbackRect.height)}px`;
    return;
  }

  let panelRect = root.getBoundingClientRect();
  const desiredLeft = selectionRect.left + window.scrollX + selectionRect.width / 2 - panelRect.width / 2;
  const spaceAbove = selectionRect.top - viewportPadding;
  const spaceBelow = window.innerHeight - selectionRect.bottom - viewportPadding;
  const fitsAbove = spaceAbove >= panelRect.height + PANEL_OFFSET;
  const fitsBelow = spaceBelow >= panelRect.height + PANEL_OFFSET + 48;

  let desiredTop;

  if (fitsAbove || (!fitsBelow && spaceAbove > spaceBelow)) {
    desiredTop = selectionRect.top + window.scrollY - panelRect.height - PANEL_OFFSET;
  } else {
    desiredTop = selectionRect.bottom + window.scrollY + PANEL_OFFSET + 48;
  }

  const availableHeight = fitsAbove || (!fitsBelow && spaceAbove > spaceBelow)
    ? spaceAbove - PANEL_OFFSET
    : spaceBelow - PANEL_OFFSET - 48;

  applyPanelSizeConstraints(availableHeight);
  panelRect = root.getBoundingClientRect();

  if (fitsAbove || (!fitsBelow && spaceAbove > spaceBelow)) {
    desiredTop = selectionRect.top + window.scrollY - panelRect.height - PANEL_OFFSET;
  } else {
    desiredTop = selectionRect.bottom + window.scrollY + PANEL_OFFSET + 48;
  }

  root.style.left = `${clampToViewportX(desiredLeft, panelRect.width)}px`;
  root.style.top = `${clampToViewportY(desiredTop, panelRect.height)}px`;

  if (state.isLanguageMenuOpen) {
    positionLanguageMenu();
  }
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
    positionPanel();
  } catch (error) {
    if (requestId !== state.requestId) {
      return;
    }

    panel.translation.textContent = "";
    panel.status.textContent = error instanceof Error ? error.message : "Ошибка перевода";
    positionPanel();
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
  closeLanguageMenu();
  quickAction.root.hidden = true;
  panel.root.hidden = true;
}

function applyTheme(theme) {
  const normalizedTheme = theme === "dia" ? "dia" : DEFAULT_THEME;
  state.popupTheme = normalizedTheme;
  quickAction.root.dataset.theme = normalizedTheme;
  panel.root.dataset.theme = normalizedTheme;
}

function toggleLanguageMenu(event) {
  event.stopPropagation();

  if (state.isLanguageMenuOpen) {
    closeLanguageMenu();
    return;
  }

  syncLanguageMenuSelection();
  panel.languageMenu.hidden = false;
  state.isLanguageMenuOpen = true;
  positionLanguageMenu();
}

function closeLanguageMenu() {
  panel.languageMenu.hidden = true;
  state.isLanguageMenuOpen = false;
}

function syncLanguageMenuSelection() {
  const items = panel.languageMenu.querySelectorAll(".selection-translator-panel__language-option");

  for (const item of items) {
    item.dataset.active = item.dataset.value === state.targetLanguage ? "true" : "false";
  }
}

async function selectTargetLanguage(value) {
  if (value === state.targetLanguage) {
    closeLanguageMenu();
    return;
  }

  state.targetLanguage = value;
  panel.language.textContent = state.targetLanguage.toUpperCase();
  syncLanguageMenuSelection();
  closeLanguageMenu();
  await chrome.storage.sync.set({ targetLanguage: value });

  if (!panel.root.hidden && state.selectedText) {
    requestTranslation();
  }
}

function positionLanguageMenu() {
  panel.languageMenu.style.left = "0px";
  panel.languageMenu.style.top = "0px";

  const rootRect = panel.root.getBoundingClientRect();
  const triggerRect = panel.language.getBoundingClientRect();
  const menuRect = panel.languageMenu.getBoundingClientRect();

  const desiredLeft = triggerRect.left - rootRect.left;
  const desiredTop = triggerRect.bottom - rootRect.top + 8;
  const maxLeft = Math.max(8, rootRect.width - menuRect.width - 8);
  const left = Math.min(Math.max(desiredLeft, 8), maxLeft);

  panel.languageMenu.style.left = `${left}px`;
  panel.languageMenu.style.top = `${desiredTop}px`;
}

function resetPanelSizeConstraints() {
  panel.card.style.maxHeight = "";
  panel.card.style.overflow = "";
  panel.original.style.maxHeight = "";
  panel.original.style.overflow = "";
  panel.translation.style.maxHeight = "";
  panel.translation.style.overflow = "";
}

function applyPanelSizeConstraints(availableHeight) {
  const safeAvailableHeight = Math.max(240, Math.floor(availableHeight));
  const naturalCardHeight = panel.card.scrollHeight;

  if (naturalCardHeight <= safeAvailableHeight) {
    return;
  }

  panel.card.style.maxHeight = `${safeAvailableHeight}px`;
  panel.card.style.overflow = "hidden";

  const originalNaturalHeight = panel.original.scrollHeight;
  const translationNaturalHeight = panel.translation.scrollHeight;
  const fixedHeight = panel.card.scrollHeight - originalNaturalHeight - translationNaturalHeight;
  const availableScrollableHeight = Math.max(140, safeAvailableHeight - fixedHeight);
  const originalMaxHeight = Math.min(originalNaturalHeight, Math.max(96, Math.floor(availableScrollableHeight * 0.34)));
  const translationMaxHeight = Math.max(120, availableScrollableHeight - originalMaxHeight);

  if (originalNaturalHeight > originalMaxHeight) {
    panel.original.style.maxHeight = `${originalMaxHeight}px`;
    panel.original.style.overflow = "auto";
  }

  if (translationNaturalHeight > translationMaxHeight) {
    panel.translation.style.maxHeight = `${translationMaxHeight}px`;
    panel.translation.style.overflow = "auto";
  }
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
