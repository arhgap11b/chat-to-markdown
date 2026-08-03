const armedPageDownloads = new Map();
const completedPageDownloads = new Map();

function normalizeDownloadName(value) {
  const raw = String(value || "").replaceAll("\\", "/").split("/").pop() || "";
  try {
    return decodeURIComponent(raw).normalize("NFKC").toLocaleLowerCase();
  } catch {
    return raw.normalize("NFKC").toLocaleLowerCase();
  }
}

function cleanupPageDownloadState() {
  const now = Date.now();
  for (const [token, item] of armedPageDownloads) {
    if (item.expiresAt <= now) armedPageDownloads.delete(token);
  }
  for (const [token, item] of completedPageDownloads) {
    if (item.expiresAt <= now) completedPageDownloads.delete(token);
  }
}

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  cleanupPageDownloadState();
  const actualName = normalizeDownloadName(downloadItem.filename || downloadItem.url);
  const candidates = Array.from(armedPageDownloads.entries());
  const match = candidates.find(([, item]) => item.expectedName === actualName)
    || (candidates.length === 1 && /https:\/\/(?:chatgpt\.com|chat\.openai\.com)\//i.test(downloadItem.referrer)
      ? candidates[0]
      : null);

  if (!match) return;
  const [token, item] = match;
  armedPageDownloads.delete(token);
  completedPageDownloads.set(token, {
    downloadId: downloadItem.id,
    expiresAt: Date.now() + 30_000
  });
  suggest({ filename: item.filename, conflictAction: "uniquify" });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) {
    return false;
  }

  if (message.type === "chat-to-markdown:arm-page-download") {
    const tabId = sender.tab?.id;
    if (tabId == null || !message.filename) {
      sendResponse({ success: false, error: "Unable to identify the page download" });
      return false;
    }

    cleanupPageDownloadState();
    const token = crypto.randomUUID();
    armedPageDownloads.set(token, {
      tabId,
      filename: message.filename,
      expectedName: normalizeDownloadName(message.expectedName),
      expiresAt: Date.now() + 10_000
    });
    sendResponse({ success: true, token });
    return false;
  }

  if (message.type === "chat-to-markdown:page-download-status") {
    cleanupPageDownloadState();
    const completed = completedPageDownloads.get(message.token);
    if (completed) {
      completedPageDownloads.delete(message.token);
      sendResponse({ success: true, started: true, downloadId: completed.downloadId });
      return false;
    }

    sendResponse({
      success: true,
      started: false,
      expired: !armedPageDownloads.has(message.token)
    });
    return false;
  }

  if (message.type === "chat-to-markdown:disarm-page-download") {
    armedPageDownloads.delete(message.token);
    completedPageDownloads.delete(message.token);
    sendResponse({ success: true });
    return false;
  }

  if (message.type === "chat-to-markdown:ensure-styles") {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ success: false, error: "Missing sender tab" });
      return false;
    }

    chrome.scripting.insertCSS(
      {
        target: { tabId },
        files: ["content.css"]
      },
      () => {
        const error = chrome.runtime.lastError;
        sendResponse(error
          ? { success: false, error: error.message }
          : { success: true });
      }
    );
    return true;
  }

  if (message.type !== "chat-to-markdown:download-url") {
    return false;
  }

  const options = {
    url: message.url,
    saveAs: false
  };

  if (message.filename) {
    options.filename = message.filename;
  }

  chrome.downloads.download(options, downloadId => {
    const error = chrome.runtime.lastError;
    if (error) {
      sendResponse({ success: false, error: error.message });
      return;
    }

    sendResponse({ success: true, downloadId });
  });

  return true;
});
