import asyncio
import logging

logger = logging.getLogger(__name__)


async def cancel_and_wait(task: asyncio.Task) -> None:
    """Stops a background task without letting its own failure abort the caller's shutdown."""
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    except Exception:
        logger.exception("Background task had failed before shutdown")
