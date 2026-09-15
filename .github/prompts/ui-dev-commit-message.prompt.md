---
description: Genera commit message con Conventional Commits para copiar y pegar. Nunca hace el commit.
argument-hint: "Opcional: contexto adicional sobre los cambios (scope, ticket, etc.)"
---

Ejecuta `git diff --cached --stat`, `git status --short` y `git branch --show-current` para identificar los cambios pendientes y la rama activa.

Extrae de la rama activa el identificador Jira con el patrón `[A-Z][A-Z0-9]+-[0-9]+` (por ejemplo, de `feature/WEBBBVAEMP-31122-new-page-sectoral` extrae `WEBBBVAEMP-31122`) y úsalo dentro de los paréntesis del commit message. Si la rama no contiene un identificador Jira, deja los paréntesis vacíos.

Genera exactamente un commit message:
- Formato: `<type>(<jira-id>): <description>` — type: `feat`, `fix`, `chore`, `refactor`, `docs`, `style`, `test`
- Idioma: inglés
- Una sola frase, sin bullets, sin saltos de línea
- Máximo 200 caracteres

Muestra SOLO el commit message en un bloque de código para que el usuario pueda copiarlo. No ejecutes `git commit` ni ningún comando git de escritura.
