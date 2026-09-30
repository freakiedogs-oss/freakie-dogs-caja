-- 27-sep-2026 (Frank): Hifumi no entra todos los días; «hoy no hubo» es una respuesta válida.
alter table public.conteo_check_hifumi drop constraint if exists conteo_check_hifumi_respuesta_check;
alter table public.conteo_check_hifumi add constraint conteo_check_hifumi_respuesta_check
  check (respuesta in ('todos_ingresados','no_hubo','faltaba_ingresar'));
