import json

with open('zain_catering_COMBINED_WORKFLOW.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

nodes = data.get('nodes', [])
connections = data.get('connections', {})
names = [n['name'] for n in nodes]
dupes = [x for x in set(names) if names.count(x) > 1]
dangling = []
for src, out in connections.items():
    if src not in names:
        dangling.append(f'Source missing: {src}')
    for mt, clist in out.items():
        for carr in clist:
            for t in carr:
                if t.get('node') not in names:
                    dangling.append(f'Target missing: {t.get("node")}')

print(f'Nodes: {len(nodes)}, Dupes: {dupes}, Dangling: {dangling}')
