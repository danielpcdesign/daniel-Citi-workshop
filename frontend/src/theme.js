import { alpha, createTheme } from '@mui/material/styles'

// facility signage: an enamel plate, paper, ink, and two signal colours kept for meaning only.
// four concrete sets (light or dark, standard or colour-blind safe); every pairing below was checked against
// WCAG AA: text 4.5:1, indicators and focus rings 3:1 (the numbers are in the v1.1 report)
const BASE = {
    light: {
        // plate: the large navy signs (summary, incident); mark: lines and bars that say "this one"
        plate: '#1F3A4D',
        mark: '#1F3A4D',
        paper: '#F4F6F7',
        surface: '#FFFFFF',
        ink: '#172026',
        muted: '#4A5761',
        rule: '#CBD3D8',
        onPlate: '#F4F6F7',
        onPlateMuted: 'rgba(244, 246, 247, 0.78)',
        onPlateRule: 'rgba(244, 246, 247, 0.25)',
        focus: '#B7791F',
        primary: '#1F3A4D',
        onPrimary: '#F4F6F7',
    },
    // at night the page goes dark, not the plate: the navy is lifted so light text on it still reads,
    // and the marks are a lighter blue so a bar still stands out against the dark page
    dark: {
        plate: '#1F4B6A',
        mark: '#5A9BC8',
        paper: '#0E161C',
        surface: '#16222A',
        ink: '#E6ECEF',
        muted: '#A7B4BC',
        rule: '#34444F',
        onPlate: '#F4F6F7',
        onPlateMuted: 'rgba(244, 246, 247, 0.82)',
        onPlateRule: 'rgba(244, 246, 247, 0.3)',
        focus: '#E6B150',
        primary: '#9CC7E6',
        onPrimary: '#0E161C',
    },
}

// red means stopped (blocked, critical, errors); amber means waiting (high, escalation).
// colour-blind safe follows Okabe-Ito: vermillion against blue, the pair that survives every common deficiency
const SIGNALS = {
    light: {
        standard: { signalRed: '#B42318', signalAmber: '#8F5E14' },
        safe: { signalRed: '#A94700', signalAmber: '#005A96' },
    },
    dark: {
        standard: { signalRed: '#F2877D', signalAmber: '#E6B150' },
        safe: { signalRed: '#F59A5C', signalAmber: '#6CB8EE' },
    },
}

// the flow chart's bands; fills, not text, so they are chosen to be told apart rather than read against the page
const STATUS = {
    light: {
        standard: { unassigned: '#C98A2B', open: '#7FA3BA', in_progress: '#1F3A4D', blocked: '#B42318', resolved: '#5B8A6B', closed: '#AEB9C1' },
        safe: { unassigned: '#E69F00', open: '#56B4E9', in_progress: '#0072B2', blocked: '#D55E00', resolved: '#009E73', closed: '#BBBBBB' },
    },
    dark: {
        standard: { unassigned: '#E6B150', open: '#8DB8D4', in_progress: '#3E7FAE', blocked: '#F2877D', resolved: '#6FB386', closed: '#5B6A74' },
        safe: { unassigned: '#E69F00', open: '#56B4E9', in_progress: '#2F8FD8', blocked: '#E8731A', resolved: '#1DB58A', closed: '#5E6B73' },
    },
}

// the concrete colours for one choice of mode and palette
export function tokenValues(mode = 'light', palette = 'standard')
{
    const base = BASE[mode] || BASE.light
    const signals = (SIGNALS[mode] || SIGNALS.light)[palette] || SIGNALS.light.standard
    return {
        ...base,
        ...signals,
        // tints for a selected row, a hovered row, and the blocked column
        tint: alpha(base.mark, mode === 'dark' ? 0.16 : 0.07),
        tintSoft: alpha(base.mark, mode === 'dark' ? 0.1 : 0.04),
        blockedTint: alpha(signals.signalRed, mode === 'dark' ? 0.12 : 0.06),
    }
}

export function statusColorValues(mode = 'light', palette = 'standard')
{
    return ((STATUS[mode] || STATUS.light)[palette]) || STATUS.light.standard
}

// what components use: css variables, so every sx that says tokens.rule follows the active theme without a re-import
const TOKEN_NAMES = Object.keys(tokenValues())
export const tokens = Object.fromEntries(TOKEN_NAMES.map((name) => [name, `var(--acme-${name})`]))

function cssVariables(values)
{
    return Object.fromEntries(TOKEN_NAMES.map((name) => [`--acme-${name}`, values[name]]))
}

// radius grows with the size of the thing: tags < controls < surfaces < the incident plate
export const radius = {
    tag: 3,
    control: 6,
    surface: 8,
    plate: 12,
}

