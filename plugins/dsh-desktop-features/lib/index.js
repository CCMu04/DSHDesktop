/**
 * Host half of the dsh-desktop-features group. 所有交互行为都在浏览器 bundle
 * （client 端）里；宿主侧只注册一个 settings 命名空间，让 rc.7 起以 keyed 契约
 * 调度的「插件设置」页（dsh-client-ui-settings-plugins 的 configurable tab）能
 * 配对并渲染本组卡片。卡片是聚合开关板，不编辑自有字段，schema 为空即可。
 */
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";

/** 本插件的设置命名空间：也是 client 端 settings.plugin.item 卡片注册的 key。 */
export const SETTINGS_NAMESPACE = settingsNamespace("desktop-features");

/** 聚合卡不持有自有字段；空 schema 只用于让 tab 侧“served”该命名空间。 */
export const SETTINGS_SCHEMA = z.object({});

const name = "dsh-desktop-features";
const inject = [];

function apply(ctx, config = {}) {
  // 无 settings 服务（如单测桩 ctx）时跳过注册，卡片行为不受影响。
  if (typeof ctx.inject !== "function") return;
  installSettingsSection(ctx, SETTINGS_NAMESPACE, SETTINGS_SCHEMA, config, {
    setSource() {},
    onChange() {},
  });
}

export { apply, inject, name };