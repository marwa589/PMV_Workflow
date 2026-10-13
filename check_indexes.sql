SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'DocumentNumberCounter'
ORDER BY indexname;
