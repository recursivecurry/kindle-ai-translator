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
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
chrome.action.onClicked.addListener((tab) => {
  void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {
    console.error("Could not open the translation panel.");
  });
});
