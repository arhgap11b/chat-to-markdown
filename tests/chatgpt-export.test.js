const assert = require("node:assert/strict");
const {
  buildConversationJsonData,
  buildConversationMessageContexts,
  buildConversationMarkdown,
  collectConversationFiles,
  extractConversationId,
  getActiveMessages,
  mergeDeepResearchReports,
  summarizeMessageText
} = require("../src/chatgpt-export.js");

function node(id, parent, message) {
  return { id, parent, children: [], message };
}

function message(id, role, parts, metadata = {}, recipient = null) {
  return {
    id,
    author: { role },
    content: { content_type: "text", parts },
    metadata,
    recipient
  };
}

const conversation = {
  id: "6a61f5f4-f534-83ed-aff1-6ec2a153a2c8",
  title: "Long architecture chat",
  current_node: "assistant-2",
  mapping: {
    root: node("root", null, null),
    "user-1": node(
      "user-1",
      "root",
      message(
        "user-1",
        "user",
        [
          {
            content_type: "image_asset_pointer",
            asset_pointer: "file-service://file-input",
            size_bytes: 50
          },
          {
            content_type: "audio_asset_pointer",
            asset_pointer: "sediment://file_audio-input",
            name: "voice-note.ogg",
            mime_type: "audio/ogg"
          },
          "Please inspect the attached source."
        ],
        {
          attachments: [
            {
              id: "file-input",
              name: "source.pdf",
              mime_type: "application/pdf",
              size: 1234
            },
            {
              id: "file-notes",
              name: "notes.txt",
              mime_type: "text/plain",
              size: 80
            }
          ]
        }
      )
    ),
    "assistant-old-branch": node(
      "assistant-old-branch",
      "user-1",
      message("assistant-old-branch", "assistant", ["This branch is not active."])
    ),
    "assistant-1": node(
      "assistant-1",
      "user-1",
      message(
        "assistant-1",
        "assistant",
        ["Created [the report](sandbox:/mnt/data/report%20final.docx)."]
      )
    ),
    "tool-1": node(
      "tool-1",
      "assistant-1",
      message("tool-1", "tool", ["tool output created sandbox:/mnt/data/debug%20(final).json"])
    ),
    "user-2": node(
      "user-2",
      "tool-1",
      message("user-2", "user", ["Now make a spreadsheet."])
    ),
    "assistant-2": node(
      "assistant-2",
      "user-2",
      message(
        "assistant-2",
        "assistant",
        ["Done."],
        {
          content_references: [
            {
              type: "file",
              file_id: "file-reference-output",
              file_name: "reference.pdf",
              mime_type: "application/pdf"
            },
            {
              type: "file",
              filepath: "sandbox:/mnt/data/chart.csv",
              file_name: "chart.csv",
              mime_type: "text/csv"
            }
          ],
          kaur1br5_dragonfruit_downloads: [
            { id: "file-output", file_name: "results.xlsx", size_bytes: 4567 }
          ],
          citations: [
            {
              metadata: {
                file_id: "file-input",
                title: "source.pdf"
              }
            },
            {
              file_id: "file-library-source",
              title: "library-source.epub",
              mime_type: "application/epub+zip"
            }
          ],
          generated_artifacts: {
            items: [
              {
                file: {
                  id: "sediment://file-generated-tar",
                  filename: "bundle.tar.gz",
                  mime_type: "application/gzip"
                }
              },
              {
                artifact: {
                  file_id: "file-generated-video",
                  display_name: "preview.webm",
                  mimeType: "video/webm"
                }
              },
              {
                file: {
                  file_id: "file-generated-same-name",
                  file_name: "source.pdf",
                  mime_type: "application/pdf"
                }
              },
              {
                download_url: "https://files.oaiusercontent.com/file-direct/report.odt?sig=test",
                file_name: "report.odt"
              }
            ]
          }
        }
      )
    )
  }
};

assert.equal(
  extractConversationId(
    "https://chatgpt.com/c/6a61f5f4-f534-83ed-aff1-6ec2a153a2c8"
  ),
  "6a61f5f4-f534-83ed-aff1-6ec2a153a2c8"
);

