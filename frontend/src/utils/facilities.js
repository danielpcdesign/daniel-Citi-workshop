// the facility hierarchy (AD-22): each level knows its child, and what archiving it takes with it
export const LEVELS = {
    building: { noun: 'building', plural: 'buildings', child: 'floor' },
    floor: { noun: 'floor', plural: 'floors', child: 'seat' },
    seat: { noun: 'seat', plural: 'seats', child: null },
}

export const CASCADE = {
    building: 'Its floors and seats are archived with it.',
    floor: 'Its seats are archived with it.',
    seat: '',
}

// a duplicate name is a 409 with a sentence, not a field error; it still belongs beside the name box
export function nameError(error)
{
    const field = error?.fields?.name
    const text = field ? field.replace(/^Value error, /, '') : error?.code === 'conflict' ? error.message : null
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : null
}
