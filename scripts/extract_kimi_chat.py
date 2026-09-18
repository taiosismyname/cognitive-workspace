from bs4 import BeautifulSoup
from pathlib import Path
from urllib.parse import urlparse
import json
import sys

html_path = Path(sys.argv[1])
output_path = Path(sys.argv[2])
source_url = sys.argv[3]
soup = BeautifulSoup(html_path.read_text(encoding="utf-8", errors="replace"), "html.parser")

header = soup.select_one("header")
title = header.get_text(" ", strip=True) if header else None
messages = []
for node in soup.select("div.chat-content-item-user, div.chat-content-item-assistant"):
    classes = set(node.get("class", []))
    role = "user" if "chat-content-item-user" in classes else "assistant"
    text_node = node.select_one(".user-content__text") if role == "user" else node.select_one(".markdown")
    if text_node is None:
        text_node = node.select_one(".segment-content")
    text = text_node.get_text(" ", strip=True) if text_node else node.get_text(" ", strip=True)
    if text:
        messages.append({"role": role, "content": text})

result = {
    "source": {"provider": "kimi", "url": source_url, "conversation_id": urlparse(source_url).path.rsplit("/", 1)[-1]},
    "title": title,
    "message_count": len(messages),
    "messages": messages,
}
output_path.parent.mkdir(parents=True, exist_ok=True)
output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"output": str(output_path), "title": title, "message_count": len(messages)}, ensure_ascii=False))
