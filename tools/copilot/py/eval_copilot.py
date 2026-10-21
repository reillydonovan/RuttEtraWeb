"""Judge a copilot model on the held-out requests: does its patch parse, stay in range, and look
like what was asked for?

    python eval_copilot.py <model in ollama> <train set dir> <stills set dir> <out dir> [--n 145]

1. Ask the model each held-out request (cold, temperature 0.2), parse its reply as JSON.
2. Check: valid JSON, unknown keys, values outside the Controls ranges / not in the enum.
3. Write <out>/samples.jsonl in the stills renderer's format (same id and source as the original
   still, the predicted patch), so `stills.mjs` renders what the model asked for; then
   <out>/index.html shows, per request: the request, the original still it was written for, and
   the model's render side by side (images by relative path, open from the share).
"""
import argparse
import json
import re
import urllib.request
from pathlib import Path

SCHEMA = Path(__file__).resolve().parent.parent / "schema" / "params.json"


def ask(url, model, text):
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": text}], "stream": False,
                       "options": {"temperature": 0.2, "seed": 1919, "num_predict": 400}}).encode()
    req = urllib.request.Request(f"{url}/api/chat", body, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)["message"]["content"]


def parse(reply):
    m = re.search(r"\{.*\}", reply, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except ValueError:
        return None


def check(patch, params):
    unknown, bad = [], []
    for k, v in patch.items():
        p = params.get(k)
        if p is None:
            unknown.append(k)
            continue
        if p.get("enum") and v not in p["enum"]:
            bad.append(k)
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            lo, hi = p.get("min"), p.get("max")
            if (lo is not None and v < lo) or (hi is not None and v > hi):
                bad.append(k)
    return unknown, bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model")
    ap.add_argument("train_dir")
    ap.add_argument("stills_dir")
    ap.add_argument("out")
    ap.add_argument("--n", type=int, default=145)
    ap.add_argument("--ollama", default="http://10.0.0.26:11434")
    a = ap.parse_args()
    params = {p["key"]: p for p in json.loads(SCHEMA.read_text(encoding="utf-8"))["params"]}
    tdir, sdir, out = Path(a.train_dir), Path(a.stills_dir), Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    held = [json.loads(l) for l in (tdir / "heldout.jsonl").read_text(encoding="utf-8").splitlines()][: a.n]
    ids = json.loads((tdir / "heldout.ids.json").read_text())[: a.n]
    samples = {json.loads(l)["id"]: json.loads(l) for l in (sdir / "samples.jsonl").read_text().splitlines() if l.strip()}
    rows, stats = [], {"n": 0, "json_ok": 0, "unknown_keys": 0, "out_of_range": 0, "clean": 0}
    for i, h in zip(ids, held):
        req = h["messages"][0]["content"]
        reply = ask(a.ollama, a.model, req)
        patch = parse(reply)
        stats["n"] += 1
        row = {"id": i, "request": req, "target": json.loads(h["messages"][1]["content"]), "reply": reply[:2000]}
        if patch is not None:
            stats["json_ok"] += 1
            unknown, bad = check(patch, params)
            stats["unknown_keys"] += bool(unknown)
            stats["out_of_range"] += bool(bad)
            stats["clean"] += not unknown and not bad
            row.update(patch=patch, unknown=unknown, out_of_range=bad)
        rows.append(row)
        print(f"{stats['n']}/{len(held)} {i} json={'ok' if patch is not None else 'NO'}", flush=True)
    (out / "answers.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")
    # renderer input: the predicted patch (only known, in-range keys) on the original still's source
    with (out / "samples.jsonl").open("w", encoding="utf-8", newline="\n") as f:
        for r in rows:
            if "patch" not in r:
                continue
            s = samples[r["id"]]
            clean = {k: v for k, v in r["patch"].items() if k in params and k not in r["out_of_range"]}
            f.write(json.dumps({"id": r["id"], "seed": s["seed"], "source": s["source"], "stratum": "copilot",
                                "preset": None, "patch": clean}) + "\n")
    (out / "stats.json").write_text(json.dumps(stats, indent=1))
    rel = Path("..") / ".." / "stills" / sdir.name
    cells = "".join(
        f"<figure><figcaption>{r['request']}</figcaption><div class='pair'>"
        f"<img src='{(rel / (r['id'] + '.png')).as_posix()}' title='the look the request was written for'>"
        f"<img src='{r['id']}.png' title='what the copilot set'></div>"
        f"<small>{'JSON ok' if 'patch' in r else 'NO JSON'}"
        f"{' · unknown: ' + ', '.join(r.get('unknown', [])) if r.get('unknown') else ''}"
        f"{' · out of range: ' + ', '.join(r.get('out_of_range', [])) if r.get('out_of_range') else ''}</small></figure>"
        for r in rows)
    (out / "index.html").write_text(
        "<!doctype html><meta charset=utf-8><title>Copilot eval</title><style>"
        "body{background:#000;color:#d2d2d7;font:14px/1.5 system-ui;margin:2rem}"
        "h1{font-weight:600}figure{margin:0 0 1.6rem}figcaption{color:#f5f5f7;margin-bottom:.4rem}"
        ".pair{display:flex;gap:.5rem}.pair img{width:min(45vw,360px);border-radius:10px}small{color:#86868b}"
        "</style>"
        f"<h1>Copilot eval: {a.model}</h1><p>Left: the look the request was written for. Right: what the "
        f"model set, rendered on the same source. {stats['json_ok']}/{stats['n']} parse, "
        f"{stats['clean']}/{stats['n']} clean (known keys, in range).</p>" + cells, encoding="utf-8")
    print(json.dumps(stats))


if __name__ == "__main__":
    main()
