import sys
import math
import time
from typing import Callable

# Injected by the JS worker at runtime via pyodide.globals.set()
send_progress: Callable[[str], None]

send_progress("Starting computation...")

# Step 1: Greeting
send_progress("Generating greeting...")
greeting = f"Hello from Python {sys.version.split()[0]} running in a Web Worker!"
time.sleep(1)

# Step 2: Compute primes (simulate a longer task with progress)
limit = 10000
send_progress(f"Computing primes up to {limit}...")

sieve = [True] * (limit + 1)
sieve[0] = sieve[1] = False
for i in range(2, int(math.sqrt(limit)) + 1):
    if sieve[i]:
        for j in range(i * i, limit + 1, i):
            sieve[j] = False

primes = [i for i in range(limit + 1) if sieve[i]]
send_progress(f"Found {len(primes)} primes")
time.sleep(1)

# Step 3: Some stats
send_progress("Computing statistics...")
total = sum(primes)
average = total / len(primes)
time.sleep(1)

send_progress("Done!")

result = {
    "greeting": greeting,
    "prime_count": len(primes),
    "largest_prime": primes[-1],
    "sum_of_primes": total,
    "average_prime": round(average, 2),
    "first_20": primes[:20],
    "last_20": primes[-20:],
}
result
