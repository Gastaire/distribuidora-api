-- Fix: Permitir textos largos en los horarios JSON
ALTER TABLE clientes ALTER COLUMN horario_atencion TYPE TEXT;
ALTER TABLE clientes ALTER COLUMN horario_entrega TYPE TEXT;

-- Crear tabla borradores para sync en la nube si no existe
CREATE TABLE IF NOT EXISTS borradores (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    cliente_local_id VARCHAR(100) NOT NULL,
    borrador_data JSONB NOT NULL,
    last_modified TIMESTAMP NOT NULL,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (usuario_id, cliente_local_id)
);
