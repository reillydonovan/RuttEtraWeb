"""Rutt copilot step 3 -> 4: (request -> settings patch) pairs from captioned stills.

    python build_pairs.py <stills set dir> <out dir> [--max-words 25] [--holdout 0.05]

For each still with a caption (<id>.request.txt, the short request an artist would type for that
look) and its sampled patch (samples.jsonl): the reply is a compact JSON patch of only the keys
that differ from the app's defaults (a patch loads with settings.patch(presetPatch(...)): keys left
out keep their values -- the app is reset to defaults before a look in the stills renderer, and the
copilot's caller does the same), with values gated off by their switch dropped, numbers rounded.
Writes train.jsonl / heldout.jsonl ({"messages": [...]}, the llm_finetune format) + manifest.json.
Seeded split by id. Defaults and gating come from the schema (schema/params.json).
"""
import argparse
import hashlib
import json
import random
import re
from pathlib import Path

SCHEMA = Path(__file__).resolve().parent.parent / "schema" / "params.json"


def gated_on(gate, patch) -> bool:
    """The schema's gated_by is prose that starts with the switch: "bloomEnabled=true (default
    false); ...", "scanlineEnabled (default true)", "colorMode=phosphorCustom". A gate that is not a
    key of the patch (e.g. "needs a picture: ...") does not drop anything."""
    if not gate:
        return True
    m = re.match(r"([A-Za-z]\w*)(?:=(\S+?))?(?=[\s;(]|$)", gate)
    if not m or m.group(1) not in patch:
        return True
    want = m.group(2)
    have = patch[m.group(1)]
    if want is None:
        return have is True
    if want in ("true", "false"):
        return have is (want == "true")
    return str(have) == want


def rnd(v):
    if isinstance(v, float):
        return float(f"{v:.3g}")
    return v


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("set_dir")
    ap.add_argument("out_dir")
    ap.add_argument("--max-words", type=int, default=25)
    ap.add_argument("--holdout", type=float, default=0.05)
    a = ap.parse_args()
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    params = {p["key"]: p for p in schema["params"]}
    d, out = Path(a.set_dir), Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    samples = {json.loads(l)["id"]: json.loads(l) for l in (d / "samples.jsonl").read_text().splitlines() if l.strip()}

    rows, skipped = [], {"no caption": 0, "long": 0, "empty patch": 0}
    for i, s in samples.items():
        cap = d / f"{i}.request.txt"
        if not cap.exists():
            skipped["no caption"] += 1
            continue
        req = " ".join(cap.read_text(encoding="utf-8").split()).strip().strip('"')
        if not req or len(req.split()) > a.max_words:
            skipped["long"] += 1
            continue
        patch = s["patch"]
        reply = {}
        for k, v in patch.items():
            p = params.get(k, {})
            if not gated_on(p.get("gated_by"), patch):
                continue  # a gated value does nothing while its switch is off
            if k in params and rnd(v) == rnd(p.get("default")):
                continue
            reply[k] = rnd(v)
        if not reply:
            skipped["empty patch"] += 1
            continue
        rows.append((i, req, reply))

    rng = random.Random(1919)
    ids = sorted(r[0] for r in rows)
    held = set(rng.sample(ids, max(1, int(len(ids) * a.holdout))))
    files = {"train": [], "heldout": []}
    for i, req, reply in rows:
        msg = {"messages": [{"role": "user", "content": req},
                            {"role": "assistant", "content": json.dumps(reply, separators=(",", ":"), sort_keys=True)}],
               "_id": i}
        files["heldout" if i in held else "train"].append(msg)
    for name, rs in files.items():
        with (out / f"{name}.jsonl").open("w", encoding="utf-8", newline="\n") as f:
            for r in rs:
                f.write(json.dumps({"messages": r["messages"]}) + "\n")
        (out / f"{name}.ids.json").write_text(json.dumps([r["_id"] for r in rs]))
    sha = hashlib.sha256((out / "train.jsonl").read_bytes()).hexdigest()
    keys = {}
    for _, _, reply in rows:
        for k in reply:
            keys[k] = keys.get(k, 0) + 1
    manifest = {"set": str(d), "train": len(files["train"]), "heldout": len(files["heldout"]),
                "skipped": skipped, "train_sha256": sha, "max_words": a.max_words,
                "mean_reply_keys": round(sum(len(r[2]) for r in rows) / max(1, len(rows)), 1),
                "key_frequency": dict(sorted(keys.items(), key=lambda kv: -kv[1]))}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    print(json.dumps({k: manifest[k] for k in ("train", "heldout", "skipped", "mean_reply_keys")}))


if __name__ == "__main__":
    main()
