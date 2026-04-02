import { createStore } from "/js/AlpineStore.js";

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

  init() {
    if (this._initialized) return;
    this._initialized = true;
    this._collapsed = loadCollapsedState();
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
      // "No Project" always last
      if (a.key === NO_PROJECT_KEY && b.key !== NO_PROJECT_KEY) return 1;
      if (b.key === NO_PROJECT_KEY && a.key !== NO_PROJECT_KEY) return -1;
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
   * Select a chat (delegates to chats store).
   */
  selectChat(chatId) {
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
   * Constant for no-project key.
   */
  get NO_PROJECT_KEY() {
    return NO_PROJECT_KEY;
  },
};

export const store = createStore("projectSidebar", model);
