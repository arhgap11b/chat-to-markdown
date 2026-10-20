const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { before, after, test } = require("node:test");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const messageButton = ".chatgpt-message-download-button";
const conversationButton = ".chatgpt-conversation-download-button";
let browser;
let currentHtml;

before(async () => {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    headless: true
  });
  currentHtml = await readFile(path.join(__dirname, "fixtures/chatgpt-current.html"), "utf8");
});
after(async () => browser?.close());

async function openPage(t, html = currentHtml, url = "https://chatgpt.com/") {
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  t.after(() => page.close());
  // No requests from a fixture may reach a real account or service.
  await page.route("**/*", route =>
    route.request().isNavigationRequest()
      ? route.fulfill({ contentType: "text/html; charset=utf-8", body: html })
      : route.abort()
  );
  await page.goto(url);
  await page.evaluate(() => {
    window.chrome = {
      runtime: {
        sendMessage: (_message, callback) => callback?.({ success: true }),
        onMessage: { addListener() {} }
      }
    };
  });
  for (const file of [
    "vendor/turndown.js", "vendor/turndown-plugin-gfm.js",
    "chatgpt-export.js", "content.js"
  ]) {
    await page.addScriptTag({ path: path.join(root, "src", file) });
  }
  return page;
}

async function downloadText(page, selector) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(selector).click()
  ]);
  return {
    filename: download.suggestedFilename(),
    text: await readFile(await download.path(), "utf8")
  };
}

