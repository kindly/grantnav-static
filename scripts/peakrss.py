#!/usr/bin/env python3
"""Run a command and report wall time and peak RSS (polled from /proc)."""
import subprocess, sys, threading, time, os

peak = 0
def poll(pid, stop):
    global peak
    while not stop.is_set():
        try:
            with open(f"/proc/{pid}/status") as f:
                for line in f:
                    if line.startswith("VmHWM:"):
                        peak = max(peak, int(line.split()[1]))
                        break
        except OSError:
            return
        time.sleep(0.02)

t0 = time.time()
p = subprocess.Popen(sys.argv[1:])
stop = threading.Event()
th = threading.Thread(target=poll, args=(p.pid, stop)); th.start()
rc = p.wait(); stop.set(); th.join()
print(f"\n[wall {time.time()-t0:.1f}s  peak RSS {peak/1024/1024:.2f} GB  exit {rc}]", file=sys.stderr)
