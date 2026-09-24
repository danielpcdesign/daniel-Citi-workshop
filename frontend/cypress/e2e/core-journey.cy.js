// the demo path end to end, against the live local stack: report, assign, work, block, follow along
// live checks leave permanent rows (README, "Live checks leave permanent rows"), so titles start with "Live"
const PASSWORD = 'a long enough password'
const EMPLOYEE = 'live.c.emp@acme.inc'
const ADMIN = 'live.c.admin@acme.inc'
const ENGINEER = 'live.c.eng@acme.inc'

// each role lands on its own starting page: employees on their tickets, admins and engineers on the dashboard
function signIn(email, landing = 'My tickets')
{
    cy.visit('/signin')
    cy.get('input[type=email]').type(email)
    cy.get('input[type=password]').type(PASSWORD)
    cy.contains('button', 'Sign in').click()
    cy.contains('h1', landing)
}

function signOut()
{
    cy.contains('button', 'Sign out').click()
    cy.contains('h1', 'Sign in')
}

// a field is found by its visible label, then the control inside the same MUI form control
function field(label)
{
    return cy.contains(label).closest('.MuiFormControl-root')
}

function choose(label, option)
{
    field(label).find('[role=combobox]').click()
    cy.contains('[role=option]', option).click()
}

describe('core journey', () =>
{
    const title = `Live E2E leak ${Date.now()}`

    it('an employee reports, an admin assigns, the engineer blocks, and the reporter sees why', () =>
    {
        signIn(EMPLOYEE)
        cy.contains('a', 'Report a problem').click()
        field('What is the problem?').find('input').type(title)
        field('Details').find('textarea').first().type('Water under the sink by the lifts.')
        choose('Kind of problem', 'Plumbing')
        choose('Building', 'Live HQ')
        cy.contains('button', 'Send report').click()
        cy.contains('Your report was sent')
        cy.contains('h1', title)
        cy.contains('Waiting for a facility admin to pick an engineer.')
        cy.location('pathname').then((path) =>
        {
            cy.wrap(path).as('ticket')
        })
        cy.screenshot('1-reported')
        signOut()

        signIn(ADMIN, 'Dashboard')
        // the board shows the most urgent, oldest tickets per status, so a new one may be below the cut
        cy.contains('h2', 'Right now')
        cy.get('[data-status=unassigned]').should('exist')
        cy.contains('h2', 'Needs attention')
        cy.get('@ticket').then((path) => cy.visit(path))
        cy.contains('button', 'Assign an engineer').click()
        cy.get('[role=dialog]').within(() =>
        {
            // disabled until the engineer list has loaded
            cy.get('[role=combobox]:not([aria-disabled])').click()
        })
        cy.contains('[role=option]', 'live.c.eng').click()
        cy.get('[role=dialog]').contains('button', 'Assign').click()
        cy.contains('live.c.eng has been assigned')
        signOut()

        signIn(ENGINEER, 'Dashboard')
        cy.get('[data-status=open]').should('exist')
        cy.contains('h2', 'Needs attention').should('not.exist')
        cy.get('@ticket').then((path) => cy.visit(path))
        cy.contains('button', 'Start work').click()
        cy.contains('live.c.eng is working on it.')
        cy.contains('button', 'Mark as blocked').click()
        cy.get('[role=dialog]').find('textarea').first().type('Waiting for a replacement valve')
        cy.get('[role=dialog]').contains('button', 'Mark as blocked').click()
        cy.contains('Blocked since')
        signOut()

        signIn(EMPLOYEE)
        cy.contains('li', title).should('contain', 'Blocked').click()
        cy.contains('Waiting for a replacement valve')
        cy.contains('marked this ticket as blocked')
        field('Add a note').find('textarea').first().type('Thanks for the update.')
        cy.contains('button', 'Post note').click()
        cy.contains('li', 'Thanks for the update.')
        cy.screenshot('2-blocked-reporter-view')
    })
})