assert.deepEqual(
  getActiveMessages(conversation).map(item => item.id),
  ["user-1", "assistant-1", "tool-1", "user-2", "assistant-2"]
);

const markdown = buildConversationMarkdown(conversation);
assert.match(markdown, /^# Long architecture chat/);
assert.match(markdown, /\*\*User\*\*:/);
assert.match(markdown, /\*\*ChatGPT\*\*:/);
assert.match(markdown, /Please inspect the attached source\./);
assert.match(markdown, /\[Attachment: notes\.txt\]/);
assert.match(markdown, /Created \[the report\]/);
assert.match(markdown, /Now make a spreadsheet\./);
assert.doesNotMatch(markdown, /This branch is not active/);
assert.doesNotMatch(markdown, /tool output/);
assert.doesNotMatch(markdown, /## 1\./);

const selectedMarkdown = buildConversationMarkdown(conversation, "", {
  includedMessageIds: ["user-2", "assistant-2"]
});
assert.match(selectedMarkdown, /Now make a spreadsheet\./);
assert.doesNotMatch(selectedMarkdown, /Please inspect the attached source\./);

const files = collectConversationFiles(conversation);
assert.deepEqual(
  files.map(file => [file.type, file.direction, file.name]),
  [
    ["file", "input", "source.pdf"],
    ["file", "input", "notes.txt"],
    ["file", "input", "voice-note.ogg"],
    ["sandbox", "output", "report final.docx"],
    ["sandbox", "output", "debug (final).json"],
    ["file", "output", "reference.pdf"],
    ["sandbox", "output", "chart.csv"],
    ["file", "input", "library-source.epub"],
    ["file", "output", "results.xlsx"],
    ["file", "output", "bundle.tar.gz"],
    ["file", "output", "preview.webm"],
    ["file", "output", "source.pdf"],
    ["direct", "output", "report.odt"]
  ]
);
assert.equal(files[3].messageId, "assistant-1");
assert.equal(files[3].sandboxPath, "/mnt/data/report%20final.docx");
assert.equal(files[4].sandboxPath, "/mnt/data/debug%20(final).json");

const preparedFiles = files.slice(0, 2).map(file => ({
  ...file,
  localName: file.name,
  relativePath: `input/${file.name}`,
  relativeUrl: `./input/${encodeURIComponent(file.name)}`
}));
const jsonData = buildConversationJsonData(
  conversation,
  "Fallback title",
  preparedFiles,
  "https://chatgpt.com/c/6a61f5f4-f534-83ed-aff1-6ec2a153a2c8"
);
assert.equal(jsonData.schemaVersion, 1);
assert.equal(jsonData.conversation.title, "Long architecture chat");
assert.equal(jsonData.messages.length, 4);
assert.deepEqual(jsonData.messages.map(item => item.author.role), [
  "user",
  "assistant",
  "user",
  "assistant"
]);
assert.equal(jsonData.messages[0].parentId, "root");
assert.equal(jsonData.messages[0].files[0].link, "./input/source.pdf");
assert.equal(jsonData.files[1].path, "input/notes.txt");
assert.doesNotThrow(() => JSON.stringify(jsonData));

const selectedJsonData = buildConversationJsonData(
  conversation,
  "",
  [],
  "https://chatgpt.com/c/example",
  { includedMessageIds: ["user-2", "assistant-2"] }
);
assert.deepEqual(selectedJsonData.messages.map(item => item.id), ["user-2", "assistant-2"]);

const messageContexts = buildConversationMessageContexts(conversation, [
  "Inspect the architecture source",
  "Create the final spreadsheet"
]);
assert.equal(messageContexts.find(item => item.id === "user-1").summary, "Inspect the architecture source");
assert.equal(messageContexts.find(item => item.id === "assistant-1").promptNumber, 1);
assert.deepEqual(messageContexts.find(item => item.id === "assistant-1").messageIds, ["assistant-1"]);
assert.deepEqual(messageContexts.find(item => item.id === "assistant-1").relatedMessageIds, ["tool-1"]);
assert.equal(messageContexts.find(item => item.id === "assistant-1").promptSummary, "Inspect the architecture source");
assert.equal(messageContexts.find(item => item.id === "user-2").promptNumber, 2);

assert.equal(
  summarizeMessageText(
    "First sentence explains the result. " + "Details ".repeat(40) + ". The final sentence gives the conclusion.",
    "assistant"
  ),
  "First sentence explains the result. … The final sentence gives the conclusion."
);
assert.equal(
  summarizeMessageText(
    "The audit is complete. [Download report](sandbox:/mnt/data/ATLAS_report(2).md)",
    "assistant"
  ),
  "The audit is complete."
);

const fileOnlyResponseContexts = buildConversationMessageContexts({
  messages: [
    message("context-user", "user", ["Please finish the architecture audit."]),
    message("context-answer", "assistant", ["The audit is complete and all findings have been reconciled."]),
    message("context-file", "assistant", ["[Download report](sandbox:/mnt/data/ATLAS_report(2).md)"])
  ]
});
const groupedFileResponse = fileOnlyResponseContexts.find(item => item.id === "context-answer");
assert.deepEqual(groupedFileResponse.messageIds, ["context-answer", "context-file"]);
assert.equal(groupedFileResponse.summary, "The audit is complete and all findings have been reconciled.");

const splitAssistantConversation = {
  title: "Grouped assistant response",
  messages: [
    message("group-user", "user", ["Review the system."]),
    message("group-answer-1", "assistant", ["The review is complete."]),
    message("group-answer-2", "assistant", ["The main risk is the deployment path."])
  ]
};
const splitAssistantContexts = buildConversationMessageContexts(splitAssistantConversation);
assert.equal(splitAssistantContexts.length, 2);
assert.deepEqual(
  splitAssistantContexts.find(item => item.role === "assistant").messageIds,
  ["group-answer-1", "group-answer-2"]
);
assert.equal(
  (buildConversationMarkdown(splitAssistantConversation).match(/\*\*ChatGPT\*\*:/g) || []).length,
  1
);

const separatedSelectedReplies = buildConversationMarkdown(conversation, "", {
  includedMessageIds: ["assistant-1", "assistant-2"]
});
assert.equal(
  (separatedSelectedReplies.match(/\*\*ChatGPT\*\*:/g) || []).length,
  2
);

const deepResearchConversation = {
  title: "Network library research",
  messages: [
    message("research-user", "user", ["Research the available networking libraries."]),
    message("research-plan", "assistant", ["I will compare the available options."]),
    message("request-WEB:research-result-1", "assistant", [], {
      command: "deep_research"
    }, "web")
  ]
};
mergeDeepResearchReports(deepResearchConversation, [{
  id: "captured-research",
  turnId: "request-WEB:research-result-1",
  promptNumber: 1,
  markdown: "# Networking libraries\n\nThe complete deep research report."
}]);
const deepResearchMarkdown = buildConversationMarkdown(deepResearchConversation);
assert.match(deepResearchMarkdown, /# Networking libraries/);
assert.match(deepResearchMarkdown, /complete deep research report/);
assert.equal(deepResearchConversation.messages[2].recipient, "all");
assert.equal(
  deepResearchConversation.messages[2].metadata.chat_to_markdown_deep_research,
  true
);

const parenthesizedFiles = collectConversationFiles({
  messages: [
    message(
      "assistant-parentheses",
      "assistant",
      [
        "[Audit](sandbox:/mnt/data/ATLAS_DOC0_current_reality_audit(2).md) "
          + "[ADR](sandbox:/mnt/data/FINAL_ADR_runtime(7)(2).md)."
      ]
    )
  ]
});
assert.deepEqual(
  parenthesizedFiles.map(file => [file.name, file.sandboxPath]),
  [
    ["ATLAS_DOC0_current_reality_audit(2).md", "/mnt/data/ATLAS_DOC0_current_reality_audit(2).md"],
    ["FINAL_ADR_runtime(7)(2).md", "/mnt/data/FINAL_ADR_runtime(7)(2).md"]
  ]
);

console.log("chatgpt-export tests passed");
