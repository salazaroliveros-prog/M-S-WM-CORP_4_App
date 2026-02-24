# Android OEM: Ubicación en segundo plano (rastrear cada 1 min)

> Nota: este archivo es **documentación (Markdown)**. No se ejecuta en Supabase. Si lo pegas en `supabase db query` o en el SQL Editor, verás un error de sintaxis (por el `#`).

## ¿Qué sí se ejecuta en Supabase?

- Sólo archivos **.sql** (por ejemplo los de `supabase/migrations/`).
- Comandos típicos:
  - `supabase migration list` (ver migraciones)
  - `supabase db push` (aplicar migraciones al proyecto)
  - o `supabase migration up` (aplicar migraciones en local)

Este documento es un checklist práctico para que el rastreo de ubicación en **segundo plano** sea lo más consistente posible en Android, incluyendo capas OEM (Xiaomi/MIUI, Huawei/EMUI, Samsung/OneUI, OPPO/Realme, Vivo, etc.).

> Importante: en Android, el “background” depende de permisos + batería + políticas del fabricante. No existe garantía absoluta en *todos* los modelos si el usuario no da permisos y el sistema aplica ahorro de energía agresivo.

---

## 1) Requisito clave (recomendado)

- Para rastreo real en segundo plano: usar la **app nativa (Capacitor/Android)**.
- En **PWA/navegador**: el sistema puede pausar timers y geolocalización cuando la app está en background.

---

## 2) Permisos (obligatorios)

En el teléfono del trabajador:

1) **Ubicación**
- Permitir: **“Todo el tiempo”** (Allow all the time)
- Activar: **“Ubicación precisa”** (Precise)

2) **Notificaciones** (Android 13+)
- Permitir notificaciones para que el servicio en primer plano pueda mostrar su aviso.

3) Verificar servicios del sistema
- GPS/Ubicación del sistema: **ON**
- Datos/Wi‑Fi: **ON** (si no hay señal, debe encolar y enviar luego)

### Nota por versión de Android (muy común)

- **Android 10+**: el permiso de “Ubicación en segundo plano” puede pedirse/otorgarse aparte.
- **Android 11+**: muchas veces no te deja elegir “Todo el tiempo” en el primer diálogo; primero debes permitir **“Sólo mientras se usa”** y luego ir a:
  - Ajustes → Apps → (tu app) → Permisos → Ubicación → **Permitir todo el tiempo**.
- **Android 12+**: el sistema es más estricto con procesos en background; si no ves un aviso persistente cuando está rastreando, normalmente el OS está matando el proceso.
- **Android 13+**: si no permites **Notificaciones**, el servicio en primer plano puede no mostrar aviso y el rastreo se vuelve inestable.

### Señal de que está funcionando (obligatorio validar)

- Cuando el rastreo esté activo en segundo plano, el teléfono debería mostrar **indicador de ubicación** (icono) y/o una **notificación persistente** (Foreground Service).
- Si no aparece: revisar permisos (Ubicación “todo el tiempo” + Notificaciones) y batería/OEM.

---

## 3) Ajustes de batería (casi siempre el problema)

En Ajustes del sistema (ruta puede variar):

- Apps → (tu app) → **Batería** → seleccionar **“Sin restricciones / Unrestricted”**
- Desactivar “Optimización de batería” / “Battery optimization” para la app
- (Si existe) habilitar “Permitir actividad en segundo plano”

**Samsung (OneUI)**: además de “Unrestricted”, agregar la app a **Never sleeping apps**.

---

## 4) Checklist OEM (por marca)

### Samsung (OneUI)
- Ajustes → Apps → (tu app) → Batería → **Sin restricciones (Unrestricted)**
- Ajustes → Cuidado del dispositivo → Batería → Límites de uso en segundo plano → **Apps que nunca se suspenden** → agregar la app

### Xiaomi / Redmi / POCO (MIUI)
- Seguridad → Permisos → **Inicio automático (Autostart)**: ON
- Ajustes → Apps → (tu app) → Batería → **Sin restricciones / No restrictions**
- En Recientes: mantener presionado el icono de la app → **Bloquear** (para que no la limpie el sistema)

### Huawei (EMUI)
- Ajustes → Apps → (tu app) → **Inicio de aplicaciones / App launch**
  - Desactivar “Administrar automáticamente”
  - Activar manualmente: **Auto-lanzar**, **Lanzar secundario**, **Ejecutar en segundo plano**
- Batería → ahorro/optimización: excluir la app

### OPPO / Realme (ColorOS / realme UI)
- Ajustes → Batería → **Ahorro de energía**: excluir la app
- Ajustes → Apps → (tu app) → Uso de batería → permitir actividad en segundo plano
- (Si existe) “Auto-launch / Inicio automático”: habilitar

### Vivo (Funtouch)
- iManager / Administrador → **Autostart**: habilitar
- Batería → optimización/ahorro: excluir la app

### OnePlus (OxygenOS)
- Ajustes → Batería → Optimización de batería → (tu app) → **No optimizar**

### Tecno / Infinix / Itel (XOS / HiOS)
- Administrador del teléfono → Autostart: habilitar
- Batería → Power Marathon / ahorro agresivo: desactivar o excluir la app

---

## 5) Prueba rápida en campo (5–10 min)

Objetivo: confirmar que el administrador ve cambios mientras el teléfono del trabajador está bloqueado.

1) En RRHH (admin), abrir “Asistencia por día” y el mapa.
2) En el teléfono del trabajador:
- Abrir asistencia
- Confirmar que la ubicación está lista
- Bloquear pantalla (dejar el teléfono quieto o caminar)
3) Esperar 2–5 minutos.

**PASA si:** en el mapa del admin se observan cambios de coordenadas/última actualización sin refrescar manual.

---

## 6) Diagnóstico cuando “se corta”

- Si no hay aviso/ícono de ubicación en la barra de estado:
  - Revisar permiso de notificaciones (Android 13+)
  - Revisar permiso de ubicación “todo el tiempo”
- Si sólo funciona con la app abierta:
  - Es casi siempre optimización de batería (poner “Unrestricted” + OEM autostart)
- Si funciona en algunos modelos y en otros no:
  - Aplicar el checklist OEM y repetir la prueba 5–10 min.
