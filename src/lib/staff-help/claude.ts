import "server-only";

// Anthropic Messages API, hand-rolled for the same reason the DeepSeek client
// is: one fewer dependency, and stubbing global fetch in vitest beats mocking
// a client class.
//
// The shape differs from the OpenAI-style API the customer bot speaks, so this
// is a separate client rather than a flag on that one:
//   - the system prompt is a top-level field, not a message
//   - tools declare `input_schema`, not a nested `function` object
//   - a reply is a list of content blocks, and tool calls come back as
//     `tool_use` blocks mixed in with the text
//   - tool results go back as a *user* message of `tool_result` blocks

export class ClaudeError extends Error {
  readonly status?: number;
  constructor(message: string, opts: { status?: number } = {}) {
    super(message);
    this.name = "ClaudeError";
    this.status = opts.status;
  }
}

export type ClaudeBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | { type: "tool_result"; tool_use_id: string; content: string };

export type ClaudeMessage = {
  role: "user" | "assistant";
  content: string | ClaudeBlock[];
};

export type ClaudeTool = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    // readonly so the tool list can stay `as const` — the permission test
    // reads it as data, and literal types make a typo in a name a build error.
    required?: readonly string[];
  };
};

export type ClaudeReply = {
  text: string;
  toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  /** Echoed back verbatim on the next turn — Anthropic requires the assistant
   *  turn to be replayed as it was returned, not reconstructed. */
  blocks: ClaudeBlock[];
};

const DEFAULT_MODEL = "claude-opus-5";
const DEFAULT_TIMEOUT_MS = 30_000;

export async function callClaude(
  messages: ClaudeMessage[],
  opts: {
    system: string;
    tools?: ClaudeTool[];
    timeoutMs?: number;
    maxTokens?: number;
  },
): Promise<ClaudeReply> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ClaudeError("ANTHROPIC_API_KEY is not configured");

  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 1024,
        system: opts.system,
        messages,
        ...(opts.tools && opts.tools.length > 0 ? { tools: opts.tools } : {}),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new ClaudeError(
      err instanceof Error && err.name === "AbortError"
        ? "Claude request timed out"
        : `Claude request failed: ${String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new ClaudeError(
      `Claude responded ${res.status}: ${await res.text()}`,
      {
        status: res.status,
      },
    );
  }

  const body = (await res.json()) as { content?: ClaudeBlock[] };
  const blocks = body.content ?? [];
  return {
    text: blocks
      .filter(
        (b): b is Extract<ClaudeBlock, { type: "text" }> => b.type === "text",
      )
      .map((b) => b.text)
      .join("")
      .trim(),
    toolUses: blocks.filter(
      (b): b is Extract<ClaudeBlock, { type: "tool_use" }> =>
        b.type === "tool_use",
    ),
    blocks,
  };
}
