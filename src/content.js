(() => {
  const SCRIPT_VERSION = "2026.08.03-11";
  if (window.__chatgptDownloaderInjected) {
    return;
  }
  window.__chatgptDownloaderInjected = true;
  window.__chatgptDownloaderVersion = SCRIPT_VERSION;
  console.info(`[chat-to-markdown] Content script v${SCRIPT_VERSION} loaded`);

  const MESSAGE_BUTTON_CLASS = "chatgpt-message-download-button";
  const CONVERSATION_BUTTON_CLASS = "chatgpt-conversation-download-button";
  const EXPORT_DIALOG_CLASS = "chatgpt-export-dialog-overlay";
  const MESSAGE_WRAPPER_ATTRIBUTE = "data-chatgpt-download-index";
  const COPY_BUTTON_SELECTOR = 'button[data-testid="copy-turn-action-button"]';
  const processedCopyButtons = new WeakSet();
  const boundMessages = new WeakSet();
  let lastCopyButtonCount = 0;
  let conversationExportInProgress = false;
  let authContextPromise = null;
  let authContextExpiresAt = 0;
  const exportCore = globalThis.ChatToMarkdownExport;
  const debugLog = (...args) => {
    if (!window.__chatgptDownloaderDebug) {
      return;
    }
    console.log("[chat-to-markdown]", ...args);
  };

  const RESEARCH_COUNTER_KEY = "chatgpt-downloader-research-counter";
  const RESEARCH_TIMESTAMP_KEY = "chatgpt-downloader-research-ts";
  const RESEARCH_TTL_MS = 5 * 60 * 1000;

  function getResearchCounter() {
    try {
      const ts = localStorage.getItem(RESEARCH_TIMESTAMP_KEY);
      if (ts && Date.now() - Number(ts) > RESEARCH_TTL_MS) {
        localStorage.setItem(RESEARCH_COUNTER_KEY, "0");
        return 0;
      }
      const value = localStorage.getItem(RESEARCH_COUNTER_KEY);
      return value ? parseInt(value, 10) : 0;
    } catch (error) {
      console.error("[chat-to-markdown] Failed to read research counter", error);
      return 0;
    }
  }

  function incrementResearchCounter() {
    try {
      const current = getResearchCounter();
      const next = current + 1;
      localStorage.setItem(RESEARCH_COUNTER_KEY, String(next));
      localStorage.setItem(RESEARCH_TIMESTAMP_KEY, String(Date.now()));
      return next;
    } catch (error) {
      console.error("[chat-to-markdown] Failed to increment research counter", error);
      return 1;
    }
  }

  function resetResearchCounter() {
    try {
      localStorage.setItem(RESEARCH_COUNTER_KEY, "0");
      localStorage.removeItem(RESEARCH_TIMESTAMP_KEY);
    } catch (error) {
      console.error("[chat-to-markdown] Failed to reset research counter", error);
    }
  }

  const MESSAGE_SELECTORS = [
    "[data-message-author-role]",
    "[data-message-id]",
    "article[data-testid*='conversation-turn']",
    "[data-testid*='conversation-turn']",
    ".group.text-token-text-primary",
    "[class*='group'][class*='text-token']",
    "article",
    "[class*='group']"
  ];
  const MESSAGE_NODE_SELECTOR = "[data-message-author-role], [data-message-id]";

  const CONTENT_SELECTORS = [
    "[class*='whitespace-pre-wrap']",
    "[class*='prose']",
    "[class*='markdown']",
    ".markdown",
    "[class*='text-base']",
    "[data-testid*='content']",
    "p",
    "div"
  ];

  const FILE_SELECTORS = [
    "a[download]",
    "a[href*='blob:']",
    "div[class*='text-token-text-primary'] a",
    "div[class*='border-token-border'] a"
  ];

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

      service.addRule("chatgptListItem", {
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

      service.addRule("chatgptMultilineCode", {
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
    if (!element) {
      return "";
    }

    const service = getTurndownService();
    const markdown = service.turndown(element);
    return markdown.replace(/\r\n/g, "\n").trim();
  }

  function processMessageContent(contentElement, messageIndex) {
    if (!contentElement) {
      return "";
    }

    const clone = contentElement.cloneNode(true);

    clone.querySelectorAll(`.${MESSAGE_BUTTON_CLASS}`).forEach(node => node.remove());
    clone.querySelectorAll('[data-testid*="copy"], [data-testid*="toast"], [data-testid*="share"]').forEach(node => node.remove());
    clone.querySelectorAll('button, [role="button"]').forEach(node => node.remove());

    const images = clone.querySelectorAll("img");
    images.forEach((img, imageIndex) => {
      if (!img.getAttribute("alt") || !img.alt.trim()) {
        img.alt = `Image ${imageIndex + 1}`;
      }
      if (!img.getAttribute("src") && img.getAttribute("data-src")) {
        img.setAttribute("src", img.getAttribute("data-src"));
      }
    });

    const fileNodes = new Set();
    FILE_SELECTORS.forEach(selector => {
      clone.querySelectorAll(selector).forEach(node => fileNodes.add(node));
    });

    Array.from(fileNodes).forEach((fileElement, fileIndex) => {
      const href = fileElement.href || fileElement.getAttribute("href");
      if (!href) {
        return;
      }

      let fileName = fileElement.download || fileElement.getAttribute("download");
      if (!fileName) {
        const filenameNode = fileElement.querySelector("div[class*='font-semibold'], .font-semibold, [class*='truncate']");
        if (filenameNode) {
          fileName = filenameNode.textContent.trim();
        } else {
          const textContent = fileElement.textContent.trim();
          fileName = textContent || `file_${messageIndex}_${fileIndex}`;
        }
      }

      fileElement.innerHTML = "";
      fileElement.textContent = `📎 ${fileName}`;
      fileElement.setAttribute("data-chatgpt-download-link", "true");
      fileElement.setAttribute("href", href);
    });

    return convertHtmlToMarkdown(clone);
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function downloadAsMarkdown(filename, markdown) {
    downloadBlob(filename, new Blob([markdown], { type: "text/markdown" }));
  }

  function downloadAsJson(filename, json) {
    downloadBlob(filename, new Blob([json], { type: "application/json" }));
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
    const rawTitle = document.querySelector("title")?.innerText?.trim();
    if (rawTitle) {
      return rawTitle;
    }
    return "Conversation with ChatGPT";
  }

  function detectAuthor(messageElement) {
    const directRole = messageElement.getAttribute("data-message-author-role");
    if (directRole === "user") return "User";
    if (directRole === "assistant") return "ChatGPT";

    const userIndicators = [
      messageElement.querySelector("img[alt*='user' i]"),
      messageElement.querySelector("[data-testid*='user']"),
      messageElement.querySelector("[data-message-author-role='user']"),
      messageElement.getAttribute("data-turn") === "user"
    ];

    if (userIndicators.some(Boolean)) {
      return "User";
    }

    return "ChatGPT";
  }

  function locateContentElement(messageElement) {
    for (const selector of CONTENT_SELECTORS) {
      const candidate = messageElement.querySelector(selector);
      if (candidate && candidate.textContent && candidate.textContent.trim()) {
        return candidate;
      }
    }
    return null;
  }

  function findMessageElements() {
    for (const selector of MESSAGE_SELECTORS) {
      const nodes = Array.from(document.querySelectorAll(selector));
      if (nodes.length) {
        return nodes;
      }
    }
    return [];
  }

  function findMessageCandidate(element) {
    if (!element) {
      return null;
    }
    if (element.matches?.(MESSAGE_NODE_SELECTOR)) {
      return element;
    }
    const candidates = element.querySelectorAll?.(MESSAGE_NODE_SELECTOR);
    if (candidates?.length) {
      return candidates[candidates.length - 1];
    }
    return null;
  }

  function findMessageInSiblings(start) {
    let current = start;
    while (current && current !== document.body) {
      let sibling = current.previousElementSibling;
      while (sibling) {
        const message = findMessageCandidate(sibling);
        if (message) {
          return message;
        }
        sibling = sibling.previousElementSibling;
      }
      current = current.parentElement;
    }
    return null;
  }

  function resolveMessageElementForButton(copyButton) {
    if (!copyButton) {
      return null;
    }

    const directMatch = findMessageCandidate(copyButton.closest?.(MESSAGE_NODE_SELECTOR));
    if (directMatch) {
      return directMatch;
    }

    const siblingMatch = findMessageInSiblings(copyButton.parentElement);
    if (siblingMatch) {
      return siblingMatch;
    }

    let current = copyButton.parentElement;
    while (current && current !== document.body) {
      if (MESSAGE_SELECTORS.some(selector => current.matches?.(selector))) {
        const candidate = findMessageCandidate(current);
        if (candidate) {
          return candidate;
        }
      }
      current = current.parentElement;
    }

    return null;
  }

  function indexMessages() {
    const messages = findMessageElements();
    messages.forEach((messageElement, index) => {
      messageElement.setAttribute(MESSAGE_WRAPPER_ATTRIBUTE, String(index));
    });
    debugLog("Indexed messages", messages.length);
  }

  function findCopyButtons(root) {
    if (!root) {
      return [];
    }
    const buttons = root.querySelectorAll ? root.querySelectorAll(COPY_BUTTON_SELECTOR) : [];
    const directMatch = root.matches?.(COPY_BUTTON_SELECTOR) ? [root] : [];
    return [...directMatch, ...buttons];
  }

  function attachTooltip(button, text) {
    let tooltipElement = null;

    const showTooltip = () => {
      if (tooltipElement) return;

      tooltipElement = document.createElement("div");
      tooltipElement.textContent = text;
      tooltipElement.className = "chatgpt-download-tooltip";
      tooltipElement.setAttribute("role", "tooltip");
      tooltipElement.style.cssText = `
        position: fixed;
        z-index: 10000;
        background: rgb(0, 0, 0);
        color: rgb(255, 255, 255);
        padding: 4px 8px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        line-height: 1.4;
        pointer-events: none;
        white-space: nowrap;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
      `;

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

  function attachDownloadButtons() {
    const copyButtons = findCopyButtons(document.body);
    if (copyButtons.length !== lastCopyButtonCount) {
      console.info(`[chat-to-markdown] copy buttons: ${copyButtons.length}`);
      lastCopyButtonCount = copyButtons.length;
    }
    copyButtons.forEach(processCopyButton);
  }

  function processCopyButton(copyButton) {
    if (processedCopyButtons.has(copyButton)) {
      return;
    }

    const messageElement = resolveMessageElementForButton(copyButton);
    if (!messageElement) {
      debugLog("Skipping copy button without message element", copyButton);
      return;
    }

    if (!messageElement.hasAttribute(MESSAGE_WRAPPER_ATTRIBUTE)) {
      indexMessages();
    }

    const actionHost = copyButton.parentElement;
    if (!actionHost) {
      debugLog("Skipping copy button without host", copyButton);
      return;
    }

    if (actionHost.querySelector(`.${MESSAGE_BUTTON_CLASS}`)) {
      processedCopyButtons.add(copyButton);
      return;
    }

    const downloadButton = copyButton.cloneNode(true);
    downloadButton.innerHTML = "";
    const iconWrapper = document.createElement("span");
    iconWrapper.className = copyButton.querySelector("span")?.className || "flex items-center justify-center touch:w-10 h-8 w-8";
    iconWrapper.innerHTML = `
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M10 2a.75.75 0 0 1 .75.75v8.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.53 3.53a.75.75 0 0 1-1.06 0L5.91 9.78a.75.75 0 1 1 1.06-1.06l2.28 2.28V2.75A.75.75 0 0 1 10 2zm-5 12.25a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1-.75-.75zm-.75 2.5a.75.75 0 0 1 .75-.75h11a.75.75 0 0 1 0 1.5h-11a.75.75 0 0 1-.75-.75z"></path>
      </svg>
    `;
    const icon = iconWrapper.querySelector("svg");
    if (icon) {
      icon.setAttribute("width", "20");
      icon.setAttribute("height", "20");
    }
    downloadButton.appendChild(iconWrapper);
    processedCopyButtons.add(copyButton);
    downloadButton.classList.add(MESSAGE_BUTTON_CLASS);

    const lang = detectLanguage();
    const messageTooltip = lang === 'uk'
      ? 'Завантажити повідомлення'
      : lang === 'ru'
        ? 'Скачать сообщение'
        : 'Download message';

    downloadButton.setAttribute("aria-label", messageTooltip);
    downloadButton.setAttribute("data-testid", "download-turn-action-button");
    downloadButton.setAttribute("data-state", "closed");
    downloadButton.setAttribute("aria-pressed", "false");
    downloadButton.setAttribute("data-chatgpt-download-button", "true");

    attachTooltip(downloadButton, messageTooltip);

    downloadButton.addEventListener("click", event => {
      event.stopPropagation();
      event.preventDefault();

      let mode = 'normal';
      if (event.ctrlKey || event.metaKey) {
        mode = 'research';
      } else if (event.shiftKey) {
        mode = 'skip';
      }

      downloadSingleMessage(messageElement, mode);
    });

    processedCopyButtons.add(downloadButton);
    try {
      copyButton.insertAdjacentElement("afterend", downloadButton);
      console.info(`[chat-to-markdown] attached download button for message ${messageElement.getAttribute(MESSAGE_WRAPPER_ATTRIBUTE)}`);
    } catch (error) {
      console.error("chat-to-markdown: failed to insert download button", error);
      processedCopyButtons.delete(downloadButton);
    }
  }

  function ensureButtonsForMessage(messageElement, attempt = 0) {
    if (!messageElement) {
      console.info("[chat-to-markdown] ensureButtons: missing message element");
      return;
    }

    if (!messageElement.hasAttribute(MESSAGE_WRAPPER_ATTRIBUTE)) {
      indexMessages();
    }

    let copyButton = messageElement.querySelector(COPY_BUTTON_SELECTOR);
    if (!copyButton) {
      let context = messageElement;
      for (let depth = 0; depth < 5 && context; depth++) {
        let next = context.nextElementSibling;
        while (next) {
          let candidate = null;
          if (next.matches?.(COPY_BUTTON_SELECTOR)) {
            candidate = next;
          } else if (next.querySelector) {
            candidate = next.querySelector(COPY_BUTTON_SELECTOR);
          }
          if (candidate) {
            console.info(`[chat-to-markdown] copy found in sibling depth ${depth}`, next.className || next.tagName);
            copyButton = candidate;
            break;
          }
          next = next.nextElementSibling;
        }
        if (copyButton) {
          break;
        }
        context = context.parentElement;
      }
    }
    if (!copyButton) {
      console.info(`[chat-to-markdown] copy missing (attempt ${attempt})`);
      if (attempt >= 12) {
        debugLog("Copy button still missing after 12 retries", messageElement);
        return;
      }
      const rerun = () => ensureButtonsForMessage(messageElement, attempt + 1);
      if (attempt < 4) {
        setTimeout(rerun, 0);
      } else if (attempt < 8) {
        setTimeout(rerun, 50);
      } else {
        setTimeout(rerun, 100);
      }
      return;
    }

    if (processedCopyButtons.has(copyButton) && messageElement.querySelector(`.${MESSAGE_BUTTON_CLASS}`)) {
      return;
    }

    console.info(`[chat-to-markdown] copy found (attempt ${attempt})`);
    processCopyButton(copyButton);
  }

  function bindMessageActions() {
    const messages = findMessageElements();
    messages.forEach(messageElement => {
      if (boundMessages.has(messageElement)) {
        return;
      }

      boundMessages.add(messageElement);
      messageElement.addEventListener("mouseenter", () => ensureButtonsForMessage(messageElement));
      messageElement.addEventListener("focusin", () => ensureButtonsForMessage(messageElement));
    });
  }

  function buildMessageMarkdown(messageElement) {
    const index = Number(messageElement.getAttribute(MESSAGE_WRAPPER_ATTRIBUTE) || "0");
    const contentElement = locateContentElement(messageElement);
    if (!contentElement) {
      throw new Error("Unable to locate message content");
    }

    const markdown = processMessageContent(contentElement, index);
    const author = detectAuthor(messageElement);
    return {
      markdown,
      author,
      index
    };
  }

  function downloadSingleMessage(messageElement, mode = 'normal') {
    try {
      const { markdown, author } = buildMessageMarkdown(messageElement);
      const finalContent = markdown.trim();
      if (!finalContent) {
        throw new Error("Message content is empty");
      }

      const lang = detectLanguage();
      const title = sanitizeFilenameSegment(getConversationTitle());
      let filename;

      if (author === "User") {
        const requestPrefix = lang === 'uk' ? 'запит' : lang === 'ru' ? 'запрос' : 'request';
        filename = `${requestPrefix}_${title}.md`;
      } else {
        if (mode === 'research') {
          const analysisPrefix = lang === 'uk' ? 'аналіз' : lang === 'ru' ? 'анализ' : 'analysis';
          const counter = incrementResearchCounter();
          filename = `${analysisPrefix}_${counter}_${title}.md`;
        } else {
          if (mode === 'normal') {
            resetResearchCounter();
          }
          filename = `${title}.md`;
        }
      }

      downloadAsMarkdown(filename, finalContent);
    } catch (error) {
      console.error("chat-to-markdown: failed to export message", error);
    }
  }

  function collectDomConversationRecords() {
    const records = [];
    findMessageElements().forEach(messageElement => {
      const contentElement = locateContentElement(messageElement);
      if (!contentElement) {
        return;
      }

      const segment = processMessageContent(contentElement, records.length).trim();
      if (!segment) {
        return;
      }

      const author = detectAuthor(messageElement);
      const role = author === "User" ? "user" : "assistant";
      const id = messageElement.getAttribute("data-message-id") || `dom-message-${records.length + 1}`;
      messageElement.setAttribute(MESSAGE_WRAPPER_ATTRIBUTE, String(records.length));
      records.push({ id, author, role, markdown: segment, messageElement });
    });

    return records;
  }

  function buildDomConversationMarkdown(options = {}) {
    const includedMessageIds = options.includedMessageIds
      ? new Set(options.includedMessageIds)
      : null;
    const records = collectDomConversationRecords();

    if (!records.length) {
      throw new Error("Unable to find any conversation content to download");
    }

    const groupedRecords = [];
    records.forEach(record => {
      const previous = groupedRecords.at(-1);
      if (record.role === "assistant" && previous?.role === "assistant") {
        previous.markdown = `${previous.markdown}\n\n${record.markdown}`;
        previous.messageIds.push(record.id);
      } else {
        groupedRecords.push({ ...record, messageIds: [record.id] });
      }
    });

    const title = `# ${getConversationTitle()}`;
    const parts = groupedRecords
      .filter(record => !includedMessageIds
        || record.messageIds.some(id => includedMessageIds.has(id)))
      .map(record => `**${record.author}**:\n\n${record.markdown}`);
    if (!parts.length) {
      throw new Error("Unable to find any conversation content to download");
    }
    const body = parts.join("\n\n---\n\n");
    const markdown = `${title}\n\n${body}`.trim();
    return markdown;
  }

  function serializeJsonFile(file) {
    return {
      name: String(file.localName || file.name || "file"),
      direction: file.direction === "input" ? "input" : "output",
      path: String(file.relativePath || ""),
      link: String(file.relativeUrl || ""),
      messageId: String(file.messageId || ""),
      mimeType: String(file.mimeType || ""),
      size: Number(file.size) || 0,
      source: String(file.source || file.type || "unknown")
    };
  }

  function buildDomConversationJsonData(title, files, options = {}) {
    const includedMessageIds = options.includedMessageIds
      ? new Set(options.includedMessageIds)
      : null;
    const exportedFiles = files.map(serializeJsonFile);
    const filesByMessage = new Map();
    exportedFiles.forEach(file => {
      if (!file.messageId) return;
      const messageFiles = filesByMessage.get(file.messageId) || [];
      messageFiles.push(file);
      filesByMessage.set(file.messageId, messageFiles);
    });

    const messages = [];
    collectDomConversationRecords().forEach(record => {
      if (includedMessageIds && !includedMessageIds.has(record.id)) return;
      messages.push({
        position: messages.length + 1,
        id: record.id,
        parentId: messages.at(-1)?.id || "",
        author: {
          role: record.role,
          label: record.author,
          name: ""
        },
        createdAt: null,
        updatedAt: null,
        recipient: "all",
        contentType: "text",
        contentMarkdown: record.markdown,
        files: filesByMessage.get(record.id) || []
      });
    });

    return {
      schemaVersion: 1,
      conversation: {
        id: exportCore?.extractConversationId(location.href, getCanonicalConversationUrl()) || "",
        title,
        currentNode: messages.at(-1)?.id || "",
        sourceUrl: location.href,
        exportedAt: new Date().toISOString()
      },
      messages,
      files: exportedFiles
    };
  }

  function collectNavigatorSummaries() {
    const summaries = [];
    document.querySelectorAll("[data-toc-item-index]").forEach(element => {
      const index = Number(element.getAttribute("data-toc-item-index"));
      if (!Number.isInteger(index) || index < 0) return;
      const candidates = [
        element.getAttribute("data-summary"),
        element.getAttribute("aria-description"),
        element.getAttribute("title"),
        element.getAttribute("aria-label"),
        element.textContent
      ];
      const summary = candidates
        .map(value => String(value || "").replace(/\s+/g, " ").trim())
        .find(value => value && !/^(?:prompt|request|промпт|запрос|запит)\s*\d+$/i.test(value));
      if (summary) summaries[index] = summary;
    });
    return summaries;
  }

  function buildDomMessageContexts(navigatorSummaries = []) {
    const contexts = [];
    let promptNumber = 0;
    let promptSummary = "";
    collectDomConversationRecords().forEach((record, index) => {
      if (record.role === "user") {
        promptNumber += 1;
        promptSummary = navigatorSummaries[promptNumber - 1]
          || exportCore?.summarizeMessageText(record.markdown, "user")
          || "";
      }
      const context = {
        id: record.id,
        role: record.role,
        author: record.author,
        position: index + 1,
        promptNumber,
        summary: record.role === "user"
          ? promptSummary
          : exportCore?.summarizeMessageText(record.markdown, "assistant") || "",
        promptSummary,
        contentMarkdown: record.markdown,
        selectable: true,
        messageIds: [record.id],
        relatedMessageIds: []
      };
      const previous = contexts.at(-1);
      if (context.role === "assistant"
          && previous?.role === "assistant"
          && previous.promptNumber === context.promptNumber) {
        previous.messageIds.push(context.id);
        previous.contentMarkdown = `${previous.contentMarkdown}\n\n${context.contentMarkdown}`;
        previous.summary = exportCore?.summarizeMessageText(
          previous.contentMarkdown,
          "assistant"
        ) || previous.summary;
      } else {
        contexts.push(context);
      }
    });
    return contexts;
  }

  function attachFileMessageContexts(files, contexts) {
    const contextsById = new Map();
    contexts.forEach(context => {
      const ids = new Set([
        context.id,
        ...(context.messageIds || []),
        ...(context.relatedMessageIds || [])
      ]);
      ids.forEach(id => contextsById.set(String(id || ""), context));
    });
    return files.map(file => {
      let messageContext = contextsById.get(String(file.messageId || "")) || null;
      if (!messageContext) {
        const normalizedName = normalizeFileNameForMatch(file.name);
        const expectedRole = file.direction === "input" ? "user" : "assistant";
        const candidates = contexts.filter(context =>
          context.role === expectedRole
          && normalizeFileNameForMatch(context.contentMarkdown).includes(normalizedName)
        );
        messageContext = file.direction === "input" ? candidates[0] : candidates.at(-1);
      }
      return { ...file, messageContext: messageContext || null };
    });
  }

  function stringifyConversationJson(data, files) {
    const linkedData = {
      ...data,
      messages: data.messages.map(message => ({
        ...message,
        contentMarkdown: replaceRelativeFileLinks(message.contentMarkdown, files)
      }))
    };
    return `${JSON.stringify(linkedData, null, 2)}\n`;
  }

  function getCanonicalConversationUrl() {
    return document.querySelector('link[rel="canonical"]')?.href || "";
  }

  function getCookie(name) {
    const prefix = `${encodeURIComponent(name)}=`;
    const cookie = document.cookie
      .split(";")
      .map(value => value.trim())
      .find(value => value.startsWith(prefix));

    if (!cookie) {
      return "";
    }

    try {
      return decodeURIComponent(cookie.slice(prefix.length));
    } catch {
      return cookie.slice(prefix.length);
    }
  }

  async function loadAuthContext(forceRefresh = false) {
    if (!forceRefresh && authContextPromise && Date.now() < authContextExpiresAt) {
      return authContextPromise;
    }

    const sessionUrl = new URL("/api/auth/session", location.origin);
    if (forceRefresh) {
      sessionUrl.searchParams.set("refresh", "true");
    }

    authContextPromise = fetch(sessionUrl, {
      cache: "no-store",
      credentials: "include",
      headers: {
        Accept: "application/json"
      }
    }).then(async response => {
      if (!response.ok) {
        throw new Error(`Unable to read ChatGPT session (HTTP ${response.status})`);
      }

      const session = await response.json();
      if (!session?.accessToken) {
        throw new Error("ChatGPT session did not contain an access token");
      }

      const workspaceCookie = getCookie("_account");
      const accountId = workspaceCookie
        ? workspaceCookie === "personal" ? "" : workspaceCookie
        : session.account?.id || "";

      return {
        accessToken: session.accessToken,
        accountId: accountId && accountId !== "personal" ? accountId : ""
      };
    });

    authContextExpiresAt = Date.now() + 2 * 60 * 1000;

    try {
      return await authContextPromise;
    } catch (error) {
      authContextPromise = null;
      authContextExpiresAt = 0;
      throw error;
    }
  }

  async function fetchJson(url, options = {}) {
    const auth = await loadAuthContext(Boolean(options.forceRefresh));
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${auth.accessToken}`
    };

    if (auth.accountId) {
      headers["ChatGPT-Account-ID"] = encodeURIComponent(auth.accountId);
    }

    const response = await fetch(url, {
      credentials: "include",
      headers
    });

    if (response.status === 401 && !options.forceRefresh) {
      return fetchJson(url, { ...options, forceRefresh: true });
    }

    if (!response.ok) {
      throw new Error(`ChatGPT API returned HTTP ${response.status}`);
    }

    return response.json();
  }

  async function fetchPaginatedConversation(conversationId, onProgress) {
    const firstUrl = new URL(
      `/backend-api/conversations/${encodeURIComponent(conversationId)}`,
      location.origin
    );
    firstUrl.searchParams.set("num_turns", "100");

    const firstPage = await fetchJson(firstUrl);
    let messages = Array.isArray(firstPage.messages) ? [...firstPage.messages] : [];
    onProgress?.(messages.length);
    let pageInfo = firstPage.page_info || {};
    let cursor = pageInfo.has_previous_page ? pageInfo.start_cursor : null;
    const seenCursors = new Set();

    while (cursor && !seenCursors.has(cursor)) {
      seenCursors.add(cursor);
      const pageUrl = new URL(
        `/backend-api/conversations/${encodeURIComponent(conversationId)}/messages`,
        location.origin
      );
      pageUrl.searchParams.set("before", cursor);
      pageUrl.searchParams.set("num_turns", "100");

      const page = await fetchJson(pageUrl);
      const olderMessages = Array.isArray(page.messages) ? page.messages : [];
      messages = [...olderMessages, ...messages];
      onProgress?.(messages.length);
      pageInfo = page.page_info || {};
      cursor = pageInfo.has_previous_page ? pageInfo.start_cursor : null;
    }

    return {
      ...firstPage,
      id: firstPage.id || conversationId,
      messages,
      current_node: messages.at(-1)?.id || firstPage.current_node
    };
  }

  async function fetchFullConversation(conversationId, onProgress) {
    let paginatedError;

    try {
      const conversation = await fetchPaginatedConversation(conversationId, onProgress);
      if (Array.isArray(conversation?.messages) && conversation.messages.length) {
        return conversation;
      }
      throw new Error("The paginated conversation response was empty");
    } catch (error) {
      paginatedError = error;
      debugLog("Paginated conversation endpoint failed, trying legacy API", error);
    }

    const fullUrl = new URL(
      `/backend-api/conversation/${encodeURIComponent(conversationId)}`,
      location.origin
    );
    fullUrl.searchParams.set("include_full_conversation", "true");

    try {
      const legacyConversation = await fetchJson(fullUrl);
      if (legacyConversation?.mapping && Object.keys(legacyConversation.mapping).length) {
        return legacyConversation;
      }
      throw new Error("The legacy full-conversation response was empty");
    } catch (legacyError) {
      throw new Error(
        `Unable to load the full conversation: ${paginatedError.message}; ${legacyError.message}`
      );
    }
  }

  function collectDomFiles() {
    const files = new Map();
    const selector = [
      "a[download]",
      "a[href^='blob:']",
      "a[href*='/backend-api/files/']",
      "a[href*='/backend-api/estuary/']",
      "a[href*='/backend-api/conversation/'][href*='download']",
      "a[href*='oaiusercontent.com']"
    ].join(",");

    document.querySelectorAll(selector).forEach((anchor, index) => {
      const url = anchor.href || anchor.getAttribute("href");
      if (!url || files.has(url)) {
        return;
      }

      const messageElement = anchor.closest(MESSAGE_NODE_SELECTOR);
      const direction = messageElement && detectAuthor(messageElement) === "User"
        ? "input"
        : "output";
      let urlFilename = "";
      try {
        const parsedUrl = new URL(url, location.href);
        urlFilename = parsedUrl.searchParams.get("filename")
          || exportCore?.filenameFromPath(parsedUrl.pathname, "")
          || "";
      } catch {
        urlFilename = "";
      }

      const name = anchor.download
        || anchor.getAttribute("download")
        || anchor.querySelector("[class*='truncate']")?.textContent?.trim()
        || urlFilename
        || anchor.textContent?.trim()
        || `file_${index + 1}`;

      files.set(url, {
        key: `direct:${url}`,
        type: "direct",
        url,
        name,
        mimeType: "",
        size: 0,
        direction,
        messageId: messageElement?.getAttribute("data-message-id") || ""
      });
    });

    const assistantEntityButtons = Array.from(
      document.querySelectorAll('[data-message-author-role="assistant"] button.behavior-btn[aria-label]')
    );
    const knownFileIconRefs = new Set(
      assistantEntityButtons
        .filter(button => looksLikeFilename(decodeDomFilename(button.getAttribute("aria-label"))))
        .map(button => button.querySelector("svg use")?.getAttribute("href") || "")
        .filter(Boolean)
    );

    assistantEntityButtons.forEach((button, index) => {
      const name = decodeDomFilename(button.getAttribute("aria-label"));
      const normalizedName = normalizeFileNameForMatch(name);
      const iconRef = button.querySelector("svg use")?.getAttribute("href") || "";
      if (!looksLikeFilename(name) && (!iconRef || !knownFileIconRefs.has(iconRef))) {
        return;
      }

      const messageElement = button.closest(MESSAGE_NODE_SELECTOR);
      const messageId = messageElement?.getAttribute("data-message-id") || "";
      const key = `dom-output:${messageId || index}:${normalizedName}`;
      if (!files.has(key)) {
        files.set(key, {
          key,
          type: "dom",
          name,
          mimeType: "",
          size: 0,
          direction: "output",
          messageId,
          domElement: button,
          source: "assistant_file_button"
        });
      }
    });

    return Array.from(files.values());
  }

  function decodeDomFilename(value) {
    const name = String(value || "").trim();
    if (!name) return "";
    try {
      return decodeURIComponent(name);
    } catch {
      return name;
    }
  }

  function looksLikeFilename(value) {
    return /\.[^.\s\\/]+(?:\.[^.\s\\/]+)?$/.test(String(value || "").trim());
  }

  function normalizeFileNameForMatch(name) {
    return String(name || "").normalize("NFKC").trim().toLocaleLowerCase();
  }

  function mergeConversationFiles(apiFiles, domFiles) {
    const result = [...apiFiles];

    for (const domFile of domFiles) {
      const normalizedName = normalizeFileNameForMatch(domFile.name);
      let match = result.find(file =>
        file.direction === domFile.direction
        && normalizeFileNameForMatch(file.name) === normalizedName
      );

      if (!match && domFile.messageId) {
        match = result.find(file =>
          file.direction === domFile.direction
          && file.messageId === domFile.messageId
          && /^(?:input|output)_file_\d+(?:\.[a-z0-9]+)?$/i.test(file.name)
          && !file.domElement
        );
        if (match) {
          match.name = domFile.name;
        }
      }

      if (match) {
        if (domFile.url) match.directUrl = domFile.url;
        if (domFile.domElement) match.domElement = domFile.domElement;
        continue;
      }

      if (!result.some(file => file.url && file.url === domFile.url)) {
        result.push(domFile);
      }
    }

    return result;
  }

  function makeUniqueFilename(name, usedNames) {
    const safeName = sanitizeFilenameSegment(name) || "file";
    const dotIndex = safeName.lastIndexOf(".");
    const base = dotIndex > 0 ? safeName.slice(0, dotIndex) : safeName;
    const extension = dotIndex > 0 ? safeName.slice(dotIndex) : "";
    let candidate = safeName;
    let counter = 2;

    while (usedNames.has(candidate.toLocaleLowerCase())) {
      candidate = `${base} (${counter})${extension}`;
      counter += 1;
    }

    usedNames.add(candidate.toLocaleLowerCase());
    return candidate;
  }

  function encodeRelativeMarkdownPath(path) {
    return `./${String(path)
      .split("/")
      .filter(Boolean)
      .map(segment => encodeURIComponent(segment))
      .join("/")}`;
  }

  function prepareSelectedFilePaths(files) {
    const usedNames = {
      input: new Set(),
      output: new Set()
    };

    return files.map(file => {
      const direction = file.direction === "input" ? "input" : "output";
      const localName = makeUniqueFilename(file.name, usedNames[direction]);
      const relativePath = `${direction}/${localName}`;
      return {
        ...file,
        localName,
        relativePath,
        relativeUrl: encodeRelativeMarkdownPath(relativePath),
        downloadPath: relativePath
      };
    });
  }

  function escapeMarkdownLabel(value) {
    return String(value || "").replace(/([\\\[\]])/g, "\\$1");
  }

  function replaceRelativeFileLinks(markdown, files) {
    if (!files.length) {
      return markdown;
    }

    let linkedMarkdown = markdown;
    const nameCounts = new Map();
    files.forEach(file => {
      const name = normalizeFileNameForMatch(file.name);
      nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    });

    for (const file of files) {
      if (file.type === "sandbox" && file.sandboxPath) {
        const sandboxTarget = `sandbox:${file.sandboxPath}`;
        linkedMarkdown = linkedMarkdown.split(sandboxTarget).join(file.relativeUrl);
      }

      if (nameCounts.get(normalizeFileNameForMatch(file.name)) !== 1) {
        continue;
      }

      const label = escapeMarkdownLabel(file.name);
      linkedMarkdown = linkedMarkdown
        .split(`[Attachment: ${file.name}]`)
        .join(`[Attachment: ${label}](${file.relativeUrl})`)
        .split(`[Image: ${file.name}]`)
        .join(`![Image: ${label}](${file.relativeUrl})`)
        .split(`[Audio: ${file.name}]`)
        .join(`[Audio: ${label}](${file.relativeUrl})`);
    }

    return linkedMarkdown;
  }

  function addRelativeFileLinks(markdown, files) {
    if (!files.length) {
      return markdown;
    }

    const linkedMarkdown = replaceRelativeFileLinks(markdown, files);
    const strings = getUiStrings();
    const language = detectLanguage();
    const indexTitle = language === "uk"
      ? "Завантажені файли"
      : language === "ru"
        ? "Скачанные файлы"
        : "Downloaded files";
    const indexLines = [`## ${indexTitle}`];

    for (const direction of ["input", "output"]) {
      const directionFiles = files.filter(file => file.direction === direction);
      if (!directionFiles.length) {
        continue;
      }

      indexLines.push("", `### ${direction === "input" ? strings.input : strings.output}`, "");
      directionFiles.forEach(file => {
        indexLines.push(`- [${escapeMarkdownLabel(file.name)}](${file.relativeUrl})`);
      });
    }

    const firstLineEnd = linkedMarkdown.indexOf("\n");
    if (firstLineEnd === -1) {
      return `${linkedMarkdown}\n\n${indexLines.join("\n")}`;
    }

    return `${linkedMarkdown.slice(0, firstLineEnd)}\n\n${indexLines.join("\n")}\n${linkedMarkdown.slice(firstLineEnd)}`;
  }

  function formatFileSize(size) {
    const bytes = Number(size) || 0;
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getUiStrings() {
    const language = detectLanguage();

    if (language === "uk") {
      return {
        title: "Експорт чату",
        modeTitle: "Що експортувати?",
        modeFullTitle: "Увесь чат",
        modeFilesTitle: "Повідомлення + файли",
        modeSelectedTitle: "Лише повідомлення",
        includeJson: "Додати JSON",
        filesTitle: "Файли",
        selectedMessages: "Вибрано: {selected} із {total}",
        user: "Користувач",
        assistant: "ChatGPT",
        noFiles: "У цьому чаті не знайдено файлів для завантаження",
        input: "Вхідні файли",
        output: "Вихідні файли",
        selectAll: "Вибрати все",
        cancel: "Скасувати",
        download: "Експортувати",
        loading: "Отримую повний чат…",
        loadedMessages: "Отримано повідомлень: {count}",
        downloadingFiles: "Завантажую файли: {current}/{total}",
        started: "Завантаження розпочато",
        failedFiles: "Не вдалося завантажити",
        directionInput: "Вхідний",
        directionOutput: "Вихідний",
        pageFallback: "Файл знайдено на сторінці",
        fallbackNotice: "Частину файлів ChatGPT приховав від API, тому вони завантажуються через кнопки сторінки без ZIP",
        creatingArchive: "Створюю архів: {current}/{total}",
        archiveStarted: "Архів готовий і завантажується",
        archivePartial: "Архів завантажено, але не вдалося додати",
        archiveFailed: "Не вдалося створити архів",
        fullChatError: "Не вдалося отримати повний контекст чату"
      };
    }

    if (language === "ru") {
      return {
        title: "Экспорт чата",
        modeTitle: "Что экспортировать?",
        modeFullTitle: "Весь чат",
        modeFilesTitle: "Сообщения + файлы",
        modeSelectedTitle: "Только сообщения",
        includeJson: "Добавить JSON",
        filesTitle: "Файлы",
        selectedMessages: "Выбрано: {selected} из {total}",
        user: "Пользователь",
        assistant: "ChatGPT",
        noFiles: "В этом чате не найдено файлов для загрузки",
        input: "Входные файлы",
        output: "Выходные файлы",
        selectAll: "Выбрать все",
        cancel: "Отмена",
        download: "Экспортировать",
        loading: "Получаю полный чат…",
        loadedMessages: "Получено сообщений: {count}",
        downloadingFiles: "Скачиваю файлы: {current}/{total}",
        started: "Скачивание началось",
        failedFiles: "Не удалось скачать",
        directionInput: "Входной",
        directionOutput: "Выходной",
        pageFallback: "Файл найден на странице",
        fallbackNotice: "Часть файлов ChatGPT скрыл от API, поэтому они скачиваются через кнопки страницы без ZIP",
        creatingArchive: "Создаю архив: {current}/{total}",
        archiveStarted: "Архив готов и скачивается",
        archivePartial: "Архив скачан, но не удалось добавить",
        archiveFailed: "Не удалось создать архив",
        fullChatError: "Не удалось получить полный контекст чата"
      };
    }

    return {
      title: "Export chat",
      modeTitle: "What should be exported?",
      modeFullTitle: "Entire chat",
      modeFilesTitle: "Messages + files",
      modeSelectedTitle: "Messages only",
      includeJson: "Include JSON",
      filesTitle: "Files",
      selectedMessages: "Selected: {selected} of {total}",
      user: "User",
      assistant: "ChatGPT",
      noFiles: "No downloadable files were found in this chat",
      input: "Input files",
      output: "Output files",
      selectAll: "Select all",
      cancel: "Cancel",
      download: "Export",
      loading: "Loading the full chat…",
      loadedMessages: "Messages loaded: {count}",
      downloadingFiles: "Downloading files: {current}/{total}",
      started: "Downloads started",
      failedFiles: "Failed to download",
      directionInput: "Input",
      directionOutput: "Output",
      pageFallback: "File detected on the page",
      fallbackNotice: "ChatGPT hid some files from the API, so they are downloaded through page buttons without ZIP packaging",
      creatingArchive: "Creating archive: {current}/{total}",
      archiveStarted: "Archive is ready and downloading",
      archivePartial: "Archive downloaded, but these files could not be added",
      archiveFailed: "Unable to create archive",
      fullChatError: "Unable to load the full chat context"
    };
  }

  function showToast(message, isError = false) {
    const existing = document.querySelector(".chatgpt-export-toast");
    existing?.remove();

    const toast = document.createElement("div");
    toast.className = `chatgpt-export-toast${isError ? " is-error" : ""}`;
    toast.setAttribute("role", isError ? "alert" : "status");
    toast.textContent = message;
    document.body.appendChild(toast);

    window.setTimeout(() => toast.remove(), isError ? 8000 : 4000);
  }

  function createProgressToast(message, current = null, total = null) {
    document.querySelector(".chatgpt-export-toast")?.remove();

    const toast = document.createElement("div");
    toast.className = "chatgpt-export-toast chatgpt-export-progress-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");

    const heading = document.createElement("div");
    heading.className = "chatgpt-export-progress-heading";
    const indicator = document.createElement("span");
    indicator.className = "chatgpt-export-progress-indicator";
    indicator.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "chatgpt-export-progress-label";
    const value = document.createElement("span");
    value.className = "chatgpt-export-progress-value";
    heading.append(indicator, label, value);

    const track = document.createElement("div");
    track.className = "chatgpt-export-progress-track";
    const fill = document.createElement("div");
    fill.className = "chatgpt-export-progress-fill";
    track.appendChild(fill);
    toast.append(heading, track);
    document.body.appendChild(toast);

    function update(nextMessage, nextCurrent = null, nextTotal = null) {
      label.textContent = nextMessage;
      const determinate = Number.isFinite(nextCurrent)
        && Number.isFinite(nextTotal)
        && nextTotal > 0;
      toast.classList.toggle("is-indeterminate", !determinate);

      if (determinate) {
        const percent = Math.max(0, Math.min(100, Math.round((nextCurrent / nextTotal) * 100)));
        fill.style.setProperty("--chatgpt-export-progress", `${percent}%`);
        value.textContent = `${percent}%`;
        track.setAttribute("role", "progressbar");
        track.setAttribute("aria-valuemin", "0");
        track.setAttribute("aria-valuemax", "100");
        track.setAttribute("aria-valuenow", String(percent));
      } else {
        fill.style.removeProperty("--chatgpt-export-progress");
        value.textContent = "";
        track.removeAttribute("role");
        track.removeAttribute("aria-valuemin");
        track.removeAttribute("aria-valuemax");
        track.removeAttribute("aria-valuenow");
      }
    }

    update(message, current, total);
    return {
      element: toast,
      update,
      remove: () => toast.remove()
    };
  }

  function showUnifiedExportDialog(messageContexts, files) {
    const strings = getUiStrings();
    const selectableContexts = messageContexts.filter(context => context.selectable);
    document.querySelector(`.${EXPORT_DIALOG_CLASS}`)?.remove();

    return new Promise(resolve => {
      let selectedMode = "full";
      const overlay = document.createElement("div");
      overlay.className = EXPORT_DIALOG_CLASS;

      const dialog = document.createElement("div");
      dialog.className = "chatgpt-export-dialog chatgpt-export-unified-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "chatgpt-export-unified-title");

      const header = document.createElement("div");
      header.className = "chatgpt-export-dialog-header";
      const heading = document.createElement("h2");
      heading.id = "chatgpt-export-unified-title";
      heading.textContent = strings.title;
      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "chatgpt-export-dialog-close";
      closeButton.setAttribute("aria-label", strings.cancel);
      closeButton.textContent = "×";
      header.append(heading, closeButton);

      const toolbar = document.createElement("div");
      toolbar.className = "chatgpt-export-unified-toolbar";
      const viewSwitch = document.createElement("div");
      viewSwitch.className = "chatgpt-export-view-switch";
      viewSwitch.setAttribute("role", "group");
      viewSwitch.setAttribute("aria-label", strings.modeTitle);

      const modes = [
        {
          value: "full",
          title: strings.modeFullTitle,
          icon: '<path d="M4.5 5.75A2.25 2.25 0 0 1 6.75 3.5h6.5a2.25 2.25 0 0 1 2.25 2.25v4.5a2.25 2.25 0 0 1-2.25 2.25H9l-3.8 3v-3.18a2.25 2.25 0 0 1-.7-1.62V5.75Z"/><path d="M7.5 7h5M7.5 9.5h3.5"/>'
        },
        {
          value: "messages",
          title: strings.modeSelectedTitle,
          icon: '<path d="M4 5.5h8M4 9h8M4 12.5h5"/><path d="m12 13.5 1.5 1.5 3-3"/>'
        },
        {
          value: "messages-files",
          title: strings.modeFilesTitle,
          icon: '<path d="M3.5 5.5h7M3.5 9h5"/><path d="M11.5 12.5 15 9a2 2 0 1 1 2.8 2.85l-4.6 4.55a3 3 0 0 1-4.25-4.25l4.25-4.2"/>'
        }
      ];
      const viewButtons = new Map();
      modes.forEach(mode => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chatgpt-export-view-button";
        button.dataset.mode = mode.value;
        button.setAttribute("aria-label", mode.title);
        button.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true">${mode.icon}</svg>`;
        button.addEventListener("click", () => setMode(mode.value));
        attachTooltip(button, mode.title);
        viewButtons.set(mode.value, button);
        viewSwitch.appendChild(button);
      });

      const jsonOption = document.createElement("label");
      jsonOption.className = "chatgpt-export-json-option";
      const jsonCheckbox = document.createElement("input");
      jsonCheckbox.type = "checkbox";
      jsonCheckbox.checked = false;
      const jsonLabel = document.createElement("span");
      jsonLabel.textContent = strings.includeJson;
      jsonOption.append(jsonCheckbox, jsonLabel);
      toolbar.append(viewSwitch, jsonOption);

      const body = document.createElement("div");
      body.className = "chatgpt-export-dialog-body chatgpt-export-unified-body";

      const messageSection = document.createElement("section");
      messageSection.className = "chatgpt-export-message-list chatgpt-export-unified-messages";
      const messageListHeader = document.createElement("label");
      messageListHeader.className = "chatgpt-export-message-list-header";
      const selectAllMessages = document.createElement("input");
      selectAllMessages.type = "checkbox";
      selectAllMessages.checked = true;
      const messageCount = document.createElement("span");
      messageCount.className = "chatgpt-export-message-count";
      messageListHeader.append(selectAllMessages, messageCount);
      messageSection.appendChild(messageListHeader);
      const messageCheckboxes = new Map();
      const fileCheckboxes = new Map();
      const directionSelectors = new Map();
      const assignedFileKeys = new Set();

      function createFileRow(file) {
        const row = document.createElement("div");
        row.className = `chatgpt-export-file-row is-${file.direction}`;
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = true;
        checkbox.setAttribute("aria-label", file.name);
        const details = document.createElement("span");
        details.className = "chatgpt-export-file-details";
        const name = document.createElement("span");
        name.className = "chatgpt-export-file-name";
        name.textContent = file.name;
        details.appendChild(name);

        const metaValues = [formatFileSize(file.size), file.mimeType].filter(Boolean);
        if (file.type === "dom") metaValues.push(strings.pageFallback);
        if (metaValues.length) {
          const meta = document.createElement("span");
          meta.className = "chatgpt-export-file-meta";
          meta.textContent = metaValues.join(" · ");
          details.appendChild(meta);
        }

        const directionSelect = document.createElement("select");
        directionSelect.className = "chatgpt-export-direction-select";
        directionSelect.setAttribute("aria-label", `${file.name}: ${strings.input}/${strings.output}`);
        [
          ["input", strings.directionInput],
          ["output", strings.directionOutput]
        ].forEach(([value, label]) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label;
          directionSelect.appendChild(option);
        });
        directionSelect.value = file.direction;
        directionSelect.addEventListener("click", event => event.stopPropagation());
        directionSelect.addEventListener("change", event => event.stopPropagation());

        row.append(checkbox, details, directionSelect);
        fileCheckboxes.set(file.key, checkbox);
        directionSelectors.set(file.key, directionSelect);
        assignedFileKeys.add(file.key);
        row.addEventListener("click", event => {
          if (event.target === checkbox || directionSelect.contains(event.target)) return;
          checkbox.click();
        });
        return row;
      }

      function createFileCollection(groupFiles, extraClass = "") {
        const collection = document.createElement("div");
        collection.className = `chatgpt-export-message-files${extraClass ? ` ${extraClass}` : ""}`;
        const header = document.createElement("label");
        header.className = "chatgpt-export-message-files-header";
        const groupCheckbox = document.createElement("input");
        groupCheckbox.type = "checkbox";
        groupCheckbox.checked = true;
        const title = document.createElement("span");
        title.textContent = `${strings.filesTitle} (${groupFiles.length})`;
        header.append(groupCheckbox, title);
        collection.appendChild(header);

        const groupCheckboxes = [];
        groupFiles.forEach(file => {
          collection.appendChild(createFileRow(file));
          const checkbox = fileCheckboxes.get(file.key);
          groupCheckboxes.push(checkbox);
          checkbox.addEventListener("change", () => {
            const selected = groupCheckboxes.filter(item => item.checked).length;
            groupCheckbox.checked = selected === groupCheckboxes.length;
            groupCheckbox.indeterminate = selected > 0 && selected < groupCheckboxes.length;
          });
        });
        groupCheckbox.addEventListener("change", () => {
          groupCheckboxes.forEach(checkbox => {
            checkbox.checked = groupCheckbox.checked;
          });
          groupCheckbox.indeterminate = false;
        });
        return collection;
      }

      selectableContexts.forEach(context => {
        const turn = document.createElement("div");
        turn.className = `chatgpt-export-message-turn is-${context.role}`;
        const row = document.createElement("label");
        row.className = `chatgpt-export-message-row is-${context.role}`;
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = true;
        const role = document.createElement("span");
        role.className = `chatgpt-export-message-role is-${context.role}`;
        role.textContent = context.role === "user" ? strings.user : strings.assistant;
        const summary = document.createElement("span");
        summary.className = "chatgpt-export-message-summary";
        summary.textContent = context.summary || context.contentMarkdown;
        const bubble = document.createElement("span");
        bubble.className = "chatgpt-export-message-bubble";
        bubble.append(role, summary);
        row.append(checkbox, bubble);
        turn.appendChild(row);

        const contextIds = new Set([
          context.id,
          ...(context.messageIds || []),
          ...(context.relatedMessageIds || [])
        ].map(String));
        const relatedFiles = files.filter(file =>
          !assignedFileKeys.has(file.key)
          && (file.messageContext?.id === context.id
            || contextIds.has(String(file.messageId || "")))
        );
        if (relatedFiles.length) {
          turn.appendChild(createFileCollection(relatedFiles));
        }

        messageSection.appendChild(turn);
        messageCheckboxes.set(context.id, checkbox);
        checkbox.addEventListener("change", updateState);
      });
      selectAllMessages.addEventListener("change", () => {
        messageCheckboxes.forEach(checkbox => {
          checkbox.checked = selectAllMessages.checked;
        });
        updateState();
      });

      const unmatchedFiles = files.filter(file => !assignedFileKeys.has(file.key));
      if (unmatchedFiles.length) {
        messageSection.appendChild(createFileCollection(unmatchedFiles, "is-unmatched"));
      } else if (!files.length) {
        const emptyFiles = document.createElement("p");
        emptyFiles.className = "chatgpt-export-empty-files";
        emptyFiles.textContent = strings.noFiles;
        messageSection.appendChild(emptyFiles);
      }

      body.appendChild(messageSection);

      const footer = document.createElement("div");
      footer.className = "chatgpt-export-dialog-footer";
      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "chatgpt-export-secondary-button";
      cancelButton.textContent = strings.cancel;
      const downloadButton = document.createElement("button");
      downloadButton.type = "button";
      downloadButton.className = "chatgpt-export-primary-button";
      downloadButton.textContent = strings.download;
      footer.append(cancelButton, downloadButton);

      dialog.append(header, toolbar, body, footer);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      function setMode(mode) {
        selectedMode = mode;
        modes.forEach(item => {
          const button = viewButtons.get(item.value);
          const active = item.value === selectedMode;
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-pressed", String(active));
        });
        messageSection.hidden = selectedMode === "full";
        messageSection.classList.toggle("is-files-view", selectedMode === "messages-files");
        updateState();
      }

      function updateState() {
        const checkedMessages = Array.from(messageCheckboxes.values())
          .filter(checkbox => checkbox.checked).length;
        messageCount.textContent = strings.selectedMessages
          .replace("{selected}", String(checkedMessages))
          .replace("{total}", String(messageCheckboxes.size));
        selectAllMessages.checked = checkedMessages === messageCheckboxes.size;
        selectAllMessages.indeterminate = checkedMessages > 0 && checkedMessages < messageCheckboxes.size;
        downloadButton.disabled = selectedMode !== "full" && checkedMessages === 0;
      }

      const onKeyDown = event => {
        if (event.key === "Escape") finish(null);
      };
      function finish(value) {
        document.removeEventListener("keydown", onKeyDown);
        document.querySelectorAll(".chatgpt-download-tooltip").forEach(tooltip => tooltip.remove());
        overlay.remove();
        resolve(value);
      }

      closeButton.addEventListener("click", () => finish(null));
      cancelButton.addEventListener("click", () => finish(null));
      downloadButton.addEventListener("click", () => {
        const includedMessageIds = selectedMode === "full"
          ? null
          : selectableContexts
              .filter(context => messageCheckboxes.get(context.id)?.checked)
              .flatMap(context => context.messageIds?.length ? context.messageIds : [context.id]);
        const selectedFiles = selectedMode === "messages-files"
          ? files
              .filter(file => fileCheckboxes.get(file.key)?.checked)
              .map(file => ({
                ...file,
                direction: directionSelectors.get(file.key)?.value || file.direction
              }))
          : [];
        finish({
          mode: selectedMode,
          includeJson: jsonCheckbox.checked,
          includedMessageIds,
          selectedFiles
        });
      });
      overlay.addEventListener("click", event => {
        if (event.target === overlay) finish(null);
      });
      document.addEventListener("keydown", onKeyDown);
      setMode("full");
      window.setTimeout(() => downloadButton.focus(), 0);
    });
  }

  function wait(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  async function requestDownloadUrl(url) {
    let lastError = null;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const payload = await fetchJson(url);
        if (payload?.download_url) {
          return payload.download_url;
        }

        const status = String(payload?.status || "").toLowerCase();
        if (status !== "retry") {
          throw new Error(payload?.error_code || "Missing download URL");
        }
      } catch (error) {
        lastError = error;
        if (attempt === 3) {
          break;
        }
      }

      await wait(500 * (attempt + 1));
    }

    throw lastError || new Error("Unable to prepare file download");
  }

  async function resolveFileDownloadUrl(file, conversationId) {
    if (file.directUrl) {
      return file.directUrl;
    }

    if (file.type === "direct" && file.url) {
      return file.url;
    }

    if (!conversationId) {
      throw new Error("Missing conversation ID");
    }

    if (file.type === "sandbox") {
      if (!file.messageId || !file.sandboxPath) {
        throw new Error("Incomplete sandbox file metadata");
      }

      const url = new URL(
        `/backend-api/conversation/${encodeURIComponent(conversationId)}/interpreter/download`,
        location.origin
      );
      url.searchParams.set("message_id", file.messageId);
      url.searchParams.set("sandbox_path", file.sandboxPath);
      url.searchParams.set("download_intent", "true");
      return requestDownloadUrl(url);
    }

    if (file.type === "file" && file.fileId) {
      const normalizedId = file.fileId.replaceAll("#", "*");
      const url = new URL(
        `/backend-api/files/download/${encodeURIComponent(normalizedId)}`,
        location.origin
      );
      url.searchParams.set("conversation_id", conversationId);
      url.searchParams.set("check_context_scopes_for_conversation_id", conversationId);
      url.searchParams.set("download_intent", "true");
      return requestDownloadUrl(url);
    }

    throw new Error("Unsupported file reference");
  }

  function sanitizeDownloadRelativePath(path) {
    const segments = String(path || "")
      .replaceAll("\\", "/")
      .split("/")
      .filter(segment => segment && segment !== "." && segment !== "..")
      .map(segment => sanitizeFilenameSegment(segment))
      .filter(Boolean);
    return segments.join("/") || "download";
  }

  function queueBrowserDownload(url, filename) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: "chat-to-markdown:download-url",
          url,
          filename: sanitizeDownloadRelativePath(filename)
        },
        response => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }
          if (!response?.success) {
            reject(new Error(response?.error || "Browser rejected the download"));
            return;
          }
          resolve(response.downloadId);
        }
      );
    });
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, response => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        if (!response?.success) {
          reject(new Error(response?.error || "Extension request failed"));
          return;
        }
        resolve(response);
      });
    });
  }

  async function queueDomButtonDownload(file) {
    const button = file.domElement;
    if (!(button instanceof HTMLElement) || !button.isConnected) {
      throw new Error("The ChatGPT file button is no longer available");
    }

    const armed = await sendRuntimeMessage({
      type: "chat-to-markdown:arm-page-download",
      filename: sanitizeDownloadRelativePath(file.downloadPath || file.name),
      expectedName: file.name
    });

    button.click();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await wait(250);
      const status = await sendRuntimeMessage({
        type: "chat-to-markdown:page-download-status",
        token: armed.token
      });
      if (status.started) return status.downloadId;
      if (status.expired) break;
    }

    await sendRuntimeMessage({
      type: "chat-to-markdown:disarm-page-download",
      token: armed.token
    });

    throw new Error("ChatGPT did not start the file download");
  }

  async function downloadSelectedFiles(files, conversationId, onProgress) {
    const failures = [];
    let completed = 0;

    for (const file of files) {
      try {
        if (file.type === "dom") {
          await queueDomButtonDownload(file);
          continue;
        }
        const url = await resolveFileDownloadUrl(file, conversationId);
        await queueBrowserDownload(url, file.downloadPath || file.name);
      } catch (error) {
        console.error("chat-to-markdown: failed to download file", file, error);
        failures.push({ file, error });
      } finally {
        completed += 1;
        onProgress?.(completed, files.length);
      }
    }

    return failures;
  }

  function formatArchiveProgress(strings, current, total) {
    return strings.creatingArchive
      .replace("{current}", String(current))
      .replace("{total}", String(total));
  }

  function formatDownloadProgress(strings, current, total) {
    return strings.downloadingFiles
      .replace("{current}", String(current))
      .replace("{total}", String(total));
  }

  async function fetchArchiveFile(file, conversationId) {
    const url = await resolveFileDownloadUrl(file, conversationId);
    const resolvedUrl = new URL(url, location.href);
    const response = await fetch(resolvedUrl.href, {
      credentials: resolvedUrl.origin === location.origin ? "include" : "omit"
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response;
  }

  async function pushResponseToZip(zip, filename, response) {
    const entry = new fflate.ZipPassThrough(sanitizeDownloadRelativePath(filename));
    zip.add(entry);

    if (!response.body?.getReader) {
      entry.push(new Uint8Array(await response.arrayBuffer()), true);
      return;
    }

    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        entry.push(new Uint8Array(0), true);
        return;
      }
      entry.push(value, false);
    }
  }

  function createExportArchive(documents, files, conversationId, onProgress) {
    if (!globalThis.fflate?.Zip || !globalThis.fflate?.ZipPassThrough) {
      return Promise.reject(new Error("ZIP library was not loaded"));
    }

    return new Promise((resolve, reject) => {
      const chunks = [];
      const failures = [];
      let settled = false;
      const finishWithError = error => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const zip = new fflate.Zip((error, data, final) => {
        if (error) {
          finishWithError(error);
          return;
        }
        if (data?.length) {
          chunks.push(data.slice());
        }
        if (final && !settled) {
          settled = true;
          resolve({
            blob: new Blob(chunks, { type: "application/zip" }),
            failures
          });
        }
      });

      (async () => {
        try {
          const total = files.length + documents.length;
          for (let index = 0; index < documents.length; index += 1) {
            const document = documents[index];
            const documentEntry = new fflate.ZipDeflate(
              sanitizeDownloadRelativePath(document.name),
              { level: 6 }
            );
            zip.add(documentEntry);
            documentEntry.push(fflate.strToU8(document.content), true);
            onProgress?.(index + 1, total);
          }

          for (let index = 0; index < files.length; index += 1) {
            const file = files[index];
            try {
              const response = await fetchArchiveFile(file, conversationId);
              await pushResponseToZip(zip, file.downloadPath || file.name, response);
            } catch (error) {
              console.error("chat-to-markdown: failed to add file to archive", file, error);
              failures.push({
                name: file.name,
                path: file.relativePath || file.downloadPath || "",
                sourcePath: file.sandboxPath || file.fileId || "",
                error: error.message
              });
            }
            onProgress?.(documents.length + index + 1, total);
          }

          if (failures.length) {
            const documentNames = new Set(documents.map(document => document.name.toLocaleLowerCase()));
            const errorFilename = documentNames.has("download-errors.json")
              ? "_download-errors.json"
              : "download-errors.json";
            const errorEntry = new fflate.ZipDeflate(errorFilename, { level: 6 });
            zip.add(errorEntry);
            errorEntry.push(fflate.strToU8(`${JSON.stringify({
              schemaVersion: 1,
              message: "Some selected ChatGPT files could not be downloaded",
              failures
            }, null, 2)}\n`), true);
          }

          zip.end();
        } catch (error) {
          zip.terminate();
          finishWithError(error);
        }
      })();
    });
  }

  async function downloadConversation() {
    if (conversationExportInProgress) {
      return;
    }

    conversationExportInProgress = true;
    const strings = getUiStrings();
    let progressToast = null;

    try {
      progressToast = createProgressToast(strings.loading);

      const conversationId = exportCore?.extractConversationId(
        location.href,
        getCanonicalConversationUrl()
      );
      let conversation = null;
      let files = [];
      let messageContexts = [];
      let title = getConversationTitle();
      const navigatorSummaries = collectNavigatorSummaries();

      if (conversationId) {
        if (!exportCore) {
          throw new Error("ChatGPT export helpers were not loaded");
        }

        conversation = await fetchFullConversation(conversationId, messageCount => {
          progressToast?.update(
            strings.loadedMessages.replace("{count}", String(messageCount))
          );
        });
        title = exportCore.getConversationTitle(conversation, title);
        messageContexts = exportCore.buildConversationMessageContexts(
          conversation,
          navigatorSummaries
        );
        files = attachFileMessageContexts(
          mergeConversationFiles(
            exportCore.collectConversationFiles(conversation),
            collectDomFiles()
          ),
          messageContexts
        );
      } else {
        messageContexts = buildDomMessageContexts(navigatorSummaries);
        files = attachFileMessageContexts(collectDomFiles(), messageContexts);
      }

      console.info("[chat-to-markdown] detected conversation files", files.map(file => ({
        name: file.name,
        direction: file.direction,
        type: file.type,
        source: file.source || "unknown",
        messageId: file.messageId || ""
      })));

      progressToast.remove();
      progressToast = null;

      const safeTitle = sanitizeFilenameSegment(title) || "Conversation with ChatGPT";
      const markdownFilename = `${safeTitle}.md`;
      const jsonFilename = `${safeTitle}.json`;
      const exportRequest = await showUnifiedExportDialog(
        messageContexts,
        files
      );
      if (!exportRequest) return;

      const includedMessageIds = exportRequest.includedMessageIds;
      const selectedFiles = exportRequest.selectedFiles;

      const exportOptions = { includedMessageIds };
      const preparedFiles = prepareSelectedFilePaths(selectedFiles);
      const markdown = conversation
        ? exportCore.buildConversationMarkdown(conversation, title, exportOptions)
        : buildDomConversationMarkdown(exportOptions);
      const linkedMarkdown = addRelativeFileLinks(markdown, preparedFiles);
      const documents = [
        { name: markdownFilename, content: linkedMarkdown, type: "markdown" }
      ];
      if (exportRequest.includeJson) {
        const jsonData = conversation
          ? exportCore.buildConversationJsonData(
              conversation,
              title,
              preparedFiles,
              location.href,
              exportOptions
            )
          : buildDomConversationJsonData(title, preparedFiles, exportOptions);
        const conversationJson = stringifyConversationJson(jsonData, preparedFiles);
        documents.push({ name: jsonFilename, content: conversationJson, type: "json" });
      }
      const packageFileCount = preparedFiles.length + documents.length;
      const hasPageFallbackFiles = preparedFiles.some(file => file.type === "dom");

      if (packageFileCount > 2 && !hasPageFallbackFiles) {
        progressToast = createProgressToast(
          formatArchiveProgress(strings, 0, packageFileCount),
          0,
          packageFileCount
        );

        try {
          const archiveResult = await createExportArchive(
            documents,
            preparedFiles,
            conversationId,
            (current, total) => {
              progressToast?.update(
                formatArchiveProgress(strings, current, total),
                current,
                total
              );
            }
          );
          downloadBlob(`${safeTitle}.zip`, archiveResult.blob);
          progressToast.remove();
          progressToast = null;
          if (archiveResult.failures.length) {
            const visibleFailures = archiveResult.failures.slice(0, 3).map(item => item.name);
            const remainingCount = archiveResult.failures.length - visibleFailures.length;
            const suffix = remainingCount > 0 ? ` (+${remainingCount})` : "";
            showToast(`${strings.archivePartial}: ${visibleFailures.join(", ")}${suffix}`, true);
          } else {
            showToast(strings.archiveStarted);
          }
        } catch (error) {
          progressToast?.remove();
          progressToast = null;
          console.error("chat-to-markdown: failed to create export archive", error);
          showToast(`${strings.archiveFailed}: ${error.message}`, true);
        }
      } else {
        documents.forEach(document => {
          if (document.type === "json") {
            downloadAsJson(document.name, document.content);
          } else {
            downloadAsMarkdown(document.name, document.content);
          }
        });
        progressToast = createProgressToast(
          formatDownloadProgress(strings, documents.length, packageFileCount),
          documents.length,
          packageFileCount
        );
        const failures = await downloadSelectedFiles(
          preparedFiles,
          conversationId,
          completed => {
            const current = completed + documents.length;
            progressToast?.update(
              formatDownloadProgress(strings, current, packageFileCount),
              current,
              packageFileCount
            );
          }
        );
        progressToast.remove();
        progressToast = null;

        if (failures.length) {
          const names = failures.map(item => item.file.name).join(", ");
          showToast(`${strings.failedFiles}: ${names}`, true);
        } else if (hasPageFallbackFiles) {
          showToast(strings.fallbackNotice);
        } else {
          showToast(strings.started);
        }
      }
    } catch (error) {
      console.error("chat-to-markdown: failed to export conversation", error);
      showToast(`${strings.fullChatError}: ${error.message}`, true);
      throw error;
    } finally {
      progressToast?.remove();
      conversationExportInProgress = false;
    }
  }

  function detectLanguage() {
    const htmlLang = document.documentElement.lang;
    if (htmlLang && /^uk(-|$)/i.test(htmlLang)) {
      return 'uk';
    }
    if (htmlLang && /^(ru|be)(-|$)/i.test(htmlLang)) {
      return 'ru';
    }

    const sampleButton = document.querySelector('button[aria-label]');
    if (sampleButton) {
      const label = sampleButton.getAttribute('aria-label');
      if (label && /[іІїЇєЄґҐ]/.test(label)) {
        return 'uk';
      }
      if (label && /[а-яА-ЯёЁ]/.test(label)) {
        return 'ru';
      }
    }

    return 'en';
  }

  function createConversationButton() {
    const voiceButtonContainer = document.querySelector('[data-testid="composer-speech-button-container"]');
    const existingButton = document.querySelector(`.${CONVERSATION_BUTTON_CLASS}`);

    if (voiceButtonContainer) {
      const buttonInCorrectPlace = voiceButtonContainer.parentElement?.querySelector(`.${CONVERSATION_BUTTON_CLASS}`);

      if (buttonInCorrectPlace) {
        return;
      }

      if (existingButton) {
        const wrapper = existingButton.closest('[data-chatgpt-download-button="true"]');
        if (wrapper && wrapper.parentNode) {
          wrapper.parentNode.removeChild(wrapper);
          console.info("[chat-to-markdown] Removed conversation button from fallback location");
        }
      }
    } else if (existingButton) {
      return;
    }

    const lang = detectLanguage();
    const tooltipText = lang === 'uk'
      ? 'Завантажити чат і файли'
      : lang === 'ru'
        ? 'Скачать чат и файлы'
        : 'Download chat and files';
    const ariaLabel = tooltipText;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "composer-btn";
    button.classList.add(CONVERSATION_BUTTON_CLASS);
    button.setAttribute("aria-label", ariaLabel);
    button.setAttribute("aria-pressed", "false");
    button.innerHTML = `
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M10 2.5a.75.75 0 0 1 .75.75v8.01l2.2-2.19a.75.75 0 1 1 1.06 1.06l-3.53 3.53a.75.75 0 0 1-1.06 0l-3.53-3.53a.75.75 0 0 1 1.06-1.06l2.2 2.19V3.25A.75.75 0 0 1 10 2.5Zm-5.75 11.5a.75.75 0 0 1 .75-.75h10a.75.75 0 0 1 0 1.5h-10a.75.75 0 0 1-.75-.75Zm1.5 3a.75.75 0 0 1 .75-.75h7a.75.75 0 0 1 0 1.5h-7a.75.75 0 0 1-.75-.75Z"></path>
      </svg>
    `;
    const convoIcon = button.querySelector("svg");
    if (convoIcon) {
      convoIcon.setAttribute("width", "20");
      convoIcon.setAttribute("height", "20");
    }

    attachTooltip(button, tooltipText);

    button.addEventListener("click", event => {
      event.stopPropagation();
      event.preventDefault();
      downloadConversation().catch(error => {
        console.error("chat-to-markdown: failed to export conversation", error);
      });
    });

    if (voiceButtonContainer) {
      const wrapper = document.createElement("span");
      wrapper.className = "";
      wrapper.setAttribute("data-state", "closed");
      wrapper.setAttribute("data-chatgpt-download-button", "true");
      wrapper.appendChild(button);
      voiceButtonContainer.insertAdjacentElement("beforebegin", wrapper);
      console.info("[chat-to-markdown] Conversation button inserted (before voice button)");
      return;
    }

    const headerActions = document.querySelector('#conversation-header-actions');
    if (headerActions) {
      const wrapper = document.createElement("div");
      wrapper.className = "flex items-center";
      wrapper.setAttribute("data-chatgpt-download-button", "true");
      const innerSpan = document.createElement("span");
      innerSpan.className = "";
      innerSpan.setAttribute("data-state", "closed");
      innerSpan.appendChild(button);
      wrapper.appendChild(innerSpan);
      headerActions.appendChild(wrapper);
      console.info("[chat-to-markdown] Conversation button inserted (fallback path - header)");
      return;
    }

    console.warn("[chat-to-markdown] No suitable container found for conversation button");
  }

  function enhancePage() {
    indexMessages();
    bindMessageActions();
    createConversationButton();
  }

  function observeMessages() {
    if (window.__chatgptDownloaderObserver || !document.body) {
      return;
    }

    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (!(node instanceof Element)) {
            return;
          }

          if (node.matches?.('[data-message-author-role]')) {
            bindMessageActions();
            ensureButtonsForMessage(node);
          }

          node.querySelectorAll?.('[data-message-author-role]').forEach(message => {
            bindMessageActions();
            ensureButtonsForMessage(message);
          });

          const copyButtons = findCopyButtons(node);
          copyButtons.forEach(processCopyButton);
        });
      });
      createConversationButton();
    });

    observer.observe(document.body, { childList: true, subtree: true });
    window.__chatgptDownloaderObserver = observer;
  }

  function ensureContentStyles() {
    try {
      chrome.runtime.sendMessage(
        { type: "chat-to-markdown:ensure-styles" },
        response => {
          const error = chrome.runtime.lastError;
          if (error || !response?.success) {
            console.warn(
              "[chat-to-markdown] Failed to re-inject content styles",
              error?.message || response?.error || "unknown error"
            );
          }
        }
      );
    } catch (error) {
      console.warn("[chat-to-markdown] Failed to request content styles", error);
    }
  }

  function init() {
    ensureContentStyles();
    enhancePage();
    observeMessages();
  }

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || !message.type) {
        return false;
      }

      if (message.type === "chatgpt-downloader:download-conversation") {
        console.info("[chat-to-markdown] Received request to download conversation");
        downloadConversation()
          .then(() => sendResponse({ success: true }))
          .catch(error => {
            console.error("chat-to-markdown: failed to export conversation", error);
            sendResponse({ success: false, error: error.message });
          });
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
