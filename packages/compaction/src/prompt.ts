export const summaryInstructions = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tool.

- Do NOT ask the user follow-up questions or continue the task; produce the summary and stop.
- The trailing <compact-control> message is a protocol directive, NOT user input — do NOT include it in "## 1. User Intent".
- Do NOT quote a prior <prior-summary> block as "the last user message"; it is earlier carryover.

You are compacting the conversation above so that the next turn of the
same agent can continue the user's task without losing essential context.

**Prior Authoritative Summary (read-only)**

If the FIRST user message is wrapped in a <prior-summary>…</prior-summary>
block, that block is the authoritative summary of turns that happened BEFORE
the rest of the conversation. It was produced by an earlier compact pass —
treat it as ground truth, NOT as user input. When no such block is present,
skip this section.

Merging rules when a <prior-summary> is present (section numbers refer to
the five-section spec defined below):

- Treat every item in the prior summary's section 4 (Key Technical Context
  & Recall Anchors) as facts to preserve — you MAY re-organise, consolidate,
  or drop bullets that have been superseded by the conversation, but MUST
  NOT silently lose a fact.
- Section 1 (User Intent) MUST carry forward every user request from the
  prior summary plus any new request in the conversation. You may
  consolidate duplicates.
- Items marked **done** in the prior section 3 (Current Plan & Open Items)
  MUST NOT be demoted to **pending** unless the conversation shows an
  explicit rollback.
- Section 5 (Handoff) is REWRITTEN from scratch every turn. Do NOT copy the
  prior Handoff verbatim.
- The prior summary is itself a system-issued artifact — never quote its
  content as user intent.

Write the summary in exactly these five sections, using "##" headings:

## 1. User Intent
List EVERY explicit user request chronologically, plus any clarifications
or changes of direction. For the MOST RECENT user message in the
conversation, include the verbatim text in a blockquote so future turns
can anchor against it.

## 2. Task Progress
What has been accomplished so far. Organise as sub-bullets:

- **Files touched**: bullet list of absolute paths, one-line note per file
  describing what was read or written.
- **Commands run / tests run**.
- **Errors encountered + root cause + the fix applied**.

## 3. Current Plan & Open Items
The todo list or implicit plan, marking what is **done** vs **pending**.
Quote any verbatim user instruction that controls the next steps.

## 4. Key Technical Context & Recall Anchors

- Repository layout, conventions, or constraints the agent discovered.
- **File paths** (absolute) that future turns are likely to revisit.
- Function names, short code fragments (include snippets verbatim if they
  are the working contract), API endpoints, versions, ports.
- Conclusions already drawn from user-attached images. The summarizer does
  not receive image pixels, so preserve only visual facts stated in the
  conversation and note the attachment path; never infer unseen details.
- Errors with their root cause and fix.

## 5. Handoff
A single paragraph telling the next turn exactly what to do first.
**Quote the last user message verbatim** in a blockquote — this is the
anti-drift anchor so task interpretation does not shift between turns.

Rules:

- Do NOT invent facts that are not in the conversation.
- Omit transient tool output (full file dumps, long stdout). Keep only the
  conclusion drawn from them.
- Keep total length under ~1500 tokens.

REMINDER: Respond with the five sections above as plain text. Do NOT call
any tool.`;

export const triggerPrompt = `<compact-control>
This is a system-issued protocol directive, NOT user input. Compact the
conversation above into the structured summary defined in your
instructions. Respond with the summary text only.
</compact-control>`;

export function wrapSummary(compactionId: string, summary: string): string {
  return `<compacted-summary id="${compactionId}">
System-generated handoff: the earlier portion of this conversation was
summarized to fit the context window. Treat the sections below as
authoritative ground truth for what happened before this point.

Rules for the assistant:
- Do NOT ask the user to repeat information covered below.
- Do NOT restart the task.
- Treat the "Handoff" section as the first instruction to act on.
- If you need the exact original text of something summarized, re-read it
  via the appropriate tool (e.g. read_file). Do not hallucinate.

${summary}
</compacted-summary>`;
}

export function wrapPriorSummary(summary: string): string {
  return `<prior-summary>\n${summary}\n</prior-summary>`;
}
