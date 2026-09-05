-- =====================================================
-- Migración 05: Zonas GPS para clientes + Pedidos Programados
-- Correr con: node migrate.js desde /distribuidora-api/
-- =====================================================

-- Tags de zona para clientes
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS zona VARCHAR(50) DEFAULT NULL;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS zona_manual BOOLEAN DEFAULT FALSE;

-- Pedidos programados
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS fecha_entrega_programada DATE DEFAULT NULL;
-- fecha_activacion: calculado como fecha_entrega_programada - 1 día a las 16:30 ARG
-- Se guarda precalculado para simplificar las queries de visibilidad
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS fecha_activacion TIMESTAMPTZ DEFAULT NULL;

-- Índice para acelerar la query de visibilidad del panel admin
CREATE INDEX IF NOT EXISTS idx_pedidos_fecha_activacion ON pedidos (fecha_activacion) WHERE fecha_activacion IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clientes_zona ON clientes (zona);
