from pathlib import Path
from bs4 import BeautifulSoup
import json
import sys

html_path = Path(sys.argv[1])
soup = BeautifulSoup(html_path.read_text(encoding="utf-8", errors="replace"), "html.parser")
records = []
for link in soup.select("a.history-link"):
    title = link.select_one(".title")
    time_node = link.select_one(".time")
    preview = link.select_one(".content, .preview, .description")
    attachments = [node.get_text(" ", strip=True) for node in link.select(".file, .attachment, [class*=file]")]
    records.append({
        "href": link.get("href"),
        "title": title.get_text(" ", strip=True) if title else None,
        "time": time_node.get_text(" ", strip=True) if time_node else None,
        "preview_present": bool(preview),
        "attachment_labels": attachments,
    })
print(json.dumps({"count": len(records), "records": records}, indent=2, ensure_ascii=False))
