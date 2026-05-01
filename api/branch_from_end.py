from helpers.api import ApiHandler, Input, Output, Request, Response
from agent import AgentContext

try:
    from plugins._chat_branching.api.branch_chat import BranchChat
    _BRANCH_AVAILABLE = True
except ImportError:
    _BRANCH_AVAILABLE = False


class BranchFromEnd(ApiHandler):
    """Branch the active chat from its last log entry.

    Thin convenience wrapper over the _chat_branching plugin: looks up the
    last log entry of an in-memory context and forwards to BranchChat.
    Does not touch disk — callers must ensure the chat is loaded.
    """

    async def process(self, input: Input, request: Request) -> Output:
        if not _BRANCH_AVAILABLE:
            return Response("Branch chat requires the _chat_branching plugin to be installed", 503)

        context_id = input.get("context_id", "")
        if not context_id:
            return Response("Missing context_id", 400)

        context = AgentContext.get(context_id)
        if not context:
            return Response("Chat is not loaded — open it first, then branch", 409)
        if not context.log.logs:
            return Response("Chat has no messages to branch from", 400)

        last_no = context.log.logs[-1].no
        return await BranchChat(self.app, self.thread_lock).process(
            {"context": context_id, "log_no": last_no}, request,
        )
