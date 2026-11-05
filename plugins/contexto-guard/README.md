# contexto-guard

Mod de Claude Code que vigila el uso de la ventana de contexto y avisa antes de que la conversación se compacte, para que puedas compactar tú cuando te convenga.

## Qué hace

- **Aviso al 70 %**: cuando el contexto llega al 70 %, la respuesta de Claude empieza con una línea `⚠ Contexto al N%…`. No bloquea nada.
- **`/contexto`**: muestra una barra con el % usado, los tokens y el estado de la compactación.
- **`/permitir-compactar`**: deja pasar la próxima compactación automática sin preguntar.
- **Compactación automática**: por debajo del 95 % se pone en espera hasta que escribas `/compact` o `/permitir-compactar`; a partir del 95 % se deja pasar para que la conversación no falle por contexto lleno. Con una ventana de 1M tokens Claude Code intenta compactar hacia el 90 % (umbral observado: 901.600 tokens), así que entre el 90 % y el 95 % el mod te pide permiso.
- En superficies que dibujan mods (terminal, escritorio) añade además un panel "Contexto" y una banda con botones. La web de Claude Code no los dibuja.

## Instalar

En una sesión de Claude Code:

```
/plugin install contexto-guard --marketplace EngineeringEyes/codex-premium
```

Desde una terminal:

```bash
claude plugin install contexto-guard --marketplace EngineeringEyes/codex-premium
```

El repositorio también incluye `.claude/settings.json`, que declara este marketplace y activa el plugin para las sesiones que abran el repositorio.

## Ajustes

En `hooks/register.tsx`: `WARN` (umbral del aviso, 70) y `HARD` (a partir de qué % no se retiene la compactación automática, 95).
