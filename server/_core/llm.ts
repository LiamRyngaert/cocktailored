import Anthropic from "@anthropic-ai/sdk";
import type {
  ImageBlockParam,
  MessageParam,
  TextBlockParam,
} from "@anthropic-ai/sdk/resources/messages";

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4";
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: { name: string };
};
export type ToolChoice = ToolChoicePrimitive | ToolChoiceByName | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  model?: string;
  thinking?: Record<string, unknown>;
  reasoning?: Record<string, unknown>;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

export type ModelInfo = {
  id: string;
  object: string;
  created: number;
  owned_by: string;
};

export type ModelsResponse = {
  object: string;
  data: ModelInfo[];
};

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured");
  // Reuse a single client (keep-alive) and let the SDK transparently retry
  // transient failures (429 rate limits, 5xx, network errors) with backoff, and
  // time-box each request so a hung upstream can never stall a function.
  if (!_client) {
    _client = new Anthropic({
      apiKey: key,
      maxRetries: Math.max(0, Number(process.env.LLM_MAX_RETRIES ?? "2") || 2),
      timeout: Math.max(5_000, Number(process.env.LLM_TIMEOUT_MS ?? "45000") || 45_000),
    });
  }
  return _client;
}

function convertImageUrl(url: string): ImageBlockParam {
  if (url.startsWith("data:")) {
    const commaIdx = url.indexOf(",");
    const header = url.slice(0, commaIdx);
    const data = url.slice(commaIdx + 1);
    const mediaType = header.split(";")[0].split(":")[1] as
      | "image/jpeg"
      | "image/png"
      | "image/gif"
      | "image/webp";
    return { type: "image", source: { type: "base64", media_type: mediaType, data } };
  }
  return { type: "image", source: { type: "url", url } };
}

function convertContent(
  content: MessageContent | MessageContent[],
): Array<TextBlockParam | ImageBlockParam> {
  const parts = Array.isArray(content) ? content : [content];
  return parts.flatMap((part): Array<TextBlockParam | ImageBlockParam> => {
    if (typeof part === "string") return [{ type: "text", text: part }];
    if (part.type === "text") return [{ type: "text", text: part.text }];
    if (part.type === "image_url") return [convertImageUrl(part.image_url.url)];
    return [{ type: "text", text: `[File: ${(part as FileContent).file_url.url}]` }];
  });
}

function extractSystemText(messages: Message[]): string {
  return messages
    .filter((m) => m.role === "system")
    .map((m) => {
      const c = m.content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) {
        return c
          .map((p) => (typeof p === "string" ? p : p.type === "text" ? p.text : ""))
          .join("");
      }
      return "";
    })
    .join("\n");
}

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const client = getClient();

  const {
    messages,
    model = "claude-sonnet-4-5",
    maxTokens,
    max_tokens,
    responseFormat,
    response_format,
  } = params;

  let systemText = extractSystemText(messages);

  const fmt = responseFormat ?? response_format;
  if (fmt?.type === "json_schema" && fmt.json_schema) {
    systemText +=
      `\n\nRespond with valid JSON matching this schema:\n` +
      JSON.stringify(fmt.json_schema.schema, null, 2) +
      `\nReturn only the raw JSON object — no markdown fences.`;
  } else if (fmt?.type === "json_object") {
    systemText += "\n\nRespond with a valid JSON object only — no markdown fences.";
  }

  const anthropicMessages: MessageParam[] = messages
    .filter((m) => m.role !== "system")
    .map((m): MessageParam => {
      if (m.role === "user") {
        return { role: "user", content: convertContent(m.content) };
      }
      if (m.role === "assistant") {
        const text =
          typeof m.content === "string"
            ? m.content
            : Array.isArray(m.content)
            ? m.content
                .map((p) => (typeof p === "string" ? p : p.type === "text" ? p.text : ""))
                .join("")
            : "";
        return { role: "assistant", content: text };
      }
      const text =
        typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return { role: "user", content: text };
    });

  const response = await client.messages.create({
    model,
    system: systemText.trim() || undefined,
    messages: anthropicMessages,
    max_tokens: max_tokens ?? maxTokens ?? 4096,
  });

  const textContent = response.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: "text"; text: string }).text)
    .join("");

  return {
    id: response.id,
    created: Math.floor(Date.now() / 1000),
    model: response.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: textContent },
        finish_reason: response.stop_reason ?? null,
      },
    ],
    usage: {
      prompt_tokens: response.usage.input_tokens,
      completion_tokens: response.usage.output_tokens,
      total_tokens: response.usage.input_tokens + response.usage.output_tokens,
    },
  };
}

export async function listLLMModels(): Promise<ModelsResponse> {
  return { object: "list", data: [] };
}
