-- Script para agregar estado de facturado y tabla de zonas
-- Añadir columna de fecha de facturación a la tabla pedidos
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS fecha_facturado TIMESTAMP DEFAULT NULL;

-- Crear tabla para el cronograma de entregas (calendario de zonas)
CREATE TABLE IF NOT EXISTS cronograma_entregas (
    fecha DATE PRIMARY KEY,
    zonas TEXT NOT NULL
);

-- Nuevas columnas en clientes para ubicación y horarios
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS localidad VARCHAR(100) DEFAULT NULL;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS latitud DOUBLE PRECISION DEFAULT NULL;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS longitud DOUBLE PRECISION DEFAULT NULL;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS horario_atencion VARCHAR(100) DEFAULT NULL;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS horario_recepcion VARCHAR(100) DEFAULT NULL;
