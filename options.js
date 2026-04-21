const targetLanguageField = document.getElementById("targetLanguage");
const popupThemeField = document.getElementById("popupTheme");
const saveButton = document.getElementById("saveButton");
const status = document.getElementById("status");

restoreSettings();
saveButton.addEventListener("click", saveSettings);

async function restoreSettings() {
  const {
    targetLanguage = "ru",
    popupTheme = "classic"
  } = await chrome.storage.sync.get(["targetLanguage", "popupTheme"]);
  targetLanguageField.value = targetLanguage;
  popupThemeField.value = popupTheme;
}

async function saveSettings() {
  await chrome.storage.sync.set({
    targetLanguage: targetLanguageField.value,
    popupTheme: popupThemeField.value
  });
  status.textContent = "Настройки сохранены";

  window.setTimeout(() => {
    status.textContent = "";
  }, 1800);
}
