import urllib.request
import json
import time
import concurrent.futures

BASE_URL = "https://fluxbasedb.me/api/ingest"

def check_health():
    print("1. Checking Live Engine Health...")
    req = urllib.request.Request(BASE_URL)
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        print(f"   Status: {resp.status} OK")
        print(f"   Engine: {data.get('engine')}")
        print(f"   Buffer Capacity: {data['metrics']['bufferCapacity']:,} items")
        print(f"   Queue Depth: {data['metrics']['queueDepth']:,} items")
        print(f"   Peak RPS: {data['metrics']['peakRps']:,} events/sec\n")

def send_batch(batch_id, count=1000):
    rows = [{"id": f"{batch_id}_{i}", "product": "test_item", "price": 99.9, "ts": time.time()} for i in range(count)]
    payload = json.dumps({"table": "telemetry_test", "rows": rows}).encode('utf-8')
    req = urllib.request.Request(BASE_URL, data=payload, headers={"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req) as resp:
        duration = (time.time() - t0) * 1000
        res = json.loads(resp.read().decode('utf-8'))
        return resp.status, res.get("queued", 0), duration, res.get("currentRps", 0)

def run_stress_test(total_events=10000, batch_size=1000, concurrency=10):
    total_batches = total_events // batch_size
    print(f"2. Running Live Ingestion Test:")
    print(f"   Pumping {total_events:,} events in {total_batches} batches of {batch_size:,} events across {concurrency} workers...")
    
    t0 = time.time()
    total_queued = 0
    latencies = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(send_batch, b, batch_size) for b in range(total_batches)]
        for f in concurrent.futures.as_completed(futures):
            status, queued, latency, rps = f.result()
            total_queued += queued
            latencies.append(latency)

    t1 = time.time()
    total_time = t1 - t0
    network_rps = int(total_queued / total_time)
    avg_lat = sum(latencies) / len(latencies)

    print("\n--- LIVE BENCHMARK COMPLETE ---")
    print(f"   Total Events Ingested: {total_queued:,}")
    print(f"   Total Time (over WAN): {total_time:.2f}s")
    print(f"   Network Throughput:    {network_rps:,} events/sec across public internet")
    print(f"   Average HTTP Latency:  {avg_lat:.1f}ms per 1,000-event batch\n")

if __name__ == "__main__":
    check_health()
    run_stress_test()
