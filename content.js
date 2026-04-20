const MIN_TEXT_LENGTH = 1;
const MAX_TEXT_LENGTH = 800;
const POPUP_GAP = 10;

const state = {
  selectedText: "",
  anchorRect: null,
  targetLanguage: "ru",
  isPointerInsidePopup: false,
  hideTimer: null,
  requestId: 0
};

const popup = createPopup();
document.documentElement.appendChild(popup.root);

init();

async function init() {
  await loadSettings();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes.targetLanguage?.newValue) {
      state.targetLanguage = changes.targetLanguage.newValue;
      popup.language.textContent = state.targetLanguage.toUpperCase();
    }
  });

  document.addEventListener("mouseup", handleSelectionChange, true);
  document.addEventListener("keyup", handleSelectionChange, true);
  document.addEventListener("selectionchange", handleSelectionChange, true);
  document.addEventListener("scroll", handleViewportChange, true);
  window.addEventListener("resize", handleViewportChange, true);

  document.addEventListener("mousedown", (event) => {
    if (popup.root.contains(event.target)) {
      return;
    }

    clearHideTimer();
    hidePopup();
  }, true);
}

async function loadSettings() {
  const { targetLanguage = "ru" } = await chrome.storage.sync.get("targetLanguage");
  state.targetLanguage = targetLanguage;
  popup.language.textContent = state.targetLanguage.toUpperCase();
}

function handleSelectionChange() {
  window.clearTimeout(state.hideTimer);
  state.hideTimer = window.setTimeout(syncSelectionState, 20);
}

function syncSelectionState() {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    scheduleHideIfNeeded();
    return;
  }

  const text = selection.toString().replace(/\s+/g, " ").trim();

  if (text.length < MIN_TEXT_LENGTH || text.length > MAX_TEXT_LENGTH) {
    hidePopup();
    return;
  }

  const range = selection.getRangeAt(0);
  const rect = getAnchorRect(range);

  if (!rect) {
    hidePopup();
    return;
  }

  state.selectedText = text;
  state.anchorRect = rect;
  popup.original.textContent = text;
  popup.language.textContent = state.targetLanguage.toUpperCase();
  popup.translation.textContent = "";
  popup.status.textContent = "Переводим...";
  popup.translateButton.disabled = false;
  popup.spinner.hidden = true;

  showPopup();
  requestTranslation();
}

function handleViewportChange() {
  if (!popup.root.hidden && state.anchorRect) {
    positionPopup();
  }
}

function getAnchorRect(range) {
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width || rect.height);

  if (rects.length > 0) {
    return rects[rects.length - 1];
  }

  const boundingRect = range.getBoundingClientRect();
  return boundingRect.width || boundingRect.height ? boundingRect : null;
}

function createPopup() {
  const root = document.createElement("div");
  root.className = "selection-translator";
  root.hidden = true;

  const card = document.createElement("div");
  card.className = "selection-translator__card";

  const header = document.createElement("div");
  header.className = "selection-translator__header";

  const badge = document.createElement("span");
  badge.className = "selection-translator__badge";
  badge.textContent = "Перевод";

  const language = document.createElement("span");
  language.className = "selection-translator__language";

  header.append(badge, language);

  const original = document.createElement("div");
  original.className = "selection-translator__original";

  const status = document.createElement("div");
  status.className = "selection-translator__status";

  const translation = document.createElement("div");
  translation.className = "selection-translator__translation";

  const actions = document.createElement("div");
  actions.className = "selection-translator__actions";

  const translateButton = document.createElement("button");
  translateButton.className = "selection-translator__button";
  translateButton.type = "button";
  translateButton.textContent = "Перевести";
  translateButton.addEventListener("click", requestTranslation);

  const copyButton = document.createElement("button");
  copyButton.className = "selection-translator__button selection-translator__button--secondary";
  copyButton.type = "button";
  copyButton.textContent = "Копировать";
  copyButton.addEventListener("click", copyTranslation);

  const spinner = document.createElement("div");
  spinner.className = "selection-translator__spinner";
  spinner.hidden = true;

  actions.append(translateButton, copyButton, spinner);
  card.append(header, original, status, translation, actions);
  root.appendChild(card);

  root.addEventListener("mouseenter", () => {
    state.isPointerInsidePopup = true;
    clearHideTimer();
  });

  root.addEventListener("mouseleave", () => {
    state.isPointerInsidePopup = false;
    scheduleHideIfNeeded();
  });

  return {
    root,
    language,
    original,
    status,
    translation,
    translateButton,
    spinner
  };
}

async function requestTranslation() {
  if (!state.selectedText) {
    return;
  }

  const requestId = ++state.requestId;
  popup.translateButton.disabled = true;
  popup.spinner.hidden = false;
  popup.status.textContent = "Переводим...";

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

    popup.translation.textContent = response.translation;
    popup.status.textContent = `Определён язык: ${response.detectedLanguage}`;
  } catch (error) {
    if (requestId !== state.requestId) {
      return;
    }

    popup.translation.textContent = "";
    popup.status.textContent = error instanceof Error ? error.message : "Ошибка перевода";
  } finally {
    if (requestId === state.requestId) {
      popup.translateButton.disabled = false;
      popup.spinner.hidden = true;
    }
  }
}

async function copyTranslation() {
  const text = popup.translation.textContent.trim();

  if (!text) {
    popup.status.textContent = "Сначала получите перевод";
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    popup.status.textContent = "Перевод скопирован";
  } catch (_error) {
    popup.status.textContent = "Не удалось скопировать";
  }
}

function showPopup() {
  popup.root.hidden = false;
  positionPopup();
}

function hidePopup() {
  state.selectedText = "";
  state.anchorRect = null;
  state.requestId += 1;
  popup.root.hidden = true;
}

function scheduleHideIfNeeded() {
  clearHideTimer();

  state.hideTimer = window.setTimeout(() => {
    const selection = window.getSelection();
    const hasSelection = selection && !selection.isCollapsed && selection.toString().trim();

    if (!hasSelection && !state.isPointerInsidePopup) {
      hidePopup();
    }
  }, 160);
}

function clearHideTimer() {
  if (state.hideTimer) {
    window.clearTimeout(state.hideTimer);
    state.hideTimer = null;
  }
}

function positionPopup() {
  if (!state.anchorRect) {
    return;
  }

  const root = popup.root;
  const { innerWidth, innerHeight } = window;
  const rect = state.anchorRect;

  root.style.left = "0px";
  root.style.top = "0px";

  const popupRect = root.getBoundingClientRect();
  const desiredLeft = rect.left + window.scrollX + rect.width / 2 - popupRect.width / 2;
  const placeAbove = rect.top >= popupRect.height + POPUP_GAP;
  const desiredTop = placeAbove
    ? rect.top + window.scrollY - popupRect.height - POPUP_GAP
    : rect.bottom + window.scrollY + POPUP_GAP;

  const minLeft = window.scrollX + 8;
  const maxLeft = window.scrollX + innerWidth - popupRect.width - 8;
  const left = Math.min(Math.max(desiredLeft, minLeft), Math.max(minLeft, maxLeft));

  const minTop = window.scrollY + 8;
  const maxTop = window.scrollY + innerHeight - popupRect.height - 8;
  const top = Math.min(Math.max(desiredTop, minTop), Math.max(minTop, maxTop));

  root.style.left = `${left}px`;
  root.style.top = `${top}px`;
}
