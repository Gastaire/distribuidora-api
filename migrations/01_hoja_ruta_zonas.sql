-- Script para agregar estado de facturado y tabla de zonas
-- Añadir columna de fecha de facturación a la tabla pedidos
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS fecha_facturado TIMESTAMP DEFAULT NULL;

-- Crear tabla para el cronograma de entregas (calendario de zonas)
CREATE TABLE IF NOT EXISTS cronograma_entregas (
    fecha DATE PRIMARY KEY,
    zonas TEXT NOT NULL
);
