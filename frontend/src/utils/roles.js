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

// every role a user holds (employee always among them); responses from before roles existed carry only the active one
export function heldRoles(user)
{
    if (!user)
    {
        return []
    }
    return Array.isArray(user.roles) && user.roles.length ? user.roles : [user.role]
}

export const ROLE_ORDER = ['employee', 'engineer', 'admin']
export const ROLE_LABEL = { employee: 'Employee', engineer: 'Engineer', admin: 'Facility admin' }

// a role set in a stable order, without duplicates, so what is sent never depends on how it was built
export function withRole(roles, role)
{
    return ROLE_ORDER.filter((candidate) => candidate === role || roles.includes(candidate))
}

export function withoutRole(roles, role)
{
    return ROLE_ORDER.filter((candidate) => candidate !== role && roles.includes(candidate))
}
