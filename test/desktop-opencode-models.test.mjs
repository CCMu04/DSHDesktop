import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { Context } from "@deepseek-ai/cordis";
import LlmRuntime from "@deepseek-ai/dsh-llm";
import SettingsProvider from "@deepseek-ai/dsh-settings";
import { OPENCODE_MODELS } from "@earendil-works/pi-ai/providers/opencode.models";
import yaml from "js-yaml";

import * as opencodeModelsPlugin from "../plugins/dsh-desktop-opencode-models/lib/index.js";
import {
  OPENCODE_DEFAULT_BASE_URLS,
  OPENCODE_PROVIDER,
  SETTINGS_NAMESPACE,
  augmentOpenCodeCatalog,
  createLlmFacade,
  discoverModelsDevProviderFromSource,
  discoverOpenCodeModels,
  modelsUrl,
  normalizeModelsDevProvider,
  normalizeListing,
  openCodeBaseURL,
  writeCatalogCache,
} from "../plugins/dsh-desktop-opencode-models/lib/index.js";
import {
  ensureBundledPlugin,
  ensurePluginRuntimeExports,
} from "../lib/builtin-plugin.mjs";

const pluginDirectory = path.resolve("plugins/dsh-desktop-opencode-models");
const previousDshHome = process.env.DSH_HOME;
const testDshHome = mkdtempSync(path.join(os.tmpdir(), "dsh-opencode-home-"));
process.env.DSH_HOME = testDshHome;
after(() => {
  if (previousDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousDshHome;
  rmSync(testDshHome, { recursive: true, force: true });
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function modelsDevBody(overrides = {}) {
  const model = (id, provider) => ({
    id,
    name: id,
    reasoning: true,
    modalities: { input: ["text"], output: ["text"] },
    limit: { context: 100_000, output: 8_000 },
    cost: { input: 0, output: 0 },
    ...(provider === undefined ? {} : { provider: { npm: provider } }),
  });
  return {
    opencode: {
      npm: "@ai-sdk/openai-compatible",
      models: { live: model("live"), ...overrides.opencode },
    },
    "opencode-go": {
      npm: "@ai-sdk/openai-compatible",
      models: { live: model("live"), ...overrides["opencode-go"] },
    },
  };
}

const metadataFetchImpl = async () => jsonResponse(modelsDevBody());

class MemorySettings extends SettingsProvider {
  writable = true;
  saved = {};

  async load() {
    return this.saved;
  }

  async persist(ns, section) {
    this.saved[ns] = structuredClone(section);
  }
}

function discoveryRequest(overrides = {}) {
  return {
    provider: OPENCODE_PROVIDER,
    baseURL: "https://opencode.ai/zen/go/v1",
    api: "openai-completions",
    ...overrides,
  };
}

test("normalizes OpenCode model listings in server order", () => {
  assert.deepEqual(
    normalizeListing({
      object: "list",
      ignored: true,
      data: [
        { id: "first", object: "model", owned_by: "opencode" },
        { id: "second", name: "ignored display name" },
        { id: "first" },
        { id: "" },
        { id: "   " },
        { nope: true },
        null,
        "invalid",
      ],
    }),
    [
      { id: "first", name: "first" },
      { id: "second", name: "second" },
    ],
  );
  assert.deepEqual(normalizeListing({ data: [] }), []);
});

test("rejects invalid top-level listing shapes", () => {
  for (const body of [null, [], {}, { data: {} }, { data: null }]) {
    assert.throws(() => normalizeListing(body), /top-level "data" array/);
  }
});

test("normalizes inference, listing, and chat-completions base URLs", () => {
  assert.equal(
    modelsUrl("https://opencode.ai/zen/go/v1"),
    "https://opencode.ai/zen/go/v1/models",
  );
  assert.equal(
    modelsUrl("https://opencode.ai/zen/go/v1/"),
    "https://opencode.ai/zen/go/v1/models",
  );
  assert.equal(
    modelsUrl("https://opencode.ai/zen/go/v1/models"),
    "https://opencode.ai/zen/go/v1/models",
  );
  assert.equal(
    modelsUrl("https://opencode.ai/zen/go/v1/models/models"),
    "https://opencode.ai/zen/go/v1/models",
  );
  assert.equal(
    modelsUrl("https://opencode.ai/zen/go/v1/chat/completions"),
    "https://opencode.ai/zen/go/v1/models",
  );
  assert.doesNotMatch(modelsUrl("https://example.test/v1"), /\/v1\/v1\//);
  assert.doesNotMatch(
    modelsUrl("https://example.test/v1/chat/completions"),
    /chat\/completions\/models/,
  );
  assert.equal(
    openCodeBaseURL({ provider: "opencode-go" }),
    "https://opencode.ai/zen/go/v1",
  );
  assert.equal(
    openCodeBaseURL({ provider: "opencode" }),
    "https://opencode.ai/zen/v1",
  );
  assert.equal(
    openCodeBaseURL({
      provider: "opencode-go",
      baseURL: "https://gateway.example.test/custom/v1",
    }),
    "https://gateway.example.test/custom/v1",
  );
});

test("rejects unsafe or malformed base URLs", () => {
  for (const value of [
    "",
    "not a url",
    "file:///tmp/models",
    "https://key@example.test/v1",
  ]) {
    assert.throws(() => modelsUrl(value), /baseURL|HTTP\(S\)/);
  }
});

test("maps Models.dev provider overrides to per-model wire protocols", () => {
  const body = modelsDevBody({
    opencode: {
      chat: {
        id: "chat",
        modalities: { input: ["text", "image", "video"] },
        limit: { context: 1_000_000, output: 131_072 },
      },
      responses: {
        id: "responses",
        provider: { npm: "@ai-sdk/openai" },
        modalities: { input: ["text", "image"] },
        limit: { context: 400_000, output: 128_000 },
      },
      messages: {
        id: "messages",
        provider: { npm: "@ai-sdk/anthropic" },
        modalities: { input: ["text"] },
        limit: { context: 200_000, output: 64_000 },
      },
      google: {
        id: "google",
        provider: { npm: "@ai-sdk/google" },
        modalities: { input: ["text", "image"] },
        limit: { context: 1_000_000, output: 64_000 },
      },
    },
  });
  const metadata = normalizeModelsDevProvider(body, "opencode");

  assert.equal(metadata.models.chat.api, "openai-completions");
  assert.equal(metadata.models.responses.api, "openai-responses");
  assert.equal(metadata.models.messages.api, "anthropic-messages");
  assert.equal(metadata.models.google.api, "google-generative-ai");
  assert.equal(metadata.models.messages.baseUrl, "https://opencode.ai/zen");
  assert.deepEqual(metadata.models.chat.input, ["text", "image"]);
});

test("falls back to the public Models.dev source for directory-external protocols", async () => {
  const metadata = await discoverModelsDevProviderFromSource(
    "opencode",
    [
      { id: "desktop-test-source-chat" },
      { id: "desktop-test-source-responses" },
      { id: "desktop-test-source-missing" },
    ],
    {},
    {
      fetchImpl: async (url) => {
        if (url.endsWith("desktop-test-source-responses.toml")) {
          return new Response('[provider]\nnpm = "@ai-sdk/openai"\n', {
            status: 200,
          });
        }
        if (url.endsWith("desktop-test-source-missing.toml")) {
          return new Response("missing", { status: 404 });
        }
        return new Response('name = "Chat"\n', { status: 200 });
      },
    },
  );

  assert.equal(
    metadata.models["desktop-test-source-chat"].api,
    "openai-completions",
  );
  assert.equal(
    metadata.models["desktop-test-source-responses"].api,
    "openai-responses",
  );
  assert.equal(
    metadata.models["desktop-test-source-missing"].api,
    "openai-completions",
  );
});

test("keeps live models usable when both Models.dev metadata sources are unreachable", async () => {
  const metadata = await discoverModelsDevProviderFromSource(
    "opencode",
    [{ id: "nemotron-3.5-lightning-free" }],
    {},
    {
      fetchImpl: async () => {
        throw new TypeError("network unavailable");
      },
    },
  );

  assert.equal(
    metadata.models["nemotron-3.5-lightning-free"].api,
    "openai-completions",
  );
  assert.equal(
    metadata.models["nemotron-3.5-lightning-free"].baseUrl,
    "https://opencode.ai/zen/v1",
  );
});

test("does not fail live discovery when Models.dev and its source are unreachable", async () => {
  const id = "desktop-test-metadata-offline";
  let registered;
  const additions = new Set();
  const llm = {
    registerModelDiscovery(_settingsNs, discover) {
      registered = discover;
      return () => {};
    },
  };
  createLlmFacade(llm, {
    fetchImpl: async () => jsonResponse({ data: [{ id }] }),
    metadataFetchImpl: async () => {
      throw new TypeError("network unavailable");
    },
    additions,
  }).registerModelDiscovery(SETTINGS_NAMESPACE, async () => []);

  try {
    assert.deepEqual(await registered({ provider: "opencode" }), [
      { id, name: id },
    ]);
    assert.equal(OPENCODE_MODELS[id].api, "openai-completions");
  } finally {
    delete OPENCODE_MODELS[id];
  }
});

test("enriches the official mixed catalog so a newly discovered model can be saved", async () => {
  const id = "desktop-test-live-chat-model";
  const metadata = normalizeModelsDevProvider(
    modelsDevBody({
      opencode: {
        [id]: {
          id,
          name: "Live chat model",
          reasoning: true,
          modalities: { input: ["text", "image"] },
          limit: { context: 1_000_000, output: 131_072 },
          cost: { input: 0, output: 0 },
        },
      },
    }),
    "opencode",
  );
  const before = OPENCODE_MODELS["gpt-5.6-sol"];
  assert.deepEqual(augmentOpenCodeCatalog("opencode", [{ id }], metadata), [
    id,
  ]);
  assert.equal(OPENCODE_MODELS[id].api, "openai-completions");
  assert.equal(OPENCODE_MODELS["gpt-5.6-sol"], before);
  assert.equal(before.api, "openai-responses");

  const root = new Context();
  try {
    await root.plugin(LlmRuntime);
    await root.plugin(MemorySettings);
    const fiber = await root.plugin(opencodeModelsPlugin);
    await root.settings.mutate(SETTINGS_NAMESPACE, [
      {
        op: "set",
        path: ["providers", "opencode"],
        value: { models: [{ id: "gpt-5.6-sol" }, { id }] },
      },
    ]);
    assert.deepEqual(
      (await root.llm.listModels("opencode")).map((model) => model.id),
      ["gpt-5.6-sol", id],
    );
    await fiber.dispose();
  } finally {
    delete OPENCODE_MODELS[id];
    await root.fiber.dispose();
  }
});

test("restores only sanitized routing metadata before the official adapter validates settings", async () => {
  const id = "desktop-test-cached-chat-model";
  const cachePath = path.join(
    testDshHome,
    "desktop-opencode-model-metadata.json",
  );
  writeCatalogCache(
    {
      version: 1,
      providers: {
        opencode: {
          npm: "@ai-sdk/openai-compatible",
          models: {
            [id]: {
              id,
              name: "Cached live model",
              api: "openai-completions",
              provider: "tampered-provider",
              baseUrl: "https://attacker.invalid/v1",
              reasoning: true,
              input: ["text", "image", "video"],
              cost: { input: 0, output: 0 },
              contextWindow: 1_000_000,
              maxTokens: 131_072,
            },
          },
        },
      },
    },
    cachePath,
  );

  const root = new Context();
  try {
    await root.plugin(LlmRuntime);
    const fiber = await root.plugin(opencodeModelsPlugin, {
      providers: { opencode: { models: [{ id }] } },
    });
    assert.equal(OPENCODE_MODELS[id].provider, "opencode");
    assert.equal(OPENCODE_MODELS[id].baseUrl, "https://opencode.ai/zen/v1");
    assert.deepEqual(OPENCODE_MODELS[id].input, ["text", "image"]);
    assert.deepEqual(
      (await root.llm.listModels("opencode")).map((model) => model.id),
      [id],
    );
    await fiber.dispose();
    assert.equal(Object.hasOwn(OPENCODE_MODELS, id), false);
  } finally {
    delete OPENCODE_MODELS[id];
    rmSync(cachePath, { force: true });
    await root.fiber.dispose();
  }
});

test("performs an authenticated uncached GET for every discovery", async () => {
  const calls = [];
  const replies = [
    { data: [{ id: "first-live" }] },
    { data: [{ id: "second-live" }, { id: "new-model" }] },
  ];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse(replies.shift());
  };
  const request = discoveryRequest({ apiKey: "  top-secret  " });

  assert.deepEqual(await discoverOpenCodeModels(request, { fetchImpl }), [
    { id: "first-live", name: "first-live" },
  ]);
  assert.deepEqual(await discoverOpenCodeModels(request, { fetchImpl }), [
    { id: "second-live", name: "second-live" },
    { id: "new-model", name: "new-model" },
  ]);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url, "https://opencode.ai/zen/go/v1/models");
    assert.equal(call.options.method, "GET");
    assert.equal(call.options.headers.Authorization, "Bearer top-secret");
    assert.equal(call.options.signal instanceof AbortSignal, true);
  }
});

test("accepts an empty live catalog", async () => {
  const models = await discoverOpenCodeModels(discoveryRequest(), {
    fetchImpl: async () => jsonResponse({ object: "list", data: [] }),
  });
  assert.deepEqual(models, []);
});

test("reports malformed JSON and unexpected successful responses", async () => {
  await assert.rejects(
    discoverOpenCodeModels(discoveryRequest(), {
      fetchImpl: async () => new Response("{broken", { status: 200 }),
    }),
    /valid JSON/,
  );
  await assert.rejects(
    discoverOpenCodeModels(discoveryRequest(), {
      fetchImpl: async () => jsonResponse({ models: [] }),
    }),
    /top-level "data" array/,
  );
});

test("preserves meaningful HTTP status failures", async () => {
  for (const status of [401, 403, 404, 429, 500, 502, 503]) {
    await assert.rejects(
      discoverOpenCodeModels(discoveryRequest(), {
        fetchImpl: async () => new Response("ignored", { status }),
      }),
      (error) => {
        assert.equal(error.failure?.status, status);
        assert.match(error.message, new RegExp(String(status)));
        return true;
      },
    );
  }
});

test("reports network failures without leaking the API key", async () => {
  const secret = "never-print-this-key";
  let failure;
  try {
    await discoverOpenCodeModels(discoveryRequest({ apiKey: secret }), {
      fetchImpl: async () => {
        throw new Error(`transport failed after receiving ${secret}`);
      },
    });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof Error);
  assert.doesNotMatch(failure.message, new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(failure), new RegExp(secret));
  assert.equal(failure.cause, undefined);
});

test("honors caller abort and an internal timeout", async () => {
  const waitingFetch = (_url, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    });

  const controller = new AbortController();
  const aborted = discoverOpenCodeModels(
    discoveryRequest({ signal: controller.signal }),
    { fetchImpl: waitingFetch, timeoutMs: 1_000 },
  );
  controller.abort();
  await assert.rejects(aborted, (error) => error.code === "ABORTED");

  await assert.rejects(
    discoverOpenCodeModels(discoveryRequest(), {
      fetchImpl: waitingFetch,
      timeoutMs: 5,
    }),
    (error) => error.code === "DISCOVERY_TIMEOUT",
  );
});

