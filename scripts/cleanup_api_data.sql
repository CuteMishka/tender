TRUNCATE TABLE
  parser_documents,
  parser_notifications,
  parser_lots,
  parser_runs,
  saved_lots,
  historical_lots,
  tracked_customers
RESTART IDENTITY CASCADE;
