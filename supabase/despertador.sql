-- Despertador: Supabase dispara los workflows de trading de GitHub Actions a la hora exacta.
--
-- GitHub atrasa los cron de Actions hasta 5 horas en los repositorios gratuitos (la primera corrida "de mañana" llega
-- pasadas las 19:00 UTC, con la bolsa de Santiago ya cerrada) y a veces se salta corridas. pg_cron (dentro de
-- Postgres, al minuto) le pide a la API de GitHub que corra el workflow (workflow_dispatch), que parte de inmediato.
-- Los cron de GitHub quedan de respaldo: las corridas son idempotentes. Todo esto es gratis en Supabase y en Actions
-- (repositorio público).
--
-- Antes de ejecutarlo, crea un token de GitHub de grano fino (Settings → Developer settings → Personal access tokens
-- → Fine-grained tokens → Generate new token): Repository access "Only select repositories" con OmniCapital, y en
-- Repository permissions solo "Actions: Read and write". Con eso solo puede lanzar y ver workflows de este repositorio:
-- no lee el código ni los secrets. Pégalo abajo en lugar de PEGA_AQUI_EL_TOKEN (aquí, en el SQL Editor; nunca en el
-- archivo del repositorio) y ejecuta todo. Queda cifrado en Vault. Cuando venza, vuelve a ejecutar solo el paso 2 con
-- el token nuevo.
--
-- Idempotente: se puede ejecutar de nuevo.

-- 1. Extensiones: pg_cron programa, pg_net hace la llamada HTTP
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. El token, cifrado en Vault (si ya existe, se reemplaza)
DO $$
DECLARE
  token text := 'PEGA_AQUI_EL_TOKEN';
  existente uuid := (SELECT id FROM vault.secrets WHERE name = 'github_despertador');
BEGIN
  IF token = 'PEGA_AQUI_EL_TOKEN' THEN
    RAISE EXCEPTION 'Falta pegar el token de GitHub en lugar de PEGA_AQUI_EL_TOKEN';
  END IF;
  IF existente IS NULL THEN
    PERFORM vault.create_secret(token, 'github_despertador', 'Token de GitHub (Actions: read/write en OmniCapital) del despertador');
  ELSE
    PERFORM vault.update_secret(existente, token);
  END IF;
END $$;

-- 3. La función que lanza un workflow. En un esquema propio, que la API de Supabase no publica, y sin permisos para
-- anon ni authenticated: nadie la puede llamar desde la web
CREATE SCHEMA IF NOT EXISTS interno;
REVOKE ALL ON SCHEMA interno FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION interno.despertar(flujo text, entradas jsonb DEFAULT '{}'::jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  token text := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'github_despertador');
BEGIN
  IF token IS NULL THEN
    RAISE EXCEPTION 'Falta el token github_despertador en Vault (paso 2 de supabase/despertador.sql)';
  END IF;
  RETURN net.http_post(
    url := 'https://api.github.com/repos/SRodriguez-Data/OmniCapital/actions/workflows/' || flujo || '/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', entradas),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'omnicapital-despertador',
      'Content-Type', 'application/json'),
    timeout_milliseconds := 10000
  );
END;
$$;

REVOKE ALL ON FUNCTION interno.despertar(text, jsonb) FROM PUBLIC, anon, authenticated;

-- 4. Los horarios (UTC). Las bolsas abren de lunes a viernes: Santiago 12:30-19:00 UTC (13:30-20:00 en invierno) y
-- Nueva York 14:30-21:00 UTC (13:30-20:00 en verano de allá). Con la bolsa cerrada la corrida solo guarda el estado.
-- - Simulaciones: cada hora.
-- - Cuentas reales: cada media hora, para anotar pronto lo que respondes en Telegram (cada una se salta sola mientras
--   su variable TRADING_REAL o TRADING_REAL_CL no valga "activo"). El fin de semana, dos veces al día: Telegram guarda
--   tus respuestas solo unas 24 horas.
SELECT cron.schedule('omnicapital-simulacion', '5 12-21 * * 1-5', $$SELECT interno.despertar('paper_trading.yml')$$);
SELECT cron.schedule('omnicapital-real', '10,40 12-21 * * 1-5', $$SELECT interno.despertar('real_trading.yml', '{"enviar": "true"}')$$);
SELECT cron.schedule('omnicapital-real-finde', '10 13,22 * * 0,6', $$SELECT interno.despertar('real_trading.yml', '{"enviar": "true"}')$$);

-- Verificación: los tres horarios
SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'omnicapital-%' ORDER BY jobname;

-- Después de la primera hora programada, cada llamada a GitHub debe responder 204:
--   SELECT created, status_code, content FROM net._http_response ORDER BY created DESC LIMIT 5;
-- Para apagarlo: SELECT cron.unschedule('omnicapital-simulacion'); (y los otros dos)