test("decorates only opencode-go in the official llm-pi-ai namespace", async () => {
  let registered;
  let disposed = 0;
  let genericCalls = 0;
  let fetchCalls = 0;
  const llm = {
    marker: 41,
    registerModelDiscovery(settingsNs, discover) {
      registered = { settingsNs, discover };
      return () => {
        registered = undefined;
        disposed += 1;
      };
    },
    listModels(provider) {
      return [this.marker, provider];
    },
  };
  const facade = createLlmFacade(llm, {
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ data: [{ id: "live" }] });
    },
    metadataFetchImpl,
  });
  const dispose = facade.registerModelDiscovery(
    SETTINGS_NAMESPACE,
    async (request) => {
      genericCalls += 1;
      return [{ id: `generic:${request.provider}` }];
    },
  );

  assert.equal(registered.settingsNs, SETTINGS_NAMESPACE);
  assert.deepEqual(await registered.discover(discoveryRequest()), [
    { id: "live", name: "live" },
  ]);
  assert.deepEqual(
    await registered.discover(
      discoveryRequest({
        provider: "openai",
        baseURL: "https://api.openai.com/v1",
      }),
    ),
    [{ id: "generic:openai" }],
  );
  assert.equal(fetchCalls, 1);
  assert.equal(genericCalls, 1);
  assert.deepEqual(facade.listModels("anything"), [41, "anything"]);

  dispose();
  assert.equal(disposed, 1);
  assert.equal(registered, undefined);
});

