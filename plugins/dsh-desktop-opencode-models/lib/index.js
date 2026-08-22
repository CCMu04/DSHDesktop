import {
  apply as applyPiAi,
  inject as piAiInject,
} from "@deepseek-ai/dsh-llm-pi-ai";
import {
  INVALID_CREDENTIAL_CODE,
  LlmError,
  attributionHeaders,
  normalizeApiKey,
} from "@deepseek-ai/dsh-llm";
import { OPENCODE_MODELS } from "@earendil-works/pi-ai/providers/opencode.models";
import { OPENCODE_GO_MODELS } from "@earendil-works/pi-ai/providers/opencode-go.models";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const name = "dsh-desktop-opencode-models";
export const inject = piAiInject;
export const SETTINGS_NAMESPACE = "llm-pi-ai";
export const OPENCODE_PROVIDER = "opencode-go";
export const OPENCODE_DEFAULT_BASE_URLS = Object.freeze({
  opencode: "https://opencode.ai/zen/v1",
  "opencode-go": "https://opencode.ai/zen/go/v1",
});
export const MODELS_DEV_URL = "https://models.dev/api.json";
export const MODELS_DEV_RAW_BASE_URL =
  "https://raw.githubusercontent.com/anomalyco/models.dev/dev/providers";
export const DEFAULT_DISCOVERY_TIMEOUT_MS = 15_000;
export const MAX_METADATA_BYTES = 8 * 1024 * 1024;
export const CATALOG_CACHE_VERSION = 1;

const OPENCODE_CATALOGS = Object.freeze({
  opencode: OPENCODE_MODELS,
  "opencode-go": OPENCODE_GO_MODELS,
});
const AI_SDK_PROTOCOLS = Object.freeze({
  "@ai-sdk/anthropic": "anthropic-messages",
  "@ai-sdk/google": "google-generative-ai",
  "@ai-sdk/openai": "openai-responses",
  "@ai-sdk/openai-compatible": "openai-completions",
});
const DEFAULT_MODEL_CONTEXT_WINDOW = 262_144;
const DEFAULT_MODEL_MAX_TOKENS = 32_768;
const MODEL_INPUTS = new Set(["text", "image"]);
const THINKING_LEVELS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

function discoveryError(message, code = "DISCOVERY_FAILED", options) {
  return new LlmError(message, code, options);
}

/**
 * Convert a configured inference base URL into its OpenAI-compatible listing
 * URL. A pasted request endpoint or listing endpoint is folded back to the
 * base first, preventing `/chat/completions/models` and `/models/models`.
 */
