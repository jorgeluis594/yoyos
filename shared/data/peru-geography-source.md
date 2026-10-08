# Peru geography catalog

Pinned source: INEI, **Perú: Población Total Proyectada al 30 de Junio de cada año, según Departamento, Provincia y Distrito, 2018–2026**.

- [Official publication](https://www.gob.pe/institucion/inei/informes-publicaciones/6894980-peru-poblacion-total-proyectada-al-30-de-junio-de-cada-ano-segun-departamento-provincia-y-distrito-2018-2025).
- [Workbook](https://cdn.www.gob.pe/uploads/document/file/8261096/6894980-peru-poblacion-total-proyectada-al-30-de-junio-de-cada-ano-segun-departamento-provincia-y-distrito-2018-2026.xlsx?v=1768402069), retrieved 2026-10-07; published file version 2026-01-14.
- SHA-256: `9436df29b883fd4a9db3705040a6668ff4efe7047c2643249b6b6bedd90d5c8b`.
- Worksheet 1, columns A (UBIGEO) and B (name): 25 departments, 196 provinces, 1,892 districts. The country summary is excluded. Trailing numeric footnote references are removed; names and leading zeroes otherwise remain as published.

The workbook is a population projection table; only its geographic identifiers and names are used. This snapshot defines the supported pilot catalog, without a network dependency at runtime. Updates require reviewing a new official snapshot and its hierarchy before replacing the data.

Reproduce from the downloaded workbook:

```sh
python3 shared/data/import-peru-geography.py /path/to/inei-workbook.xlsx
pnpm --silent --dir apps/core test:unit ../../shared/peru-geography.spec.mjs
```
