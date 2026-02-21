(() => {
  const SCRIPT_VERSION = "2025.10.14-01";
  if (window.__geminiDownloaderInjected) {
    return;
  }
  window.__geminiDownloaderInjected = true;
  window.__geminiDownloaderVersion = SCRIPT_VERSION;
  console.info(`[Gemini Downloader] Content script v${SCRIPT_VERSION} loaded`);

  const MESSAGE_BUTTON_CLASS = "gemini-message-download-button";
  const CONVERSATION_BUTTON_CLASS = "gemini-conversation-download-button";
  const RESEARCH_COUNTER_KEY = "chatgpt-downloader-research-counter";

  const boundMessages = new WeakSet();

  const debugLog = (...args) => {
    if (!window.__geminiDownloaderDebug) return;
    console.log("[Gemini Downloader]", ...args);
  };

  function getResearchCounter() {
    try {
      const value = localStorage.getItem(RESEARCH_COUNTER_KEY);
      return value ? parseInt(value, 10) : 0;
    } catch (error) {
      console.error("[Gemini Downloader] Failed to read research counter", error);
      return 0;
    }
  }

  function incrementResearchCounter() {
    try {
      const current = getResearchCounter();
      const next = current + 1;
      localStorage.setItem(RESEARCH_COUNTER_KEY, String(next));
      return next;
    } catch (error) {
      console.error("[Gemini Downloader] Failed to increment research counter", error);
      return 1;
    }
  }

  function resetResearchCounter() {
    try {
      localStorage.setItem(RESEARCH_COUNTER_KEY, "0");
    } catch (error) {
      console.error("[Gemini Downloader] Failed to reset research counter", error);
    }
  }

  let turndownServiceInstance = null;

  function getTurndownService() {
    if (typeof TurndownService === "undefined") {
      throw new Error("TurndownService is not available in this context");
    }

    if (!turndownServiceInstance) {
      const service = new TurndownService({
        headingStyle: "atx",
        hr: "---",
        bulletListMarker: "*",
        codeBlockStyle: "fenced",
        fence: "```",
        emDelimiter: "*",
        strongDelimiter: "**",
        br: "\n"
      });

      if (typeof turndownPluginGfm !== "undefined" && turndownPluginGfm.gfm) {
        service.use(turndownPluginGfm.gfm);
      }

      service.addRule("geminiListItem", {
        filter: "li",
        replacement: function (content, node, options) {
          const parent = node.parentNode;
          const lines = content
            .replace(/^\n+/, "")
            .replace(/\n+$/, "")
            .split("\n")
            .map((line, index) => (index === 0 ? line : `  ${line}`));

          const body = lines.join("\n");

          let prefix = `${options.bulletListMarker} `;
          if (parent && parent.nodeName === "OL") {
            const start = parent.getAttribute("start");
            const index = Array.prototype.indexOf.call(parent.children, node);
            prefix = `${start ? Number(start) + index : index + 1}. `;
          }

          const suffix = node.nextSibling ? "\n" : "";
          return prefix + body + suffix;
        }
      });

      service.addRule("geminiMultilineCode", {
        filter: node =>
          node.nodeName === "CODE" &&
          node.textContent.includes("\n") &&
          node.parentNode?.nodeName !== "PRE",
        replacement: function (content, node, options) {
          const className = node.getAttribute("class") || "";
          const language = (className.match(/language-([\w-]+)/) || [null, ""])[1];
          const fence = options.fence || "```";
          const normalized = content.replace(/\n+$/, "").replace(/^\n+/, "");
          return `\n\n${fence}${language}\n${normalized}\n${fence}\n\n`;
        }
      });

      turndownServiceInstance = service;
    }

    return turndownServiceInstance;
  }

  function convertHtmlToMarkdown(element) {
    if (!element) return "";
    const service = getTurndownService();
    const markdown = service.turndown(element);
    return markdown.replace(/\r\n/g, "\n").trim();
  }

  function processMessageContent(contentElement) {
    if (!contentElement) return "";
    const clone = contentElement.cloneNode(true);

    clone.querySelectorAll(`.${MESSAGE_BUTTON_CLASS}`).forEach(node => node.remove());
    clone.querySelectorAll('button, [role="button"]').forEach(node => node.remove());
    clone.querySelectorAll('.buttons-container-v2, .actions-container-v2').forEach(node => node.remove());

    const images = clone.querySelectorAll("img");
    images.forEach((img, imageIndex) => {
      if (!img.getAttribute("alt") || !img.alt.trim()) {
        img.alt = `Image ${imageIndex + 1}`;
      }
      if (!img.getAttribute("src") && img.getAttribute("data-src")) {
        img.setAttribute("src", img.getAttribute("data-src"));
      }
    });

    return convertHtmlToMarkdown(clone);
  }

  function downloadAsMarkdown(filename, markdown) {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  function sanitizeFilenameSegment(segment) {
    return segment
      .replace(/[<>:"\/\\|?*\x00-\x1f]/g, "_")
      .replace(/^\.+/, "")
      .replace(/\.+$/, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
  }

  function getConversationTitle() {
    const convTitle = document.querySelector(".conversation-title")?.textContent?.trim();
    if (convTitle) return convTitle;
    const rawTitle = document.title?.trim();
    if (rawTitle && rawTitle !== "Google Gemini") return rawTitle;
    return "Conversation with Gemini";
  }

  function detectAuthor(messageElement) {
    const tag = messageElement.tagName?.toLowerCase();
    if (tag === "user-query" || messageElement.matches?.("user-query")) return "User";
    if (tag === "model-response" || messageElement.matches?.("model-response")) return "Gemini";
    if (messageElement.closest("user-query")) return "User";
    if (messageElement.closest("model-response")) return "Gemini";
    return "Gemini";
  }

  function locateContentElement(messageElement) {
    const tag = messageElement.tagName?.toLowerCase();
    if (tag === "model-response" || messageElement.matches?.("model-response")) {
      const content = messageElement.querySelector("message-content");
      if (content && content.textContent.trim()) return content;
    }
    if (tag === "user-query" || messageElement.matches?.("user-query")) {
      const content = messageElement.querySelector("user-query-content");
      if (content && content.textContent.trim()) return content;
      const queryText = messageElement.querySelector(".query-text");
      if (queryText && queryText.textContent.trim()) return queryText;
    }
    return null;
  }

  function findMessageElements() {
    return Array.from(document.querySelectorAll("model-response, user-query"));
  }

  function detectLanguage() {
    const htmlLang = document.documentElement.lang;
    if (htmlLang && htmlLang.startsWith("ru")) return "ru";
    const sampleButton = document.querySelector("button[aria-label]");
    if (sampleButton) {
      const label = sampleButton.getAttribute("aria-label");
      if (label && /[а-яА-Я]/.test(label)) return "ru";
    }
    return "en";
  }

  const DOWNLOAD_ICON_NAME = "download";

  function attachTooltip(button, text) {
    let tooltipElement = null;

    const showTooltip = () => {
      if (tooltipElement) return;

      tooltipElement = document.createElement("div");
      tooltipElement.textContent = text;
      tooltipElement.className = "gemini-download-tooltip";
      tooltipElement.setAttribute("role", "tooltip");
      tooltipElement.style.cssText = `
        position: fixed;
        z-index: 10000;
        background: rgb(227, 227, 227);
        color: rgb(48, 48, 48);
        padding: 4px 8px;
        border-radius: 4px;
        font-family: "Google Sans Flex", "Google Sans Text", "Google Sans", sans-serif;
        font-size: 12px;
        font-weight: 400;
        line-height: 16px;
        letter-spacing: 0.096px;
        max-width: 200px;
        pointer-events: none;
        white-space: nowrap;
        opacity: 0;
        transition: opacity 0.15s ease-in;
      `;
      requestAnimationFrame(() => {
        if (tooltipElement) tooltipElement.style.opacity = "1";
      });

      document.body.appendChild(tooltipElement);

      const buttonRect = button.getBoundingClientRect();
      const tooltipRect = tooltipElement.getBoundingClientRect();

      const left = buttonRect.left + (buttonRect.width - tooltipRect.width) / 2;
      const top = buttonRect.bottom + 8;

      tooltipElement.style.left = `${Math.max(10, Math.min(left, window.innerWidth - tooltipRect.width - 10))}px`;
      tooltipElement.style.top = `${top}px`;
    };

    const hideTooltip = () => {
      if (tooltipElement && tooltipElement.parentNode) {
        tooltipElement.parentNode.removeChild(tooltipElement);
      }
      tooltipElement = null;
    };

    button.addEventListener("mouseenter", showTooltip);
    button.addEventListener("mouseleave", hideTooltip);
    button.addEventListener("click", hideTooltip);
    button.addEventListener("focus", showTooltip);
    button.addEventListener("blur", hideTooltip);
  }

  function swapIcon(element) {
    const icon = element.querySelector("mat-icon");
    if (icon) {
      icon.setAttribute("fonticon", DOWNLOAD_ICON_NAME);
      icon.setAttribute("data-mat-icon-name", DOWNLOAD_ICON_NAME);
      icon.textContent = "";
    }
  }

  function attachDownloadButton(messageElement) {
    if (boundMessages.has(messageElement)) return;

    const tag = messageElement.tagName?.toLowerCase();
    let cloneSource = null;
    let insertAfter = null;
    let clickTarget = null;

    if (tag === "model-response") {
      const copyEl = messageElement.querySelector("copy-button");
      if (!copyEl) return;
      cloneSource = copyEl;
      insertAfter = copyEl;
    } else if (tag === "user-query") {
      const copyBtn = messageElement.querySelector('[mattooltip="Copy prompt"], [aria-label="Copy prompt"]');
      if (!copyBtn) return;
      cloneSource = copyBtn;
      insertAfter = copyBtn;
    }

    if (!cloneSource || !insertAfter) return;

    const container = insertAfter.parentElement;
    if (!container) return;
    if (container.querySelector(`.${MESSAGE_BUTTON_CLASS}`)) {
      boundMessages.add(messageElement);
      return;
    }

    const clone = cloneSource.cloneNode(true);
    clone.classList.add(MESSAGE_BUTTON_CLASS);
    swapIcon(clone);

    const lang = detectLanguage();
    const tooltipText = lang === "ru" ? "Скачать сообщение" : "Download message";

    clickTarget = clone.querySelector("button") || clone;
    clickTarget.setAttribute("aria-label", tooltipText);
    clickTarget.removeAttribute("mattooltip");
    attachTooltip(clickTarget, tooltipText);

    clickTarget.addEventListener("click", event => {
      event.stopPropagation();
      event.preventDefault();

      let mode = "normal";
      if (event.ctrlKey || event.metaKey) {
        mode = "research";
      } else if (event.shiftKey) {
        mode = "skip";
      }

      downloadSingleMessage(messageElement, mode);
    });

    insertAfter.insertAdjacentElement("afterend", clone);
    boundMessages.add(messageElement);
    console.info(`[Gemini Downloader] Attached download button to ${tag}`);
  }

  function ensureButtonsForMessage(messageElement, attempt = 0) {
    if (!messageElement) return;
    if (boundMessages.has(messageElement)) return;

    const tag = messageElement.tagName?.toLowerCase();
    let ready = false;

    if (tag === "model-response") {
      const copyEl = messageElement.querySelector("copy-button");
      ready = !!(copyEl?.querySelector("button"));
    } else if (tag === "user-query") {
      ready = !!messageElement.querySelector('[mattooltip="Copy prompt"], [aria-label="Copy prompt"]');
    }

    if (!ready) {
      if (attempt >= 20) {
        debugLog(`Copy button not found after 20 retries for ${tag}`);
        return;
      }
      const delay = attempt < 5 ? 100 : attempt < 10 ? 300 : 500;
      setTimeout(() => ensureButtonsForMessage(messageElement, attempt + 1), delay);
      return;
    }

    attachDownloadButton(messageElement);
  }

  function downloadSingleMessage(messageElement, mode = "normal") {
    try {
      const contentElement = locateContentElement(messageElement);
      if (!contentElement) {
        throw new Error("Unable to locate message content");
      }

      const markdown = processMessageContent(contentElement).trim();
      if (!markdown) {
        throw new Error("Message content is empty");
      }

      const author = detectAuthor(messageElement);
      const lang = detectLanguage();
      const title = sanitizeFilenameSegment(getConversationTitle());
      let filename;

      if (author === "User") {
        const requestPrefix = lang === "ru" ? "запрос" : "request";
        filename = `${requestPrefix}_${title}.md`;
      } else {
        if (mode === "research") {
          const analysisPrefix = lang === "ru" ? "анализ" : "analysis";
          const counter = incrementResearchCounter();
          filename = `${analysisPrefix}_${counter}_${title}.md`;
        } else {
          if (mode === "normal") {
            resetResearchCounter();
          }
          filename = `${title}.md`;
        }
      }

      downloadAsMarkdown(filename, markdown);
    } catch (error) {
      console.error("[Gemini Downloader] Failed to export message", error);
    }
  }

  function downloadConversation() {
    const messages = findMessageElements();
    const parts = [];

    messages.forEach(messageElement => {
      const contentElement = locateContentElement(messageElement);
      if (!contentElement) return;

      const segment = processMessageContent(contentElement).trim();
      if (!segment) return;

      const author = detectAuthor(messageElement);
      parts.push(`**${author}**:\n\n${segment}`);
    });

    if (!parts.length) {
      throw new Error("Unable to find any conversation content to download");
    }

    const title = `# ${getConversationTitle()}`;
    const body = parts.join("\n\n---\n\n");
    const markdown = `${title}\n\n${body}`.trim();
    const filename = sanitizeFilenameSegment(getConversationTitle());
    downloadAsMarkdown(`${filename}.md`, markdown);
  }

  function createConversationButton() {
    if (document.querySelector(`.${CONVERSATION_BUTTON_CLASS}`)) return;

    const bottomRow = document.querySelector(".input-buttons-wrapper-bottom");
    if (!bottomRow) {
      debugLog("Input area bottom row not found");
      return;
    }

    const micContainer = bottomRow.querySelector(".mic-button-container");
    const micButton = micContainer?.querySelector("button");
    if (!micButton) {
      debugLog("Mic button not found to clone");
      return;
    }

    const lang = detectLanguage();
    const tooltipText = lang === "ru" ? "Скачать весь чат" : "Download chat";

    const button = micButton.cloneNode(true);
    const icon = button.querySelector("mat-icon");
    if (icon) {
      icon.setAttribute("fonticon", DOWNLOAD_ICON_NAME);
      icon.setAttribute("data-mat-icon-name", DOWNLOAD_ICON_NAME);
      icon.textContent = "";
    }
    button.classList.add(CONVERSATION_BUTTON_CLASS);
    button.setAttribute("aria-label", tooltipText);
    button.removeAttribute("mattooltip");
    attachTooltip(button, tooltipText);

    button.addEventListener("click", event => {
      event.stopPropagation();
      event.preventDefault();
      try {
        downloadConversation();
      } catch (error) {
        console.error("[Gemini Downloader] Failed to export conversation", error);
      }
    });

    micContainer.insertAdjacentElement("beforebegin", button);

    console.info("[Gemini Downloader] Conversation download button inserted");
  }

  function enhancePage() {
    const messages = findMessageElements();
    messages.forEach(msg => ensureButtonsForMessage(msg));
    createConversationButton();
  }

  function observeMessages() {
    if (window.__geminiDownloaderObserver || !document.body) return;

    const observer = new MutationObserver(mutations => {
      let shouldCreateConvoButton = false;

      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (!(node instanceof Element)) return;

          if (node.matches?.("model-response, user-query")) {
            ensureButtonsForMessage(node);
            shouldCreateConvoButton = true;
          }

          node.querySelectorAll?.("model-response, user-query").forEach(msg => {
            ensureButtonsForMessage(msg);
            shouldCreateConvoButton = true;
          });

          if (
            node.matches?.(".input-buttons-wrapper-bottom") ||
            node.querySelector?.(".input-buttons-wrapper-bottom")
          ) {
            shouldCreateConvoButton = true;
          }
        });
      });

      if (shouldCreateConvoButton) {
        createConversationButton();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    window.__geminiDownloaderObserver = observer;
  }

  function init() {
    enhancePage();
    observeMessages();
  }

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || !message.type) return false;

      if (message.type === "gemini-downloader:download-conversation") {
        console.info("[Gemini Downloader] Received request to download conversation");
        try {
          downloadConversation();
          sendResponse({ success: true });
        } catch (error) {
          console.error("[Gemini Downloader] Failed to export conversation", error);
          sendResponse({ success: false, error: error.message });
        }
        return true;
      }
      return false;
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
