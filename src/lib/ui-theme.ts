/**
 * Design tokens and the shared stylesheet for every server-rendered page.
 *
 * The route overview, the plugin help pages, the startup-warning help pages and
 * the admin UI are all rendered from strings on the server, so there is no
 * stylesheet file they can link. These constants are the shared source of truth
 * instead: `renderHtmlDocument()` embeds them once per page, so the palette,
 * the type scale and the component styles cannot drift between pages.
 *
 * Rules to keep this property:
 * - Never hardcode a colour in a page. Add a token here and reference it.
 * - Never add a second `body{}` rule in a page; use `maxPageWidth` on
 *   `renderHtmlDocument()` for the few pages that need a different measure.
 */

/**
 * CSS custom properties shared by every page.
 *
 * Exposed separately from the stylesheet because the sandboxed help wrapper
 * needs the tokens without the rest of the chrome.
 */
export const DESIGN_TOKENS_CSS = `--bg:#f5f6f8;
--surface:#fff;
--surface-subtle:#f8f9fa;
--surface-hover:#f1f3f4;
--border:#dadce0;
--border-strong:#bdc1c6;
--text:#1f1f1f;
--text-muted:#5f6368;
--accent:#0b57d0;
--accent-hover:#0342a5;
--danger:#b3261e;
--danger-text:#8c1d18;
--danger-bg:#fdecea;
--danger-border:#f0b3ad;
--ok:#1e8e3e;
--ok-text:#12612a;
--ok-bg:#e6f4ea;
--ok-border:#a5d6a7;
--warn:#f9a825;
--warn-text:#7b5800;
--warn-bg:#fff8e1;
--warn-border:#f2d28b;
--info:#2c7a7b;
--info-bg:#f3fbfb;
--focus:#0b57d0;
--radius:8px;
--radius-sm:5px;
--radius-pill:999px;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;`;

/**
 * The dark palette, applied by overriding the same custom properties under
 * `[data-theme='dark']`.
 *
 * The theme is set on the root element by the theme client script from a
 * cookie, so a page never hardcodes a colour: it references a token and this
 * block decides whether that token resolves to the light or the dark value.
 * Only the palette changes - radii, spacing and the mono stack are shared.
 */
export const DARK_THEME_TOKENS_CSS = `--bg:#121417;
--surface:#1e2126;
--surface-subtle:#23272d;
--surface-hover:#2a2f36;
--border:#3a4048;
--border-strong:#4a515b;
--text:#e3e6ea;
--text-muted:#9aa0a6;
--accent:#8ab4f8;
--accent-hover:#aecbfa;
--danger:#f28b82;
--danger-text:#f0a8a2;
--danger-bg:#3a2320;
--danger-border:#5c3530;
--ok:#81c995;
--ok-text:#93d3a4;
--ok-bg:#1e3124;
--ok-border:#2f5138;
--warn:#fdd663;
--warn-text:#e6cd7a;
--warn-bg:#38301a;
--warn-border:#5c5122;
--info:#78d9ec;
--info-bg:#16302f;
--focus:#8ab4f8;`;

/**
 * The component stylesheet embedded in every page.
 *
 * Three rules are load-bearing beyond looks:
 * - `.field input` deliberately has no `min-width`. The overview page lays
 *   example forms out in a responsive grid, and a min-width is what makes a
 *   short card overflow its column and the page look uneven.
 * - `.field input[aria-invalid='true']` is the only invalid-field marker. The
 *   browser's own `:invalid` ring would flag every required field as broken
 *   before the user has submitted anything.
 * - `.field` lays its rows out as `1fr auto`. A field is a grid item and is
 *   stretched to the height of its grid row, so when one label in a row wraps to
 *   two lines every field grows and the leftover height has to land somewhere.
 *   Two `auto` rows split it, which makes the input of a short-label field both
 *   taller than its neighbours and offset from their baseline; giving the slack
 *   to the label row keeps every input at its natural height and bottom-aligned.
 */