test("uses live Zen and Go defaults when the native provider cards omit baseURL", async () => {
  const calls = [];
  let registered;
  let genericCalls = 0;
  const llm = {
    registerModelDiscovery(_settingsNs, discover) {
      registered = discover;
      return () => {};
    },
  };
  createLlmFacade(llm, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ data: [{ id: `live-${calls.length}` }] });
    },
    metadataFetchImpl: async () =>
      jsonResponse(
        modelsDevBody({
          "opencode-go": {
            "live-1": {
              id: "live-1",
              modalities: { input: ["text"] },
              limit: { context: 100_000, output: 8_000 },
            },
          },
          opencode: {
            "live-2": {
              id: "live-2",
              modalities: { input: ["text"] },
              limit: { context: 100_000, output: 8_000 },
            },
          },
        }),
      ),
    resolveApiKey: async ({ provider }) => `stored-${provider}`,
  }).registerModelDiscovery(SETTINGS_NAMESPACE, async () => {
    genericCalls += 1;
    return [];
  });

  assert.deepEqual(await registered({ provider: "opencode-go" }), [
    { id: "live-1", name: "live-1" },
  ]);
  assert.deepEqual(await registered({ provider: "opencode" }), [
    { id: "live-2", name: "live-2" },
  ]);
  assert.deepEqual(
    calls.map(({ url }) => url),
    [
      `${OPENCODE_DEFAULT_BASE_URLS["opencode-go"]}/models`,
      `${OPENCODE_DEFAULT_BASE_URLS.opencode}/models`,
    ],
  );
  assert.equal(
    calls[0].options.headers.Authorization,
    "Bearer stored-opencode-go",
  );
  assert.equal(
    calls[1].options.headers.Authorization,
    "Bearer stored-opencode",
  );
  assert.equal(genericCalls, 0);
});

