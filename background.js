import { createNotebookLocatorHandler } from './core/notebook-worker.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
});

const locateNotebookControl = createNotebookLocatorHandler(chrome);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!['TUBELESS_LOCATE_ELEMENT', 'TUBELESS_LOCATOR_CACHE'].includes(message?.type)) return false;
  locateNotebookControl(message, sender).then(respond, () => respond({ ok: false, message: 'Falha ao identificar o controle do notebook.' }));
  return true;
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
});