export const APP_STYLESHEET = `:root{${DESIGN_TOKENS_CSS}}
[data-theme=dark]{${DARK_THEME_TOKENS_CSS}}
*,*::before,*::after{box-sizing:border-box}
body{margin:2rem auto;padding:0 1rem;max-width:var(--page-max-width,60rem);background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:1rem;line-height:1.55}
h1{margin:0 0 .4rem;font-size:1.6rem;font-weight:600;letter-spacing:-.01em}
h2{margin:1.6rem 0 .5rem;font-size:1.15rem;font-weight:600}
h3{margin:1.2rem 0 .4rem;font-size:1rem;font-weight:600}
p{margin:.5rem 0}
a{color:var(--accent)}
a:hover{color:var(--accent-hover)}
code{font-family:var(--mono);font-size:.88em;background:var(--surface-hover);padding:.12rem .35rem;border-radius:var(--radius-sm);overflow-wrap:anywhere}
pre{font-family:var(--mono);font-size:.86rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.6rem .7rem;overflow-x:auto;white-space:pre}
pre code{background:transparent;padding:0}
ul,ol{margin:.5rem 0;padding-left:1.4rem}
li{margin:.3rem 0}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid var(--border);padding:.4rem .55rem;text-align:left;font-size:.92rem}
th{background:var(--surface-subtle);font-weight:600}
dl{margin:.5rem 0}
dt{margin-top:.8rem;font-weight:600}
dd{margin:.2rem 0 0;overflow-wrap:anywhere}
.page-header{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;flex-wrap:wrap;border-bottom:1px solid var(--border);padding-bottom:.7rem;margin-bottom:1.2rem}
.page-header h1{margin:0}
.page-meta{display:flex;gap:1.1rem;flex-wrap:wrap;align-items:center;color:var(--text-muted);font-size:.9rem}
.crumbs{margin:0 0 1.1rem;font-size:.9rem}
.muted{color:var(--text-muted)}
.card{display:grid;gap:.6rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:.85rem .95rem;margin:0 0 .8rem;min-width:0}
.plugin-example-method{display:inline-block;padding:.1rem .5rem;border:1px solid var(--border-strong);border-radius:var(--radius-pill);background:var(--surface);color:var(--text-muted);font-size:.74rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
.field{display:grid;grid-template-columns:1fr;grid-template-rows:1fr auto;gap:.22rem;min-width:0}
.field-label{font-size:.86rem;color:var(--text-muted)}
.field input,.field select{width:100%;padding:.36rem .45rem;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font:inherit;font-size:.94rem}
.field input:focus,.field select:focus,button:focus,a:focus{outline:2px solid var(--accent);outline-offset:1px}
.field input[aria-invalid='true']{border-color:var(--danger)}
.field .hint{font-size:.78rem;color:var(--text-muted)}
.required{margin-left:.25rem;color:var(--danger);font-weight:700}
button{padding:.38rem .85rem;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font:inherit;font-size:.92rem;cursor:pointer}
button:hover:not(:disabled){background:var(--surface-hover);border-color:var(--text-muted)}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
button.primary:hover:not(:disabled){background:var(--accent-hover);border-color:var(--accent-hover)}
button.danger{background:var(--surface);border-color:var(--danger);color:var(--danger-text)}
button.danger:hover:not(:disabled){background:var(--danger-bg)}
button:disabled{opacity:.55;cursor:default}
.toolbar{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;margin:1rem 0}
.banner{border-left:4px solid var(--danger);background:var(--danger-bg);padding:.7rem 1rem;margin:1rem 0;border-radius:0 var(--radius-sm) var(--radius-sm) 0}
.banner h2{margin:.1rem 0 .4rem;color:var(--danger-text);font-size:1.05rem}
.banner.ok{border-left-color:var(--ok);background:var(--ok-bg)}
.banner.ok h2{color:var(--ok-text)}
.banner.warn{border-left-color:var(--warn);background:var(--warn-bg)}
.banner.warn h2{color:var(--warn-text)}
.banner pre{margin:.5rem 0}
.status{margin:.9rem 0;padding:.55rem .75rem;border-radius:var(--radius-sm);display:none;font-size:.94rem}
.status.show{display:block}
.status.ok{background:var(--ok-bg);border:1px solid var(--ok-border);color:var(--ok-text)}
.status.error{background:var(--danger-bg);border:1px solid var(--danger-border);color:var(--danger-text)}
.entry{display:grid;gap:.6rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:.85rem .95rem;margin:0 0 .8rem;min-width:0}
.entry-head{display:grid;grid-template-columns:repeat(auto-fit,minmax(13rem,1fr));gap:.6rem;align-items:end}
.params{display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:.55rem .7rem}
.entry-actions{display:flex;gap:.45rem;flex-wrap:wrap}
.entry-command{display:grid;gap:.3rem}
.entry-command-line{display:block;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.5rem .6rem;overflow-x:auto;white-space:pre}
.test-result{margin-top:.6rem;font-size:.9rem;background:var(--surface-subtle);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.5rem .6rem;white-space:pre-wrap;display:none}
.test-result.show{display:block}
.login{max-width:24rem}
.login .field{margin-bottom:.9rem}
.route-section{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:.1rem 1rem 1.1rem;margin:0 0 1.3rem;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.route-section>h2{margin:1.1rem 0 .9rem;padding-bottom:.55rem;border-bottom:1px solid var(--border);font-size:1.15rem}
.route-section>.route-list{margin:0}
.route-list{list-style:none;margin:.4rem 0 1.5rem;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(20rem,1fr));gap:.7rem;align-items:start}
.route-list>li{margin:0;min-width:0}
.route-list--single{grid-template-columns:1fr}
.route-header{display:flex;align-items:baseline;gap:.55rem;flex-wrap:wrap;font-weight:600;overflow-wrap:anywhere}
.route-help{font-size:.9rem;font-weight:400}
.plugin-examples{display:grid;grid-template-columns:1fr;gap:.6rem;margin-top:.6rem}
.plugin-example-form{display:grid;gap:.6rem;background:var(--surface-subtle);border:1px solid var(--border);border-radius:var(--radius);padding:.8rem .9rem;min-width:0}
.plugin-example-header{display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-wrap:wrap}
.plugin-example-title{font-weight:600}
.plugin-example-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:.5rem .6rem}
.plugin-example-actions{display:flex;justify-content:flex-end;gap:.45rem;flex-wrap:wrap}
.plugin-example-link{display:inline-block;padding:.34rem .6rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);text-decoration:none;font-size:.92rem;justify-self:start}
.plugin-example-link:hover{background:var(--surface-hover);border-color:var(--text-muted)}
.warnings{border-left:4px solid var(--warn);background:var(--warn-bg);padding:.7rem 1rem;margin:1rem 0;border-radius:0 var(--radius-sm) var(--radius-sm) 0}
.warnings h2{margin:.1rem 0 .4rem;color:var(--warn-text);font-size:1.05rem}
.startup-warning-whitelist-entry{background:var(--warn-bg);border-color:var(--warn-border);white-space:pre-wrap}
.shell-auth-hint{margin-top:1.5rem;padding:.8rem 1rem;border-left:4px solid var(--info);background:var(--info-bg);border-radius:0 var(--radius-sm) var(--radius-sm) 0}
.shell-auth-hint h2{margin-top:0}
.sandbox-frame{width:100%;min-height:70vh;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)}
.theme-toggle{position:fixed;top:.7rem;right:.9rem;z-index:1000;display:inline-flex;align-items:center;gap:.4rem;padding:.3rem .55rem;font:inherit;font-size:.82rem;color:var(--text-muted);background:var(--surface);border:1px solid var(--border-strong);border-radius:var(--radius-pill);cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.theme-toggle:hover{background:var(--surface-hover);color:var(--text)}
.theme-toggle:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.theme-toggle-icon{font-size:1rem;line-height:1}`;
