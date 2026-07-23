-- Assessment search: parse Student ID + Unit Code from p_search (AND).
-- Parsing is done in SQL so PostgREST schema-cache issues with extra params cannot break Admin Directory.
-- Optional p_search_student_ext_id / p_search_unit_code still supported when provided.

DROP FUNCTION IF EXISTS public.skyline_list_submitted_instances_paged(
  integer, integer, text, bigint, bigint, bigint, date, text, date, date, text, text, bigint
);
DROP FUNCTION IF EXISTS public.skyline_list_submitted_instances_paged(
  integer, integer, text, bigint, bigint, bigint, date, text, date, date, text, text, bigint, text, text
);

CREATE FUNCTION public.skyline_list_submitted_instances_paged(
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 20,
  p_search text DEFAULT NULL,
  p_course_id bigint DEFAULT NULL,
  p_form_id bigint DEFAULT NULL,
  p_student_id bigint DEFAULT NULL,
  p_active_on date DEFAULT NULL,
  p_workflow_status text DEFAULT NULL,
  p_start_from date DEFAULT NULL,
  p_end_date_to date DEFAULT NULL,
  p_sort_key text DEFAULT 'created',
  p_sort_dir text DEFAULT 'desc',
  p_batch_id bigint DEFAULT NULL,
  p_search_student_ext_id text DEFAULT NULL,
  p_search_unit_code text DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  form_id bigint,
  form_name text,
  form_version text,
  student_id bigint,
  student_name text,
  student_email text,
  status text,
  role_context text,
  created_at timestamptz,
  submitted_at timestamptz,
  submission_count integer,
  start_date date,
  end_date date,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_from integer := GREATEST(0, (COALESCE(p_page, 1) - 1) * COALESCE(p_page_size, 20));
  v_limit integer := GREATEST(1, COALESCE(p_page_size, 20));
  v_dir text := CASE WHEN lower(COALESCE(p_sort_dir, 'desc')) = 'asc' THEN 'asc' ELSE 'desc' END;
  v_key text := lower(COALESCE(p_sort_key, 'created'));
  v_sql text;
  v_raw text := NULLIF(trim(COALESCE(p_search, '')), '');
  v_ext_id text := NULLIF(trim(COALESCE(p_search_student_ext_id, '')), '');
  v_unit text := NULLIF(trim(COALESCE(p_search_unit_code, '')), '');
  v_general text := NULL;
  v_tokens text[];
  v_tok text;
  v_rest text[] := ARRAY[]::text[];
BEGIN
  -- Prefer explicit structured args; otherwise parse whitespace-delimited p_search.
  -- When structured args are provided alongside a full raw string, strip known tokens
  -- so the leftover becomes general (avoid requiring the whole "ID UNIT" phrase in one field).
  IF v_ext_id IS NOT NULL OR v_unit IS NOT NULL THEN
    IF v_raw IS NOT NULL THEN
      v_tokens := regexp_split_to_array(v_raw, '\s+');
      FOREACH v_tok IN ARRAY v_tokens
      LOOP
        IF v_ext_id IS NOT NULL AND lower(v_tok) = lower(v_ext_id) THEN
          CONTINUE;
        END IF;
        IF v_unit IS NOT NULL AND lower(v_tok) = lower(v_unit) THEN
          CONTINUE;
        END IF;
        v_rest := array_append(v_rest, v_tok);
      END LOOP;
      IF coalesce(array_length(v_rest, 1), 0) > 0 THEN
        v_general := array_to_string(v_rest, ' ');
      END IF;
    END IF;
  ELSIF v_raw IS NOT NULL THEN
    v_tokens := regexp_split_to_array(v_raw, '\s+');
    IF coalesce(array_length(v_tokens, 1), 0) = 1 THEN
      v_tok := v_tokens[1];
      IF v_tok ~ '^\d{4,}$' THEN
        v_ext_id := v_tok;
      ELSIF length(v_tok) >= 5
        AND v_tok ~ '[A-Za-z]'
        AND v_tok ~ '[0-9]'
        AND v_tok !~ '\s'
        AND v_tok ~ '^[A-Za-z0-9._-]+$'
        AND v_tok !~ '^\d+$'
      THEN
        v_unit := v_tok;
      ELSE
        v_general := v_tok;
      END IF;
    ELSE
      FOREACH v_tok IN ARRAY v_tokens
      LOOP
        IF v_ext_id IS NULL AND v_tok ~ '^\d{4,}$' THEN
          v_ext_id := v_tok;
        ELSIF v_unit IS NULL
          AND length(v_tok) >= 5
          AND v_tok ~ '[A-Za-z]'
          AND v_tok ~ '[0-9]'
          AND v_tok !~ '\s'
          AND v_tok ~ '^[A-Za-z0-9._-]+$'
          AND v_tok !~ '^\d+$'
        THEN
          v_unit := v_tok;
        ELSE
          v_rest := array_append(v_rest, v_tok);
        END IF;
      END LOOP;
      -- Name phrases like "AARON BINU" — no structured tokens → keep full raw as general.
      IF v_ext_id IS NULL AND v_unit IS NULL THEN
        v_general := v_raw;
      ELSIF coalesce(array_length(v_rest, 1), 0) > 0 THEN
        v_general := array_to_string(v_rest, ' ');
      END IF;
    END IF;
  END IF;

  v_sql := $q$
    WITH base AS (
      SELECT
        i.id,
        i.form_id,
        f.name AS form_name,
        f.version AS form_version,
        i.student_id,
        COALESCE(
          NULLIF(trim(concat_ws(' ', NULLIF(s.first_name,''), NULLIF(s.last_name,''))), ''),
          NULLIF(s.name,''),
          s.email,
          'Unknown student'
        ) AS student_name,
        COALESCE(s.email, '') AS student_email,
        i.status,
        i.role_context,
        i.created_at,
        i.submitted_at,
        COALESCE(i.submission_count, 0)::int AS submission_count,
        i.start_date,
        i.end_date
      FROM public.skyline_form_instances i
      JOIN public.skyline_forms f ON f.id = i.form_id
      JOIN public.skyline_students s ON s.id = i.student_id
      WHERE i.student_id IS NOT NULL
        AND (s.status IS NULL OR s.status = 'active')
        AND ($1::bigint IS NULL OR i.form_id = $1::bigint)
        AND ($2::bigint IS NULL OR i.student_id = $2::bigint)
        AND (
          $3::bigint IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.skyline_course_forms cf
            WHERE cf.course_id = $3::bigint
              AND cf.form_id = i.form_id
          )
        )
        -- Exact external Student ID when detected / provided
        AND (
          COALESCE($12::text, '') = ''
          OR lower(trim(COALESCE(s.student_id, ''))) = lower(trim($12::text))
        )
        -- Unit code (partial, case-insensitive) when detected / provided
        AND (
          COALESCE($13::text, '') = ''
          OR COALESCE(f.unit_code, '') ILIKE ('%' || $13::text || '%')
          OR COALESCE(f.name, '') ILIKE ('%' || $13::text || '%')
        )
        -- Remaining general free-text (OR across fields)
        AND (
          COALESCE($4::text, '') = ''
          OR (
            i.status ILIKE ('%' || $4::text || '%')
            OR i.role_context ILIKE ('%' || $4::text || '%')
            OR f.name ILIKE ('%' || $4::text || '%')
            OR COALESCE(f.version,'') ILIKE ('%' || $4::text || '%')
            OR COALESCE(f.unit_code,'') ILIKE ('%' || $4::text || '%')
            OR COALESCE(f.unit_name,'') ILIKE ('%' || $4::text || '%')
            OR COALESCE(s.student_id,'') ILIKE ('%' || $4::text || '%')
            OR COALESCE(s.name,'') ILIKE ('%' || $4::text || '%')
            OR COALESCE(s.first_name,'') ILIKE ('%' || $4::text || '%')
            OR COALESCE(s.last_name,'') ILIKE ('%' || $4::text || '%')
            OR COALESCE(s.email,'') ILIKE ('%' || $4::text || '%')
          )
        )
        AND (
          $5::date IS NULL
          OR (
            i.start_date IS NOT NULL
            AND i.start_date <= $5::date
            AND (i.end_date IS NULL OR i.end_date >= $5::date)
          )
        )
        AND (
          $6::text IS NULL
          OR trim(BOTH FROM $6::text) = ''
          OR lower(trim(BOTH FROM $6::text)) = 'all'
          OR (
            lower(trim(BOTH FROM $6::text)) = 'awaiting_student'
            AND i.status = 'draft'
            AND NOT COALESCE(i.did_not_attempt, false)
          )
          OR (
            lower(trim(BOTH FROM $6::text)) = 'awaiting_trainer'
            AND i.role_context = 'trainer'
            AND i.status <> 'locked'
          )
          OR (
            lower(trim(BOTH FROM $6::text)) = 'awaiting_office'
            AND i.role_context = 'office'
            AND i.status <> 'locked'
            AND NOT COALESCE(i.did_not_attempt, false)
          )
          OR (
            lower(trim(BOTH FROM $6::text)) = 'did_not_attempt'
            AND COALESCE(i.did_not_attempt, false) = true
          )
          OR (
            lower(trim(BOTH FROM $6::text)) = 'completed'
            AND i.status = 'locked'
            AND NOT COALESCE(i.did_not_attempt, false)
          )
        )
        AND (
          $7::date IS NULL
          OR COALESCE(i.end_date, i.start_date) >= $7::date
        )
        AND (
          $8::date IS NULL
          OR COALESCE(i.start_date, i.end_date) <= $8::date
        )
        AND (
          i.start_date IS NULL
          OR i.end_date IS NULL
          OR i.end_date >= i.start_date
        )
        AND (
          $9::bigint IS NULL
          OR s.batch_id = $9::bigint
        )
    )
    SELECT
      b.*,
      COUNT(*) OVER() AS total_count
    FROM base b
  $q$;

  IF v_key = 'student' THEN
    v_sql := v_sql || format(' ORDER BY b.student_name %s, b.student_email %s, b.id %s ', v_dir, v_dir, v_dir);
  ELSIF v_key = 'form' THEN
    v_sql := v_sql || format(' ORDER BY b.form_name %s, b.form_version %s, b.id %s ', v_dir, v_dir, v_dir);
  ELSIF v_key = 'start' THEN
    v_sql := v_sql || format(' ORDER BY (b.start_date::date) %s NULLS LAST, b.id %s ', v_dir, v_dir);
  ELSIF v_key = 'end' THEN
    v_sql := v_sql || format(' ORDER BY (b.end_date::date) %s NULLS LAST, b.id %s ', v_dir, v_dir);
  ELSIF v_key = 'workflow' THEN
    v_sql := v_sql || format(' ORDER BY b.role_context %s, b.status %s, b.id %s ', v_dir, v_dir);
  ELSE
    v_sql := v_sql || format(' ORDER BY b.created_at %s, b.id %s ', v_dir, v_dir);
  END IF;

  v_sql := v_sql || ' LIMIT $10 OFFSET $11 ';

  RETURN QUERY EXECUTE v_sql
    USING
      p_form_id,
      p_student_id,
      p_course_id,
      NULLIF(trim(COALESCE(v_general, '')), ''),
      p_active_on,
      p_workflow_status,
      p_start_from,
      p_end_date_to,
      p_batch_id,
      v_limit,
      v_from,
      NULLIF(trim(COALESCE(v_ext_id, '')), ''),
      NULLIF(trim(COALESCE(v_unit, '')), '');
END;
$$;

GRANT EXECUTE ON FUNCTION public.skyline_list_submitted_instances_paged(
  integer, integer, text, bigint, bigint, bigint, date, text, date, date, text, text, bigint, text, text
) TO authenticated;

COMMENT ON FUNCTION public.skyline_list_submitted_instances_paged(
  integer, integer, text, bigint, bigint, bigint, date, text, date, date, text, text, bigint, text, text
) IS
  'Paged assessment directory. Parses Student ID + Unit Code from p_search (AND). Optional p_search_student_ext_id / p_search_unit_code also supported.';

-- Refresh PostgREST schema cache so the API picks up the function signature.
NOTIFY pgrst, 'reload schema';
