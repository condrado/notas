# Notas

Aplicación web estática para escribir y organizar notas localmente.

Versión actual: **1.0.10**

## Versionado automático

Cada `push` a `main` o `master` incrementa automáticamente la versión mediante GitHub Actions:

- Cualquier commit incrementa el patch: `1.0.10` → `1.0.11`.
- `feat(minor)` o `feat(minior)` incrementa minor y reinicia patch: `1.0.10` → `1.1.0`.
- `feat(major)` incrementa major y reinicia minor y patch: `1.0.10` → `2.0.0`.

Ejemplos:

```text
git commit -m "fix: corregir el guardado"
git commit -m "feat(minor): añadir etiquetas"
git commit -m "feat(major): rediseñar el editor"
```

La versión fuente se guarda en `package.json` y la Action mantiene también actualizada esta sección del README.

Para que la versión se incluya en el mismo commit antes del `push`, ejecuta una vez:

```bash
npm install
```

El hook local actualizará `package.json`, README e interfaz según el mensaje del commit. La GitHub Action queda como respaldo si el commit se realiza desde otro entorno.