test("current ChatGPT injects only message actions and exports full user/assistant content", async t => {
  const page = await openPage(t);
  assert.equal(await page.locator(messageButton).count(), 4);
  assert.equal(await page.locator(conversationButton).count(), 1);
  assert.equal(await page.locator(`${conversationButton}.native-composer-button`).count(), 1);
  assert.equal(await page.locator(`aside ${messageButton}, [data-code-block] ${messageButton}`).count(), 0);

  const user = await downloadText(page, `[data-content-search-unit-key$=":user"] ${messageButton} >> nth=0`);
  assert.equal(user.filename, "запит_DOM regression chat.md");
  assert.equal(user.text, "First request with **formatting**.\n\nKeep the whole request.");

  const answer = await downloadText(page, `[data-talvt-turn-state] > .turn-action-controls ${messageButton} >> nth=0`);
  assert.equal(answer.filename, "DOM regression chat.md");
  assert.match(answer.text, /^## First answer/);
  assert.match(answer.text, /```\nconst some_value = "\*literal\*";\n  console\.log\(some_value\);\n```/);
  assert.match(answer.text, /```\nsingle_line\(\)\n```/);
  assert.match(answer.text, /\| Alpha \| 42 \|/);
  assert.match(answer.text, /Last paragraph of the first answer\.$/);
  assert.doesNotMatch(answer.text, /First request|Second answer|Code toolbar|Copy table|ChatGPT said|rendered-diagram-style/);
});

test("DOM conversation export preserves order, roles and stable message IDs", async t => {
  const page = await openPage(t);
  await page.locator(conversationButton).click();
  await page.locator(".chatgpt-export-json-option input").check();
  const downloads = [];
  const allDownloads = page.waitForEvent("download", {
    predicate: download => {
      downloads.push(download);
      return downloads.length === 2;
    }
  });
  await page.locator(".chatgpt-export-primary-button").click();
  await allDownloads;
  assert.equal(downloads.length, 2);
  const markdown = downloads.find(item => item.suggestedFilename().endsWith(".md"));
  const json = downloads.find(item => item.suggestedFilename().endsWith(".json"));
  const text = await readFile(await markdown.path(), "utf8");
  assert.equal((text.match(/\*\*User\*\*:/g) || []).length, 2);
  assert.equal((text.match(/\*\*ChatGPT\*\*:/g) || []).length, 2);
  assert.ok(text.indexOf("First request") < text.indexOf("First answer"));
  assert.ok(text.indexOf("First answer") < text.indexOf("Second request"));
  assert.doesNotMatch(text, /Sidebar content|Unsent draft/);
  const data = JSON.parse(await readFile(await json.path(), "utf8"));
  assert.deepEqual(data.messages.map(message => message.id), ["user-1", "assistant-1", "user-2", "assistant-2"]);
});

test("full export still retrieves messages missing from the mounted DOM", async t => {
  const page = await openPage(t, currentHtml, "https://chatgpt.com/c/11111111-2222-3333-8444-555555555555");
  await page.route("**/api/auth/session", route => route.fulfill({ json: { accessToken: "fixture-only" } }));
  await page.route("**/backend-api/conversations/**", route => route.fulfill({
    json: {
      title: "Complete API chat",
      messages: [
        { id: "unmounted-user", author: { role: "user" }, content: { content_type: "text", parts: ["Older unmounted request."] } },
        { id: "unmounted-answer", author: { role: "assistant" }, content: { content_type: "text", parts: ["Older unmounted answer."] } }
      ]
    }
  }));
  await page.locator(conversationButton).click();
  const result = await downloadText(page, ".chatgpt-export-primary-button");
  assert.match(result.text, /Older unmounted request/);
  assert.match(result.text, /Older unmounted answer/);
  assert.equal(result.filename, "Complete API chat.md");
});

test("new turns, replaced action bars and composer remounts receive one button each", async t => {
  const page = await openPage(t);
  await page.evaluate(() => {
    const turn = document.querySelector("[data-talvt-turn-state]").parentElement.cloneNode(true);
    turn.querySelectorAll(".chatgpt-message-download-button").forEach(button => button.remove());
    turn.querySelector('[data-markdown-text-style="assistant-message"]').innerHTML = "<p>Newly mounted answer.</p>";
    document.querySelector("main").appendChild(turn);
    const form = document.querySelector("form");
    const replacement = form.cloneNode(true);
    replacement.querySelector('[data-chatgpt-download-button="true"]').remove();
    form.replaceWith(replacement);
  });
  await page.waitForFunction(() => document.querySelectorAll(".chatgpt-message-download-button").length === 6);
  assert.equal(await page.locator(conversationButton).count(), 1);
  const result = await downloadText(page, `[data-talvt-turn-state] > .turn-action-controls ${messageButton} >> nth=2`);
  assert.equal(result.text, "Newly mounted answer.");
  await page.evaluate(() => {
    const toolbar = document.querySelector("[data-talvt-turn-state] > .turn-action-controls");
    const replacement = toolbar.cloneNode(true);
    replacement.querySelector(".chatgpt-message-download-button").remove();
    toolbar.replaceWith(replacement);
  });
  await page.waitForFunction(() => document.querySelectorAll(".chatgpt-message-download-button").length === 6);
  assert.equal(await page.locator(conversationButton).count(), 1);
  await page.evaluate(() => {
    const reply = document.querySelector('[data-content-search-unit-key$=":assistant"]');
    const replacement = reply.cloneNode(true);
    replacement.querySelector('[data-markdown-text-style="assistant-message"]').innerHTML = "<p>Replaced message body.</p>";
    reply.replaceWith(replacement);
  });
  const replaced = await downloadText(page, `[data-talvt-turn-state] > .turn-action-controls ${messageButton} >> nth=0`);
  assert.equal(replaced.text, "Replaced message body.");
});

for (const [lang, copy, copyMessage] of [
  ["en", "Copy", "Copy message"],
  ["ru", "Копировать", "Копировать сообщение"]
]) {
  test(`current message controls work in ${lang}`, async t => {
    const html = currentHtml.replace('lang="uk-UA"', `lang="${lang}"`)
      .replaceAll("Копіювати повідомлення", copyMessage).replaceAll('aria-label="Копіювати"', `aria-label="${copy}"`);
    const page = await openPage(t, html);
    assert.equal(await page.locator(messageButton).count(), 4);
  });
}

test("legacy ChatGPT keeps initial message actions and moves export from header to composer", async t => {
  const page = await openPage(t, `<!doctype html><html lang="en"><head><title>Legacy</title></head><body>
    <div id="conversation-header-actions"></div>
    <article data-testid="conversation-turn-1">
      <div data-message-author-role="user" data-message-id="old-user"><div class="whitespace-pre-wrap">Legacy prompt.</div></div>
      <div><button data-testid="copy-turn-action-button">Copy</button></div>
    </article>
    <article data-testid="conversation-turn-2">
      <div data-message-author-role="assistant" data-message-id="old-assistant"><div class="markdown"><p>Legacy answer.</p></div></div>
      <div><button data-testid="copy-turn-action-button">Copy</button></div>
    </article>
  </body></html>`);
  assert.equal(await page.locator(messageButton).count(), 2);
  assert.equal((await downloadText(page, `article:nth-of-type(2) ${messageButton}`)).text, "Legacy answer.");
  await page.evaluate(() => {
    const form = document.createElement("form");
    form.innerHTML = '<div data-testid="composer-speech-button-container"><button>Voice</button></div>';
    document.body.appendChild(form);
  });
  await page.locator(`form ${conversationButton}`).waitFor();
  assert.equal(await page.locator(conversationButton).count(), 1);
});
