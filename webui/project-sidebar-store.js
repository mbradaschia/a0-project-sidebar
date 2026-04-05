import { createStore } from "/js/AlpineStore.js";
import { sendJsonData, toastFetchError } from "/index.js";

const STORAGE_KEY = "projectSidebar_collapsed";
const NO_PROJECT_KEY = "__no_project__";

function loadCollapsedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_e) {
    return {};
  }
}

function saveCollapsedState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_e) {
    // ignore
  }
}

/**
 * Parse a serialized datetime string into a comparable timestamp.
 * Handles ISO strings and epoch numbers.
 */
function toTimestamp(val) {
  if (!val) return 0;
  if (typeof val === "number") return val;
  const d = new Date(val);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

const model = {
  _collapsed: {},
  _initialized: false,

  /** Currently open chat context menu — null when closed */
  openChatContext: null,
  /** CSS style string (right/top) for the fixed dropdown panel */
  chatMenuStyle: "",
  /** Dynamically registered menu items — any plugin can call registerChatMenuItem() */
  chatMenuItems: [],

  init() {
    if (this._initialized) return;
    this._initialized = true;
    this._collapsed = loadCollapsedState();
    // Single global listener — closes the chat menu on any outside pointer-down.
    // pointerdown fires before click on both mouse and touch — no race conditions.
    document.addEventListener("pointerdown", (e) => {
      if (this.openChatContext) {
        const menu = document.querySelector(".psb-chat-menu");
        if (menu && menu.contains(e.target)) return;
        if (e.target.closest(".chat-more-btn")) return;
        this.closeChatMenu();
      }
    });
    // Pre-register built-in and known-plugin menu items after all stores are loaded
    setTimeout(() => this._registerDefaultMenuItems(), 200);
  },

  /** Open the more-actions dropdown for a chat item. */
  openChatMenu(context, btn) {
    const r = btn.getBoundingClientRect();
    this.chatMenuStyle =
      "right:" + (window.innerWidth - r.right) + "px;" +
      "top:" + (r.bottom + 2) + "px;";
    // Toggle: clicking same button again closes it
    this.openChatContext =
      this.openChatContext?.id === context.id ? null : context;
  },
  /** Close the more-actions dropdown. */
  closeChatMenu() {
    this.openChatContext = null;
  },

  /** Register a menu item into the chat context dropdown.
   * item: { label, icon, order, danger, visible(ctx), action(ctx) }
   * Use { divider: true, order, label: '__dividerN__' } for separator lines.
   */
  registerChatMenuItem(item) {
    this.chatMenuItems.push(item);
    this.chatMenuItems.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  },

  /** Pre-register built-in A0 actions and known plugin items. Called once on init. */
  _registerDefaultMenuItems() {
    // -- Known plugins (registered only if their store is present) --
    if (Alpine.store("chatRename")) {
      this.registerChatMenuItem({ label: "Rename", icon: "edit", order: 10,
        action: (ctx) => Alpine.store("chatRename").openRenameModal(ctx.id) });
    }
    if (Alpine.store("chatArchive")) {
      this.registerChatMenuItem({ label: "Archive", icon: "archive", order: 20,
        visible: (ctx) => !Alpine.store("chatArchive").isArchived(ctx.id),
        action: (ctx) => Alpine.store("chatArchive").archiveChat(ctx.id, ctx.name) });
      this.registerChatMenuItem({ label: "Unarchive", icon: "unarchive", order: 21,
        visible: (ctx) => Alpine.store("chatArchive").isArchived(ctx.id),
        action: (ctx) => Alpine.store("chatArchive").unarchiveChat(ctx.id) });
    }
    // -- Built-in A0 actions (always present) --
    this.registerChatMenuItem({ label: "Branch chat", icon: "fork_right", order: 30,
      action: (ctx) => this.branchChat(ctx.id) });
    this.registerChatMenuItem({ divider: true, label: "__divider_danger__", order: 89 });
    this.registerChatMenuItem({ label: "Terminate & delete", icon: "stop_circle", order: 90, danger: true, confirm: true,
      visible: (ctx) => ctx.running,
      action: (ctx) => this.killChat(ctx.id) });
    this.registerChatMenuItem({ label: "Delete chat", icon: "delete", order: 91, danger: true, confirm: true,
      visible: (ctx) => !ctx.running,
      action: (ctx) => this.killChat(ctx.id) });
  },

  /**
   * Build project groups from the chats store's contexts array.
   * Returns array of groups, each with key, name, title, color, chats[], latestTimestamp.
   * Reactively updates when $store.chats.contexts changes.
   */
  getProjectGroups() {
    const chatsStore = Alpine.store("chats");
    if (!chatsStore || !Array.isArray(chatsStore.contexts)) return [];

    const contexts = chatsStore.contexts;
    const groupMap = new Map();

    for (const ctx of contexts) {
      const projName = ctx.project?.name || NO_PROJECT_KEY;
      if (!groupMap.has(projName)) {
        groupMap.set(projName, {
          key: projName,
          name: projName,
          title: projName === NO_PROJECT_KEY
            ? "No Project"
            : (ctx.project?.title || projName),
          color: projName === NO_PROJECT_KEY
            ? ""
            : (ctx.project?.color || ""),
          chats: [],
          latestTimestamp: 0,
        });
      }
      const group = groupMap.get(projName);
      group.chats.push(ctx);

      const ts = toTimestamp(ctx.last_message) || toTimestamp(ctx.created_at);
      if (ts > group.latestTimestamp) {
        group.latestTimestamp = ts;
      }
    }

    // Sort chats within each group by last_message descending
    for (const group of groupMap.values()) {
      group.chats.sort((a, b) => {
        const ta = toTimestamp(a.last_message) || toTimestamp(a.created_at);
        const tb = toTimestamp(b.last_message) || toTimestamp(b.created_at);
        return tb - ta;
      });
    }

    // Convert to array and sort groups
    const groups = Array.from(groupMap.values());
    groups.sort((a, b) => {
      // "No Project" always first
      if (a.key === NO_PROJECT_KEY && b.key !== NO_PROJECT_KEY) return -1;
      if (b.key === NO_PROJECT_KEY && a.key !== NO_PROJECT_KEY) return 1;
      // Otherwise sort by most recent chat descending
      return b.latestTimestamp - a.latestTimestamp;
    });

    return groups;
  },

  /**
   * Check if any chat in a group is currently running.
   */
  hasRunningChat(group) {
    return group.chats.some(ctx => ctx.running);
  },

  /**
   * Check if any chat in a group is paused.
   */
  hasPausedChat(group) {
    return group.chats.some(ctx => ctx.paused);
  },

  /**
   * Check if any chat in a group has finished but not been seen.
   * Integrates with the chat_status_marklet plugin's _finishedUnseen state.
   */
  hasFinishedUnseenChat(group) {
    const markletStore = Alpine.store("chatStatusMarklet");
    if (!markletStore || !markletStore._finishedUnseen) return false;
    return group.chats.some(ctx => !!markletStore._finishedUnseen[ctx.id]);
  },


  isCollapsed(projectKey) {
    // Default: collapsed. Only expanded if explicitly set to false.
    return this._collapsed[projectKey] !== false;
  },

  toggleCollapse(projectKey) {
    this._collapsed[projectKey] = !this.isCollapsed(projectKey);
    // Force Alpine reactivity by replacing the object reference
    this._collapsed = { ...this._collapsed };
    saveCollapsedState(this._collapsed);
  },

  /**
   * Open the project edit modal via the projects store.
   */
  editProject(projectName) {
    if (!projectName || projectName === NO_PROJECT_KEY) return;
    const projectsStore = Alpine.store("projects");
    if (projectsStore && typeof projectsStore.openEditModal === "function") {
      projectsStore.openEditModal(projectName);
    }
  },

  /**
   * Check if a given chat is the currently selected one.
   */
  isSelected(chatId) {
    const chatsStore = Alpine.store("chats");
    return chatsStore && chatsStore.selected === chatId;
  },

  /**
   * Check if a group contains the currently selected chat (used for touch device edit button visibility).
   */
  isActiveGroup(group) {
    const chatsStore = Alpine.store("chats");
    if (!chatsStore || !chatsStore.selected) return false;
    return group.chats.some((ctx) => ctx.id === chatsStore.selected);
  },

  /**
   * Returns true when running on a touch-only device (no hover capability).
   * More reliable than CSS class detection since it doesn't depend on A0's async body class swap.
   */
  isTouchDevice() {
    return (
      document.body.classList.contains("device-touch") ||
      window.matchMedia("(hover: none) and (pointer: coarse)").matches
    );
  },


  /**
   * Select a chat (delegates to chats store).
   */
  selectChat(chatId) {
    // Close the dropdown first so the menu dismiss doesn't race with the
    // focus/resize chain that selectChat triggers on mobile.
    if (this.openChatContext) this.closeChatMenu();
    const chatsStore = Alpine.store("chats");
    if (chatsStore) chatsStore.selectChat(chatId);
  },

  /**
   * Close/kill a chat (delegates to chats store).
   */
  killChat(chatId) {
    const chatsStore = Alpine.store("chats");
    if (chatsStore) chatsStore.killChat(chatId);
  },

  /**
   * Create a new chat (delegates to chats store).
   */
  newChat() {
    const chatsStore = Alpine.store("chats");
    if (chatsStore) chatsStore.newChat();
  },

  /**
   * Create a new chat inside a specific project group.
   * Two-step approach:
   *   1. Create a new chat via /chat_create
   *   2. Immediately activate the project on it via /projects?action=activate
   * This is reliable regardless of chat_inherit_project setting or existing chat state.
   */
  async newChatInProject(group) {
    const chatsStore = Alpine.store("chats");
    if (!chatsStore) return;

    // For the "No Project" group, fall back to the default new-chat behaviour.
    if (group.key === NO_PROJECT_KEY) {
      chatsStore.newChat();
      return;
    }

    try {
      // Step 1: create a new chat
      const createResp = await sendJsonData("/chat_create", {
        current_context: chatsStore.selected || "",
      });
      if (!createResp || !createResp.ok) return;

      const newCtxId = createResp.ctxid;

      // Step 2: directly activate the project on the new chat
      await sendJsonData("/projects", {
        action: "activate",
        context_id: newCtxId,
        name: group.name,
      });

      // Select the new chat (sidebar will update reactively)
      chatsStore.selectChat(newCtxId);
    } catch (e) {
      toastFetchError("Error creating chat in project", e);
    }
  },

  async branchChat(contextId) {
    try {
      const res = await sendJsonData("/plugins/project_sidebar/branch_from_end", { context_id: contextId });
      if (res?.ok) {
        const chatsStore = Alpine.store("chats");
        if (chatsStore) chatsStore.selectChat(res.ctxid);
      }
    } catch (e) {
      toastFetchError("Error branching chat", e);
    }
  },

  /**
   * Constant for no-project key.
   */
  /** Check if a group contains the selected chat. */
  isActiveChat(context) {
    const chatsStore = Alpine.store("chats");
    return chatsStore && chatsStore.selected === context.id;
  },

  get NO_PROJECT_KEY() {
    return NO_PROJECT_KEY;
  },
};

export const store = createStore("projectSidebar", model);
