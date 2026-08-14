window.__ModuleLoader__.load({
	id: "dsh-desktop-ui",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let react_dom = require("react-dom");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region styles
		const css = ".dshDesktopUi_trigger{min-height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;border-radius:6px;align-items:center;gap:3px;padding:3px 2px;font-size:12px;line-height:18px;display:inline-flex}.dshDesktopUi_trigger:hover:not(:disabled),.dshDesktopUi_trigger:focus-visible{color:var(--dsw-alias-label-secondary)}.dshDesktopUi_trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:wait}.dshDesktopUi_trigger svg,.dshDesktopUi_trigger span{flex:none}.dshDesktopUi_trigger span{white-space:nowrap}";
		const tagId = "dsh-desktop-ui/HeaderAction.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-desktop-ui";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region lib/client/settings-drawer.js
		/**
		* Turn the shipped centered settings modal into a left-side drawer via CSS.
		* The shipped settings panel is
		* `div[role="presentation"] > div[role="dialog"][aria-modal="true"][aria-labelledby]`
		* (the primitives Modal uses `aria-label`, so it stays untouched): the
		* shipped mask stays visible (dim + blur, with a fade-in), the panel docks
		* to the left edge at full height with a slide-in animation. Clicking the
		* mask or pressing Escape closes; the close shim plays the slide-out first.
		*/
		const drawerCss = 'div[role="presentation"]:has(> div[role="dialog"][aria-modal="true"][aria-labelledby]) > div[aria-hidden="true"]{animation:dduiMaskFadeIn .22s ease-out !important}@keyframes dduiMaskFadeIn{from{opacity:0}to{opacity:1}}div[role="presentation"]:has(> div[role="dialog"][aria-modal="true"][aria-labelledby]) > div[aria-hidden="true"].ddui_closing{animation:dduiMaskFadeOut .22s ease-out forwards !important}@keyframes dduiMaskFadeOut{from{opacity:1}to{opacity:0}}div[role="presentation"] > div[role="dialog"][aria-modal="true"][aria-labelledby]{position:fixed !important;top:0 !important;left:0 !important;bottom:0 !important;right:auto !important;width:min(720px,100vw) !important;max-width:min(720px,100vw) !important;height:100vh !important;max-height:100vh !important;margin:0 !important;border-radius:0 24px 24px 0 !important;animation:dduiSettingsSlideIn .22s ease-out !important}@keyframes dduiSettingsSlideIn{from{transform:translateX(-100%)}to{transform:translateX(0)}}div[role="presentation"] > div[role="dialog"][aria-modal="true"][aria-labelledby].ddui_closing{animation:dduiSettingsSlideOut .22s ease-out forwards !important}@keyframes dduiSettingsSlideOut{from{transform:translateX(0)}to{transform:translateX(-100%)}}';
		const drawerTagId = "dsh-desktop-ui/SettingsDrawer.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(drawerTagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-desktop-ui";
			tag.dataset.pluginCss = drawerTagId;
			tag.textContent = drawerCss;
			document.head.appendChild(tag);
		}
		/**
		* Close-animation shim: the shipped settings root unmounts the panel
		* instantly on close and CSS cannot animate an unmounted element. This shim
		* intercepts every close path (close button, mask/outside click, Escape) in
		* the capture phase, plays the slide-out animation, then completes the close
		* through the shipped handlers (re-dispatching the original event, a
		* synthetic click on the mask, or the Escape key). The panel's structural
		* layout mirrors the shipped SettingsPanel DOM.
		*/
		function installSettingsDrawerShim() {
			const panelSelector = 'div[role="presentation"] > div[role="dialog"][aria-modal="true"][aria-labelledby]';
			let pending = null;
			let bypassing = false;
			const finishClose = () => {
				const task = pending;
				pending = null;
				if (task === null) return;
				task.panel.classList.remove("ddui_closing");
				const overlay = task.panel.parentElement;
				const mask = overlay === null ? null : overlay.children[0];
				if (mask !== null) mask.classList.remove("ddui_closing");
				bypassing = true;
				try {
					if (task.mode === "keydown") {
						document.dispatchEvent(new KeyboardEvent("keydown", { key: task.key, bubbles: true, cancelable: true }));
					} else if (task.mode === "outside") {
						const overlay = task.panel.parentElement;
						const mask = overlay === null ? null : overlay.children[0];
						if (mask !== null) mask.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
					} else {
						task.target.dispatchEvent(new MouseEvent(task.type, { bubbles: true, cancelable: true }));
					}
				} finally {
					bypassing = false;
				}
			};
			const playClose = (panel, event, mode) => {
				if (pending !== null) return;
				panel.classList.add("ddui_closing");
				const overlay = panel.parentElement;
				const mask = overlay === null ? null : overlay.children[0];
				if (mask !== null) mask.classList.add("ddui_closing");
				pending = {
					panel,
					target: event.target,
					type: event.type,
					key: event.key,
					mode
				};
				setTimeout(finishClose, 240);
			};
			const onClickCapture = (event) => {
				if (bypassing || pending !== null) return;
				const panel = typeof event.target?.closest === "function" ? event.target.closest(panelSelector) : void 0;
				if (panel !== void 0 && panel !== null) {
					const overlay = panel.parentElement;
					const mask = overlay === null ? void 0 : overlay.children[0];
					const content = panel.children[1];
					const header = content === void 0 ? void 0 : content.children[0];
					const closeButton = header === void 0 ? void 0 : header.lastElementChild;
					const isClose = closeButton !== void 0 && closeButton !== null && closeButton.contains(event.target);
					const isMask = mask !== void 0 && event.target === mask;
					if (!isClose && !isMask) return;
					event.stopImmediatePropagation();
					playClose(panel, event, "target");
					return;
				}
				const openPanel = document.querySelector(panelSelector);
				if (openPanel === null) return;
				event.stopImmediatePropagation();
				playClose(openPanel, event, "outside");
			};
			const onKeyDownCapture = (event) => {
				if (bypassing || pending !== null) return;
				if (event.key !== "Escape") return;
				const panel = document.querySelector(panelSelector);
				if (panel === null) return;
				event.stopImmediatePropagation();
				playClose(panel, event);
			};
			document.addEventListener("click", onClickCapture, true);
			document.addEventListener("keydown", onKeyDownCapture, true);
			return () => {
				document.removeEventListener("click", onClickCapture, true);
				document.removeEventListener("keydown", onKeyDownCapture, true);
			};
		}
		//#endregion
		//#region lib/client/plugin-list.js
		/** Grouped plugin inventory styles (preset vs user plugins). */
		const pluginCss = '.dduiP_section{width:100%;max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:14px;display:flex}.dduiP_catalog{flex-direction:column;gap:16px;display:flex}.dduiP_group{flex-direction:column;gap:10px;display:flex}.dduiP_groupTitle{align-items:baseline;gap:7px;margin:0;padding:0 2px;font-size:13px;font-weight:600;line-height:20px;display:flex}.dduiP_groupTitle span{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:12px;line-height:18px}.dduiP_cards{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:10px;margin:0;padding:0;list-style:none;display:grid}.dduiP_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;min-width:0;overflow:hidden}.dduiP_card[data-open=true]{border-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-shadow-lv1)}.dduiP_cardContent{box-sizing:border-box;width:100%;min-height:52px;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;justify-content:space-between;align-items:center;gap:12px;padding:12px 14px;display:flex}.dduiP_cardContent:hover,.dduiP_card[data-open=true]>.dduiP_cardContent{background:var(--dsw-alias-interactive-bg-hover)}.dduiP_cardContent:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.dduiP_cardTitle{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:14px;font-weight:600;line-height:20px;overflow:hidden}.dduiP_cardTrailing{color:var(--dsw-alias-label-tertiary);flex:none;align-items:center;gap:7px;display:inline-flex}.dduiP_statusDot{background:var(--dsw-alias-label-tertiary);border-radius:999px;flex:none;width:7px;height:7px;display:inline-block}.dduiP_statusDot[data-phase=active]{background:var(--dsw-alias-state-success-primary)}.dduiP_statusDot[data-phase=failed]{background:var(--dsw-alias-state-error-primary)}.dduiP_statusDot[data-phase=loading]{background:var(--dsw-alias-state-business-primary)}.dduiP_configTag{background:var(--dsw-alias-bg-layer-1);min-height:20px;color:var(--dsw-alias-label-secondary);white-space:nowrap;border-radius:5px;align-items:center;padding:1px 6px;font-size:11px;line-height:16px;display:inline-flex}.dduiP_configTag[data-enabled=true]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);color:var(--dsw-alias-state-success-primary)}.dduiP_chevron{color:var(--dsw-alias-label-tertiary);flex:none}.dduiP_card[data-open=true] .dduiP_chevron{transform:rotate(180deg)}.dduiP_cardDetails{border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);padding:10px 14px 12px}.dduiP_entryValue{overflow-wrap:anywhere;color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;display:block}.dduiP_details{grid-template-columns:76px minmax(0,1fr);gap:6px 10px;margin:8px 0 0;display:grid}.dduiP_details div{display:contents}.dduiP_details dt{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}.dduiP_details dd{overflow-wrap:anywhere;min-width:0;color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;line-height:17px}.dduiP_search{width:100%;color:var(--dsw-alias-label-tertiary);align-items:center;display:flex;position:relative}.dduiP_search>svg{pointer-events:none;position:absolute;left:12px}.dduiP_search input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);width:100%;height:36px;color:var(--dsw-alias-label-primary);font:inherit;border-radius:8px;outline:none;padding:0 34px 0 36px;font-size:13px}.dduiP_search input::placeholder{color:var(--dsw-alias-label-tertiary)}.dduiP_search input:focus-visible{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent)}.dduiP_status,.dduiP_failure p{margin:0}.dduiP_status,.dduiP_failure{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}.dduiP_failure{color:var(--dsw-alias-state-error-primary);align-items:center;gap:10px;display:flex}.dduiP_failure button{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;background:0 0;border-radius:6px;padding:4px 10px}.dduiP_hidden{clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}@media (prefers-reduced-motion:no-preference){.dduiP_chevron{transition:transform .14s var(--ds-ease-in-out)}}@media (width<=680px){.dduiP_cards{grid-template-columns:minmax(0,1fr)}}';
		const pluginTagId = "dsh-desktop-ui/PluginListBySource.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(pluginTagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-desktop-ui";
			tag.dataset.pluginCss = pluginTagId;
			tag.textContent = pluginCss;
			document.head.appendChild(tag);
		}
		/** Fiber phase keys for the status label lookup. */
		const dduiPhaseKeys = {
			pending: "plugin.pending",
			loading: "plugin.loadingPhase",
			active: "plugin.active",
			failed: "plugin.failed",
			unloading: "plugin.unloading"
		};
		/** Localized label for one root Fiber phase. */
		function dduiPhaseLabel(phase, t) {
			return phase === null ? t("plugin.unobserved") : t(dduiPhaseKeys[phase] ?? "plugin.unobserved");
		}
		/** Compact a module specifier without guessing whether its Loader id was generated. */
		function dduiShortName(moduleName) {
			return (moduleName.startsWith("@") ? moduleName.slice(moduleName.indexOf("/") + 1) : moduleName).replace(/^cordis:/, "").replace(/^cordis-plugin-/, "").replace(/^dsh-(?:host-|client-)?/, "");
		}
		/** Whether an inventory row matches the local catalog query. */
		function dduiMatches(entry, normalizedQuery) {
			if (normalizedQuery.length === 0) return true;
			return [entry.moduleName, entry.entryId].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
		}
		/** Read the Host plugin inventory through the shared read-only remote. */
		function desktopUiPluginList(ctx) {
			return async () => {
				const result = await ctx.remote.pluginInventory.list();
				if (!result.ok) throw new Error(`pluginInventory.list failed: ${result.error.code}: ${result.error.message}`);
				return result.value;
			};
		}
		/** Whether an inventory row belongs to the shipped platform (preset group). */
		function dduiIsPreset(moduleName) {
			return moduleName.startsWith("@deepseek-ai/") || moduleName.startsWith("cordis:");
		}
		/**
		* The Plugins section builds its tab bar AND panels from the RAW slot
		* ledger, so a same-id shadow registration yields both a duplicate tab
		* button and a duplicate tab panel (two live component instances). This
		* watcher dedupes: for every `[role="tablist"]`, buttons with the same
		* visible text keep only the last one (ours registers last), and sibling
		* `[role="tabpanel"]` elements with the same id keep only the last one.
		*/
		function installPluginTabsDedup() {
			const dedupe = () => {
				for (const tablist of document.querySelectorAll('[role="tablist"]')) {
					const seen = /* @__PURE__ */ new Map();
					for (const button of tablist.querySelectorAll(":scope > button")) {
						const text = button.textContent ?? "";
						const previous = seen.get(text);
						if (previous !== void 0) previous.remove();
						seen.set(text, button);
					}
					const section = tablist.parentElement;
					if (section === null) continue;
					const panelSeen = /* @__PURE__ */ new Map();
					for (const panel of section.querySelectorAll(':scope > [role="tabpanel"]')) {
						const previous = panelSeen.get(panel.id);
						if (previous !== void 0) previous.remove();
						panelSeen.set(panel.id, panel);
					}
				}
			};
			const observer = new MutationObserver(dedupe);
			observer.observe(document.body, { childList: true, subtree: true });
			dedupe();
			return () => {
				observer.disconnect();
			};
		}
		/** Grouped plugin inventory: preset (platform) vs the user's own plugins. */
		function PluginListBySource({ list, t }) {
			const catalogId = react.useId();
			const [request, setRequest] = react.useState(0);
			const [query, setQuery] = react.useState("");
			const [expanded, setExpanded] = react.useState(null);
			const [state, setState] = react.useState({ status: "loading" });
			react.useEffect(() => {
				let current = true;
				Promise.resolve().then(() => list()).then((snapshot) => {
					if (current) setState({
						status: "ready",
						snapshot
					});
				}, () => {
					if (current) setState({ status: "error" });
				});
				return () => {
					current = false;
				};
			}, [list, request]);
			const normalizedQuery = query.trim().toLocaleLowerCase();
			const filteredEntries = react.useMemo(() => state.status === "ready" ? state.snapshot.entries.filter((entry) => dduiMatches(entry, normalizedQuery)) : [], [normalizedQuery, state]);
			react.useEffect(() => {
				if (expanded !== null && !filteredEntries.some((entry) => entry.entryId === expanded)) setExpanded(null);
			}, [expanded, filteredEntries]);
			const retry = () => {
				setState({ status: "loading" });
				setRequest((value) => value + 1);
			};
			const renderCard = (entry) => {
				const status = dduiPhaseLabel(entry.fiberPhase, t);
				const title = dduiShortName(entry.moduleName);
				const configuration = t(entry.enabled ? "plugin.enabled" : "plugin.disabled");
				const open = expanded === entry.entryId;
				const detailId = `${catalogId}-details-${encodeURIComponent(entry.entryId)}`;
				return (0, react_jsx_runtime.jsxs)("li", {
					className: "dduiP_card",
					"data-plugin-entry": entry.entryId,
					"data-open": open ? "true" : void 0,
					children: [(0, react_jsx_runtime.jsxs)("button", {
						className: "dduiP_cardContent",
						type: "button",
						"aria-expanded": open,
						"aria-controls": detailId,
						"aria-label": entry.enabled ? `${title}, ${status}, ${configuration}` : `${title}, ${configuration}`,
						onClick: () => {
							setExpanded((current) => current === entry.entryId ? null : entry.entryId);
						},
						children: [(0, react_jsx_runtime.jsx)("strong", {
							className: "dduiP_cardTitle",
							title: entry.moduleName,
							children: title
						}), (0, react_jsx_runtime.jsxs)("span", {
							className: "dduiP_cardTrailing",
							children: [
								entry.enabled ? (0, react_jsx_runtime.jsx)("span", {
									className: "dduiP_statusDot",
									"data-phase": entry.fiberPhase ?? "unobserved",
									role: "img",
									"aria-label": status,
									title: status
								}) : null,
								(0, react_jsx_runtime.jsx)("span", {
									className: "dduiP_configTag",
									"data-enabled": entry.enabled ? "true" : "false",
									children: configuration
								}),
								(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, {
									className: "dduiP_chevron",
									size: 12,
									"aria-hidden": "true"
								})
							]
						})]
					}), open ? (0, react_jsx_runtime.jsxs)("div", {
						className: "dduiP_cardDetails",
						id: detailId,
						children: [(0, react_jsx_runtime.jsx)("code", {
							className: "dduiP_entryValue",
							"data-loader-entry": true,
							children: entry.entryId
						}), (0, react_jsx_runtime.jsxs)("dl", {
							className: "dduiP_details",
							children: [(0, react_jsx_runtime.jsxs)("div", {
								children: [(0, react_jsx_runtime.jsx)("dt", {
									children: t("plugin.configuration")
								}), (0, react_jsx_runtime.jsx)("dd", {
									children: configuration
								})]
							}), entry.enabled ? (0, react_jsx_runtime.jsxs)("div", {
								children: [(0, react_jsx_runtime.jsx)("dt", {
									children: t("plugin.cordis")
								}), (0, react_jsx_runtime.jsx)("dd", {
									children: status
								})]
							}) : null]
						})]
					}) : null]
				}, entry.entryId);
			};
			const presets = filteredEntries.filter((entry) => dduiIsPreset(entry.moduleName));
			const users = filteredEntries.filter((entry) => !dduiIsPreset(entry.moduleName));
			return (0, react_jsx_runtime.jsxs)("div", {
				className: "dduiP_section",
				"aria-busy": state.status === "loading",
				children: [
					state.status === "loading" ? (0, react_jsx_runtime.jsx)("p", {
						className: "dduiP_status",
						children: t("plugin.loading")
					}) : null,
					state.status === "error" ? (0, react_jsx_runtime.jsxs)("div", {
						className: "dduiP_failure",
						children: [(0, react_jsx_runtime.jsx)("p", {
							role: "alert",
							children: t("plugin.error")
						}), (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: retry,
							children: t("plugin.retry")
						})]
					}) : null,
					state.status === "ready" ? (0, react_jsx_runtime.jsxs)("div", {
						className: "dduiP_catalog",
						children: [
							(0, react_jsx_runtime.jsxs)("label", {
								className: "dduiP_search",
								children: [
									(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutline16, { "aria-hidden": "true" }),
									(0, react_jsx_runtime.jsx)("span", {
										className: "dduiP_hidden",
										children: t("plugin.search")
									}),
									(0, react_jsx_runtime.jsx)("input", {
										type: "search",
										value: query,
										placeholder: t("plugin.search"),
										"aria-label": t("plugin.search"),
										onChange: (event) => {
											setQuery(event.currentTarget.value);
										}
									})
								]
							}),
							state.snapshot.entries.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
								className: "dduiP_status",
								children: t("plugin.empty")
							}) : null,
							state.snapshot.entries.length > 0 && filteredEntries.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
								className: "dduiP_status",
								children: t("plugin.emptySearch")
							}) : null,
							users.length > 0 ? (0, react_jsx_runtime.jsxs)("section", {
								className: "dduiP_group",
								children: [(0, react_jsx_runtime.jsxs)("h3", {
									className: "dduiP_groupTitle",
									children: [t("plugin.myGroup"), (0, react_jsx_runtime.jsx)("span", {
										"data-plugin-count": users.length,
										children: users.length
									})]
								}), (0, react_jsx_runtime.jsx)("ul", {
									className: "dduiP_cards",
									children: users.map(renderCard)
								})]
							}) : null,
							presets.length > 0 ? (0, react_jsx_runtime.jsxs)("section", {
								className: "dduiP_group",
								children: [(0, react_jsx_runtime.jsxs)("h3", {
									className: "dduiP_groupTitle",
									children: [t("plugin.presetGroup"), (0, react_jsx_runtime.jsx)("span", {
										"data-plugin-count": presets.length,
										children: presets.length
									})]
								}), (0, react_jsx_runtime.jsx)("ul", {
									className: "dduiP_cards",
									children: presets.map(renderCard)
								})]
							}) : null
						]
					}) : null
				]
			});
		}
		//#endregion
		//#region lib/client/toast.js
		/** Lightweight toast styles (top-center, auto-dismiss). */
		const toastCss = '.dduiToast{box-sizing:border-box;position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:3000;align-items:flex-start;gap:8px;max-width:min(480px,calc(100vw - 32px));padding:9px 14px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);box-shadow:var(--dsw-shadow-lv2);color:var(--dsw-alias-label-primary);border-radius:10px;display:flex;animation:dduiToastIn .2s ease-out}.dduiToast[data-kind=error]{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}.dduiToastIcon{flex:none;margin-top:2px;display:inline-flex}.dduiToast[data-kind=success] .dduiToastIcon{color:var(--dsw-alias-state-success-primary)}.dduiToast[data-kind=error] .dduiToastIcon{color:var(--dsw-alias-state-error-primary)}.dduiToastText{min-width:0;font-size:13px;line-height:20px;overflow-wrap:anywhere}@keyframes dduiToastIn{from{opacity:0;transform:translateX(-50%) translateY(-8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
		const toastTagId = "dsh-desktop-ui/Toast.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(toastTagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-desktop-ui";
			tag.dataset.pluginCss = toastTagId;
			tag.textContent = toastCss;
			document.head.appendChild(tag);
		}
		/** Single-slot toast state: the newest message replaces the previous one. */
		const dshToastStore = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)({
			toast: null
		});
		/** Monotonic toast sequence so re-showing the same text restarts the timer. */
		let dshToastSeq = 0;
		/** Show one lightweight toast (kind: "success" | "error"). */
		function showDesktopToast(kind, text) {
			dshToastStore.update((state) => {
				state.toast = {
					id: ++dshToastSeq,
					kind,
					text
				};
			});
		}
		/** Toast host: renders the current toast in the frame-wide overlay seat. */
		function DesktopUiToastHost({ useToastState }) {
			const toast = useToastState((state) => state.toast);
			react.useEffect(() => {
				if (toast === null) return;
				const timer = setTimeout(() => {
					dshToastStore.update((state) => {
						state.toast = null;
					});
				}, 3200);
				return () => {
					clearTimeout(timer);
				};
			}, [toast]);
			if (toast === null) return null;
			/* Body portal so a transformed/filtered ancestor cannot trap the
			fixed banner below the app's own overlays. */
			return react_dom.createPortal((0, react_jsx_runtime.jsxs)("div", {
				className: "dduiToast",
				"data-kind": toast.kind,
				role: "status",
				children: [
					(0, react_jsx_runtime.jsx)("span", {
						className: "dduiToastIcon",
						"aria-hidden": "true",
						children: toast.kind === "error"
							? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutline16, { size: 14 })
							: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, { size: 14 })
					}),
					(0, react_jsx_runtime.jsx)("span", {
						className: "dduiToastText",
						children: toast.text
					})
				]
			}), document.body);
		}
		//#endregion
		//#region lib/client/context-menu.js
		/** Right-click / selection-copy styles. */
		const ctxCss = '.dduiCtx{box-sizing:border-box;position:fixed;z-index:3000;min-width:132px;padding:3px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);box-shadow:var(--dsw-shadow-lv3);border-radius:8px;flex-direction:column;gap:1px;margin:0;list-style:none;display:flex;animation:dduiCtxIn .12s ease-out}.dduiCtx button{box-sizing:border-box;width:100%;min-height:26px;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;background:0 0;border:0;border-radius:6px;align-items:center;gap:8px;padding:4px 8px;font:inherit;font-size:12px;line-height:18px;display:flex}.dduiCtx button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.dduiCtx button:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}.dduiCtxSep{height:1px;background:var(--dsw-alias-border-l2);flex:none;margin:3px 6px}@keyframes dduiCtxIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}';
		const ctxTagId = "dsh-desktop-ui/ContextMenu.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(ctxTagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-desktop-ui";
			tag.dataset.pluginCss = ctxTagId;
			tag.textContent = ctxCss;
			document.head.appendChild(tag);
		}
		/** Floating surface state: the right-click menu (with its copy payload). */
		const dshFloatStore = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)({
			menu: null
		});
		/** Workspace directory open handler installed by apply(); runContextAction dispatches into it. */
		let desktopOpenWorkspacePath = null;
		/** Show the right-click menu at a viewport point, flipping near the edges. */
		function showFloatingMenu(x, y, items, target, payload) {
			const itemHeight = 26;
			const pad = 3;
			const gap = 1;
			const width = 132;
			const height = items.length * itemHeight + (items.length - 1) * gap + pad * 2 + 2;
			const left = x + width > window.innerWidth - 8 ? Math.max(8, x - width) : x;
			const top = y + 6 + height > window.innerHeight - 8 ? Math.max(8, y - 6 - height) : y + 6;
			dshFloatStore.update((state) => {
				state.menu = { x: left, y: top, items, target, payload };
			});
		}
		/** Hide the right-click menu (if any). */
		function hideFloatingMenu() {
			dshFloatStore.update((state) => {
				state.menu = null;
			});
		}
		/** The floating host: renders the right-click menu above everything. */
		function DesktopUiFloatHost({ useFloatState }) {
			const { menu } = useFloatState((state) => state);
			react.useEffect(() => {
				if (menu === null) return;
				const onKeyDown = (event) => {
					if (event.key === "Escape") hideFloatingMenu();
				};
				const onScroll = () => hideFloatingMenu();
				document.addEventListener("keydown", onKeyDown, true);
				document.addEventListener("scroll", onScroll, true);
				return () => {
					document.removeEventListener("keydown", onKeyDown, true);
					document.removeEventListener("scroll", onScroll, true);
				};
			}, [menu]);
			if (menu === null) return null;
			const menuStyle = menu === null ? void 0 : {
				left: menu.x,
				top: menu.y
			};
			return react_dom.createPortal((0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				menu !== null ? (0, react_jsx_runtime.jsx)("ul", {
					className: "dduiCtx",
					role: "menu",
					style: menuStyle,
					onMouseDown: (event) => {
						event.preventDefault();
					},
					children: menu.items.map((item) => item.sep === true ? (0, react_jsx_runtime.jsx)("li", {
						className: "dduiCtxSep",
						"aria-hidden": "true"
					}) : (0, react_jsx_runtime.jsx)("li", {
						children: (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							role: "menuitem",
							disabled: item.disabled === true,
							onClick: () => {
								runContextAction(item.id);
							},
							children: item.label
						})
					}, item.id))
				}) : null
			] }), document.body);
		}
		/** Locate the composer textarea (the app's chip-aware input). */
		function composerTextarea() {
			return document.querySelector('[data-composer-card] textarea');
		}
		/** Paste the clipboard text into any input: the composer uses the app pipeline, others insert directly. */
		async function pasteIntoField(field) {
			if (typeof navigator === "undefined" || navigator.clipboard === void 0) {
				showDesktopToast("error", "无法访问剪贴板");
				return;
			}
			let text;
			try {
				text = await navigator.clipboard.readText();
			} catch (error) {
				showDesktopToast("error", "无法读取剪贴板（权限被拒绝）");
				return;
			}
			if (text === "") {
				showDesktopToast("error", "剪贴板为空");
				return;
			}
			if (field.closest('[data-composer-card]') !== null) {
				const dataTransfer = new DataTransfer();
				dataTransfer.setData("text/plain", text);
				field.dispatchEvent(new ClipboardEvent("paste", {
					clipboardData: dataTransfer,
					bubbles: true,
					cancelable: true
				}));
				return;
			}
			field.focus();
			document.execCommand("insertText", false, text);
		}
		/** Execute one context-menu action against its target field. */
		function runContextAction(id) {
			const snapshot = dshFloatStore.getSnapshot();
			const menu = snapshot.menu;
			hideFloatingMenu();
			if (id === "openInExplorer") {
				const path = menu !== null && menu.payload !== void 0 ? menu.payload.workspacePath : void 0;
				if (typeof path === "string" && path !== "" && desktopOpenWorkspacePath !== null) {
					desktopOpenWorkspacePath(path);
				}
				return;
			}
			if (id === "reload") {
				globalThis.location?.reload();
				return;
			}
			if (id === "copySel") {
				const payload = menu !== null && menu.payload !== void 0 ? menu.payload : null;
				if (payload === null) return;
				if (payload.imageSrc !== null && payload.imageSrc !== void 0 && payload.imageSrc !== "") {
					void copyImageSource(payload.imageSrc).then((kind) => {
						if (kind === "image") showDesktopToast("success", "已复制图片");
						else if (kind === "url") showDesktopToast("success", "已复制图片地址");
					});
					return;
				}
				if (payload.text !== null && payload.text !== void 0 && payload.text.trim() !== "") {
					(0, _deepseek_ai_dsh_client_ui_primitives.writeClipboard)(payload.text).then((ok) => {
						if (ok) showDesktopToast("success", "已复制");
					});
				}
				return;
			}
			const field = menu !== null && menu.target !== void 0 ? menu.target : composerTextarea();
			if (field === null || typeof field.focus !== "function") return;
			field.focus();
			if (id === "selectAll") {
				field.select();
				return;
			}
			if (id === "paste") {
				void pasteIntoField(field);
				return;
			}
			if (id === "cut") {
				document.execCommand("cut");
				showDesktopToast("success", "已剪切");
				return;
			}
			if (id === "copy") {
				document.execCommand("copy");
				showDesktopToast("success", "已复制");
			}
		}
		/** Copy an image: bitmap when the clipboard API allows it, otherwise its URL. */
		async function copyImageSource(src) {
			if (typeof ClipboardItem !== "undefined" && typeof navigator !== "undefined" && navigator.clipboard !== void 0) {
				try {
					const response = await fetch(src);
					if (response.ok) {
						const blob = await response.blob();
						await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
						return "image";
					}
				} catch (error) {
					/* fall through to the URL copy */
				}
			}
			const ok = await (0, _deepseek_ai_dsh_client_ui_primitives.writeClipboard)(src);
			return ok ? "url" : "";
		}
		/**
		* Install the right-click behaviors.
		* @param options.t - bound locale lookup for the workspace row's menu labels.
		* @param options.resolveWorkspacePath - map a workspace row label to its directory path.
		* @param options.openWorkspacePath - open one workspace directory (host.openPath).
		*/
		function installChatContextMenu({ t, resolveWorkspacePath, openWorkspacePath } = {}) {
			desktopOpenWorkspacePath = openWorkspacePath ?? null;
			const FIELD_SELECTOR = 'textarea, input[type="text"], input[type="search"], input:not([type])';
			const onContextMenu = (event) => {
				const target = event.target;
				if (typeof target?.closest !== "function") return;
				// Workspace rows in the sidebar tree carry aria-expanded (session
				// rows carry aria-selected instead), so the treeitem + expanded
				// pair pins the workspace folder rows exactly.
				const workspaceRow = target.closest('[role="treeitem"][aria-expanded]');
				if (workspaceRow !== null) {
					const label = (workspaceRow.textContent ?? "").trim();
					const path = resolveWorkspacePath(label);
					if (path !== void 0) {
						event.preventDefault();
						event.stopImmediatePropagation();
						showFloatingMenu(event.clientX, event.clientY, [
							{ id: "openInExplorer", label: t("openWorkspace") }
						], void 0, { workspacePath: path });
					}
					return;
				}
				const field = target.closest(FIELD_SELECTOR);
				if (field !== null) {
					event.preventDefault();
					event.stopImmediatePropagation();
					const readOnly = field.readOnly === true || field.disabled === true;
					const start = typeof field.selectionStart === "number" ? field.selectionStart : 0;
					const end = typeof field.selectionEnd === "number" ? field.selectionEnd : 0;
					const selected = start !== end;
					const hasText = String(field.value ?? "").length > 0;
					showFloatingMenu(event.clientX, event.clientY, [
						{ id: "cut", label: "剪切", disabled: !selected || readOnly },
						{ id: "copy", label: "复制", disabled: !selected },
						{ id: "paste", label: "粘贴", disabled: readOnly },
						{ id: "selectAll", label: "全选", disabled: !hasText },
						{ id: "sep", sep: true },
						{ id: "reload", label: "刷新", disabled: false }
					], field);
					return;
				}
				event.preventDefault();
				event.stopImmediatePropagation();
				let copyText = "";
				const selection = window.getSelection();
				if (selection !== null && !selection.isCollapsed && selection.rangeCount > 0) {
					const text = selection.toString();
					if (text.trim() !== "") copyText = text;
				}
				let copyImageSrc = "";
				const imageEl = target.closest("img");
				if (imageEl !== null) copyImageSrc = imageEl.currentSrc || imageEl.src || "";
				const canCopy = copyText !== "" || copyImageSrc !== "";
				showFloatingMenu(event.clientX, event.clientY, [
					{ id: "copySel", label: "复制", disabled: !canCopy },
					{ id: "sep", sep: true },
					{ id: "reload", label: "刷新", disabled: false }
				], void 0, { text: copyText, imageSrc: copyImageSrc });
			};
			const onPointerDown = (event) => {
				const target = event.target;
				if (typeof target?.closest !== "function") return;
				if (target.closest(".dduiCtx") !== null) return;
				hideFloatingMenu();
			};
			document.addEventListener("contextmenu", onContextMenu, true);
			document.addEventListener("pointerdown", onPointerDown, true);
			return () => {
				document.removeEventListener("contextmenu", onContextMenu, true);
				document.removeEventListener("pointerdown", onPointerDown, true);
				hideFloatingMenu();
			};
		}
		//#endregion
		//#region lib/client/stats-line.js
		/** Bottom stats line (conversation.composer.dock / StatsLine): use the whole
		dock width instead of the chat column, stay centered, and wrap instead of
		truncating with an ellipsis. The primary selector is the slot outlet's
		stable `data-slot` attribute (every slot renders a `<div data-slot=...>`);
		the hashed `.FJxK0a_root` module class is kept as a fallback in case the
		outlet markup ever changes. */
		const statsCss = 'div[data-slot="conversation.composer.dock"]>div,.FJxK0a_root{box-sizing:border-box;width:100%!important;max-width:none!important;margin:0 auto!important;text-align:center!important;white-space:normal!important;overflow:visible!important;text-overflow:clip!important}';
		const statsTagId = "dsh-desktop-ui/StatsLine.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(statsTagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-desktop-ui";
			tag.dataset.pluginCss = statsTagId;
			tag.textContent = statsCss;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region lib/client/open-document.js
		/** Open-document action styles: the shipped action plus an explicit failure modal. */
		const docCss = '.dduiDoc_action{align-items:center;gap:8px;min-width:0;display:flex}.dduiDoc_error{max-width:180px;color:var(--dsw-alias-state-error-primary);text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;overflow:hidden}';
		const docTagId = "dsh-desktop-ui/SettingsDocumentAction.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(docTagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-desktop-ui";
			tag.dataset.pluginCss = docTagId;
			tag.textContent = docCss;
			document.head.appendChild(tag);
		}
		/** Narrow an unknown failure to a display string. */
		function desktopUiMessageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/** State owner for the optional local settings-document action (mirrors the shipped store). */
		var DesktopUiDocumentStore = class {
			api;
			store = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)({
				status: "idle",
				opening: false,
				error: null
			});
			generation = 0;
			constructor(api) {
				this.api = api;
			}
			async load() {
				const generation = ++this.generation;
				this.store.update((state) => {
					state.status = "loading";
					state.error = null;
				});
				try {
					const { result } = await this.api.settings.describe({});
					if (generation !== this.generation) return;
					if (!result.ok) {
						this.store.update((state) => {
							state.status = "unavailable";
							state.error = result.error.message;
						});
						return;
					}
					this.store.update((state) => {
						state.status = result.value.hasDocument ? "ready" : "unavailable";
						state.error = null;
					});
				} catch (error) {
					if (generation !== this.generation) return;
					this.store.update((state) => {
						state.status = "unavailable";
						state.error = desktopUiMessageOf(error);
					});
				}
			}
			async open() {
				const current = this.store.getSnapshot();
				if (current.status !== "ready" || current.opening) return;
				this.store.update((state) => {
					state.opening = true;
					state.error = null;
				});
				try {
					const response = await this.api.settings.openDocument({});
					if (!response.result.ok) throw new Error(response.result.error.message);
					return "ok";
				} catch (error) {
					const message = desktopUiMessageOf(error);
					this.store.update((state) => {
						state.error = message;
					});
					return message;
				} finally {
					this.store.update((state) => {
						state.opening = false;
					});
				}
			}
		};
		/** Open-document action: same behavior as the shipped one, plus toast feedback. */
		function DesktopUiDocumentAction({ controller, useDocumentState, t }) {
			const state = useDocumentState((snapshot) => snapshot);
			react.useEffect(() => {
				controller.load();
			}, [controller]);
			if (state.status !== "ready") return null;
			return (0, react_jsx_runtime.jsxs)("div", {
				className: "dduiDoc_action",
				children: [
					state.error === null ? null : (0, react_jsx_runtime.jsx)("span", {
						className: "dduiDoc_error",
						role: "alert",
						children: t("openDocument.error")
					}),
					(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "outline",
						size: "sm",
						disabled: state.opening,
						onClick: async () => {
							const result = await controller.open();
							if (result === "ok") showDesktopToast("success", t("openDocument.success"));
							else showDesktopToast("error", result ?? t("openDocument.error"));
						},
						children: t("openDocument")
					})
				]
			});
		}
		//#endregion
		//#region lib/client/Dialog.js
		/** Modal mirroring the shipped Session-log download dialog (same strings, own locale namespace). */
		function SessionLogDownloadDialog({ sessionId, useSessionLogDownload, dismiss, t }) {
			const entry = useSessionLogDownload((state) => state.bySession[String(sessionId)]);
			const status = entry?.status;
			const open = entry?.open === true;
			const error = status === "error" ? entry?.error || t("dialog.commandFailed") : null;
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open,
				onClose: () => {
					dismiss(sessionId);
				},
				title: status === "downloading" ? t("dialog.preparingTitle") : status === "success" ? t("dialog.successTitle") : t("dialog.errorTitle"),
				description: status === "downloading" ? t("dialog.preparingDescription") : status === "success" ? t("dialog.successDescription") : error ?? t("dialog.commandFailed"),
				closeLabel: t("dialog.close"),
				footer: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					onClick: () => {
						dismiss(sessionId);
					},
					children: t("dialog.close")
				})
			});
		}
		//#endregion
		//#region lib/client/HeaderAction.js
		/** Ghost-text header action (icon first) plus the shared download dialog. */
		function ExportMoveHeaderAction(props) {
			const { sessionId, useSessionLogDownload, request, t } = props;
			const busy = useSessionLogDownload((state) => state.bySession[String(sessionId)])?.status === "downloading";
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: "dshDesktopUi_trigger",
				disabled: busy,
				"aria-busy": busy,
				onClick: () => {
					request(sessionId);
				},
				children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDownloadOutline16, { size: 12 }), (0, react_jsx_runtime.jsx)("span", { children: t("trigger.label") })]
			}), (0, react_jsx_runtime.jsx)(SessionLogDownloadDialog, { ...props })] });
		}
		//#endregion
		//#region lib/client/locales.js
		/** Locale namespace owned by this customization (mirrors the shipped strings). */
		const NS = "desktop-ui";
		const zh = {
			"trigger.label": "导出会话",
			"dialog.preparingTitle": "正在导出 Session",
			"dialog.preparingDescription": "正在准备包含当前 Session、子 Session 和附件的 ZIP 文件。",
			"dialog.successTitle": "Session 导出已开始下载",
			"dialog.successDescription": "浏览器正在下载 Session ZIP 文件。",
			"dialog.errorTitle": "Session 导出失败",
			"dialog.close": "关闭",
			"dialog.commandFailed": "无法启动 Session 导出。",
			"plugin.tab": "插件列表",
			"plugin.loading": "正在读取插件…",
			"plugin.error": "暂时无法读取插件。",
			"plugin.retry": "重试",
			"plugin.search": "搜索插件",
			"plugin.empty": "暂无插件。",
			"plugin.emptySearch": "没有匹配的插件。",
			"plugin.enabled": "已启用",
			"plugin.disabled": "已停用",
			"plugin.configuration": "配置状态",
			"plugin.cordis": "Cordis 状态",
			"plugin.unobserved": "未挂载",
			"plugin.pending": "等待依赖",
			"plugin.loadingPhase": "加载中",
			"plugin.active": "已挂载",
			"plugin.failed": "挂载失败",
			"plugin.unloading": "卸载中",
			"plugin.myGroup": "我的插件",
			"plugin.presetGroup": "预设插件",
			"openDocument": "打开配置文件",
			"openDocument.error": "无法打开配置文件",
			"openDocument.success": "已请求打开配置文件",
			"openWorkspace": "在资源管理器中打开",
			"openWorkspace.error": "无法打开工作区目录"
		};
		const en = {
			"trigger.label": "Session log",
			"dialog.preparingTitle": "Exporting Session",
			"dialog.preparingDescription": "Preparing a ZIP containing this Session, its sub-Sessions, and attachments.",
			"dialog.successTitle": "Session download started",
			"dialog.successDescription": "The browser is downloading the Session ZIP.",
			"dialog.errorTitle": "Session export failed",
			"dialog.close": "Close",
			"dialog.commandFailed": "Could not start the Session export.",
			"plugin.tab": "Plugin list",
			"plugin.loading": "Reading plugins…",
			"plugin.error": "Plugins are temporarily unavailable.",
			"plugin.retry": "Retry",
			"plugin.search": "Search plugins",
			"plugin.empty": "No plugins are available.",
			"plugin.emptySearch": "No matching plugins.",
			"plugin.enabled": "Enabled",
			"plugin.disabled": "Disabled",
			"plugin.configuration": "Configuration",
			"plugin.cordis": "Cordis status",
			"plugin.unobserved": "Not mounted",
			"plugin.pending": "Waiting for dependencies",
			"plugin.loadingPhase": "Loading",
			"plugin.active": "Mounted",
			"plugin.failed": "Mount failed",
			"plugin.unloading": "Unloading",
			"plugin.myGroup": "My plugins",
			"plugin.presetGroup": "Preset plugins",
			"openDocument": "Open configuration file",
			"openDocument.error": "Could not open configuration file",
			"openDocument.success": "Configuration file open requested",
			"openWorkspace": "Open in Explorer",
			"openWorkspace.error": "Could not open the workspace directory"
		};
		//#endregion
		//#region lib/client/index.js
		/**
		* Move the shipped Session-log export button from the rightmost header
		* utilities into the title-adjacent action row (ghost text style, order 30),
		* and restyle the shipped settings modal as a right-side drawer (CSS only).
		*/
		const inject = ["slots", "locale", "remote", "remote.pluginInventory", "connection"];
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "dsh-desktop-ui-toast",
				inject: () => ({ hooks: { toastState: dshToastStore } })
			}, DesktopUiToastHost));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "dsh-desktop-ui-ctx",
				inject: () => ({ hooks: { floatState: dshFloatStore } })
			}, DesktopUiFloatHost));
			ctx.effect(() => installChatContextMenu({
				t,
				resolveWorkspacePath: (label) => {
					const workspaces = ctx.get("workspaces");
					if (workspaces === void 0) return void 0;
					const items = workspaces.list.getSnapshot().items;
					const match = items.find((item) => item.title === label
						|| String(item.path ?? "").replace(/[/\\]+$/, "").split(/[/\\]/).pop() === label);
					return match === void 0 ? void 0 : match.path;
				},
				openWorkspacePath: (path) => {
					const workspaces = ctx.get("workspaces");
					if (workspaces === void 0) return;
					workspaces.openPath(path).catch(() => {
						showDesktopToast("error", t("openWorkspace.error"));
					});
				}
			}), "dsh-desktop-ui: chat context menu");
			const connection = ctx.get("connection");
			if (connection !== void 0 && connection.isLoopback) {
				const documentController = new DesktopUiDocumentStore(connection.api);
				ctx.slots.inject("settings.action", () => ctx.slots.register({
					name: "settings.action",
					id: "open-document",
					priority: -1,
					order: 0,
					locale: NS,
					inject: () => ({
						hooks: { documentState: documentController.store },
						controller: documentController
					})
				}, DesktopUiDocumentAction));
			}
			ctx.effect(() => installSettingsDrawerShim(), "dsh-desktop-ui: settings drawer close shim");
			ctx.effect(() => installPluginTabsDedup(), "dsh-desktop-ui: plugin tabs dedup");
			ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
				name: "settings.plugins.tab",
				id: "all",
				priority: -1,
				order: 10,
				label: () => t("plugin.tab"),
				locale: NS,
				inject: () => ({ list: desktopUiPluginList(ctx) })
			}, PluginListBySource));
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-desktop-ui: browser dictionaries");
			const controller = ctx.get("sessionLogDownload");
			if (controller === void 0) return;
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "session-log-download",
				priority: -1
			}, () => null));
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "session-log-download",
				order: 30,
				locale: NS,
				inject: () => ({
					hooks: { sessionLogDownload: controller.store },
					request: (sessionId) => controller.download(sessionId),
					dismiss: (sessionId) => {
						controller.dismiss(sessionId);
					}
				})
			}, ExportMoveHeaderAction));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
