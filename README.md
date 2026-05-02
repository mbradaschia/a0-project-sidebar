# Project Sidebar

![Project Sidebar](webui/thumbnail.png)

An Agent Zero plugin that replaces the default chats list with a **project-grouped sidebar view**. Chats are organized under collapsible project headers, sorted by most recently active chat. The plugin is mostly frontend; it ships a single small backend route used by the "branch chat" context-menu entry, which delegates to the [`_chat_branching`](https://github.com/agent0ai/agent-zero) plugin.

## Features

- **Collapsible project groups** — Chats organized under their assigned project, collapsed by default
- **Smart sorting** — Project groups ordered by most recently active chat; chats within each group also sorted by recency
- **"No Project" group** — Chats without a project assignment are collected at the bottom
- **Edit shortcut** — Hover over any project header to reveal an edit icon linking to project settings
- **Persistent collapse state** — Expand/collapse preferences saved in `localStorage`
- **Status indicators** — Running (pulsing blue dot) and finished-unseen (teal dot) shown on collapsed project headers — matching the [Chat Status Marklet](https://github.com/mbradaschia/a0-chat-status-marklet) plugin visual style
- **Interoperability** — Maintains `.chat-container` class and adds `data-chat-id` / `data-project-name` attributes for other plugins (Chat Archive, Chat Rename, etc.)

## Installation

Install via the Agent Zero **Plugin Hub** (Settings → Plugins → Browse) or manually:

```bash
cp -r project_sidebar /path/to/agent-zero/usr/plugins/
```

Then enable the plugin in **Settings → Plugins**.

## How It Works

The plugin reads existing chat context data (which already includes project assignment) from `$store.chats.contexts` and re-renders it grouped by project. The default chats list is hidden via CSS; the project-grouped view is injected at the `sidebar-chats-list-start` extension point.

### Backend surface

The plugin exposes one backend route:

| Route | Purpose |
|---|---|
| `/plugins/project_sidebar/branch_from_end` | Looks up the requested chat's last log entry and forwards to `_chat_branching`'s `BranchChat` handler. |

Properties of this route:

- **In-memory only** — looks up the context via `AgentContext.get(...)`. If the chat is not loaded, the route returns 409 and the frontend asks core to load it (`selectChat`) before retrying. The plugin does not read chat files from disk.
- **No new persisted state** — the actual write (creating the branched chat) is performed by `_chat_branching`, not this plugin.
- **Dependency** — requires the [`_chat_branching`](https://github.com/agent0ai/agent-zero) plugin; returns 503 if it is not installed.

### "New chat in project" behaviour

The per-group "+" button creates a chat and assigns it to the clicked project. It honours the core `chat_inherit_project` setting:

- When `chat_inherit_project=true` **and** the seed (currently active) chat is already in the same project, the plugin issues only `/chat_create` and lets core auto-inherit the project — no `/projects` override.
- Otherwise the plugin follows `/chat_create` with `/projects?action=activate`, treating the user's click on a specific project group as an explicit choice that overrides the global setting.

## Interoperability

Other plugins can target elements using these selectors:

| Selector | Description |
|---|---|
| `[data-project-name="project_name"]` | Project group container or chat item belonging to a project |
| `[data-chat-id="context_id"]` | Individual chat item |
| `.project-group` | Project group wrapper `<li>` |
| `.project-group-header` | Clickable project header (collapse toggle) |
| `.chat-container` | Individual chat row (same class as default sidebar) |
| `.chat-selected` | Currently selected chat |
| `.project-sidebar-list` | The grouped `<ul>` container |

## Chat Status Marklet Compatibility

This plugin integrates with the [Chat Status Marklet](https://github.com/mbradaschia/a0-chat-status-marklet) plugin:

- **Collapsed groups**: Shows aggregate running/unseen status dots on the project header
- **Expanded groups**: Individual per-chat marklet dots are shown (no duplication)
- The `chat_status_marklet` plugin's `_syncMarklets()` uses `data-chat-id` attribute matching for correct dot placement regardless of DOM ordering

## Version

1.0.1

## License

MIT — see [LICENSE](LICENSE)
