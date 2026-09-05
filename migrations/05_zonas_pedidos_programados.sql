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

-- =====================================================
-- FIX: Agregar 'programado' al CHECK constraint de estado
-- El constraint original no incluía este valor
-- =====================================================
DO $$
BEGIN
    -- Eliminar constraint viejo si existe (nombre puede variar)
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'chk_estado_archivado' AND table_name = 'pedidos'
    ) THEN
        ALTER TABLE pedidos DROP CONSTRAINT chk_estado_archivado;
    END IF;
    -- Eliminar constraint anterior si ya teníamos uno con este nombre
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'chk_estado_pedido' AND table_name = 'pedidos'
    ) THEN
        ALTER TABLE pedidos DROP CONSTRAINT chk_estado_pedido;
    END IF;
END $$;

-- Recrear con 'programado' incluido
ALTER TABLE pedidos ADD CONSTRAINT chk_estado_pedido CHECK (
    estado IN ('pendiente', 'visto', 'en_preparacion', 'facturado', 'listo_para_entrega', 'entregado', 'cancelado', 'archivado', 'combinado', 'programado')
);

-- Índice para acelerar la query de visibilidad del panel admin
CREATE INDEX IF NOT EXISTS idx_pedidos_fecha_activacion ON pedidos (fecha_activacion) WHERE fecha_activacion IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clientes_zona ON clientes (zona);
