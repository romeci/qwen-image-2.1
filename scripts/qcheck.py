import json, urllib.request
try:
    q = json.load(urllib.request.urlopen("http://127.0.0.1:8188/queue", timeout=8))
    print("fila running:", len(q.get("queue_running", [])), " pending:", len(q.get("queue_pending", [])))
    for e in q.get("queue_running", []):
        print("  RUNNING", e[1])
except Exception as e:
    print("queue ERR", e)
try:
    h = json.load(urllib.request.urlopen("http://127.0.0.1:8188/history/ad4aea60-6133-42cf-aa08-3d485706f426", timeout=8))
    for pid, e in h.items():
        st = e.get("status", {})
        print("history:", st.get("status_str"), json.dumps(st.get("messages", []))[:600])
except Exception as e:
    print("history ERR", e)
try:
    s = json.load(urllib.request.urlopen("http://127.0.0.1:8188/system_stats", timeout=8))
    print("ram GB:", round(s["system"]["ram_used"]/1e9,1), " vram GB:", round(s["devices"][0]["vram_used"]/1e9,1))
except Exception as e:
    print("stats ERR", e)
