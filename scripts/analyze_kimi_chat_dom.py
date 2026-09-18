from bs4 import BeautifulSoup
from pathlib import Path
import sys

html_path = Path(sys.argv[1])
soup = BeautifulSoup(html_path.read_text(encoding="utf-8", errors="replace"), "html.parser")
seen = set()
for node in soup.find_all(True):
    text = node.get_text(" ", strip=True)
    if not (120 <= len(text) <= 20000):
        continue
    classes = " ".join(node.get("class", []))
    if not classes or not any(token in classes.lower() for token in ("message", "chat", "query", "answer", "content", "markdown", "turn")):
        continue
    key = (node.name, classes, len(text))
    if key in seen:
        continue
    seen.add(key)
    print({"tag": node.name, "classes": classes, "text_length": len(text), "start": text[:120]})
