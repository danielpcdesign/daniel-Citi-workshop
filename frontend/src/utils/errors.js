// the server's per-field messages (AD-12), shown beside the input they name
export function fieldError(error, name)
{
    const message = error?.fields?.[name]
    if (!message)
    {
        return null
    }
    // pydantic prefixes custom validator messages; the person filling the form does not need that
    const text = message.replace(/^Value error, /, '')
    return text.charAt(0).toUpperCase() + text.slice(1)
}

// errors that belong to no visible input still need to be shown somewhere
export function unplacedError(error, placedNames)
{
    if (!error)
    {
        return null
    }
    const fields = error.fields || {}
    const placed = Object.keys(fields).filter((name) => placedNames.includes(name))
    return placed.length && placed.length === Object.keys(fields).length ? null : error
}
