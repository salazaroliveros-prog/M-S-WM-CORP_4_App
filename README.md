<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/temp/2

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. (Opcional) Configurar Supabase para CRUD real:
   - Copie [.env.local.example](.env.local.example) a `.env.local` y complete `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
   - En Supabase Auth, habilite **Anonymous sign-ins** (o reemplace por un login real).
    - Aplique la migración SQL en `supabase/migrations/20260204_init.sql`.
    - (Opcional) Para **APUs + precios desde Web con cache** aplique también `supabase/migrations/20260204_catalog_apu_prices.sql`.
3. Run the app:
   `npm run dev`

## Deploy a GitHub Pages

Este repo está configurado para desplegarse automáticamente a GitHub Pages con GitHub Actions.

1) En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2) Hacer push a `main`.
3) El workflow publicará la carpeta `dist/`.

URL esperada:

`https://salazaroliveros-prog.github.io/M-S-WM-CORP_4_App/`

Si quieres probar el build de Pages local:

`npm run build:pages`

## Catálogo APU + Precios (importación web segura)

La app **no hace scraping** automático de sitios. Para mantener datos **seguros y trazables**, se importan desde una URL explícita (CSV/JSON) que usted controle o desde APIs oficiales con permiso.

### CSV de precios (para "Actualizar Precios Web")

- Debe ser una URL pública que devuelva texto CSV.
- Encabezados soportados (case-insensitive):
   - `name` o `descripcion`
   - `unit_price` o `precio`
   - `unit` (opcional)

Ejemplo:

```csv
name,unit,unit_price
Cemento 42.5kg,saco,78.50
Arena lavada,m3,210.00
Varilla #3,unidad,36.00
```

Sugerencia: Google Sheets "Publicar en la web" como CSV.

### JSON de APUs (para "Actualizar APUs Web")

Formato recomendado: arreglo de objetos.

```json
[
   {
      "typology": "RESIDENCIAL",
      "name": "Limpieza y chapeo",
      "unit": "m2",
      "laborCost": 15,
      "equipmentCost": 5,
      "materials": [
         { "name": "Cal", "unit": "lbs", "quantityPerUnit": 0.5, "unitPrice": 0 }
      ],
      "meta": {
         "rendimiento_mo": "0.08 jornales/m2",
         "rendimiento_material": "0.5 lbs/m2"
      },
      "currency": "GTQ",
      "source": "Base interna",
      "effectiveDate": "2026-02-04"
   }
]
```

Una vez importado, al crear un renglón personalizado puede activar "catálogo Supabase" para autocompletar mano de obra/equipo/materiales y aplicar precios cacheados.