export function modelsUrl(baseURL) {
  if (typeof baseURL !== "string" || baseURL.trim().length === 0) {
    throw discoveryError(
      "OpenCode model discovery needs a non-empty baseURL",
      "INVALID_DISCOVERY",
    );
  }

  let url;
  try {
    url = new URL(baseURL.trim());
  } catch {
    throw discoveryError(
      "OpenCode model discovery received an invalid baseURL",
      "INVALID_DISCOVERY",
    );
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw discoveryError(
      "OpenCode model discovery requires an HTTP(S) baseURL without embedded credentials",
      "INVALID_DISCOVERY",
    );
  }

  let pathname = url.pathname.replace(/\/+$/, "");
  while (/\/models$/i.test(pathname)) {
    pathname = pathname.replace(/\/models$/i, "");
  }
  pathname = pathname.replace(/\/(?:chat\/)?completions$/i, "");
  url.pathname = `${pathname}/models`.replace(/^\/\//, "/");
  url.hash = "";
  return url.toString();
}

/** Normalize an OpenAI model-list response without inferring capabilities. */
export function normalizeListing(body) {
  if (typeof body !== "object" || body === null || !Array.isArray(body.data)) {
    throw discoveryError(
      'OpenCode model discovery expected a top-level "data" array',
    );
  }

  const seen = new Set();
  const models = [];
  for (const entry of body.data) {
    if (typeof entry !== "object" || entry === null) continue;
    if (typeof entry.id !== "string") continue;
    const id = entry.id.trim();
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, name: id });
  }
  return models;
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function finiteCost(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function metadataBaseURL(provider, api) {
  const baseURL = OPENCODE_DEFAULT_BASE_URLS[provider];
  return api === "anthropic-messages"
    ? baseURL.replace(/\/v1\/?$/i, "")
    : baseURL;
}

function metadataModel(provider, providerMetadata, source) {
  if (typeof source !== "object" || source === null) return undefined;
  if (typeof source.id !== "string" || source.id.trim().length === 0) {
    return undefined;
  }
  const id = source.id.trim();
  const packageName = source.provider?.npm ?? providerMetadata.npm;
  const api = AI_SDK_PROTOCOLS[packageName];
  if (api === undefined) return undefined;
  const input = Array.isArray(source.modalities?.input)
    ? source.modalities.input.filter((entry) => MODEL_INPUTS.has(entry))
    : [];
  const effort = Array.isArray(source.reasoning_options)
    ? source.reasoning_options.find((entry) => entry?.type === "effort")
    : undefined;
  const thinkingLevelMap = {};
  for (const level of effort?.values ?? []) {
    if (THINKING_LEVELS.has(level)) {
      thinkingLevelMap[level] = level;
    }
  }
  const cost = source.cost ?? {};
  return {
    id,
    name:
      typeof source.name === "string" && source.name.trim().length > 0
        ? source.name.trim()
        : id,
    api,
    provider,
    baseUrl: metadataBaseURL(provider, api),
    reasoning: source.reasoning === true,
    input: input.length > 0 ? input : ["text"],
    cost: {
      input: finiteCost(cost.input),
      output: finiteCost(cost.output),
      cacheRead: finiteCost(cost.cache_read),
      cacheWrite: finiteCost(cost.cache_write),
    },
    contextWindow: positiveInteger(
      source.limit?.context,
      DEFAULT_MODEL_CONTEXT_WINDOW,
    ),
    maxTokens: positiveInteger(source.limit?.output, DEFAULT_MODEL_MAX_TOKENS),
    ...(Object.keys(thinkingLevelMap).length === 0 ? {} : { thinkingLevelMap }),
  };
}

/**
 * Keep only the Models.dev fields needed to route and size OpenCode models.
 * The compact form is also the non-secret on-disk bootstrap cache.
 */
export function normalizeModelsDevProvider(body, provider) {
  if (!Object.hasOwn(OPENCODE_DEFAULT_BASE_URLS, provider)) {
    throw discoveryError(`unsupported OpenCode provider metadata: ${provider}`);
  }
  const source = body?.[provider];
  if (
    typeof source !== "object" ||
    source === null ||
    typeof source.models !== "object" ||
    source.models === null ||
    Array.isArray(source.models)
  ) {
    throw discoveryError(
      `Models.dev does not describe the OpenCode provider "${provider}"`,
    );
  }
  const providerMetadata = {
    npm:
      typeof source.npm === "string" ? source.npm : "@ai-sdk/openai-compatible",
    models: {},
  };
  for (const [key, value] of Object.entries(source.models)) {
    const model = metadataModel(provider, providerMetadata, value);
    if (model === undefined || model.id !== key) continue;
    providerMetadata.models[key] = model;
  }
  return providerMetadata;
}

function fallbackMetadataModel(provider, id, providerMetadata) {
  const api = AI_SDK_PROTOCOLS[providerMetadata.npm];
  if (api === undefined) return undefined;
  return {
    id,
    name: id,
    api,
    provider,
    baseUrl: metadataBaseURL(provider, api),
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_MODEL_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MODEL_MAX_TOKENS,
  };
}

/**
 * Extend pi-ai's public provider catalog with live metadata. Existing installed
 * entries always win, preserving their richer per-model protocol/compat data.
 */
export function augmentOpenCodeCatalog(
  provider,
  discovered,
  providerMetadata,
  additions,
) {
  const catalog = OPENCODE_CATALOGS[provider];
  if (catalog === undefined) return [];
  const managed = [];
  for (const { id } of discovered) {
    const key = `${provider}\0${id}`;
    const pluginOwnsEntry = additions?.has(key) === true;
    if (Object.hasOwn(catalog, id) && !pluginOwnsEntry) continue;
    const model =
      providerMetadata.models[id] ??
      fallbackMetadataModel(provider, id, providerMetadata);
    if (model === undefined) continue;
    catalog[id] = model;
    managed.push(id);
    additions?.add(key);
  }
  return managed;
}

function sanitizedCachedModel(provider, id, source) {
  if (
    typeof source !== "object" ||
    source === null ||
    source.id !== id ||
    !Object.values(AI_SDK_PROTOCOLS).includes(source.api)
  ) {
    return undefined;
  }
  const input = Array.isArray(source.input)
    ? source.input.filter((entry) => MODEL_INPUTS.has(entry))
    : [];
  const cost = source.cost ?? {};
  return {
    id,
    name:
      typeof source.name === "string" && source.name.trim().length > 0
        ? source.name.trim()
        : id,
    api: source.api,
    provider,
    baseUrl: metadataBaseURL(provider, source.api),
    reasoning: source.reasoning === true,
    input: input.length > 0 ? input : ["text"],
    cost: {
      input: finiteCost(cost.input),
      output: finiteCost(cost.output),
      cacheRead: finiteCost(cost.cacheRead),
      cacheWrite: finiteCost(cost.cacheWrite),
    },
    contextWindow: positiveInteger(
      source.contextWindow,
      DEFAULT_MODEL_CONTEXT_WINDOW,
    ),
    maxTokens: positiveInteger(source.maxTokens, DEFAULT_MODEL_MAX_TOKENS),
  };
}

function augmentCachedCatalog(cache, additions) {
  for (const provider of Object.keys(OPENCODE_DEFAULT_BASE_URLS)) {
    const source = cache?.providers?.[provider];
    if (typeof source !== "object" || source === null) continue;
    const metadata = {
      npm: "@ai-sdk/openai-compatible",
      models: {},
    };
    for (const [id, model] of Object.entries(source.models ?? {})) {
      const clean = sanitizedCachedModel(provider, id, model);
      if (clean !== undefined) metadata.models[id] = clean;
    }
    augmentOpenCodeCatalog(
      provider,
      Object.keys(metadata.models).map((id) => ({ id })),
      metadata,
      additions,
    );
  }
}

function defaultCatalogCachePath() {
  const dshHome =
    typeof process.env.DSH_HOME === "string" &&
    process.env.DSH_HOME.trim().length > 0
      ? process.env.DSH_HOME
      : join(homedir(), ".dsh");
  return join(dshHome, "desktop-opencode-model-metadata.json");
}

export function readCatalogCache(path = defaultCatalogCachePath()) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (
      value?.version !== CATALOG_CACHE_VERSION ||
      typeof value.providers !== "object" ||
      value.providers === null
    ) {
      return { version: CATALOG_CACHE_VERSION, providers: {} };
    }
    return value;
  } catch {
    return { version: CATALOG_CACHE_VERSION, providers: {} };
  }
}

