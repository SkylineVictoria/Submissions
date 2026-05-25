-- Activity log for learning document uploads and deletes.
CREATE TABLE IF NOT EXISTS skyline_learning_doc_activity (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  form_id BIGINT NOT NULL REFERENCES skyline_forms(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('upload', 'delete', 'add_url', 'remove_url')),
  file_path TEXT,
  file_name TEXT,
  public_url TEXT,
  audience TEXT CHECK (audience IN ('student', 'trainer')),
  performed_by BIGINT,
  performed_by_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_learning_doc_activity_form_id ON skyline_learning_doc_activity(form_id);
CREATE INDEX idx_learning_doc_activity_created_at ON skyline_learning_doc_activity(created_at DESC);
