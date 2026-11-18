-- Límites por usuario en las tablas que escribe cada cuenta con su sesión (mi_portafolio, perfil_inversionista y
-- push_suscripciones). El registro en la app está abierto y la clave pública permite escribir directo en la base, sin
-- pasar por las validaciones de la web: las políticas (RLS) ya impiden tocar filas ajenas, pero no ponían tope a
-- cuántas filas propias ni a qué se guarda en ellas. Con esto una cuenta cualquiera no puede llenar la base gratuita
-- (500 MB) ni dejar tickers inventados para que el minero diario los intente descargar.
--
-- - mi_portafolio: el ticker con la misma forma que acepta la web (TICKER_RE en web/src/lib/validation.ts) y hasta
--   500 filas por cuenta (una fila por compra; la web analiza hasta 60 activos).
-- - perfil_inversionista: el cuestionario pesa menos de 1 KB; se aceptan hasta 20 KB.
-- - push_suscripciones: textos con el largo que valida la web y hasta 10 celulares o navegadores por cuenta.
--
-- Las reglas nuevas son NOT VALID: se aplican a todo lo que se inserte o cambie desde ahora, sin revisar (ni rechazar)
-- las filas que ya existen. La verificación del final muestra si alguna fila antigua no las cumple.
-- Rigen también para el agente y el bot (clave secreta): solo leen estas tablas o registran operaciones de su dueño.
-- Las tablas que todavía no existan se saltan: se puede ejecutar antes o después de push_suscripciones.sql y
-- perfil_inversionista.sql, y volver a ejecutarlo después. Idempotente.

-- 1. Tope de filas por cuenta. SECURITY DEFINER para contar todas las filas de la cuenta sin depender de las políticas;
-- search_path vacío y sin permiso de ejecución directa (solo las llama el disparador).
CREATE OR REPLACE FUNCTION public.tope_mi_portafolio() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.user_id IS NOT NULL
     AND (SELECT count(*) FROM public.mi_portafolio WHERE user_id = NEW.user_id) >= 500 THEN
    RAISE EXCEPTION 'Tu portafolio llegó al máximo de 500 registros: borra los que ya no uses antes de agregar más.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tope_push_suscripciones() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Volver a guardar la suscripción de un navegador ya registrado (upsert por endpoint) no suma una fila
  IF EXISTS (SELECT 1 FROM public.push_suscripciones WHERE endpoint = NEW.endpoint) THEN
    RETURN NEW;
  END IF;
  IF (SELECT count(*) FROM public.push_suscripciones WHERE user_id = NEW.user_id) >= 10 THEN
    RAISE EXCEPTION 'Ya tienes 10 celulares o navegadores con avisos: desactiva alguno antes de sumar otro.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.tope_mi_portafolio() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tope_push_suscripciones() FROM PUBLIC, anon, authenticated;

-- 2. Reglas y disparadores de cada tabla (las que no existan se saltan)
DO $$
BEGIN
  IF to_regclass('public.mi_portafolio') IS NOT NULL THEN
    ALTER TABLE public.mi_portafolio DROP CONSTRAINT IF EXISTS mi_portafolio_ticker_valido;
    ALTER TABLE public.mi_portafolio ADD CONSTRAINT mi_portafolio_ticker_valido
      CHECK (ticker ~ '^[A-Z0-9.^=-]{1,20}$') NOT VALID;
    DROP TRIGGER IF EXISTS tope_mi_portafolio ON public.mi_portafolio;
    CREATE TRIGGER tope_mi_portafolio BEFORE INSERT ON public.mi_portafolio
      FOR EACH ROW EXECUTE FUNCTION public.tope_mi_portafolio();
  ELSE
    RAISE NOTICE 'No existe mi_portafolio: se salta.';
  END IF;

  IF to_regclass('public.perfil_inversionista') IS NOT NULL THEN
    ALTER TABLE public.perfil_inversionista DROP CONSTRAINT IF EXISTS perfil_inversionista_tamano;
    ALTER TABLE public.perfil_inversionista ADD CONSTRAINT perfil_inversionista_tamano
      CHECK (octet_length(datos::text) <= 20000) NOT VALID;
  ELSE
    RAISE NOTICE 'No existe perfil_inversionista: se salta (ejecuta antes supabase/perfil_inversionista.sql).';
  END IF;

  IF to_regclass('public.push_suscripciones') IS NOT NULL THEN
    ALTER TABLE public.push_suscripciones DROP CONSTRAINT IF EXISTS push_suscripciones_largos;
    ALTER TABLE public.push_suscripciones ADD CONSTRAINT push_suscripciones_largos
      CHECK (endpoint ~ '^https://' AND char_length(endpoint) <= 1000 AND char_length(p256dh) <= 200
             AND char_length(auth) <= 100 AND (dispositivo IS NULL OR char_length(dispositivo) <= 80)) NOT VALID;
    DROP TRIGGER IF EXISTS tope_push_suscripciones ON public.push_suscripciones;
    CREATE TRIGGER tope_push_suscripciones BEFORE INSERT ON public.push_suscripciones
      FOR EACH ROW EXECUTE FUNCTION public.tope_push_suscripciones();
  ELSE
    RAISE NOTICE 'No existe push_suscripciones: se salta (ejecuta antes supabase/push_suscripciones.sql).';
  END IF;
END $$;

-- Verificación 1: deben aparecer las 3 reglas (mi_portafolio_ticker_valido, perfil_inversionista_tamano,
-- push_suscripciones_largos) y los 2 disparadores (tope_mi_portafolio, tope_push_suscripciones)
SELECT 'regla' AS tipo, conrelid::regclass::text AS tabla, conname AS nombre
FROM pg_constraint
WHERE conname IN ('mi_portafolio_ticker_valido', 'perfil_inversionista_tamano', 'push_suscripciones_largos')
UNION ALL
SELECT 'disparador', tgrelid::regclass::text, tgname
FROM pg_trigger
WHERE tgname IN ('tope_mi_portafolio', 'tope_push_suscripciones') AND NOT tgisinternal
ORDER BY 1, 2;

-- Verificación 2: filas antiguas de mi_portafolio cuyo ticker no cumple la regla (debe salir vacío; si sale alguna,
-- corrígela o bórrala: mientras exista no se puede editar sin arreglar su ticker)
SELECT id, ticker FROM public.mi_portafolio WHERE ticker !~ '^[A-Z0-9.^=-]{1,20}$';
