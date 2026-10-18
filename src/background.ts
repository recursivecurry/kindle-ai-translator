chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.remove([
    "apiKey",
    "enabled",
    "revision",
    "typography",
    "cachePages",
    "previousPageMode",
    "sourceLanguage",
    "targetLanguage",
  ]);
});
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
