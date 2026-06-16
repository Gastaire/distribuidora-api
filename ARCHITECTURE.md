# Distrimaxi API — Arquitectura y Referencia

> Referencia técnica rápida. Última actualización: junio 2026.

---

## Stack Técnico

| Componente | Tecnología |
|-----------|-----------|
| Runtime | Node.js |
| Framework | Express 5 |
| Base de datos | PostgreSQL (driver `pg`) |
| Autenticación | JWT (`jsonwebtoken` + `bcryptjs`) |
| Uploads | Multer |
| Tareas programadas | node-cron |
| Notificaciones | Evolution API (WhatsApp) |
| Deploy | Docker + Dokploy + Traefik |

---

## Estructura de Directorios

```
distribuidora-api/
├── index.js              ← Entry point, registra todas las rutas bajo /api
├── src/
│   ├── controllers/      ← Lógica de negocio (un archivo por dominio)
│   ├── routes/           ← Definición de endpoints y middlewares de auth
│   ├── middleware/
│   │   └── auth.middleware.js  ← protect() + authorize(rol)
│   └── db/
│       └── index.js      ← Pool de conexiones PostgreSQL
└── migrations/           ← Scripts SQL de cambios de esquema (a crear)
```

---

## Autenticación y Roles

Todos los endpoints protegidos usan:
```js
router.get('/ruta', protect, authorize('admin'), handler);
```

| Rol | Permisos clave |
|-----|---------------|
| `admin` | Todo |
| `vendedor` | Ver/crear sus propios pedidos, ver productos y clientes |
| `deposito` | Ver pedidos, cambiar estado a: visto, en_preparacion, listo_para_entrega, entregado |

---

## Endpoints por Módulo

### Auth — `/api/auth`
| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | `/login` | ❌ | Login, devuelve JWT |

### Pedidos — `/api/pedidos`
| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/pedidos` | protect | Lista pedidos (filtrado por rol) |
| GET | `/pedidos/:id` | protect | Detalle de un pedido con items |
| GET | `/pedidos/mis-pedidos` | protect | Pedidos del usuario autenticado |
| GET | `/pedidos/mis-pedidos-historicos` | protect | Historial >72h del usuario |
| GET | `/pedidos/estados` | protect | Estado de lista de IDs (sync app) |
| POST | `/pedidos` | protect | Crear pedido |
| PUT | `/pedidos/:id` | protect | Editar pedido (12h limit para vendedores) |
| PUT | `/pedidos/:id/estado` | protect | Cambiar estado |
| PUT | `/pedidos/:id/notas` | protect | Editar notas de entrega |
| PUT | `/pedidos/:id/archivar` | protect | Archivar pedido |
| PUT | `/pedidos/:id/desarchivar` | protect | Desarchivar pedido |
| POST | `/pedidos/combinar` | protect | Combinar N pedidos del mismo cliente |
| DELETE | `/pedidos/archivados/limpiar` | protect, admin | Eliminar todos los archivados |

**Estados de pedido:**
```
pendiente → visto → en_preparacion → listo_para_entrega → entregado
                                                         ↘ archivado
                                                         ↘ cancelado
                                                         ↘ combinado
```

> ⚠️ Al pasar a `entregado`, descuenta `stock_cantidad` de productos con `controla_stock = true`.

### Productos — `/api/productos`
| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/productos` | protect | Lista todos |
| GET | `/productos/:id` | protect | Detalle |
| POST | `/productos` | protect, admin | Crear |
| PUT | `/productos/:id` | protect, admin | Editar |
| DELETE | `/productos/:id` | protect, admin | Eliminar |

**Campos clave de productos:** `id`, `nombre`, `codigo_sku`, `categoria`, `precio_unitario`, `stock` (Sí/No), `stock_cantidad`, `controla_stock`

