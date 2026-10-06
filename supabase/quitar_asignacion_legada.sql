-- Elimina el disparador heredado que, al registrarse un usuario nuevo, le asignaba todas las filas de
-- mi_portafolio sin dueño (user_id NULL). Sirvió una vez para migrar el portafolio original; hoy todas las
-- filas tienen dueño, y con la app abierta a registros cualquier persona nueva podría quedarse con filas
-- huérfanas. Supabase además la marcaba como función SECURITY DEFINER ejecutable sin sesión.
--
-- Definición original, por si hubiera que restaurarla:
--   CREATE FUNCTION public.assign_legacy_portfolio_to_first_user() RETURNS trigger
--   LANGUAGE plpgsql SECURITY DEFINER AS $$
--   BEGIN
--     UPDATE public.mi_portafolio SET user_id = NEW.id WHERE user_id IS NULL;
--     RETURN NEW;
--   END; $$;
--   CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
--     FOR EACH ROW EXECUTE FUNCTION public.assign_legacy_portfolio_to_first_user();

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.assign_legacy_portfolio_to_first_user();
