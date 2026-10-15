import asyncio

from compliance_service.infra.tasks import cancel_and_wait


async def test_cancels_a_running_task():
    task = asyncio.create_task(asyncio.sleep(60))

    await cancel_and_wait(task)

    assert task.cancelled()


async def test_does_not_raise_for_a_task_that_already_failed():
    async def crash():
        raise RuntimeError("consumer crashed")

    task = asyncio.create_task(crash())
    await asyncio.sleep(0)

    await cancel_and_wait(task)

    assert task.done()
