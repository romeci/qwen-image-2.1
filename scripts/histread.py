import json, urllib.request

h = json.load(urllib.request.urlopen("http://127.0.0.1:8188/history"))
for pid, e in list(h.items())[-6:]:
    st = e.get("status", {})
    print("=" * 70)
    print(pid, "->", st.get("status_str"))
    for m in st.get("messages", []):
        print("  MSG", m[0], json.dumps(m[1])[:700])
    pr = e.get("prompt")
    if pr and len(pr) > 3 and pr[3]:
        for nid, node in pr[3].items():
            if isinstance(node, dict) and str(node.get("class_type", "")).startswith("TextEncode"):
                print("  PROMPT:", str(node.get("inputs", {}).get("prompt", ""))[:250])
    for nid, o in (e.get("outputs") or {}).items():
        if "images" in o:
            print("  OUT:", [i.get("filename") for i in o["images"]])
