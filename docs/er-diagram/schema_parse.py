"""Reads migrations/*.sql and returns the real schema.

The ER diagram is generated from this, not from memory, so that a column or
foreign key can never appear in the picture without existing in the database.
"""
import glob, re, os

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")


def parse():
    tables = {}  # name -> {"cols": [..], "migration": file}
    for f in sorted(glob.glob(os.path.join(ROOT, "migrations", "*.sql"))):
        sql = re.sub(r"--[^\n]*", "", open(f, encoding="utf-8").read())
        for m in re.finditer(r"CREATE TABLE (\w+) \((.*?)\n\);", sql, re.S):
            name, body = m.group(1), m.group(2)
            cols = []
            for line in body.split("\n"):
                line = line.strip().rstrip(",")
                mm = re.match(r"^(\w+)\s+(TEXT|INTEGER|REAL)\b(.*)$", line)
                if not mm:
                    continue
                rest = mm.group(3)
                fk = re.search(r"REFERENCES (\w+)\((\w+)\)", rest)
                cols.append({
                    "name": mm.group(1),
                    "type": mm.group(2),
                    "pk": "PRIMARY KEY" in rest,
                    "unique": "UNIQUE" in rest,
                    "notnull": "NOT NULL" in rest,
                    "fk": fk.group(1) if fk else None,
                })
            tables[name] = {"cols": cols, "migration": os.path.basename(f)}
        for m in re.finditer(r"ALTER TABLE (\w+) ADD COLUMN (\w+) (TEXT|INTEGER|REAL)([^;]*);", sql):
            t, c, ty, rest = m.groups()
            fk = re.search(r"REFERENCES (\w+)\((\w+)\)", rest)
            tables[t]["cols"].append({
                "name": c, "type": ty, "pk": False, "unique": False,
                "notnull": "NOT NULL" in rest, "fk": fk.group(1) if fk else None,
            })
    return tables


if __name__ == "__main__":
    t = parse()
    print(len(t), "tables;", sum(len(v["cols"]) for v in t.values()), "columns;",
          sum(1 for v in t.values() for c in v["cols"] if c["fk"]), "foreign keys")
