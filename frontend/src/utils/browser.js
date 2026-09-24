// a full page load: drops every in-memory trace of the previous session (data, polling, the router's "from")
export function hardNavigate(path)
{
    window.location.assign(path)
}