test("leaves discoveries registered for other settings namespaces untouched", async () => {
  const callback = async () => [{ id: "untouched" }];
  let received;
  const llm = {
    registerModelDiscovery(settingsNs, discover) {
      received = { settingsNs, discover };
      return () => {};
    },
  };
  createLlmFacade(llm).registerModelDiscovery("another-namespace", callback);
  assert.equal(received.settingsNs, "another-namespace");
  assert.equal(received.discover, callback);
});

test("loads the official adapter through Cordis and disposes every registration on unload", async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    if (url === "https://models.dev/api.json") {
      return jsonResponse(
        modelsDevBody({
          "opencode-go": {
            "cordis-live-1": {
              id: "cordis-live-1",
              modalities: { input: ["text"] },
              limit: { context: 100_000, output: 8_000 },
            },
          },
          opencode: {
            "cordis-live-2": {
              id: "cordis-live-2",
              modalities: { input: ["text"] },
              limit: { context: 100_000, output: 8_000 },
            },
          },
        }),
      );
    }
    urls.push(url);
    return jsonResponse({ data: [{ id: `cordis-live-${urls.length}` }] });
  };
  const root = new Context();
  try {
    await root.plugin(LlmRuntime);
    const fiber = await root.plugin(opencodeModelsPlugin);
    assert.equal(
      root.llm
        .listConfigurableProviders()
        .some(
          (entry) =>
            entry.provider === OPENCODE_PROVIDER &&
            entry.settingsNs === SETTINGS_NAMESPACE,
        ),
      true,
    );
    assert.deepEqual(
      await root.llm.discoverModels(SETTINGS_NAMESPACE, {
        provider: OPENCODE_PROVIDER,
      }),
      [{ id: "cordis-live-1", name: "cordis-live-1" }],
    );
    assert.deepEqual(
      await root.llm.discoverModels(SETTINGS_NAMESPACE, {
        provider: "opencode",
      }),
      [{ id: "cordis-live-2", name: "cordis-live-2" }],
    );
    assert.deepEqual(urls, [
      "https://opencode.ai/zen/go/v1/models",
      "https://opencode.ai/zen/v1/models",
    ]);
    assert.equal(
      root.llm
        .listConfigurableProviders()
        .some(
          (entry) =>
            entry.provider === "opencode" &&
            entry.settingsNs === SETTINGS_NAMESPACE,
        ),
      true,
    );

    await fiber.dispose();
    await assert.rejects(
      root.llm.discoverModels(SETTINGS_NAMESPACE, discoveryRequest()),
      (error) => error.code === "NO_DISCOVERY",
    );
    assert.deepEqual(root.llm.listConfigurableProviders(), []);
  } finally {
    globalThis.fetch = originalFetch;
    await root.fiber.dispose();
  }
});

