# Migrations

Scripts SQL para cambios de esquema de la base de datos.

## Protocolo

1. Crear archivo con nombre `YYYYMMDD_descripcion.sql`
2. Escribir SQL **idempotente** (usar `IF NOT EXISTS`, etc.)
3. Correr en **staging primero**, verificar, luego en producción
4. Nunca deployar código que espera una columna nueva sin haber corrido la migración antes

## Cómo ejecutar

```bash
# Desde el cliente psql (o via Dokploy console)
psql -h $DB_HOST -U $DB_USER -d $DB_DATABASE -f migrations/YYYYMMDD_nombre.sql
```

## Historial

| Fecha | Archivo | Descripción | Estado |
|-------|---------|-------------|--------|
| — | — | Esquema inicial (sin migración documentada) | prod |

