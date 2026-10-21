"""Submit one caption_image task per rendered still (Rutt copilot step 3), as one batch.

    python submit_captions.py <set dir> [--min-max 0.02] [--limit N]

Run with Gaffer's venv python from the Gaffer repo root; the token comes from the node config.
Skips near-black stills (manifest max luminance < --min-max) and stills already captioned or
already submitted (submitted.jsonl). Each caption is written next to the still as
<id>.request.txt. Tasks go through the mesh's shared caption_image queue (whichever node
advertises it), project ruttetraweb, role copilot-caption.
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

PROMPT = ("Write the short request a video artist would type to get exactly this look from a scan-line "
          "video instrument: 6 to 18 words, plain words about form, line, colour and light. No words like "
          "otherworldly, ethereal, electric, dreamscape, evoking. No software names or numbers. "
          "Reply with the request only.")


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("set_dir")
    ap.add_argument("--min-max", type=float, default=0.02)
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    d = Path(a.set_dir)
    uri_dir = "studio://projects/ruttetraweb-copilot/stills/" + d.name
    done_file = Path(__file__).parent / f"submitted-{d.name}.jsonl"
    already = {json.loads(l)["id"] for l in done_file.read_text().splitlines()} if done_file.exists() else set()
    todo = []
    for line in (d / "manifest.jsonl").read_text().splitlines():
        r = json.loads(line)
        if r["max"] < a.min_max or r["id"] in already or (d / f"{r['id']}.request.txt").exists():
            continue
        todo.append(r["id"])
    if a.limit:
        todo = todo[: a.limit]
    print(f"{len(todo)} to submit ({len(already)} already submitted)", flush=True)

    sys.path.insert(0, "src")
    from fastmcp import Client
    import mcp.types
    from gaffer.shareconfig import resolve_node
    cfg, _ = resolve_node(None)
    url = f"http://127.0.0.1:{cfg.mcp_port}/mcp"
    token = cfg.token
    info = mcp.types.Implementation(name="gaffer-cli", version="0.1.0")
    async with Client(url, auth=token, client_info=info) as c:
        with done_file.open("a") as out:
            for n, i in enumerate(todo, 1):
                res = (await c.call_tool("submit_task", {
                    "capability": "caption_image", "project": "ruttetraweb", "role": "copilot-caption",
                    "input": {"image": f"{uri_dir}/{i}.png", "prompt": PROMPT,
                              "output": f"{uri_dir}/{i}.request.txt"}})).data
                if "task_id" not in res:
                    print(f"refused at {i}: {res}", flush=True)
                    return
                out.write(json.dumps({"id": i, "task_id": res["task_id"]}) + "\n")
                if n % 250 == 0:
                    print(f"{n}/{len(todo)}", flush=True)
    print("submitted all", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
