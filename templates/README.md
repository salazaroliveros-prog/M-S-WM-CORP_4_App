# Plantillas de importación (sin links)

Si aún no tienes URLs publicadas, puedes:

1) Editar estos CSV (Excel/Google Sheets).
2) En la app ir a Presupuestos → **Actualizar Precios Web** / **Actualizar APUs Web**.
3) Elegir modo **Archivo** y subir el `.csv`.

## precios_template.csv
- Columnas: `name`, `unit`, `unit_price`

## apus_template.csv
- Requeridas: `typology`, `name`
- Opcionales: `unit`, `labor_cost`, `equipment_cost`, `materials`, `meta`
- `materials` soporta:
  - JSON en una celda: `[{"name":"Cemento","unit":"saco","quantityPerUnit":0.2,"unitPrice":0}]`
  - Texto: `Nombre|Unidad|QtyPerUnit|UnitPrice; Nombre|Unidad|QtyPerUnit|UnitPrice`
- `meta` idealmente JSON; si no, se guarda como texto.