const display = '"Overpass", "Atkinson Hyperlegible", system-ui, sans-serif'
const text = '"Atkinson Hyperlegible", system-ui, sans-serif'

// everything that moves, stopped: the setting, or the system's wish when the setting follows it
const STILL = {
    '*, *::before, *::after': {
        animationDuration: '0.01ms !important',
        animationIterationCount: '1 !important',
        transitionDuration: '0.01ms !important',
        scrollBehavior: 'auto !important',
    },
}

// mode: 'light' | 'dark'; palette: 'standard' | 'safe'; reducedMotion: true turns every transition off
export function buildTheme({ mode = 'light', palette = 'standard', reducedMotion = false } = {})
{
    const values = tokenValues(mode, palette)
    return createTheme({
        palette: {
            mode,
            primary: { main: values.primary, contrastText: values.onPrimary },
            error: { main: values.signalRed },
            warning: { main: values.signalAmber },
            background: { default: values.paper, paper: values.surface },
            text: { primary: values.ink, secondary: values.muted },
            divider: values.rule,
        },
        // chart colours travel on the theme: svg fills take concrete colours, not css variables
        acme: { mode, palette, reducedMotion, status: statusColorValues(mode, palette) },
        shape: { borderRadius: radius.control },
        // MUI's own transitions (collapse, drawer, dialog) read this; with motion reduced they finish at once
        ...(reducedMotion && { transitions: { create: () => 'none' } }),
        typography: {
            fontFamily: text,
            fontSize: 15,
            // a modular scale (1.25) from a 16px body
            h1: { fontFamily: display, fontWeight: 800, fontSize: '2.44rem', lineHeight: 1.1, letterSpacing: '-0.01em' },
            h2: { fontFamily: display, fontWeight: 800, fontSize: '1.95rem', lineHeight: 1.15 },
            h3: { fontFamily: display, fontWeight: 700, fontSize: '1.56rem', lineHeight: 1.2 },
            h4: { fontFamily: display, fontWeight: 700, fontSize: '1.25rem', lineHeight: 1.25 },
            h5: { fontFamily: display, fontWeight: 700, fontSize: '1.1rem', lineHeight: 1.3 },
            h6: { fontFamily: display, fontWeight: 700, fontSize: '1rem', lineHeight: 1.3 },
            body1: { fontSize: '1rem', lineHeight: 1.55 },
            body2: { fontSize: '0.9rem', lineHeight: 1.5 },
            button: { fontFamily: display, fontWeight: 700, textTransform: 'none', letterSpacing: 0 },
            // no tracked-out capitals anywhere: labels stay in sentence case
            overline: { textTransform: 'none', letterSpacing: 0, fontSize: '0.8rem', lineHeight: 1.4 },
            caption: { fontSize: '0.8rem', lineHeight: 1.4 },
        },
        components: {
            MuiCssBaseline: {
                styleOverrides: {
                    ':root': { ...cssVariables(values), colorScheme: mode },
                    body: { backgroundColor: values.paper },
                    // one visible, consistent focus ring for keyboard users
                    ':focus-visible': { outline: `3px solid ${values.focus}`, outlineOffset: 2 },
                    ...(reducedMotion && STILL),
                },
            },
            MuiButtonBase: {
                defaultProps: { disableRipple: true },
            },
            MuiButton: {
                defaultProps: { disableElevation: true },
                styleOverrides: {
                    root: { borderRadius: radius.control, paddingInline: 16, minHeight: 40 },
                },
            },
            MuiPaper: {
                defaultProps: { elevation: 0 },
                styleOverrides: {
                    root: { borderRadius: radius.surface },
                    outlined: { borderColor: values.rule },
                },
            },
            MuiChip: {
                styleOverrides: {
                    root: { borderRadius: radius.tag, fontWeight: 700 },
                },
            },
            MuiOutlinedInput: {
                styleOverrides: {
                    root: { backgroundColor: values.surface },
                    notchedOutline: { borderColor: values.rule },
                },
            },
            MuiDialog: {
                styleOverrides: {
                    paper: { borderRadius: radius.surface },
                },
            },
            MuiLink: {
                defaultProps: { underline: 'always' },
            },
            MuiStepIcon: {
                styleOverrides: {
                    text: { fontFamily: display, fontWeight: 700 },
                },
            },
        },
    })
}

// the default look (light, standard colours, motion allowed); tests and anything outside the settings provider use it
export const theme = buildTheme()

// read by screen readers, not drawn: context that sighted users get from layout
// sizes are strings: in sx a bare 1 means 100%, which made these spans page-wide and pushed the page sideways
export const srOnly = {
    position: 'absolute',
    width: '1px',
    height: '1px',
    margin: '-1px',
    padding: 0,
    border: 0,
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
}
