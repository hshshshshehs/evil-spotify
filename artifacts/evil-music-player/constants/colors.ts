/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#f7f2f3',
    tint: '#ef4050',

    // Core surfaces
    background: '#101014',
    foreground: '#f7f2f3',

    // Cards / elevated surfaces
    card: '#19181d',
    cardForeground: '#f7f2f3',

    // Primary action color (buttons, links, active states)
    primary: '#ef4050',
    primaryForeground: '#ffffff',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#242228',
    secondaryForeground: '#f7f2f3',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#242228',
    mutedForeground: '#a19aa2',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#351d23',
    accentForeground: '#ffc6cb',

    // Destructive actions (delete, error states)
    destructive: '#ff6976',
    destructiveForeground: '#ffffff',

    // Borders and input outlines
    border: '#302c33',
    input: '#302c33',
  },
  dark: {
    text: '#f7f2f3',
    tint: '#ef4050',
    background: '#101014',
    foreground: '#f7f2f3',
    card: '#19181d',
    cardForeground: '#f7f2f3',
    primary: '#ef4050',
    primaryForeground: '#ffffff',
    secondary: '#242228',
    secondaryForeground: '#f7f2f3',
    muted: '#242228',
    mutedForeground: '#a19aa2',
    accent: '#351d23',
    accentForeground: '#ffc6cb',
    destructive: '#ff6976',
    destructiveForeground: '#ffffff',
    border: '#302c33',
    input: '#302c33',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 18,
};

export default colors;
