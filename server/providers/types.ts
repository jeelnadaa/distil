export type Usage = { input: number; output: number; cached: number; reasoning: number };

// images: base64 page renders or photos sent with a user turn (vision extraction); each adapter encodes them its own way.
export type ImagePart = { mime: string; data: string };
// videos: public video links (YouTube) the model watches itself; only Gemini can.
export type ChatMessage = { role: "user" | "assistant"; content: string; images?: ImagePart[]; videos?: string[] };

export type ChatRequest = {
  model: string;
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  signal?: AbortSignal;
};

// Adapters yield text as it arrives and usage once the provider reports it.
export type StreamEvent = { type: "text"; text: string } | { type: "usage"; usage: Usage };

export type ModelInfo = { id: string; name: string; contextWindow: number | null };

export type Endpoint = { baseUrl: string; apiKey: string | null; fetch?: typeof fetch };

// Embeddings for retrieval (F-1005): documents when indexing, queries when searching (some models embed them differently).
export type EmbedRequest = { model: string; texts: string[]; task: "document" | "query"; signal?: AbortSignal };
export type Embedded = { vectors: number[][]; tokens: number | null };

export type Adapter = {
  stream(endpoint: Endpoint, request: ChatRequest): AsyncIterable<StreamEvent>;
  listModels(endpoint: Endpoint, signal?: AbortSignal): Promise<ModelInfo[]>;
  // Providers without an embeddings API leave these out.
  embed?(endpoint: Endpoint, request: EmbedRequest): Promise<Embedded>;
  listEmbeddingModels?(endpoint: Endpoint, signal?: AbortSignal): Promise<ModelInfo[]>;
};

export class ProviderError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
