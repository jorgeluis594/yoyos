"""Extract the pinned INEI workbook: python3 shared/data/import-peru-geography.py file.xlsx."""
import hashlib
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

source = Path(sys.argv[1])
ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
with zipfile.ZipFile(source) as workbook:
    strings = ["".join(item.itertext()) for item in ET.fromstring(workbook.read("xl/sharedStrings.xml")).findall("s:si", ns)]
    locations = []
    for row in ET.fromstring(workbook.read("xl/worksheets/sheet1.xml")).findall("s:sheetData/s:row", ns):
        cells = {}
        for cell in row:
            value = cell.find("s:v", ns)
            if value is not None:
                cells[re.sub(r"\d", "", cell.attrib["r"])] = strings[int(value.text)] if cell.attrib.get("t") == "s" else value.text
        code = cells.get("A", "")
        if re.fullmatch(r"\d{6}", code) and code != "000000":
            name = re.sub(r"(?:\s+\d+/)+$", "", cells["B"]).strip()
            locations.append((code, name))

codes = {code for code, _ in locations}
assert len(codes) == len(locations) == 2113, "Expected 25 departments, 196 provinces and 1892 districts"
assert all(name and not re.search(r"\d|/", name) for _, name in locations)
assert all(code[:2] + "0000" in codes and (code.endswith("0000") or code[:4] + "00" in codes) for code in codes)
digest = hashlib.sha256(source.read_bytes()).hexdigest()
output = "// Generated from the pinned INEI workbook; see peru-geography-source.md.\n"
output += f"// Source SHA-256: {digest}\n"
output += "export const peruLocations: readonly (readonly [string, string])[] = [\n"
output += "".join("  " + json.dumps(item, ensure_ascii=False) + ",\n" for item in locations)
output += "];\n"
Path(__file__).with_name("peru-geography-2026.ts").write_text(output, encoding="utf-8")
print(f"Imported {len(locations)} locations; SHA-256 {digest}")
