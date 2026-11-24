// One deployment holds one shared dataset, so replacing it affects every user.
// Only emails listed in ADMIN_EMAILS (comma-separated) may import. Unset means nobody
// can: failing closed beats letting any signed-up user wipe the data.
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

export function isAdmin(email: string | null | undefined): boolean {
  return !!email && adminEmails().includes(email.toLowerCase())
}
