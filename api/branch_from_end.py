import json
from helpers.api import ApiHandler, Input, Output, Request, Response
from helpers import files
from agent import AgentContext
import helpers.persist_chat as persist_chat
try:
    from plugins._chat_branching.api.branch_chat import BranchChat
    _BRANCH_AVAILABLE = True
except ImportError:
    _BRANCH_AVAILABLE = False


class BranchFromEnd(ApiHandler):
    """Branch a chat from its last log entry (convenience wrapper for the sidebar).

    Works for both in-memory and on-disk chats — loads from disk if not currently active.
    """

    async def process(self, input: Input, request: Request) -> Output:
        if not _BRANCH_AVAILABLE:
            return Response("Branch chat requires the _chat_branching plugin to be installed", 503)
        context_id = input.get("context_id", "")
        if not context_id:
            return Response("Missing context_id", 400)

        context = AgentContext.get(context_id)

        if not context:
            # Chat exists on disk but is not currently loaded in memory — load it
            try:
                path = persist_chat._get_chat_file_path(context_id)
                js = files.read_file(path)
                if not js:
                    return Response("Context not found", 404)
                data = json.loads(js)
                context = persist_chat._deserialize_context(data)
            except Exception as e:
                return Response(f"Context not found: {e}", 404)

        if not context:
            return Response("Context not found", 404)

        if not context.log.logs:
            return Response("Chat has no messages to branch from", 400)

        last_no = context.log.logs[-1].no

        # Delegate to BranchChat with the last log item's number
        fake_input = {"context": context_id, "log_no": last_no}
        return await BranchChat().process(fake_input, request)
