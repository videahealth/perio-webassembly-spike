import asyncio
from typing import Callable, Coroutine, Any

# Injected by the JS worker at runtime via pyodide.globals.set()
wait_for_message: Callable[[], Coroutine[Any, Any, str]]
send_message: Callable[[str], None]


async def main() -> None:
    counter = 0

    while True:
        # Await the next message from JS — yields control to the JS event loop
        msg = await wait_for_message()

        if msg == "__STOP__":
            send_message("goodbye!")
            break

        # Simulate processing delay
        await asyncio.sleep(1)

        counter += 1
        send_message(f"pong {counter}")


await main()  # type: ignore[top-level-await]  # Pyodide's runPythonAsync supports this
