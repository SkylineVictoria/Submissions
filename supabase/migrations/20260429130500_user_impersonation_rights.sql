-- Superadmin-managed rights for admin users.
ALTER TABLE skyline_users
  ADD COLUMN IF NOT EXISTS can_login_as_student BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_login_as_trainer BOOLEAN NOT NULL DEFAULT false;

-- Keep superadmin accounts fully enabled for operational support.
UPDATE skyline_users
SET
  can_login_as_student = true,
  can_login_as_trainer = true
WHERE role = 'superadmin';
