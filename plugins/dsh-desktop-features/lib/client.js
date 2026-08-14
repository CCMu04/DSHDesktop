/**
 * dsh-desktop-features — browser half.
 *
 * 「功能增强」聚合卡片：在插件配置页（settings.plugin.item）渲染一张分组
 * 卡片，结构完全对齐「视觉增强」卡片（dsh-desktop-ui 的 DesktopUiConfigCard）：
 * 头部（名称 + 描述 + 箭头）+ 字段行（每个功能增强一行开关）+ 底部统一
 * 「重置 / 保存」。
 *
 * 子功能插件（如 dsh-desktop-updates、dsh-desktop-context-menu）不渲染 UI，
 * 只向 `desktop.features.item` 槽位注册一个数据接口：
 *   { load(): Promise<boolean>, save(enabled): Promise<void>,
 *     title: string, description: string }
 * 聚合卡片负责收集接口、加载状态、暂存草稿与统一保存。
 *
 * 新增功能增强时：新建独立插件，client 注册上述数据接口即可，无需改动本插件。
 */
window.__ModuleLoader__.load({
  id: "dsh-desktop-features",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react_jsx_runtime = require("react/jsx-runtime");
    let react = require("react");
    let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

    //#region 样式
    // 与「视觉增强」卡片同一套 token 与结构（dduiC_* 的镜像，本插件自带）。
    const css =
      ".dduiFg_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}.dduiFg_card:hover{border-color:var(--dsw-alias-label-dimmed)}.dduiFg_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}.dduiFg_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}.dduiFg_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.dduiFg_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.dduiFg_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}.dduiFg_description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}.dduiFg_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}.dduiFg_chevronOpen{transform:rotate(180deg)}.dduiFg_body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}.dduiFg_field{flex-direction:column;gap:6px;padding:12px 0;display:flex}.dduiFg_field+.dduiFg_field{border-top:1px solid var(--dsw-alias-border-l2)}.dduiFg_head{align-items:center;gap:8px;display:flex}.dduiFg_label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}.dduiFg_badges{align-items:center;gap:8px;display:inline-flex}.dduiFg_badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.dduiFg_badgeMuted{white-space:nowrap;color:var(--dsw-alias-label-tertiary);border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px}.dduiFg_switch{accent-color:var(--dsw-alias-brand-primary);flex:none;width:16px;height:16px;margin:0;cursor:pointer}.dduiFg_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}.dduiFg_footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}.dduiFg_failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}.dduiFg_discard,.dduiFg_save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}.dduiFg_discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}.dduiFg_discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.dduiFg_save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.dduiFg_discard:disabled,.dduiFg_save:disabled{opacity:.4;cursor:default}.dduiFg_discard:focus-visible,.dduiFg_save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}";
    const tagId = "dsh-desktop-features/FeaturesGroupCard.module.css";
    if (
      typeof document !== "undefined" &&
      document.querySelector(
        "style[data-plugin-css=" + JSON.stringify(tagId) + "]",
      ) === null
    ) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-desktop-features";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }
    //#endregion

    //#region 聚合卡片
    /**
     * 「功能增强」分组卡片（视觉增强卡片模板）：
     *   头部：名称 + 描述 + 箭头；
     *   展开区：每个功能增强一行字段（标题 + 启用/停用徽标 + 开关 + 说明），
     *           状态暂存在草稿中；
     *   底部：统一「重置」与「保存」（逐个写入各功能的数据接口）。
     */
    function FeaturesGroupCard({ t, features }) {
      const [open, setOpen] = react.useState(false);
      const [state, setState] = react.useState({
        status: "loading",
        rows: [], // { id, title, description, face, value }
        draft: {}, // id -> boolean（暂存）
      });
      const [saving, setSaving] = react.useState(false);
      const [failed, setFailed] = react.useState(null);
      react.useEffect(() => {
        let current = true;
        const reload = () => {
          const entries = features.entries();
          Promise.all(
            entries.map(async (entry) => {
              const face = entry.inject();
              const value =
                typeof face?.load === "function" ? await face.load() : true;
              return {
                id: entry.options?.id ?? "",
                title:
                  typeof face?.title === "string"
                    ? face.title
                    : entry.options?.id ?? "",
                description:
                  typeof face?.description === "string" ? face.description : "",
                face,
                value,
              };
            }),
          ).then((rows) => {
            if (!current) return;
            setState({
              status: "ready",
              rows,
              draft: Object.fromEntries(
                rows.map((row) => [row.id, row.value]),
              ),
            });
          }, () => {
            if (current)
              setState((snapshot) => ({ ...snapshot, status: "error" }));
          });
        };
        reload();
        // 子项注册/卸载（插件增删）时重载。
        const off = features.subscribe(reload);
        return () => {
          current = false;
          off();
        };
      }, [features]);
      const toggle = (id) => {
        setState((snapshot) =>
          snapshot.status === "ready"
            ? {
                ...snapshot,
                draft: { ...snapshot.draft, [id]: !snapshot.draft[id] },
              }
            : snapshot,
        );
      };
      const reset = () => {
        if (state.status !== "ready" || saving) return;
        setState({
          ...state,
          draft: Object.fromEntries(
            state.rows.map((row) => [row.id, row.value]),
          ),
        });
      };
      const save = () => {
        if (state.status !== "ready" || saving) return;
        setSaving(true);
        setFailed(null);
        Promise.all(
          state.rows.map(async (row) => {
            if (typeof row.face?.save === "function") {
              await row.face.save(state.draft[row.id]);
            }
          }),
        ).then(() => {
          globalThis.location.reload();
        }, () => {
          setSaving(false);
          setFailed("saveFailed");
        });
      };
      return (0, react_jsx_runtime.jsxs)("div", {
        className: open ? "dduiFg_card dduiFg_cardOpen" : "dduiFg_card",
        children: [
          (0, react_jsx_runtime.jsxs)("button", {
            type: "button",
            className: "dduiFg_header",
            "aria-expanded": open,
            onClick: () => {
              setOpen((value) => !value);
            },
            children: [
              (0, react_jsx_runtime.jsxs)("span", {
                className: "dduiFg_headText",
                children: [
                  (0, react_jsx_runtime.jsx)("span", {
                    className: "dduiFg_name",
                    children: t("title"),
                  }),
                  (0, react_jsx_runtime.jsx)("span", {
                    className: "dduiFg_description",
                    children: t("description"),
                  }),
                ],
              }),
              (0, react_jsx_runtime.jsx)(
                _deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14,
                {
                  className: open
                    ? "dduiFg_chevron dduiFg_chevronOpen"
                    : "dduiFg_chevron",
                  size: 14,
                  "aria-hidden": "true",
                },
              ),
            ],
          }),
          open
            ? (0, react_jsx_runtime.jsxs)("div", {
                className: "dduiFg_body",
                children: [
                  state.status === "loading"
                    ? (0, react_jsx_runtime.jsx)("p", {
                        className: "dduiFg_hint",
                        children: t("loading"),
                      })
                    : state.status === "error"
                      ? (0, react_jsx_runtime.jsx)("p", {
                          className: "dduiFg_hint",
                          children: t("loadFailed"),
                        })
                      : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
                          children: [
                            state.rows.map((row) =>
                              (0, react_jsx_runtime.jsxs)("div", {
                                className: "dduiFg_field",
                                key: row.id,
                                children: [
                                  (0, react_jsx_runtime.jsxs)("div", {
                                    className: "dduiFg_head",
                                    children: [
                                      (0, react_jsx_runtime.jsx)("label", {
                                        className: "dduiFg_label",
                                        htmlFor: "dsh-desktop-feature-" + row.id,
                                        children: row.title,
                                      }),
                                      (0, react_jsx_runtime.jsxs)("span", {
                                        className: "dduiFg_badges",
                                        children: [
                                          (0, react_jsx_runtime.jsx)("span", {
                                            className: state.draft[row.id]
                                              ? "dduiFg_badge"
                                              : "dduiFg_badgeMuted",
                                            children: state.draft[row.id]
                                              ? t("enabled")
                                              : t("disabled"),
                                          }),
                                        ],
                                      }),
                                      (0, react_jsx_runtime.jsx)("input", {
                                        id: "dsh-desktop-feature-" + row.id,
                                        className: "dduiFg_switch",
                                        type: "checkbox",
                                        checked:
                                          state.draft[row.id] === true,
                                        onChange: () => {
                                          toggle(row.id);
                                        },
                                      }),
                                    ],
                                  }),
                                  (0, react_jsx_runtime.jsx)("p", {
                                    className: "dduiFg_hint",
                                    children: row.description,
                                  }),
                                ],
                              }),
                            ),
                            (0, react_jsx_runtime.jsxs)("div", {
                              className: "dduiFg_footer",
                              children: [
                                failed === null
                                  ? null
                                  : (0, react_jsx_runtime.jsx)("p", {
                                      className: "dduiFg_failed",
                                      role: "alert",
                                      children: t(failed),
                                    }),
                                (0, react_jsx_runtime.jsx)("button", {
                                  type: "button",
                                  className: "dduiFg_discard",
                                  disabled: saving,
                                  onClick: reset,
                                  children: t("reset"),
                                }),
                                (0, react_jsx_runtime.jsx)("button", {
                                  type: "button",
                                  className: "dduiFg_save",
                                  disabled: saving,
                                  onClick: save,
                                  children: saving ? t("saving") : t("save"),
                                }),
                              ],
                            }),
                          ],
                        }),
                ],
              })
            : null,
        ],
      });
    }
    //#endregion

    //#region 词典
    const NS = "desktop-features";
    const zh = {
      title: "功能增强",
      description: "需要单独开关的功能增强，展开后逐个配置",
      loading: "正在读取配置…",
      loadFailed: "无法读取功能增强配置。",
      enabled: "已启用",
      disabled: "已停用",
      save: "保存",
      saving: "保存中…",
      reset: "重置",
      saveFailed: "保存失败，请重试。",
    };
    const en = {
      title: "Feature enhancements",
      description:
        "Feature enhancements with individual switches; expand to configure",
      loading: "Reading configuration…",
      loadFailed: "Could not read the feature enhancement configuration.",
      enabled: "Enabled",
      disabled: "Disabled",
      save: "Save",
      saving: "Saving…",
      reset: "Reset",
      saveFailed: "Save failed, please try again.",
    };
    //#endregion

    //#region 入口
    const inject = ["slots", "locale"];
    function apply(ctx) {
      ctx.effect(
        () =>
          ctx.locale.register(NS, {
            zh,
            en,
          }),
        "dsh-desktop-features: dictionaries",
      );
      ctx.slots.inject("settings.plugin.item", () =>
        ctx.slots.register(
          {
            name: "settings.plugin.item",
            id: "dsh-desktop-features",
            order: 110,
            locale: NS,
            children: {
              "desktop.features.item": { kind: "list", scope: "root" },
            },
            inject: () => ({
              features: {
                entries: () => ctx.slots.entries("desktop.features.item"),
                subscribe: (listener) =>
                  ctx.slots.subscribe("desktop.features.item", listener),
              },
            }),
          },
          FeaturesGroupCard,
        ),
      );
    }
    //#endregion

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
