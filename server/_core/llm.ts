import Anthropic from "@anthropic-ai/sdk";
import type {
  ImageBlockParam,
  TextBlockParam,
  MessageParam,
} from "@anthropic-ai/sdk/resources/messages";

export type Role = "system" | "user" | "assistant";

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

export type MessageContent = string | TextContent | ImageContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type InvokeParams = {
  messages: Message[];
  model?: string;
  maxTokens?: number;
  max_tokens?: number;
  response_format?: unknown;
  responseFormat?: unknown;
  outputSchema?: unknown;
  output_schema?: unknown;
  tools?: unknown;
  toolChoice?: unknown;
  tool_choice?: unknown;
  thinking?: unknown;
  reasoning?: unknown;
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type ModelsResponse = {
  object: string;
  data: Array<{ id: string; object: string; created: number; owned_by: string }>;
};

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  return new Anthropic({ apiKey });
}

function parseDataUri(
  dataUri: string
): { mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string } {
  const match = dataUri.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) throw new Error("Invalid image data URI");
  const mediaType = match[1] as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  return { mediaType, data: match[2] };
}

function convertContent(
  content: MessageContent | MessageContent[]
): Array<TextBlockParam | ImageBlockParam> {
  const parts = Array.isArray(content) ? content : [content];
  return parts.map((part): TextBlockParam | ImageBlockParam => {
    if (typeof part === "string") return { type: "text", text: part };
    if (part.type === "text") return { type: "text", text: part.text };
    if (part.type === "image_url") {
      const url = part.image_url.url;
      if (url.startsWith("data:")) {
        const { mediaType, data } = parseDataUri(url);
        return { type: "image", source: { type: "base64", media_type: mediaType, data } };
      }
      return { type: "image", source: { type: "url", url } };
    }
    throw new Error(`Unsupported content type: ${(part as { type: string }).type}`);
  });
}

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const client = getClient();

  const systemParts = params.messages
    .filter((m) => m.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n");

  const messages: MessageParam[] = params.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: convertContent(m.content),
    }));

  const response = await client.messages.create({
    model: params.model ?? "claude-sonnet-4-5",
    max_tokens: (params.maxTokens ?? params.max_tokens ?? 4096),
    ...(systemParts ? { system: systemParts } : {}),
    messages,
  });

  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return {
    id: response.id,
    created: Math.floor(Date.now() / 1000),
    model: response.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
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
  return {
    object: "list",
    data: [
      { id: "claude-sonnet-4-5", object: "model", created: 0, owned_by: "anthropic" },
      { id: "claude-opus-4-8", object: "model", created: 0, owned_by: "anthropic" },
    ],
  };
}
