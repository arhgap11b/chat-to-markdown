(() => {
  "use strict";

  if (window.__chatToMarkdownDeepResearchFrame) return;
  window.__chatToMarkdownDeepResearchFrame = true;

  const REQUEST_TYPE = "chat-to-markdown:deep-research-request";
  const RESPONSE_TYPE = "chat-to-markdown:deep-research-response";
  const pendingParents = new Map();

  function createTurndownService() {
    if (typeof TurndownService === "undefined") return null;
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
    return service;
  }

  function findReportRoot() {
    const selectors = [
      ".deep-research-result",
      "[class*='_reportPage_']",
      "[data-testid*='research-report']",
      "article[class*='report']",
      "main article"
    ];
    for (const selector of selectors) {
      const candidates = Array.from(document.querySelectorAll(selector));
      const candidate = candidates
        .filter(element => (element.textContent || "").trim().length > 200)
        .sort((left, right) => right.textContent.length - left.textContent.length)[0];
      if (candidate) return candidate;
    }
    return null;
  }

  function extractReport() {
    const root = findReportRoot();
    const service = createTurndownService();
    if (!root || !service) return null;

    const clone = root.cloneNode(true);
    clone.querySelectorAll("sup[data-citation-index], sup:has([data-citation-index])")
      .forEach(element => {
        const index = element.getAttribute("data-citation-index")
          || element.querySelector("[data-citation-index]")?.getAttribute("data-citation-index")
          || element.textContent.trim();
        element.replaceWith(document.createTextNode(index ? `[${index}]` : ""));
      });
    clone.querySelectorAll([
      "button",
      "[role='button']",
      "[role='tooltip']",
      "[aria-hidden='true']",
      "script",
      "style",
      "noscript"
    ].join(",")).forEach(element => element.remove());

    const markdown = service.turndown(clone)
      .replace(/\uE200[^\uE201]*\uE201/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (markdown.length < 100) return null;

    const title = root.querySelector("h1")?.textContent?.trim()
      || document.querySelector("h1")?.textContent?.trim()
      || document.title?.trim()
      || "Deep Research";
    return { markdown, title };
  }

  function postResponse(target, requestId, report) {
    target?.postMessage({
      type: RESPONSE_TYPE,
      requestId,
      markdown: report?.markdown || "",
      title: report?.title || ""
    }, "*");
  }

  window.addEventListener("message", event => {
    const data = event.data;
    if (!data || !data.requestId) return;

    if (data.type === RESPONSE_TYPE) {
      const parent = pendingParents.get(data.requestId);
      if (!parent) return;
      pendingParents.delete(data.requestId);
      parent.postMessage(data, "*");
      return;
    }

    if (data.type !== REQUEST_TYPE) return;
    const report = extractReport();
    if (report) {
      postResponse(event.source, data.requestId, report);
      return;
    }

    const childFrames = Array.from(document.querySelectorAll("iframe"))
      .map(frame => frame.contentWindow)
      .filter(Boolean);
    if (!childFrames.length) {
      postResponse(event.source, data.requestId, null);
      return;
    }

    pendingParents.set(data.requestId, event.source);
    childFrames.forEach(child => child.postMessage(data, "*"));
    window.setTimeout(() => {
      const parent = pendingParents.get(data.requestId);
      if (!parent) return;
      pendingParents.delete(data.requestId);
      postResponse(parent, data.requestId, null);
    }, 2500);
  });
})();
