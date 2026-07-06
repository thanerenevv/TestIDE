export type AiAdapterKind = "anthropic" | "gemini" | "openai-compatible";

export interface AiProviderPreset {
  id: string;
  label: string;
  kind: AiAdapterKind;
  baseUrl: string;
  editableBaseUrl: boolean;
  needsApiKey: boolean;
  authStyle: "bearer" | "api-key-header";
  needsApiVersion: boolean;
  placeholderModel: string;
}

/** Every provider funnels through one of three real adapters (Anthropic,
 * Gemini, or a generic OpenAI-compatible client) — the rest of this list is
 * just different base URLs/auth for the same OpenAI-shaped chat API, which
 * is how most of the ecosystem (OpenRouter, Groq, Mistral, DeepSeek,
 * Together, Fireworks, xAI, Perplexity, Ollama, LM Studio, Azure) exposes
 * itself. That's what makes broad provider coverage tractable. */
export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  { id: "anthropic", label: "Anthropic (Claude)", kind: "anthropic", baseUrl: "https://api.anthropic.com", editableBaseUrl: false, needsApiKey: true, authStyle: "bearer", needsApiVersion: false, placeholderModel: "claude-sonnet-4-5" },
  { id: "openai", label: "OpenAI", kind: "openai-compatible", baseUrl: "https://api.openai.com/v1", editableBaseUrl: false, needsApiKey: true, authStyle: "bearer", needsApiVersion: false, placeholderModel: "gpt-4o" },
  { id: "gemini", label: "Google Gemini", kind: "gemini", baseUrl: "https://generativelanguage.googleapis.com", editableBaseUrl: false, needsApiKey: true, authStyle: "bearer", needsApiVersion: false, placeholderModel: "gemini-2.0-flash" },
  { id: "openrouter", label: "OpenRouter", kind: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", editableBaseUrl: false, needsApiKey: true, authStyle: "bearer", needsApiVersion: false, placeholderModel: "anthropic/claude-sonnet-4.5" },
  { id: "groq", label: "Groq", kind: "openai-compatible", baseUrl: "https://api.groq.com/openai/v1", editableBaseUrl: false, needsApiKey: true, authStyle: "bearer", needsApiVersion: false, placeholderModel: "llama-3.3-70b-versatile" },
  { id: "mistral", label: "Mistral", kind: "openai-compatible", baseUrl: "https://api.mistral.ai/v1", editableBaseUrl: false, needsApiKey: true, authStyle: "bearer", needsApiVersion: false, placeholderModel: "mistral-large-latest" },
  { id: "deepseek", label: "DeepSeek", kind: "openai-compatible", baseUrl: "https://api.deepseek.com", editableBaseUrl: false, needsApiKey: true, authStyle: "bearer", needsApiVersion: false, placeholderModel: "deepseek-chat" },
  { id: "together", label: "Together AI", kind: "openai-compatible", baseUrl: "https://api.together.xyz/v1", editableBaseUrl: false, needsApiKey: true, authStyle: "bearer", needsApiVersion: false, placeholderModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  { id: "fireworks", label: "Fireworks AI", kind: "openai-compatible", baseUrl: "https://api.fireworks.ai/inference/v1", editableBaseUrl: false, needsApiKey: true, authStyle: "bearer", needsApiVersion: false, placeholderModel: "accounts/fireworks/models/llama-v3p1-70b-instruct" },
  { id: "xai", label: "xAI (Grok)", kind: "openai-compatible", baseUrl: "https://api.x.ai/v1", editableBaseUrl: false, needsApiKey: true, authStyle: "bearer", needsApiVersion: false, placeholderModel: "grok-2-latest" },
  { id: "perplexity", label: "Perplexity", kind: "openai-compatible", baseUrl: "https://api.perplexity.ai", editableBaseUrl: false, needsApiKey: true, authStyle: "bearer", needsApiVersion: false, placeholderModel: "llama-3.1-sonar-large-128k-online" },
  { id: "azure-openai", label: "Azure OpenAI", kind: "openai-compatible", baseUrl: "", editableBaseUrl: true, needsApiKey: true, authStyle: "api-key-header", needsApiVersion: true, placeholderModel: "your deployment name" },
  { id: "ollama", label: "Ollama (local)", kind: "openai-compatible", baseUrl: "http://localhost:11434/v1", editableBaseUrl: true, needsApiKey: false, authStyle: "bearer", needsApiVersion: false, placeholderModel: "llama3.1" },
  { id: "lmstudio", label: "LM Studio (local)", kind: "openai-compatible", baseUrl: "http://localhost:1234/v1", editableBaseUrl: true, needsApiKey: false, authStyle: "bearer", needsApiVersion: false, placeholderModel: "local-model" },
  { id: "custom", label: "Custom (OpenAI-compatible)", kind: "openai-compatible", baseUrl: "", editableBaseUrl: true, needsApiKey: true, authStyle: "bearer", needsApiVersion: false, placeholderModel: "model-id" },
];

export function findPreset(id: string): AiProviderPreset {
  return AI_PROVIDER_PRESETS.find((p) => p.id === id) ?? AI_PROVIDER_PRESETS[0];
}
