from collections.abc import Callable
from typing import TypeVar
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

T = TypeVar("T")


def with_retry(attempts: int, backoff_seconds: float) -> Callable[[Callable[..., T]], Callable[..., T]]:
    return retry(
        reraise=True,
        stop=stop_after_attempt(attempts),
        wait=wait_exponential(multiplier=backoff_seconds, min=backoff_seconds, max=backoff_seconds * 8),
        retry=retry_if_exception_type((TimeoutError, OSError, RuntimeError)),
    )
