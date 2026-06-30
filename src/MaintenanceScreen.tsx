const MESSAGE =
  'The submission portal is temporarily unavailable due to database maintenance. Please try again shortly.';

/** Standalone screen — must not import supabase, auth, or any data-fetching modules. */
export function MaintenanceScreen() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-12"
      style={{ background: 'var(--bg, #f8fafc)', color: 'var(--text, #0f172a)' }}
    >
      <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-8 shadow-sm text-center">
        <div
          className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700"
          aria-hidden="true"
        >
          <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-gray-900 mb-3">Maintenance in progress</h1>
        <p className="text-sm leading-relaxed text-gray-600">{MESSAGE}</p>
        <p className="mt-6 text-xs text-gray-400">submissions.slit.edu.au</p>
      </div>
    </div>
  );
}
