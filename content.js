const MIN_TEXT_LENGTH = 1;
const TRIGGER_OFFSET = 12;
const PANEL_OFFSET = 14;
const VIEWPORT_PADDING = 8;
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
  anchorRange: null,
  panelPlacement: "below",
  panelRepositionPending: false,
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

if (typeof ResizeObserver !== "undefined") {
  const panelSizeObserver = new ResizeObserver(() => {
    if (!panel.root.hidden) {
      schedulePanelReposition();
    }
  });
  panelSizeObserver.observe(panel.card);
}

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

  clearHideTimer();
  closeLanguageMenu();
  hideAllUi();
}

function scheduleSelectionSync() {
  clearHideTimer();
  state.hideTimer = window.setTimeout(syncSelectionState, 20);
}

function syncSelectionState() {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    quickAction.root.hidden = true;

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
  const left = rect.left + rect.width / 2 - bubbleRect.width / 2;
  const top = rect.bottom + TRIGGER_OFFSET;

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

  captureAnchor();
  state.panelPlacement = "below";
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

  if (root.hidden) {
    return;
  }

  resetPanelSizeConstraints();
  root.style.left = "0px";
  root.style.top = "0px";

  const anchor = getLiveAnchorViewportRect();

  if (!anchor) {
    const fallbackMaxHeight = window.innerHeight - 24 - VIEWPORT_PADDING * 2;
    applyPanelSizeConstraints(fallbackMaxHeight);
    const fallbackRect = root.getBoundingClientRect();
    const fallbackLeft = (window.innerWidth - fallbackRect.width) / 2;
    const fallbackTop = window.innerHeight - fallbackRect.height - 24;
    root.style.left = `${clampToViewportX(fallbackLeft, fallbackRect.width)}px`;
    root.style.top = `${clampToViewportY(fallbackTop, fallbackRect.height)}px`;
    return;
  }

  let panelRect = root.getBoundingClientRect();

  const { placement, availableHeight } = choosePanelPlacement(anchor, panelRect.height);
  state.panelPlacement = placement;

  applyPanelSizeConstraints(availableHeight);
  panelRect = root.getBoundingClientRect();

  const top = placement === "above"
    ? anchor.top - panelRect.height - PANEL_OFFSET
    : anchor.bottom + PANEL_OFFSET;

  const center = anchor.left + anchor.width / 2;
  const left = center - panelRect.width / 2;

  root.style.left = `${clampToViewportX(left, panelRect.width)}px`;
  root.style.top = `${clampToViewportY(top, panelRect.height)}px`;

  if (state.isLanguageMenuOpen) {
    positionLanguageMenu();
  }
}

function captureAnchor() {
  const selection = window.getSelection();
  let capturedRange = null;

  if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
    try {
      capturedRange = selection.getRangeAt(0).cloneRange();
    } catch (_error) {
      capturedRange = null;
    }
  }

  state.anchorRange = capturedRange;
}

function rectFromRange(range) {
  try {
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width || rect.height);
    if (rects.length > 0) {
      return rects[rects.length - 1];
    }
    const rect = range.getBoundingClientRect();
    return rect.width || rect.height ? rect : null;
  } catch (_error) {
    return null;
  }
}

function getLiveAnchorViewportRect() {
  if (!state.anchorRange) {
    return null;
  }

  return rectFromRange(state.anchorRange);
}

function isAnchorOutsideViewport(anchor) {
  if (!anchor) {
    return false;
  }

  return anchor.bottom <= 0 || anchor.top >= window.innerHeight;
}

function choosePanelPlacement(anchorViewportRect, panelHeight) {
  const viewportHeight = window.innerHeight;
  const spaceAbove = Math.max(0, anchorViewportRect.top - VIEWPORT_PADDING);
  const spaceBelow = Math.max(0, viewportHeight - anchorViewportRect.bottom - VIEWPORT_PADDING);
  const required = panelHeight + PANEL_OFFSET;
  const fitsAbove = spaceAbove >= required;
  const fitsBelow = spaceBelow >= required;
  const previous = state.panelPlacement;

  let placement;

  if (fitsBelow && fitsAbove) {
    // Both sides fit: keep the previous choice to avoid jitter on scroll.
    placement = previous === "above" ? "above" : "below";
  } else if (fitsBelow) {
    placement = "below";
  } else if (fitsAbove) {
    placement = "above";
  } else {
    // Neither side fits fully — go with whichever has more room so the panel
    // stays as visible as possible after the size constraint is applied.
    placement = spaceAbove > spaceBelow ? "above" : "below";
  }

  const availableHeight = placement === "above"
    ? spaceAbove - PANEL_OFFSET
    : spaceBelow - PANEL_OFFSET;

  return { placement, availableHeight };
}

function schedulePanelReposition() {
  if (state.panelRepositionPending) {
    return;
  }

  state.panelRepositionPending = true;
  window.requestAnimationFrame(() => {
    state.panelRepositionPending = false;

    if (!panel.root.hidden) {
      positionPanel();
    }
  });
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
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
      const rect = getAnchorRect(selection.getRangeAt(0));
      if (rect && rect.top < window.innerHeight && rect.bottom > 0) {
        state.selectionRect = rect;
        positionQuickAction();
      } else {
        quickAction.root.hidden = true;
      }
    } else {
      quickAction.root.hidden = true;
    }
  }

  if (!panel.root.hidden) {
    const anchor = getLiveAnchorViewportRect();

    if (state.anchorRange && isAnchorOutsideViewport(anchor)) {
      hideAllUi();
    } else {
      schedulePanelReposition();
    }
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
  state.anchorRange = null;
  state.panelPlacement = "below";
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
  const menu = panel.languageMenu;
  const viewportPadding = 8;
  const gap = 6;

  menu.style.left = "0px";
  menu.style.top = "0px";
  menu.style.maxHeight = `${window.innerHeight - viewportPadding * 2}px`;

  const triggerRect = panel.language.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();

  const spaceBelow = window.innerHeight - triggerRect.bottom - viewportPadding;
  const spaceAbove = triggerRect.top - viewportPadding;
  const placeAbove = menuRect.height + gap > spaceBelow && spaceAbove > spaceBelow;

  let top = placeAbove
    ? triggerRect.top - menuRect.height - gap
    : triggerRect.bottom + gap;

  const maxTop = window.innerHeight - menuRect.height - viewportPadding;
  top = Math.min(Math.max(top, viewportPadding), Math.max(viewportPadding, maxTop));

  let left = triggerRect.left;
  const maxLeft = window.innerWidth - menuRect.width - viewportPadding;
  left = Math.min(Math.max(left, viewportPadding), Math.max(viewportPadding, maxLeft));

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
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

function clampToViewportX(left, width) {
  const min = VIEWPORT_PADDING;
  const max = window.innerWidth - width - VIEWPORT_PADDING;
  return Math.min(Math.max(left, min), Math.max(min, max));
}

function clampToViewportY(top, height) {
  const min = VIEWPORT_PADDING;
  const max = window.innerHeight - height - VIEWPORT_PADDING;
  return Math.min(Math.max(top, min), Math.max(min, max));
}
