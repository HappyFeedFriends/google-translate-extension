const targetLanguageField = document.getElementById("targetLanguage");
const saveButton = document.getElementById("saveButton");
const status = document.getElementById("status");

restoreSettings();
saveButton.addEventListener("click", saveSettings);

async function restoreSettings() {
  const { targetLanguage = "ru" } = await chrome.storage.sync.get("targetLanguage");
  targetLanguageField.value = targetLanguage;
}

async function saveSettings() {
  await chrome.storage.sync.set({ targetLanguage: targetLanguageField.value });
  status.textContent = "Настройки сохранены";

  window.setTimeout(() => {
    status.textContent = "";
  }, 1800);
}
