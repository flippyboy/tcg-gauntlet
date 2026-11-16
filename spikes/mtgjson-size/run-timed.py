#!/usr/bin/env python3
# usage: run-timed.py -- cmd args...  ; prints wall seconds and peak RSS of the child tree (ru_maxrss of children)
import resource, subprocess, sys, time
cmd = sys.argv[sys.argv.index('--')+1:]
t = time.time()
r = subprocess.run(cmd)
w = time.time() - t
ru = resource.getrusage(resource.RUSAGE_CHILDREN)
print(f"wall={w:.2f}s user={ru.ru_utime:.2f}s sys={ru.ru_stime:.2f}s maxrss={ru.ru_maxrss/1024:.1f} MiB rc={r.returncode}", file=sys.stderr)
