"""대화 메모리 관리 — MemorySaver 싱글턴"""

import logging
from langgraph.checkpoint.memory import MemorySaver

logger = logging.getLogger(__name__)

_checkpointer: MemorySaver | None = None


async def get_checkpointer() -> MemorySaver:
    global _checkpointer
    if _checkpointer is None:
        _checkpointer = MemorySaver()
        logger.info("Agent checkpointer 초기화 완료")
    return _checkpointer


async def close_checkpointer() -> None:
    global _checkpointer
    if _checkpointer is not None:
        _checkpointer = None
        logger.info("Agent checkpointer 종료")