export function writeCatalogCache(cache, path = defaultCatalogCachePath()) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(cache)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export async function discoverModelsDevProvider(
  provider,
  request,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_DISCOVERY_TIMEOUT_MS,
  } = {},
) {
  if (typeof fetchImpl !== "function") {
    throw discoveryError("OpenCode model metadata has no fetch implementation");
  }
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  const signal = request.signal
    ? AbortSignal.any([request.signal, timeout.signal])
    : timeout.signal;
  try {
    const response = await fetchImpl(MODELS_DEV_URL, {
      method: "GET",
      headers: { Accept: "application/json", ...attributionHeaders() },
      signal,
    });
    if (!response.ok) {
      throw discoveryError(
        `${MODELS_DEV_URL} answered ${response.status}; OpenCode model protocols could not be resolved`,
      );
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (declaredLength > MAX_METADATA_BYTES) {
      throw discoveryError("Models.dev metadata response is too large");
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_METADATA_BYTES) {
      throw discoveryError("Models.dev metadata response is too large");
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw discoveryError(`${MODELS_DEV_URL} did not answer with valid JSON`);
    }
    return normalizeModelsDevProvider(body, provider);
  } catch (error) {
    if (error instanceof LlmError) throw error;
    if (request.signal?.aborted) {
      throw discoveryError(
        "OpenCode model metadata aborted by caller",
        "ABORTED",
      );
    }
    if (timeout.signal.aborted) {
      throw discoveryError(
        `OpenCode model metadata timed out while requesting ${MODELS_DEV_URL}`,
        "DISCOVERY_TIMEOUT",
      );
    }
    throw discoveryError(`Could not reach ${MODELS_DEV_URL}`);
  } finally {
    clearTimeout(timer);
  }
}

function providerNpmFromToml(text) {
  const section = text.match(
    /(?:^|\r?\n)\[provider\]\s*\r?\n([\s\S]*?)(?=\r?\n\[|$)/,
  )?.[1];
  return section?.match(/^npm\s*=\s*"([^"]+)"\s*$/m)?.[1];
}

/**
 * Models.dev's CDN is occasionally unreachable from Node/Bun behind proxies.
 * Its public GitHub source remains a precise fallback for the few live IDs the
 * installed pi-ai catalog does not yet know. Only `[provider].npm` is needed
 * here; all other fields keep the official route fallbacks.
 */
export async function discoverModelsDevProviderFromSource(
  provider,
  discovered,
  request,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_DISCOVERY_TIMEOUT_MS,
  } = {},
) {
  if (typeof fetchImpl !== "function") {
    throw discoveryError("OpenCode model metadata has no fetch implementation");
  }
  const catalog = OPENCODE_CATALOGS[provider];
  if (catalog === undefined) {
    throw discoveryError(`unsupported OpenCode provider metadata: ${provider}`);
  }
  const metadata = {
    npm: "@ai-sdk/openai-compatible",
    models: {},
  };
  const unknown = discovered.filter(({ id }) => !Object.hasOwn(catalog, id));
  if (unknown.length === 0) return metadata;

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  const signal = request.signal
    ? AbortSignal.any([request.signal, timeout.signal])
    : timeout.signal;
  try {
    await Promise.all(
      unknown.map(async ({ id }) => {
        const url = `${MODELS_DEV_RAW_BASE_URL}/${provider}/models/${encodeURIComponent(id)}.toml`;
        let packageName = metadata.npm;
        try {
          const response = await fetchImpl(url, {
            method: "GET",
            headers: { Accept: "text/plain", ...attributionHeaders() },
            signal,
          });
          if (response.ok) {
            const text = await response.text();
            if (Buffer.byteLength(text, "utf8") <= 256 * 1024) {
              packageName = providerNpmFromToml(text) ?? packageName;
            }
          }
        } catch (error) {
          // Metadata enrichment is advisory. A caller abort must still cancel
          // discovery, but an unavailable CDN/source must not hide the live
          // OpenCode candidates. In that case use the provider's declared
          // OpenAI-compatible default and enrich on a later refresh.
          if (request.signal?.aborted) throw error;
        }
        const model = fallbackMetadataModel(provider, id, {
          npm: packageName,
          models: {},
        });
        if (model !== undefined) metadata.models[id] = model;
      }),
    );
    return metadata;
  } catch (error) {
    if (error instanceof LlmError) throw error;
    if (request.signal?.aborted) {
      throw discoveryError(
        "OpenCode model metadata aborted by caller",
        "ABORTED",
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function checkedApiKey(raw) {
  const checked = normalizeApiKey(raw);
  if (checked.ok) return checked.value;
  throw discoveryError(
    checked.reason === "empty"
      ? "OpenCode API key is blank"
      : "OpenCode API key contains characters that cannot be sent in an HTTP header",
    INVALID_CREDENTIAL_CODE,
  );
}

function statusMessage(url, status) {
  if (status === 401 || status === 403) {
    return `${url} answered ${status}; check the OpenCode API key`;
  }
  if (status === 404) {
    return `${url} answered 404; check the OpenCode baseURL`;
  }
  if (status === 429) {
    return `${url} answered 429; OpenCode rate-limited model discovery`;
  }
  return `${url} answered ${status}`;
}

/** Perform one uncached OpenCode Go model discovery request. */
export async function discoverOpenCodeModels(
  request,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_DISCOVERY_TIMEOUT_MS,
  } = {},
) {
  const url = modelsUrl(request.baseURL);
  if (request.signal?.aborted) {
    throw discoveryError(
      "OpenCode model discovery aborted by caller",
      "ABORTED",
    );
  }
  if (typeof fetchImpl !== "function") {
    throw discoveryError(
      "OpenCode model discovery has no fetch implementation",
    );
  }

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  const signal = request.signal
    ? AbortSignal.any([request.signal, timeout.signal])
    : timeout.signal;
  const apiKey =
    request.apiKey === undefined ? undefined : checkedApiKey(request.apiKey);

  let response;
  let body;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...attributionHeaders(),
        ...(apiKey === undefined ? {} : { Authorization: `Bearer ${apiKey}` }),
      },
      signal,
    });
    if (!response.ok) {
      throw discoveryError(
        statusMessage(url, response.status),
        "DISCOVERY_FAILED",
        { status: response.status },
      );
    }
    const text = await response.text();
    try {
      body = JSON.parse(text);
    } catch {
      throw discoveryError(`${url} did not answer with valid JSON`);
    }
  } catch (error) {
    if (error instanceof LlmError) throw error;
    if (request.signal?.aborted) {
      throw discoveryError(
        "OpenCode model discovery aborted by caller",
        "ABORTED",
      );
    }
    if (timeout.signal.aborted) {
      throw discoveryError(
        `OpenCode model discovery timed out while requesting ${url}`,
        "DISCOVERY_TIMEOUT",
      );
    }
    throw discoveryError(`Could not reach the OpenCode models endpoint ${url}`);
  } finally {
    clearTimeout(timer);
  }
  return normalizeListing(body);
}

