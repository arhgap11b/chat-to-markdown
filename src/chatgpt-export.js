(function (root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.ChatToMarkdownExport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FILE_POINTER_PREFIX_PATTERN = /^(?:file-service|sediment):\/\//i;
  const FILE_POINTER_PATTERN = /(?:file-service|sediment):\/\/([^\s"'<>\]\[{}]+)/gi;
  const SANDBOX_PREFIX = "sandbox:";
  const RAW_SANDBOX_PATTERN = /sandbox:(\/mnt\/data\/[^\s"'<>\]\[{}]+)/gi;
  const DIRECT_FILE_URL_PATTERN = /^(?:blob:|https?:\/\/[^/]*oaiusercontent\.com\/|https?:\/\/[^/]+\/backend-api\/(?:files|estuary|conversation)\/)/i;

  function extractConversationId(url, canonicalUrl) {
    for (const candidate of [url, canonicalUrl]) {
      if (!candidate || typeof candidate !== "string") {
        continue;
      }

      const match = candidate.match(/\/c\/([0-9a-f]{8}-[0-9a-f-]{27,})/i);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  function stripFileServicePrefix(value) {
    if (typeof value !== "string") {
      return "";
    }
    return value.replace(FILE_POINTER_PREFIX_PATTERN, "");
  }

  function getMessageNodes(conversation) {
    const mapping = conversation && conversation.mapping;
    if (!mapping || typeof mapping !== "object") {
      const messages = Array.isArray(conversation && conversation.messages)
        ? conversation.messages
        : [];
      return messages.map(message => ({ id: message && message.id, message }));
    }

    const nodes = [];
    const visited = new Set();
    let nodeId = conversation.current_node;

    while (nodeId && mapping[nodeId] && !visited.has(nodeId)) {
      visited.add(nodeId);
      const node = mapping[nodeId];
      nodes.push(node);
      nodeId = node.parent;
    }

    if (nodes.length) {
      return nodes.reverse();
    }

    return Object.values(mapping)
      .filter(node => node && node.message)
      .sort((left, right) => {
        const leftTime = Number(left.message && left.message.create_time) || 0;
        const rightTime = Number(right.message && right.message.create_time) || 0;
        return leftTime - rightTime;
      });
  }

  function getActiveMessages(conversation) {
    return getMessageNodes(conversation)
      .map(node => node && node.message)
      .filter(Boolean);
  }

  function isVisibleConversationMessage(message) {
    if (!message || message.metadata?.is_visually_hidden_from_conversation) {
      return false;
    }

    const role = message.author && message.author.role;
    if (role === "user") {
      return true;
    }

    if (role !== "assistant") {
      return false;
    }

    return !message.recipient || message.recipient === "all";
  }

  function getAttachmentMap(message) {
    const result = new Map();
    const attachments = message && message.metadata && message.metadata.attachments;

    if (!Array.isArray(attachments)) {
      return result;
    }

    for (const attachment of attachments) {
      const id = stripFileServicePrefix(attachment && (attachment.id || attachment.file_id));
      if (id) {
        result.set(id, attachment);
      }
    }

    return result;
  }

  function cleanInternalMarkers(text) {
    return String(text || "")
      .replace(/\uE200(?:cite|filecite|turn\d+\w*)?\uE202[^\uE201]*\uE201/g, "")
      .replace(/\uE200[^\uE201]*\uE201/g, "")
      .replace(/\r\n/g, "\n")
      .trim();
  }

  function removeFileMarkdownLinks(value) {
    const text = String(value || "");
    const pattern = /!?\[[^\]]*\]\(\s*<?(?:sandbox:|file-service:|sediment:)/gi;
    let cursor = 0;
    let output = "";
    let match;

    while ((match = pattern.exec(text))) {
      output += text.slice(cursor, match.index);
      let depth = 1;
      let end = pattern.lastIndex;
      for (; end < text.length; end += 1) {
        if (text[end] === "(") depth += 1;
        if (text[end] === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (depth !== 0) {
        output += text.slice(match.index);
        return output;
      }
      output += " ";
      cursor = end + 1;
      pattern.lastIndex = cursor;
    }

    return `${output}${text.slice(cursor)}`;
  }

  function plainTextForSummary(markdown) {
    return removeFileMarkdownLinks(markdown)
      .replace(/```[\s\S]*?```/g, " [code] ")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\[(?:Attachment|Image|Audio):[^\]]+\]/gi, " ")
      .replace(/(?:sandbox:|file-service:|sediment:)\S+/gi, " ")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+[.)]\s+/gm, "")
      .replace(/[>*_~|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function clipSummary(value, maxLength) {
    const text = String(value || "").trim();
    if (text.length <= maxLength) return text;
    const clipped = text.slice(0, Math.max(1, maxLength - 1)).replace(/\s+\S*$/, "").trim();
    return `${clipped || text.slice(0, maxLength - 1)}…`;
  }

  function summarizeMessageText(markdown, role = "user") {
    const text = plainTextForSummary(markdown);
    if (!text) return "";
    if (text.length <= 170) return text;

    const sentences = (text.match(/[^.!?…]+(?:[.!?…]+|$)/g) || [text])
      .map(sentence => sentence.trim())
      .filter(Boolean);
    if (role === "user") {
      return clipSummary(sentences.slice(0, 2).join(" ") || text, 170);
    }

    const first = clipSummary(sentences[0] || text, 105);
    const lastCandidate = sentences.at(-1) || "";
    const last = lastCandidate && lastCandidate !== sentences[0]
      ? clipSummary(lastCandidate, 70)
      : "";
    return last ? `${first} … ${last}` : clipSummary(text, 170);
  }

  function buildConversationMessageContexts(conversation, navigatorSummaries = []) {
    const contexts = [];
    let visiblePosition = 0;
    let promptIndex = -1;
    let currentPromptSummary = "";
    let currentPromptNumber = 0;
    let lastVisibleContext = null;

    for (const message of getActiveMessages(conversation)) {
      const role = String(message?.author?.role || "unknown");
      const contentMarkdown = messageToMarkdown(message);
      const selectable = isVisibleConversationMessage(message) && Boolean(contentMarkdown);

      if (selectable && role === "user") {
        promptIndex += 1;
        visiblePosition += 1;
        const nativeSummary = String(navigatorSummaries[promptIndex] || "").trim();
        currentPromptSummary = nativeSummary || summarizeMessageText(contentMarkdown, "user");
        currentPromptNumber = promptIndex + 1;
        lastVisibleContext = {
          id: String(message.id || ""),
          role,
          author: "User",
          position: visiblePosition,
          promptNumber: currentPromptNumber,
          summary: currentPromptSummary,
          promptSummary: currentPromptSummary,
          contentMarkdown,
          selectable: true
        };
        contexts.push(lastVisibleContext);
        continue;
      }

      if (selectable && role === "assistant") {
        visiblePosition += 1;
        lastVisibleContext = {
          id: String(message.id || ""),
          role,
          author: "ChatGPT",
          position: visiblePosition,
          promptNumber: currentPromptNumber,
          summary: summarizeMessageText(contentMarkdown, "assistant"),
          promptSummary: currentPromptSummary,
          contentMarkdown,
          selectable: true
        };
        contexts.push(lastVisibleContext);
        continue;
      }

      if (message?.id && lastVisibleContext) {
        const outputLike = role === "assistant" || role === "tool";
        contexts.push({
          ...lastVisibleContext,
          id: String(message.id),
          role: outputLike ? "assistant" : lastVisibleContext.role,
          author: outputLike ? "ChatGPT" : lastVisibleContext.author,
          summary: outputLike && contentMarkdown
            ? summarizeMessageText(contentMarkdown, "assistant")
            : lastVisibleContext.summary,
          contentMarkdown: contentMarkdown || lastVisibleContext.contentMarkdown,
          sourceRole: role,
          selectable: false
        });
      }
    }

    contexts.forEach((context, index) => {
      if (context.selectable || !["assistant", "tool"].includes(context.sourceRole)) return;
      for (let nextIndex = index + 1; nextIndex < contexts.length; nextIndex += 1) {
        const candidate = contexts[nextIndex];
        if (!candidate.selectable) continue;
        if (candidate.role === "user") break;
        if (candidate.role === "assistant") {
          context.summary = candidate.summary;
          context.promptSummary = candidate.promptSummary;
          context.promptNumber = candidate.promptNumber;
          break;
        }
      }
    });

    contexts.forEach((context, index) => {
      if (context.role !== "assistant" || context.summary) return;
      for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
        const candidate = contexts[previousIndex];
        if (candidate.promptNumber !== context.promptNumber) break;
        if (candidate.role === "assistant" && candidate.summary) {
          context.summary = candidate.summary;
          return;
        }
      }
      for (let nextIndex = index + 1; nextIndex < contexts.length; nextIndex += 1) {
        const candidate = contexts[nextIndex];
        if (candidate.promptNumber !== context.promptNumber) break;
        if (candidate.role === "assistant" && candidate.summary) {
          context.summary = candidate.summary;
          return;
        }
      }
    });

    const groups = [];
    contexts.filter(context => context.selectable).forEach(context => {
      const previous = groups.at(-1);
      if (context.role === "assistant"
          && previous?.role === "assistant"
          && previous.promptNumber === context.promptNumber) {
        previous.messageIds.push(context.id);
        previous.contentMarkdown = [previous.contentMarkdown, context.contentMarkdown]
          .filter(Boolean)
          .join("\n\n");
        const combinedSummary = summarizeMessageText(previous.contentMarkdown, "assistant");
        if (combinedSummary) previous.summary = combinedSummary;
        return;
      }

      groups.push({
        ...context,
        messageIds: [context.id],
        relatedMessageIds: []
      });
    });

    contexts.filter(context => !context.selectable).forEach(context => {
      const candidates = groups.filter(group =>
        group.promptNumber === context.promptNumber
        && group.role === context.role
      );
      const target = candidates.at(-1)
        || groups.filter(group => group.promptNumber === context.promptNumber).at(-1);
      if (target) target.relatedMessageIds.push(context.id);
    });

    return groups;
  }

  function partToMarkdown(part, attachmentMap, imageIndex) {
    if (typeof part === "string") {
      return cleanInternalMarkers(part);
    }

    if (!part || typeof part !== "object") {
      return "";
    }

    if (typeof part.text === "string") {
      return cleanInternalMarkers(part.text);
    }

    const pointer = stripFileServicePrefix(
      part.asset_pointer || part.file_id || part.id || ""
    );
    const attachment = pointer ? attachmentMap.get(pointer) : null;
    const contentType = String(part.content_type || "");

    if (contentType.includes("image") || part.asset_pointer) {
      const name = attachment?.name || part.name || `Image ${imageIndex}`;
      return `[Image: ${name}]`;
    }

    if (contentType.includes("audio")) {
      const name = attachment?.name || part.name || `Audio ${imageIndex}`;
      return `[Audio: ${name}]`;
    }

    return "";
  }

  function messageToMarkdown(message) {
    const content = message && message.content;
    if (!content) {
      return "";
    }

    const attachmentMap = getAttachmentMap(message);
    const parts = Array.isArray(content.parts)
      ? content.parts
      : typeof content.text === "string"
        ? [content.text]
        : [];

    const converted = parts
      .map((part, index) => partToMarkdown(part, attachmentMap, index + 1))
      .filter(Boolean);

    const referencedFileIds = new Set(
      parts
        .filter(part => part && typeof part === "object")
        .map(part => stripFileServicePrefix(part.asset_pointer || part.file_id || part.id || ""))
        .filter(Boolean)
    );
    const attachmentLabels = Array.from(attachmentMap.entries())
      .filter(([fileId]) => !referencedFileIds.has(fileId))
      .map(([, attachment]) => `[Attachment: ${attachment.name || attachment.file_name || "file"}]`);

    converted.unshift(...attachmentLabels);

    if (!converted.length && typeof content.result === "string") {
      converted.push(cleanInternalMarkers(content.result));
    }

    return converted.join("\n\n").trim();
  }

  function isDeepResearchMessage(message, report) {
    const identifiers = [
      message?.id,
      message?.recipient,
      message?.content?.content_type,
      message?.metadata?.request_id,
      message?.metadata?.command,
      message?.metadata?.model_slug
    ].map(value => String(value || "")).join(" ");
    if (/deep[-_ ]?research|request-WEB/i.test(identifiers)) return true;

    const reportToken = String(report?.turnId || "").match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0];
    if (!reportToken) return false;
    try {
      return JSON.stringify({
        id: message?.id,
        metadata: message?.metadata,
        contentType: message?.content?.content_type
      }).includes(reportToken);
    } catch {
      return false;
    }
  }

  function appendSyntheticConversationMessage(conversation, report, index) {
    const id = String(report.id || `deep-research-${Date.now()}-${index + 1}`);
    const message = {
      id,
      author: { role: "assistant", name: "ChatGPT" },
      content: { content_type: "text", parts: [report.markdown] },
      create_time: null,
      update_time: null,
      recipient: "all",
      metadata: { chat_to_markdown_deep_research: true }
    };

    if (Array.isArray(conversation?.messages)) {
      conversation.messages.push(message);
      return message;
    }

    if (conversation?.mapping && typeof conversation.mapping === "object") {
      const parent = conversation.current_node || null;
      conversation.mapping[id] = { id, parent, children: [], message };
      if (parent && conversation.mapping[parent]) {
        const children = conversation.mapping[parent].children;
        if (Array.isArray(children) && !children.includes(id)) children.push(id);
      }
      conversation.current_node = id;
      return message;
    }

    conversation.messages = [message];
    return message;
  }

  function mergeDeepResearchReports(conversation, reports = []) {
    if (!conversation || !Array.isArray(reports) || !reports.length) return conversation;
    const messages = getActiveMessages(conversation);
    const assistantGroups = new Map();
    let promptNumber = 0;

    messages.forEach(message => {
      const role = String(message?.author?.role || "");
      if (role === "user") {
        promptNumber += 1;
        return;
      }
      if (role !== "assistant") return;
      const group = assistantGroups.get(promptNumber) || [];
      group.push(message);
      assistantGroups.set(promptNumber, group);
    });

    reports.forEach((report, index) => {
      const markdown = String(report?.markdown || "").trim();
      if (!markdown) return;
      const candidates = assistantGroups.get(Number(report.promptNumber) || 0) || [];
      const target = [...candidates].reverse().find(message => isDeepResearchMessage(message, report))
        || [...candidates].reverse().find(message => !messageToMarkdown(message))
        || candidates.at(-1)
        || null;

      if (!target) {
        appendSyntheticConversationMessage(conversation, report, index);
        return;
      }

      const existing = messageToMarkdown(target);
      const reportPrefix = markdown.replace(/\s+/g, " ").slice(0, 180);
      const existingNormalized = existing.replace(/\s+/g, " ");
      if (!reportPrefix || !existingNormalized.includes(reportPrefix)) {
        target.content = { content_type: "text", parts: [markdown] };
      }
      target.recipient = "all";
      target.metadata = {
        ...(target.metadata || {}),
        is_visually_hidden_from_conversation: false,
        chat_to_markdown_deep_research: true
      };
    });
    return conversation;
  }

  function getConversationTitle(conversation, fallbackTitle) {
    const title = conversation && typeof conversation.title === "string"
      ? conversation.title.trim()
      : "";
    return title || String(fallbackTitle || "Conversation with ChatGPT").trim();
  }

  function buildConversationMarkdown(conversation, fallbackTitle, options = {}) {
    const includedMessageIds = options.includedMessageIds
      ? new Set(options.includedMessageIds)
      : null;
    const messages = [];

    for (const message of getActiveMessages(conversation)) {
      if (!isVisibleConversationMessage(message)) continue;
      const markdown = messageToMarkdown(message);
      if (!markdown) continue;
      messages.push({
        id: String(message.id || ""),
        role: message.author?.role === "user" ? "user" : "assistant",
        author: message.author?.role === "user" ? "User" : "ChatGPT",
        markdown
      });
    }

    if (!messages.length) {
      throw new Error("Unable to find any conversation content to download");
    }

    const title = getConversationTitle(conversation, fallbackTitle).replace(/[\r\n]+/g, " ");
    const groupedMessages = [];
    messages.forEach(item => {
      const previous = groupedMessages.at(-1);
      if (item.role === "assistant" && previous?.role === "assistant") {
        previous.markdown = `${previous.markdown}\n\n${item.markdown}`;
        previous.messageIds.push(item.id);
      } else {
        groupedMessages.push({ ...item, messageIds: [item.id] });
      }
    });
    const parts = groupedMessages
      .filter(item => !includedMessageIds
        || item.messageIds.some(id => includedMessageIds.has(id)))
      .map(item => `**${item.author}**:\n\n${item.markdown}`);
    if (!parts.length) {
      throw new Error("Unable to find any conversation content to download");
    }
    return `# ${title}\n\n${parts.join("\n\n---\n\n")}`.trim();
  }

  function toIsoTimestamp(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return null;
    }

    const milliseconds = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function serializeExportFile(file) {
    return {
      name: String(file?.localName || file?.name || "file"),
      direction: file?.direction === "input" ? "input" : "output",
      path: String(file?.relativePath || ""),
      link: String(file?.relativeUrl || ""),
      messageId: String(file?.messageId || ""),
      mimeType: String(file?.mimeType || ""),
      size: Number(file?.size) || 0,
      source: String(file?.source || file?.type || "unknown")
    };
  }

  function buildConversationJsonData(
    conversation,
    fallbackTitle,
    files = [],
    sourceUrl = "",
    options = {}
  ) {
    const includedMessageIds = options.includedMessageIds
      ? new Set(options.includedMessageIds)
      : null;
    const exportedFiles = files.map(serializeExportFile);
    const filesByMessage = new Map();

    exportedFiles.forEach(file => {
      if (!file.messageId) return;
      const messageFiles = filesByMessage.get(file.messageId) || [];
      messageFiles.push(file);
      filesByMessage.set(file.messageId, messageFiles);
    });

    const messages = [];
    for (const node of getMessageNodes(conversation)) {
      const message = node?.message;
      if (!isVisibleConversationMessage(message)) {
        continue;
      }
      if (includedMessageIds && !includedMessageIds.has(String(message.id || node.id || ""))) {
        continue;
      }

      const contentMarkdown = messageToMarkdown(message);
      if (!contentMarkdown) {
        continue;
      }

      const role = String(message.author?.role || "unknown");
      messages.push({
        position: messages.length + 1,
        id: String(message.id || node.id || ""),
        parentId: String(node.parent || message.parent_id || message.parentId || ""),
        author: {
          role,
          label: role === "user" ? "User" : role === "assistant" ? "ChatGPT" : role,
          name: String(message.author?.name || "")
        },
        createdAt: toIsoTimestamp(message.create_time),
        updatedAt: toIsoTimestamp(message.update_time),
        recipient: String(message.recipient || "all"),
        contentType: String(message.content?.content_type || "text"),
        contentMarkdown,
        files: filesByMessage.get(String(message.id || node.id || "")) || []
      });
    }

    return {
      schemaVersion: 1,
      conversation: {
        id: String(conversation?.id || conversation?.conversation_id || ""),
        title: getConversationTitle(conversation, fallbackTitle),
        currentNode: String(conversation?.current_node || ""),
        sourceUrl: String(sourceUrl || ""),
        exportedAt: new Date().toISOString()
      },
      messages,
      files: exportedFiles
    };
  }

  function filenameFromPath(path, fallback) {
    const cleanPath = String(path || "").split(/[?#]/, 1)[0];
    const lastSegment = cleanPath.split("/").filter(Boolean).pop();

    if (!lastSegment) {
      return fallback;
    }

    try {
      return decodeURIComponent(lastSegment);
    } catch {
      return lastSegment;
    }
  }

  function getMessageDirection(message) {
    const role = message?.author?.role;
    if (role === "user") return "input";
    if (role === "assistant" || role === "tool") return "output";
    return null;
  }

  function firstString(object, keys) {
    for (const key of keys) {
      if (typeof object?.[key] === "string" && object[key].trim()) {
        return object[key].trim();
      }
    }
    return "";
  }

  function decodeFileName(value) {
    const name = String(value || "").trim();
    if (!name) return "";
    try {
      return decodeURIComponent(name);
    } catch {
      return name;
    }
  }

  function extensionFromMimeType(mimeType) {
    const normalized = String(mimeType || "").split(";", 1)[0].toLowerCase();
    const known = {
      "application/pdf": ".pdf",
      "application/json": ".json",
      "application/zip": ".zip",
      "application/gzip": ".gz",
      "application/x-tar": ".tar",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
      "text/csv": ".csv",
      "text/markdown": ".md",
      "text/plain": ".txt",
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
      "image/gif": ".gif",
      "image/svg+xml": ".svg",
      "audio/mpeg": ".mp3",
      "audio/wav": ".wav",
      "video/mp4": ".mp4"
    };
    return known[normalized] || "";
  }

  function candidateName(object, fallback) {
    const rawName = firstString(object, [
      "file_name",
      "filename",
      "name",
      "display_name",
      "displayName",
      "title"
    ]);
    if (rawName) return decodeFileName(rawName);

    const url = firstString(object, ["download_url", "downloadUrl", "url", "href"]);
    if (url) {
      try {
        const parsed = new URL(url, "https://chatgpt.com");
        const fromQuery = parsed.searchParams.get("filename") || parsed.searchParams.get("file_name");
        if (fromQuery) return decodeFileName(fromQuery);
        const fromPath = filenameFromPath(parsed.pathname, "");
        if (fromPath && !/^file[-_][a-z0-9]+$/i.test(fromPath)) return fromPath;
      } catch {
        // Keep the fallback below.
      }
    }

    const mimeType = firstString(object, ["mime_type", "mimeType", "content_type", "contentType"]);
    return `${fallback}${extensionFromMimeType(mimeType)}`;
  }

  function fileIdFromValue(value) {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (FILE_POINTER_PREFIX_PATTERN.test(trimmed)) {
      return stripFileServicePrefix(trimmed);
    }
    return /^file[-_][a-z0-9][a-z0-9._#*-]*$/i.test(trimmed) ? trimmed : "";
  }

  function cleanSandboxPath(value) {
    let path = String(value || "").trim();
    if (path.startsWith(SANDBOX_PREFIX)) {
      path = path.slice(SANDBOX_PREFIX.length);
    }
    if (!path.startsWith("/mnt/data/")) return "";

    path = path.replace(/[.,;:!?]+$/g, "");
    while (path.endsWith(")")) {
      const openCount = (path.match(/\(/g) || []).length;
      const closeCount = (path.match(/\)/g) || []).length;
      if (closeCount <= openCount) break;
      path = path.slice(0, -1);
    }
    return path;
  }

  function directionForContext(messageDirection, path, kind) {
    if (kind === "sandbox") return "output";
    const context = path.join(".").toLowerCase();
    if (/citations?|file_search|uploaded_sources?/.test(context)) return "input";
    if (/dragonfruit|generated|downloads?|outputs?|artifacts?/.test(context)) return "output";
    return messageDirection;
  }

  function walkNestedValues(value, visitor, path = [], seen = new Set()) {
    if (value == null) return;
    if (typeof value === "string") {
      visitor(value, path, null);
      return;
    }
    if (typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    visitor(value, path, value);

    if (Array.isArray(value)) {
      value.forEach((item, index) => walkNestedValues(item, visitor, [...path, String(index)], seen));
      return;
    }
    Object.entries(value).forEach(([key, item]) => {
      walkNestedValues(item, visitor, [...path, key], seen);
    });
  }

  function collectNestedMessageFiles(message, messageDirection, addFile) {
    let genericIndex = 0;

    walkNestedValues(message, (value, path, object) => {
      if (typeof value === "string") {
        for (const match of value.matchAll(FILE_POINTER_PATTERN)) {
          const fileId = fileIdFromValue(match[0]);
          if (!fileId) continue;
          genericIndex += 1;
          const direction = directionForContext(messageDirection, path, "file");
          if (!direction) continue;
          addFile({
            key: `file:${fileId}`,
            type: "file",
            fileId,
            name: `${direction}_file_${genericIndex}`,
            mimeType: "",
            size: 0,
            direction,
            messageId: message.id || "",
            priority: 30,
            source: "nested_pointer"
          });
        }

        for (const match of value.matchAll(RAW_SANDBOX_PATTERN)) {
          const sandboxPath = cleanSandboxPath(match[1]);
          if (!sandboxPath) continue;
          addFile({
            key: `sandbox:${message.id || "unknown"}:${sandboxPath}`,
            type: "sandbox",
            sandboxPath,
            name: filenameFromPath(sandboxPath, `output_file_${genericIndex + 1}`),
            mimeType: "",
            size: 0,
            direction: "output",
            messageId: message.id || "",
            priority: 110,
            source: "sandbox_text"
          });
        }
        return;
      }

      if (!object || Array.isArray(object)) return;
      const context = path.join(".").toLowerCase();
      const mimeType = firstString(object, ["mime_type", "mimeType"]);
      const size = Number(object.size || object.size_bytes || object.file_size || object.byte_size) || 0;
      const pointer = firstString(object, ["asset_pointer", "assetPointer", "file_pointer", "filePointer"]);
      const explicitFileId = firstString(object, ["file_id", "fileId"]);
      const contextualId = /file|attachment|asset|citation|download|artifact|image|audio|video/.test(context)
        ? firstString(object, ["id"])
        : "";
      const fileId = fileIdFromValue(pointer || explicitFileId || contextualId);
      const rawSandboxPath = firstString(object, ["sandbox_path", "sandboxPath", "filepath", "file_path"]);
      const sandboxPath = cleanSandboxPath(rawSandboxPath);
      const directUrl = firstString(object, ["download_url", "downloadUrl", "url", "href"]);
      const isFileContext = Boolean(
        fileId
        && (
          pointer
          || explicitFileId
          || mimeType
          || /file|attachment|asset|citation|download|artifact|image|audio|video/.test(context)
        )
      );

      if (sandboxPath) {
        addFile({
          key: `sandbox:${message.id || "unknown"}:${sandboxPath}`,
          type: "sandbox",
          sandboxPath,
          name: candidateName(object, filenameFromPath(sandboxPath, `output_file_${genericIndex + 1}`)),
          mimeType,
          size,
          direction: "output",
          messageId: message.id || "",
          priority: 115,
          source: "nested_sandbox"
        });
      } else if (isFileContext) {
        genericIndex += 1;
        const direction = directionForContext(messageDirection, path, "file");
        if (!direction) return;
        addFile({
          key: `file:${fileId}`,
          type: "file",
          fileId,
          name: candidateName(object, `${direction}_file_${genericIndex}`),
          mimeType,
          size,
          direction,
          messageId: message.id || "",
          directUrl: DIRECT_FILE_URL_PATTERN.test(directUrl) ? directUrl : "",
          priority: /citations?/.test(context) ? 85 : 60,
          source: "nested_file"
        });
      } else if (DIRECT_FILE_URL_PATTERN.test(directUrl)) {
        genericIndex += 1;
        const direction = directionForContext(messageDirection, path, "direct");
        if (!direction) return;
        addFile({
          key: `direct:${directUrl}`,
          type: "direct",
          url: directUrl,
          name: candidateName(object, `${direction}_file_${genericIndex}`),
          mimeType,
          size,
          direction,
          messageId: message.id || "",
          priority: 50,
          source: "nested_url"
        });
      }
    });
  }

  function collectConversationFiles(conversation) {
    const files = new Map();
    const messages = getActiveMessages(conversation);

    function addFile(file) {
      if (!file || !file.key || !file.name) {
        return;
      }

      const existing = files.get(file.key);
      if (!existing) {
        files.set(file.key, file);
        return;
      }

      const existingPriority = Number(existing.priority) || 0;
      const incomingPriority = Number(file.priority) || 0;
      if (incomingPriority > existingPriority) {
        files.set(file.key, {
          ...existing,
          ...file,
          directUrl: file.directUrl || existing.directUrl || ""
        });
        return;
      }

      if (!existing.directUrl && file.directUrl) existing.directUrl = file.directUrl;
      if (!existing.mimeType && file.mimeType) existing.mimeType = file.mimeType;
      if (!existing.size && file.size) existing.size = file.size;
      if (/^(?:input|output)_file_\d+(?:\.[a-z0-9]+)?$/i.test(existing.name)
          && !/^(?:input|output)_file_\d+(?:\.[a-z0-9]+)?$/i.test(file.name)) {
        existing.name = file.name;
      }
    }

    for (const message of messages) {
      if (!message) {
        continue;
      }

      const direction = getMessageDirection(message);
      if (!direction) {
        continue;
      }
      const metadata = message.metadata || {};
      const attachments = Array.isArray(metadata.attachments)
        ? metadata.attachments
        : [];

      for (const attachment of attachments) {
        const fileId = fileIdFromValue(
          attachment?.id || attachment?.file_id || attachment?.asset_pointer || ""
        );
        if (!fileId) {
          continue;
        }
        const name = candidateName(attachment, `${direction}_file_${files.size + 1}`);

        addFile({
          key: `file:${fileId}`,
          type: "file",
          fileId,
          name,
          mimeType: attachment.mime_type || attachment.mimeType || "",
          size: Number(attachment.size || attachment.size_bytes) || 0,
          direction,
          messageId: message.id || "",
          priority: message.author?.role === "user" ? 130 : 105,
          source: "attachment"
        });
      }

      const contentParts = Array.isArray(message.content?.parts)
        ? message.content.parts
        : [];

      for (const part of contentParts) {
        if (!part || typeof part !== "object") {
          continue;
        }

        const fileId = fileIdFromValue(part.asset_pointer || part.file_id || "");
        if (!fileId) {
          continue;
        }

        const attachment = attachments.find(item =>
          stripFileServicePrefix(item?.id || item?.file_id || "") === fileId
        );
        const extension = String(part.content_type || "").includes("image") ? ".png" : "";
        const name = attachment?.name || part.name || `${direction}_file_${files.size + 1}${extension}`;

        addFile({
          key: `file:${fileId}`,
          type: "file",
          fileId,
          name,
          mimeType: attachment?.mime_type || "",
          size: Number(attachment?.size || part.size_bytes) || 0,
          direction,
          messageId: message.id || "",
          priority: message.author?.role === "user" ? 125 : 100,
          source: "content_part"
        });
      }

      const contentReferences = Array.isArray(metadata.content_references)
        ? metadata.content_references
        : [];

      for (const reference of contentReferences) {
        if (!reference || typeof reference !== "object") {
          continue;
        }

        const rawPath = reference.filepath || reference.file_path || reference.sandbox_path || "";
        const sandboxPath = rawPath.startsWith(SANDBOX_PREFIX)
          ? rawPath.slice(SANDBOX_PREFIX.length)
          : rawPath.startsWith("/mnt/")
            ? rawPath
            : "";
        const name = reference.file_name || reference.name || filenameFromPath(sandboxPath, "");

        if (sandboxPath && name) {
          addFile({
            key: `sandbox:${message.id || "unknown"}:${sandboxPath}`,
            type: "sandbox",
            sandboxPath,
            name,
            mimeType: reference.mime_type || "",
            size: Number(reference.size || reference.size_bytes) || 0,
            direction: "output",
            messageId: message.id || "",
            priority: 135,
            source: "content_reference_sandbox"
          });
          continue;
        }

        const fileId = fileIdFromValue(reference.file_id || reference.id || reference.asset_pointer || "");
        if (fileId && name) {
          addFile({
            key: `file:${fileId}`,
            type: "file",
            fileId,
            name,
            mimeType: reference.mime_type || "",
            size: Number(reference.size || reference.size_bytes) || 0,
            direction,
            messageId: message.id || "",
            priority: 100,
            source: "content_reference"
          });
        }
      }

      const citations = Array.isArray(metadata.citations) ? metadata.citations : [];
      for (const citation of citations) {
        const details = citation?.metadata && typeof citation.metadata === "object"
          ? { ...citation, ...citation.metadata }
          : citation;
        const fileId = fileIdFromValue(details?.file_id || details?.id || details?.asset_pointer || "");
        if (!fileId) continue;
        addFile({
          key: `file:${fileId}`,
          type: "file",
          fileId,
          name: candidateName(details, `input_file_${files.size + 1}`),
          mimeType: details.mime_type || details.mimeType || "",
          size: Number(details.size || details.size_bytes) || 0,
          direction: "input",
          messageId: message.id || "",
          priority: 110,
          source: "citation"
        });
      }

      const generatedDownloads = Array.isArray(metadata.kaur1br5_dragonfruit_downloads)
        ? metadata.kaur1br5_dragonfruit_downloads
        : [];

      for (const download of generatedDownloads) {
        const fileId = fileIdFromValue(download?.id || download?.file_id || download?.asset_pointer || "");
        if (!fileId) {
          continue;
        }
        const name = candidateName(download, `output_file_${files.size + 1}`);

        addFile({
          key: `file:${fileId}`,
          type: "file",
          fileId,
          name,
          mimeType: download.mime_type || "",
          size: Number(download.size || download.size_bytes) || 0,
          direction: "output",
          messageId: message.id || "",
          priority: 145,
          source: "generated_download"
        });
      }

      collectNestedMessageFiles(message, direction, addFile);
    }

    const collectedFiles = Array.from(files.values());
    const completeSandboxPaths = new Set(
      collectedFiles
        .filter(file => file.type === "sandbox" && file.sandboxPath)
        .map(file => `${file.messageId || ""}\n${file.sandboxPath}`)
    );

    return collectedFiles.filter(file => {
      if (file.type !== "sandbox" || !file.sandboxPath) {
        return true;
      }

      const openCount = (file.sandboxPath.match(/\(/g) || []).length;
      const closeCount = (file.sandboxPath.match(/\)/g) || []).length;
      if (openCount <= closeCount) {
        return true;
      }

      const prefix = `${file.messageId || ""}\n${file.sandboxPath}`;
      return !Array.from(completeSandboxPaths).some(candidate =>
        candidate !== prefix && candidate.startsWith(prefix)
      );
    }).map(file => {
      const { priority, ...result } = file;
      return result;
    });
  }

  return {
    buildConversationMarkdown,
    buildConversationJsonData,
    buildConversationMessageContexts,
    collectConversationFiles,
    extractConversationId,
    filenameFromPath,
    getActiveMessages,
    getConversationTitle,
    isVisibleConversationMessage,
    messageToMarkdown,
    mergeDeepResearchReports,
    summarizeMessageText,
    stripFileServicePrefix
  };
});
