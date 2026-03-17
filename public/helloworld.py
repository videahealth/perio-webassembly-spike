import sys
import math

def greet(name: str) -> str:
    return f"Hello, {name}! Welcome to Python running in WebAssembly."

def compute_primes(n: int) -> list[int]:
    """Find all primes up to n using a sieve."""
    sieve = [True] * (n + 1)
    sieve[0] = sieve[1] = False
    for i in range(2, int(math.sqrt(n)) + 1):
        if sieve[i]:
            for j in range(i * i, n + 1, i):
                sieve[j] = False
    return [i for i in range(n + 1) if sieve[i]]

greeting = greet("VIDEA")
primes = compute_primes(100)
python_version = sys.version

result = {
    "greeting": greeting,
    "primes": primes,
    "python_version": python_version,
}
result
