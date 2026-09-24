// who gets the dashboard: the roles that work on other people's tickets (AD-18, AD-19)
export const DASHBOARD_ROLES = ['admin', 'engineer']

export function canSeeDashboard(user)
{
    return Boolean(user) && DASHBOARD_ROLES.includes(user.role)
}

// where a signed-in person starts: the triage view for staff, their own tickets for everyone else
export function homePath(user)
{
    return canSeeDashboard(user) ? '/dashboard' : '/tickets'
}
