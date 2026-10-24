"""Writes the E2E catalog spreadsheet (xlsx) to stdout.

The SKUs carry the run id given as the first argument, so every run imports new products
(the catalog rejects a SKU that already exists). Standard library only: scripts/e2e-smoke.sh
runs it in a throwaway python container, so the host needs nothing but Docker.
"""
import io
import sys
import zipfile
from xml.sax.saxutils import escape

run = sys.argv[1]
rows = [
    ("sku", "name", "description", "price", "category", "stock"),
    (f"E2E-{run}-A", "Termometro clinico digital", "Termometro digital com leitura axilar em 10 segundos",
     59.9, "monitoramento", 2),
    (f"E2E-{run}-B", "Seringa replica descartavel", "Seringa descartavel de 5 ml com agulha 25x7",
     2.5, "descartaveis", 100),
    (f"E2E-{run}-C", "Tomografo computadorizado", "Tomografo de 64 canais para diagnostico por imagem",
     3500000, "imagem", 1),
]


def cell(ref, value):
    if isinstance(value, str):
        return f'<c r="{ref}" t="inlineStr"><is><t>{escape(value)}</t></is></c>'
    return f'<c r="{ref}"><v>{value}</v></c>'


sheet_rows = ''.join(
    f'<row r="{r}">' + ''.join(cell(f'{"ABCDEF"[c]}{r}', v) for c, v in enumerate(row)) + '</row>'
    for r, row in enumerate(rows, start=1)
)
main_ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
rel_ns = 'http://schemas.openxmlformats.org/package/2006/relationships'
doc_rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
parts = {
    '[Content_Types].xml':
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '</Types>',
    '_rels/.rels':
        f'<Relationships xmlns="{rel_ns}">'
        f'<Relationship Id="rId1" Type="{doc_rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':
        f'<workbook xmlns="{main_ns}" xmlns:r="{doc_rel}">'
        '<sheets><sheet name="catalogo" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
        f'<Relationships xmlns="{rel_ns}">'
        f'<Relationship Id="rId1" Type="{doc_rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': f'<worksheet xmlns="{main_ns}"><sheetData>{sheet_rows}</sheetData></worksheet>',
}

buffer = io.BytesIO()
with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as xlsx:
    for name, xml in parts.items():
        xlsx.writestr(name, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + xml)
sys.stdout.buffer.write(buffer.getvalue())
