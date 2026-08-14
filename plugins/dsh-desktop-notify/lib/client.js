/**
 * dsh-desktop-notify — browser half.
 *
 * 「完成提醒」功能增强：
 *   - 订阅当前会话的 ConversationSnapshot（sessions 服务），按 running
 *     true→false 边缘判定回复完成（与官方侧边栏 completed 提醒同一判定）；
 *   - 完成瞬间窗口不在前台（document.hasFocus() 为 false，覆盖失焦/最小化）
 *     时，用系统通知（HTML5 Notification → Windows 右下角 toast）提醒；
 *     点击通知把窗口带回前台；
 *   - 「功能增强」卡片子项（desktop.features.item）数据接口：启用/停用。
 *
 * 开关由 host 端持久化（/api/desktop-notify/config）。
 */
window.__ModuleLoader__.load({
  id: "dsh-desktop-notify",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    //#region 配置工具
    /** 功能开关默认值。 */
    const ddnDefaultConfig = { enabled: true };
    /** 读取生效配置；任何失败回退默认（开启）。 */
    function loadNotifyConfig() {
      return fetch("/api/desktop-notify/config", {
        headers: { accept: "application/json" },
        cache: "no-store",
      })
        .then((res) =>
          res.ok
            ? res.json()
            : Promise.reject(new Error("config-http-" + res.status)),
        )
        .then((body) => ({
          enabled:
            typeof body?.enabled === "boolean" ? body.enabled : true,
        }))
        .catch(() => ({ ...ddnDefaultConfig }));
    }
    /** 写入开关；返回是否被接受。 */
    function saveNotifyConfig(config) {
      return fetch("/api/desktop-notify/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
      }).then((res) => res.ok);
    }
    //#endregion

    //#region 完成提醒
    /** 通知正文预览上限（字符）。 */
    const ddnPreviewLimit = 120;
    /** 截断文本并追加省略号。 */
    function truncate(text, limit) {
      const collapsed = text.replace(/\s+/g, " ").trim();
      return collapsed.length > limit
        ? collapsed.slice(0, limit - 1) + "…"
        : collapsed;
    }
    /** 取最后一条已落地的 assistant 消息文本（多个 text 块合并）。 */
    function assistantPreview(nodes) {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i];
        if (node?.kind !== "assistant") continue;
        const text = (Array.isArray(node.blocks) ? node.blocks : [])
          .filter((block) => block?.kind === "text" && typeof block.text === "string")
          .map((block) => block.text)
          .join("")
          .trim();
        if (text !== "") return text;
      }
      return "";
    }
    /**
     * 安装完成提醒：订阅当前会话快照，running true→false 且窗口不在前台时
     * 弹系统通知。sessions 服务未就绪时延迟重试（客户端插件可能先于核心
     * 服务 apply）。返回 disposer。
     */
    function installCompletionNotify(ctx, t) {
      /** sessions 服务就绪前的重试上限与间隔。 */
      const ddnMaxRetries = 20;
      const ddnRetryDelayMs = 500;

      let disposed = false;
      let retries = 0;
      let teardown = null;

      const start = () => {
        const sessions = ctx.get("sessions");
        if (sessions === void 0) {
          if (!disposed && retries < ddnMaxRetries) {
            retries++;
            setTimeout(start, ddnRetryDelayMs);
          }
          return;
        }
        teardown = watchCompletion(sessions, t);
      };

      start();

      return () => {
        disposed = true;
        if (teardown !== null) teardown();
      };
    }

    /** 在已就绪的 sessions 服务上安装完成提醒；返回 disposer。 */
    function watchCompletion(sessions, t) {
      // 通知权限：Electron 默认自动批准；显式请求一次以防受限环境。
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "default"
      ) {
        try {
          void Notification.requestPermission();
        } catch {}
      }
      // 窗口焦点状态（失焦与最小化都会 blur）。
      let focused = true;
      try {
        focused = document.hasFocus();
      } catch {}
      const onWindowFocus = () => {
        focused = true;
      };
      const onWindowBlur = () => {
        focused = false;
      };
      window.addEventListener("focus", onWindowFocus);
      window.addEventListener("blur", onWindowBlur);

      let currentId = null;
      let sessionOff = null;
      /** null = 尚未观察（首次快照只记录 running 位，不提醒）。 */
      let prevRunning = null;

      const maybeNotify = (snap) => {
        const nodes = Array.isArray(snap?.nodes) ? snap.nodes : [];
        const last = nodes[nodes.length - 1];
        let body;
        if (last?.kind === "turn-error") {
          body = t("notify.error");
        } else {
          const preview = assistantPreview(nodes);
          body =
            preview === ""
              ? t("notify.empty")
              : truncate(preview, ddnPreviewLimit);
        }
        let notice;
        try {
          notice = new Notification(t("notify.title"), { body });
        } catch {
          return;
        }
        notice.onclick = () => {
          try {
            window.focus();
          } catch {}
        };
      };

      const onSessionChange = () => {
        if (currentId === null) return;
        const binding = sessions.binding(currentId);
        if (binding === void 0) return;
        const snap = binding.session.getSnapshot();
        const running = snap?.running === true;
        if (prevRunning === null) {
          // 首次观察只记录，加载时已在运行的会话也能捕获本次完成。
          prevRunning = running;
          return;
        }
        if (prevRunning && !running && !focused) {
          maybeNotify(snap);
        }
        prevRunning = running;
      };

      /** 跟随当前会话（列表 current 变化时重新订阅）。 */
      const attach = () => {
        if (sessionOff !== null) {
          sessionOff();
          sessionOff = null;
        }
        currentId = null;
        prevRunning = null;
        let listSnap;
        try {
          listSnap = sessions.list.getSnapshot();
        } catch {
          return;
        }
        const id = listSnap?.current ?? void 0;
        if (id === void 0) return;
        currentId = id;
        const binding = sessions.binding(id);
        if (binding === void 0) return;
        sessionOff = binding.session.subscribe(onSessionChange);
        onSessionChange();
      };

      let listOff = () => {};
      try {
        listOff = sessions.list.subscribe(attach);
      } catch {}
      attach();

      return () => {
        listOff();
        if (sessionOff !== null) sessionOff();
        window.removeEventListener("focus", onWindowFocus);
        window.removeEventListener("blur", onWindowBlur);
      };
    }
    //#endregion

    //#region 功能增强数据接口
    /**
     * 「功能增强」卡片中的「完成提醒」数据接口（desktop.features.item）：
     * 只提供 load/save/title/description，开关渲染与保存由功能增强卡片统一完成。
     */
    function notifyFeatureFace(t) {
      return {
        load: () => loadNotifyConfig().then((config) => config.enabled),
        save: (enabled) => saveNotifyConfig({ enabled }),
        title: t("feature.title"),
        description: t("feature.description"),
      };
    }
    //#endregion

    //#region 词典
    /** 本插件文案命名空间。 */
    const NS = "desktop-notify";
    const zh = {
      "feature.title": "完成提醒",
      "feature.description":
        "回复完成且应用窗口不在前台时，在右下角弹出系统通知提醒",
      "notify.title": "对话完成",
      "notify.error": "回复出错了",
      "notify.empty": "回复已生成",
    };
    const en = {
      "feature.title": "Completion reminder",
      "feature.description":
        "Show a system notification in the bottom-right corner when a reply finishes while the app window is not focused",
      "notify.title": "Conversation finished",
      "notify.error": "The reply failed",
      "notify.empty": "Reply generated",
    };
    //#endregion

    //#region 入口
    /** 所需客户端服务。 */
    const inject = ["slots", "locale"];
    /**
     * 插件入口：
     *   - 「功能增强」卡片子项（desktop.features.item）始终注册 —— 开关由用户在
     *     功能增强卡片里控制；
     *   - 完成提醒逻辑按 enabled 开关安装/移除。
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(
        () =>
          ctx.locale.register(NS, {
            zh,
            en,
          }),
        "dsh-desktop-notify: dictionaries",
      );
      // 功能增强卡片子项（always-on：数据接口永远可调）。
      ctx.slots.inject("desktop.features.item", () =>
        ctx.slots.register(
          {
            name: "desktop.features.item",
            id: "notify",
            order: 40,
            locale: NS,
            inject: () => notifyFeatureFace(t),
          },
          // 该槽位由「功能增强」卡片消费数据接口，不渲染组件。
          () => null,
        ),
      );
      // 完成提醒：按配置快照安装/移除。
      const installFeature = (config) => {
        const disposers = [];
        if (config.enabled) {
          const dispose = installCompletionNotify(ctx, t);
          if (typeof dispose === "function") disposers.push(dispose);
        }
        return disposers;
      };
      let active = [];
      const applyConfig = (config) => {
        for (const dispose of active) dispose();
        active = installFeature(config);
      };
      applyConfig({ ...ddnDefaultConfig });
      void loadNotifyConfig().then((config) => {
        applyConfig(config);
      });
    }
    //#endregion

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
