"""Offline structural HTML tree for DOM assertions; does not emulate a browser."""
import json
import sys
from html.parser import HTMLParser

class Tree(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = {"tag": "root", "attrs": {}, "children": []}
        self.stack = [self.root]
    def handle_starttag(self, tag, attrs):
        node = {"tag": tag, "attrs": dict(attrs), "children": []}
        self.stack[-1]["children"].append(node)
        if tag not in {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}:
            self.stack.append(node)
    def handle_endtag(self, tag):
        if self.stack[-1]["tag"] != tag:
            raise ValueError("Mismatched HTML: " + tag)
        self.stack.pop()
    def handle_data(self, data):
        self.stack[-1]["children"].append(data)

tree = Tree()
tree.feed(sys.stdin.read())
if len(tree.stack) != 1:
    raise ValueError("Unclosed HTML")
print(json.dumps(tree.root))
