# CLAUDE.md

## Ojo Tablero: actualizar el tablero de trabajo

El usuario sigue el trabajo de Claude en el artifact **Ojo Tablero**:
https://claude.ai/artifact/44f4AJPGFLZDwv6aXxfofw

La página se dibuja sola a partir de un único documento de su base de datos. En cada sesión de este repositorio, Claude mantiene ese documento al día con la herramienta `ArtifactData` (cárgala con ToolSearch: `select:ArtifactData`).

- `url`: `https://claude.ai/artifact/44f4AJPGFLZDwv6aXxfofw`
- `collection`: `board`, `doc_id`: `state`

### Cuándo actualizar

1. Al empezar una tarea: `status: "working"`, título y lista de tareas.
2. Al editar un archivo importante: `file` y `code` (un fragmento corto del código nuevo, máx. ~40 líneas).
3. Al hacer commit o push, o al abrir o fusionar un PR: `lastCommit` y una entrada en `activity`.
4. Al terminar o al quedar esperando al usuario: `status: "blocked"` (esperando) o `"idle"` (terminado) y tareas marcadas.

No actualices en cada llamada a una herramienta: una vez por paso significativo basta, porque cada escritura gasta contexto.

### Cómo escribir

- Lee primero el documento (`action: "get"`) para obtener su `version` y pásala como `if_version` en el `update`. Si falla por versión, vuelve a leer y repite.
- Usa la hora real: `date -u +%Y-%m-%dT%H:%M:%SZ`.
- `activity` y `tasks` se reemplazan enteros al escribirlos: envía la lista completa y conserva solo las 15 entradas de actividad más recientes.
- Nunca escribas secretos, tokens ni datos personales: el tablero lo puede ver cualquiera con quien el usuario comparta la página.

### Campos del documento

| Campo | Tipo | Significado |
| --- | --- | --- |
| `title` | string | Nombre de la sesión o la tarea |
| `status` | `"working"` \| `"blocked"` \| `"idle"` | Trabajando / esperando al usuario / en pausa |
| `statusText` | string | Texto del estado (opcional) |
| `branch` | string | Rama actual |
| `contextPct` | number | % de contexto usado (`/contexto` o el panel Contexto) |
| `lastCommit` | string | `<hash corto> <mensaje>` |
| `file` | string | Archivo que se está editando |
| `code` | string | Fragmento del código nuevo |
| `tasks` | `{ text, done?, active? }[]` | Pasos de la tarea |
| `activity` | `{ at, kind, text }[]` | Historial; `at` en ISO UTC, `kind` corto (Edita, Commit, Comando, PR…) |
| `updatedAt` | string | Hora ISO UTC de la escritura |

## Plugin contexto-guard

`plugins/contexto-guard/` avisa al llegar al 70 % de contexto (`/contexto`, `/permitir-compactar`). Está activado para este repositorio en `.claude/settings.json`; su README explica cómo instalarlo en otras sesiones.