### Clientes — `/api/clientes`
| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/clientes` | protect | Lista todos |
| GET | `/clientes/:id` | protect | Detalle |
| POST | `/clientes` | protect | Crear |
| PUT | `/clientes/:id` | protect | Editar |
| DELETE | `/clientes/:id` | protect, admin | Eliminar |

**Campos:** `id`, `nombre_comercio`, `nombre_contacto`, `direccion`, `telefono`

### Listas de Precios — `/api/listas-precios`
Sistema de precios diferenciados por cliente/canal.
Tablas: `listas_de_precios` + `lista_precios_items` (relación lista ↔ producto ↔ precio).

### Dashboard — `/api/dashboard/stats`
Acepta `?source=pedidos|presencial&salesPeriod=7d|30d|monthly&topProductsLimit=N`
Devuelve: totalRevenue, totalOrders, salesByDay, topProducts, topCustomers, salesBySeller.

### KPIs — `/api/kpi/category`
Acepta `?category=X&channel=pedidos|presencial|todos&startDate=&endDate=`
Combina pedidos de la app + ventas presenciales por producto/categoría.

### Reportes — `/api/reportes` (admin only)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/reportes/faltantes-diario` | Productos faltantes últimas 24h |

> 🚧 **Área de expansión planeada** — ver sección de mejoras.

### Otros módulos
- **`/api/categorias`** — CRUD de categorías de productos
- **`/api/usuarios`** — CRUD de usuarios del sistema
- **`/api/borradores`** — Pedidos guardados pero no confirmados
- **`/api/import`** — Importación masiva de productos via CSV
- **`/api/logs`** — Lectura de tabla `actividad`
- **`/api/diagnostics`** — Herramientas de integridad de datos

---

## Tablas de la Base de Datos

### Tablas principales identificadas en el código

| Tabla | Descripción |
|-------|-------------|
| `pedidos` | Pedidos con estado, cliente, vendedor, lista de precios |
| `pedido_items` | Ítems de cada pedido (precio congelado al momento de creación) |
| `productos` | Catálogo con SKU, precio, stock, categoría |
| `clientes` | Clientes de la distribuidora |
| `usuarios` | Usuarios del sistema con roles |
| `categorias` | Categorías de productos |
| `listas_de_precios` | Listas de precios (ej: "General", por canal) |
| `lista_precios_items` | Precios específicos por producto en cada lista |
| `actividad` | Log de todas las acciones (auditoría) |
| `registro_faltantes` | Registro cuando un ítem se quita de un pedido |
| `borradores` | Pedidos no confirmados |
| `ventas_presenciales_comprobantes` | Ventas no app |
| `ventas_presenciales_items` | Ítems de ventas presenciales |

---

## Patrones de Código Establecidos

### Controller con transacción
```js
const client = await pool.connect();
try {
    await client.query('BEGIN');
    // ... lógica ...
    await client.query('INSERT INTO actividad ...'); // log siempre
    await client.query('COMMIT');
    res.status(200).json({ ... });
} catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: error.message });
} finally {
    client.release();
}
```

### Log de actividad (siempre incluir en operaciones mutantes)
```js
await client.query(
    'INSERT INTO actividad (id_usuario, nombre_usuario, accion, detalle) VALUES ($1, $2, $3, $4)',
    [usuario_id, nombre_usuario, 'ACCION_EN_MAYUSCULAS', `Descripción legible.`]
);
```

---

## Mejoras Planeadas

### 🔴 Reportes (prioridad principal)

El controller `reportes.controller.js` actualmente solo tiene `getReporteFaltantes`.
Endpoints a agregar bajo `/api/reportes`:

| Endpoint | Descripción |
|----------|-------------|
| `GET /reportes/diario-pedidos` | Resumen del día: total pedidos, monto, por estado |
| `GET /reportes/pedidos-por-vendedor` | Cantidad y monto por vendedor, filtrable por fecha |
| `GET /reportes/pedidos-entregados` | Pedidos entregados con detalle, rango de fechas |
| `GET /reportes/rendimiento-vendedores` | Ranking de vendedores: pedidos, clientes únicos, monto |
| `GET /reportes/clientes-activos` | Clientes con pedidos en el período, frecuencia |
| `GET /reportes/productos-mas-pedidos` | Top productos por cantidad/monto, filtrable |

Todos devuelven datos listos para consumir por el panel admin.

---

## Próximas migraciones de BD (a crear antes de implementar)

Ninguna identificada aún para el módulo de reportes (usa tablas existentes).
Documentar aquí cuando se necesiten.
