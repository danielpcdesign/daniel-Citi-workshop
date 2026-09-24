// brings a dashboard section into view; instant for people who asked the system for less motion
// focus: false when the reader's focus should stay where it is (a row they just picked)
export function scrollToSection(id, { focus = true } = {})
{
    const element = document.getElementById(id)
    if (!element)
    {
        return
    }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    element.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
    // keyboard users continue from the section they jumped to, not from the nav
    if (focus)
    {
        element.focus?.({ preventScroll: true })
    }
}
