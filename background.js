const DEFAULT_TARGET_LANGUAGE = "ru";
const MENU_ID = "selection-translator-context";

chrome.runtime.onInstalled.addListener(async () => {
  const { targetLanguage } = await chrome.storage.sync.get("targetLanguage");

  if (!targetLanguage) {
    await chrome.storage.sync.set({ targetLanguage: DEFAULT_TARGET_LANGUAGE });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "TRANSLATE_SELECTION") {
    return false;
  }

  translateSelection(message.text, message.targetLanguage)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Translation failed"
      });
    });

  return true;
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) {
    return;
  }

  const selectedText = (info.selectionText || "").trim();

  if (!selectedText) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "OPEN_TRANSLATION_PANEL",
      text: selectedText
    });
  } catch (_error) {
    // Ignore pages where content scripts are not available.
  }
});

async function translateSelection(text, targetLanguage = DEFAULT_TARGET_LANGUAGE) {
  const query = new URLSearchParams({
    client: "gtx",
    sl: "auto",
    tl: targetLanguage,
    dt: "t",
    q: text
  });

  const response = await fetch(`https://translate.googleapis.com/translate_a/single?${query.toString()}`);

  if (!response.ok) {
    throw new Error(`Translation request failed with status ${response.status}`);
  }

  const payload = await response.json();
  const translation = Array.isArray(payload?.[0])
    ? payload[0].map((item) => item?.[0] || "").join("").trim()
    : "";
  const detectedLanguage = payload?.[2] || "auto";

  if (!translation) {
    throw new Error("Empty translation response");
  }

  return {
    translation,
    detectedLanguage
  };
}