test("the plugin patch replaces the stock row through the existing bundle mechanism", () => {
  const manifest = JSON.parse(
    readFileSync(path.join(pluginDirectory, "package.json"), "utf8"),
  );
  const patches = yaml.load(
    readFileSync(path.join(pluginDirectory, "cordis.patch.yml"), "utf8"),
  );
  assert.equal(manifest.name, "dsh-desktop-opencode-models");
  assert.equal(manifest.dsh.bundle.patch, "./cordis.patch.yml");
  assert.equal(manifest.exports["./client"], "./lib/client.js");
  assert.deepEqual(patches[0], {
    id: "llm-pi-ai",
    name: "@deepseek-ai/dsh-llm-pi-ai",
    disabled: true,
  });
  assert.deepEqual(patches[1].insert, [
    {
      id: "dsh-desktop-opencode-models",
      name: "dsh-desktop-opencode-models",
    },
  ]);
});

test("the existing content-fingerprint deployment installs the new plugin", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "dsh-opencode-plugin-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let installed;
  const result = await ensureBundledPlugin({
    sourceDirectory: pluginDirectory,
    userDataDirectory: path.join(root, "user-data"),
    dshHome: path.join(root, "dsh-home"),
    packageName: "dsh-desktop-opencode-models",
    install: async (target) => {
      installed = target;
    },
  });

  assert.equal(result.changed, true);
  assert.equal(installed, result.targetDirectory);
  assert.equal(existsSync(path.join(installed, "cordis.patch.yml")), true);
  assert.equal(existsSync(path.join(installed, "lib", "index.js")), true);

  ensurePluginRuntimeExports({
    userDataDirectory: path.join(root, "user-data"),
    runtimeNodeModulesDirectory: path.resolve("node_modules"),
  });
  const deployed = await import(
    `${pathToFileURL(path.join(installed, "lib", "index.js")).href}?deployed=1`
  );
  assert.equal(deployed.name, "dsh-desktop-opencode-models");
});

test("the required client half is a no-op and does not modify the UI", () => {
  const loaded = [];
  const previousWindow = globalThis.window;
  globalThis.window = {
    __ModuleLoader__: {
      load(entry) {
        loaded.push(entry);
      },
    },
  };
  try {
    const source = readFileSync(
      path.join(pluginDirectory, "lib", "client.js"),
      "utf8",
    );
    (0, eval)(source);
    assert.equal(loaded.length, 1);
    const exported = loaded[0].factory();
    assert.deepEqual(exported.inject, []);
    assert.equal(exported.apply(), undefined);
  } finally {
    globalThis.window = previousWindow;
  }
});