export function isOpenCodeLiveRequest(request) {
  return Object.hasOwn(OPENCODE_DEFAULT_BASE_URLS, request?.provider);
}

export function openCodeBaseURL(request) {
  if (!isOpenCodeLiveRequest(request)) return undefined;
  if (
    typeof request.baseURL === "string" &&
    request.baseURL.trim().length > 0
  ) {
    return request.baseURL;
  }
  return OPENCODE_DEFAULT_BASE_URLS[request.provider];
}

async function resolveStoredApiKey(ctx, provider) {
  if (!Object.hasOwn(OPENCODE_DEFAULT_BASE_URLS, provider)) return undefined;
  const settings = ctx.get("settings");
  const profile = settings?.get(SETTINGS_NAMESPACE)?.providers?.[provider];
  const ref = profile?.apiKeyEnv;
  if (typeof ref !== "string" || ref.length === 0) return undefined;
  const resolved = await ctx.get("credentials")?.resolve(ref);
  return typeof resolved?.value === "string" && resolved.value.length > 0
    ? resolved.value
    : undefined;
}

/**
 * Decorate only the official llm-pi-ai discovery registration. Every other
 * service method, namespace and provider delegates to the official object.
 */
export function createLlmFacade(
  llm,
  {
    fetchImpl = globalThis.fetch,
    metadataFetchImpl = fetchImpl,
    timeoutMs = DEFAULT_DISCOVERY_TIMEOUT_MS,
    resolveApiKey,
    onMetadata,
    additions,
  } = {},
) {
  const registerModelDiscovery = (settingsNs, discover) => {
    if (settingsNs !== SETTINGS_NAMESPACE) {
      return llm.registerModelDiscovery(settingsNs, discover);
    }
    return llm.registerModelDiscovery(settingsNs, async (request) => {
      if (!isOpenCodeLiveRequest(request)) return discover(request);
      const apiKey =
        request.apiKey === undefined
          ? await resolveApiKey?.(request)
          : undefined;
      const probe = {
        ...request,
        baseURL: openCodeBaseURL(request),
        ...(apiKey === undefined ? {} : { apiKey }),
      };
      const [models, metadataResult] = await Promise.all([
        discoverOpenCodeModels(probe, { fetchImpl, timeoutMs }),
        discoverModelsDevProvider(request.provider, request, {
          fetchImpl: metadataFetchImpl,
          timeoutMs: Math.min(timeoutMs, 5_000),
        }).then(
          (value) => ({ value }),
          (error) => ({ error }),
        ),
      ]);
      const metadata =
        metadataResult.value ??
        (await discoverModelsDevProviderFromSource(
          request.provider,
          models,
          request,
          { fetchImpl: metadataFetchImpl, timeoutMs },
        ));
      const managedIds = augmentOpenCodeCatalog(
        request.provider,
        models,
        metadata,
        additions,
      );
      await onMetadata?.(request.provider, metadata, managedIds);
      return models;
    });
  };

  return new Proxy(llm, {
    get(target, property) {
      if (property === "registerModelDiscovery") return registerModelDiscovery;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function createContextFacade(ctx, { additions, onMetadata } = {}) {
  const llm = createLlmFacade(ctx.llm, {
    resolveApiKey: (request) => resolveStoredApiKey(ctx, request.provider),
    additions,
    onMetadata,
  });
  return new Proxy(ctx, {
    get(target, property) {
      if (property === "llm") return llm;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** Run the unmodified official adapter plugin inside the decorated context. */
export function apply(ctx, config = {}) {
  const additions = new Set();
  const cachePath = defaultCatalogCachePath();
  const cache = readCatalogCache(cachePath);
  augmentCachedCatalog(cache, additions);
  ctx.effect(() => () => {
    for (const entry of additions) {
      const separator = entry.indexOf("\0");
      const provider = entry.slice(0, separator);
      const id = entry.slice(separator + 1);
      delete OPENCODE_CATALOGS[provider]?.[id];
    }
  });
  const onMetadata = (provider, metadata, managedIds) => {
    const previous = cache.providers[provider];
    const models = { ...previous?.models };
    for (const id of managedIds) {
      const model =
        metadata.models[id] ?? fallbackMetadataModel(provider, id, metadata);
      if (model !== undefined) models[id] = model;
    }
    cache.providers[provider] = {
      npm: "@ai-sdk/openai-compatible",
      models,
    };
    try {
      writeCatalogCache(cache, cachePath);
    } catch (error) {
      ctx.logger.warn(
        "dsh-desktop-opencode-models: could not persist non-secret model routing metadata",
      );
      ctx.logger.warn(error);
    }
  };
  return applyPiAi(createContextFacade(ctx, { additions, onMetadata }), config);
}
