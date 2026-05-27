// src/settings/styles.ts
export function buildStyles(nonce: string): string {
  return `<style nonce="${nonce}">
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:          #0f0e1a;
  --surface:     #1a1830;
  --surface2:    #22203a;
  --surface3:    #2a2845;
  --border:      #302e50;
  --border2:     #403d68;
  --primary:     #6d4aff;
  --primary-h:   #5535e0;
  --primary-bg:  #6d4aff18;
  --success:     #1cc47e;
  --success-bg:  #1cc47e18;
  --danger:      #e84646;
  --danger-bg:   #e8464618;
  --warn:        #f5a623;
  --warn-bg:     #f5a62318;
  --text:        #e8e6f8;
  --text2:       #c4c0e0;
  --muted:       #7c78a8;
  --radius:      14px;
  --radius-sm:   8px;
  --radius-xs:   5px;
  --shadow:      0 2px 8px rgba(0,0,0,.4);
  --shadow-md:   0 8px 24px rgba(0,0,0,.5);
  --shadow-lg:   0 16px 48px rgba(0,0,0,.6);
  --glow:        0 0 20px rgba(109,74,255,.25);
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  font-size: 14px;
  line-height: 1.6;
}

/* ── Scrollbar ── */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: var(--surface); }
::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }

/* ── Animated background ── */
body::before {
  content: '';
  position: fixed; inset: 0; z-index: -1;
  background:
    radial-gradient(ellipse 80% 60% at 20% 10%, rgba(109,74,255,.12) 0%, transparent 70%),
    radial-gradient(ellipse 60% 40% at 80% 90%, rgba(28,196,126,.07) 0%, transparent 70%);
  pointer-events: none;
}

/* ── Header ── */
header {
  background: rgba(26,24,48,.9);
  border-bottom: 1px solid var(--border);
  padding: 0 28px;
  display: flex; align-items: center; gap: 14px;
  height: 58px;
  position: sticky; top: 0; z-index: 30;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.logo-wrap { display: flex; align-items: center; gap: 10px; }
.logo-icon {
  width: 34px; height: 34px; border-radius: 9px;
  background: linear-gradient(135deg, #6d4aff 0%, #9b6dff 100%);
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 18px; flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(109,74,255,.4);
}
.header-title   { font-weight: 700; font-size: 15px; color: var(--text); }
.header-subtitle{ font-size: 11px; color: var(--muted); }
.header-spacer  { flex: 1; }
.status-pill {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--muted);
  background: var(--surface2); border: 1px solid var(--border);
  padding: 5px 12px; border-radius: 20px;
}
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); flex-shrink: 0; }
.dot.ok  { background: var(--success); box-shadow: 0 0 0 3px var(--success-bg); }
.dot.err { background: var(--danger);  box-shadow: 0 0 0 3px var(--danger-bg); }
.btn-shutdown {
  padding: 5px 13px; border-radius: 20px; border: 1px solid var(--danger);
  background: var(--danger-bg); color: var(--danger);
  font-size: 12px; font-weight: 500; cursor: pointer; transition: all .15s;
  white-space: nowrap;
}
.btn-shutdown:hover:not(:disabled) { background: var(--danger); color: #fff; }
.btn-shutdown:disabled { opacity: .5; cursor: not-allowed; }

.btn-agent-ref {
  padding: 5px 13px; border-radius: 20px; border: 1px solid var(--primary);
  background: var(--primary-bg); color: var(--primary);
  font-size: 12px; font-weight: 500; cursor: pointer; transition: all .15s;
  white-space: nowrap; text-decoration: none;
}
.btn-agent-ref:hover { background: var(--primary); color: #fff; }

/* Settings tab nav (post-setup view) */
nav {
  background: rgba(26,24,48,.85);
  border-bottom: 1px solid var(--border);
  display: flex; padding: 0 28px; gap: 2px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
nav button {
  background: none; border: none; cursor: pointer;
  color: var(--muted); font-size: 13px; font-weight: 500;
  padding: 14px 16px;
  border-bottom: 2px solid transparent;
  transition: color .15s, border-color .15s;
}
nav button:hover { color: var(--text2); }
nav button.active { border-bottom-color: var(--primary); color: var(--primary); }

main { max-width: 900px; margin: 0 auto; padding: 32px 24px 100px; }
section { display: none; }
section.active { display: block; }

/* ── Card ── */
.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 24px; margin-bottom: 16px;
  box-shadow: var(--shadow);
}
.card-title { font-weight: 700; font-size: 15px; color: var(--text); margin-bottom: 4px; }
.card-desc  { color: var(--muted); font-size: 13px; margin-bottom: 18px; line-height: 1.6; }

.section-heading    { font-size: 20px; font-weight: 700; color: var(--text); margin-bottom: 4px; }
.section-subheading { font-size: 14px; color: var(--muted); margin-bottom: 28px; }

fieldset { border: none; }
legend {
  font-size: 11px; font-weight: 700; color: var(--muted);
  text-transform: uppercase; letter-spacing: .07em; margin-bottom: 14px;
}

/* ── Form fields ── */
.field { margin-bottom: 18px; }
.field label:not(.toggle-wrap) {
  display: block; font-size: 13px; font-weight: 600;
  color: var(--text2); margin-bottom: 6px;
}
.field input[type=text],
.field input[type=email],
.field input[type=password],
.field input[type=number] {
  width: 100%; padding: 10px 14px;
  background: var(--surface2); border: 1.5px solid var(--border);
  border-radius: var(--radius-sm); color: var(--text); font-size: 14px;
  outline: none; transition: border-color .15s, box-shadow .15s;
}
.field input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(109,74,255,.2);
}
.field input.invalid { border-color: var(--danger); }
.field .hint    { font-size: 12px; color: var(--muted); margin-top: 5px; line-height: 1.5; }
.field .err-msg { font-size: 12px; color: var(--danger); margin-top: 5px; display: none; }
.field.has-error .err-msg   { display: block; }
.field.has-error input      { border-color: var(--danger); }
/* ── Password visibility toggle ── */
.pw-wrap { position: relative; }
.pw-wrap input { padding-right: 38px !important; width: 100%; box-sizing: border-box; }
.eye-btn {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  background: none; border: none; padding: 4px; cursor: pointer;
  color: var(--muted); line-height: 0;
}
.eye-btn:hover { color: var(--text); }


.row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.row-3 { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 16px; }

/* ── Buttons ── */
button.btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 20px; border-radius: var(--radius-sm); border: none;
  font-size: 14px; font-weight: 600; cursor: pointer;
  transition: background .15s, transform .1s, box-shadow .15s;
  line-height: 1; white-space: nowrap;
}
button.btn:active:not(:disabled) { transform: scale(.97); }
button.btn:disabled { opacity: .4; cursor: not-allowed; }
.btn-primary {
  background: var(--primary); color: #fff;
  box-shadow: 0 2px 8px rgba(109,74,255,.35);
}
.btn-primary:hover:not(:disabled) {
  background: var(--primary-h);
  box-shadow: 0 4px 16px rgba(109,74,255,.5);
}
.btn-ghost {
  background: var(--surface2); color: var(--text2);
  border: 1.5px solid var(--border);
}
.btn-ghost:hover:not(:disabled) { background: var(--surface3); border-color: var(--border2); }
.btn-danger { background: var(--danger); color: #fff; }
.btn-danger:hover:not(:disabled) { background: #c53030; }
.btn-success { background: var(--success); color: #fff; }
.btn-success:hover { background: #17a86d; }
.btn-sm { padding: 7px 14px; font-size: 13px; }

.actions { display: flex; gap: 10px; margin-top: 24px; flex-wrap: wrap; align-items: center; }

/* ── Toggle switch ── */
.toggle-wrap { display: flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; }
.toggle { position: relative; width: 40px; height: 22px; flex-shrink: 0; }
.toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
.slider {
  position: absolute; inset: 0;
  background: var(--border2); border-radius: 11px; transition: background .2s;
}
.slider::before {
  content: ""; position: absolute;
  width: 16px; height: 16px; left: 3px; top: 3px;
  background: #fff; border-radius: 50%;
  transition: transform .2s; box-shadow: 0 1px 3px rgba(0,0,0,.3);
}
.toggle input:checked + .slider { background: var(--primary); }
.toggle input:checked + .slider::before { transform: translateX(18px); }
.toggle input:focus-visible + .slider { outline: 2px solid var(--primary); outline-offset: 2px; }

/* ── Category accordion (Permissions tab) ── */
.category {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); margin-bottom: 10px; overflow: hidden;
}
.category-header {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; cursor: pointer; transition: background .1s;
}
.category-header:hover { background: var(--surface2); }
.category-header .caret { color: var(--muted); font-size: 12px; transition: transform .2s; }
.category-header.open .caret { transform: rotate(90deg); }
.category-info { flex: 1; }
.category-info .name { font-weight: 600; font-size: 14px; }
.category-info .desc { font-size: 12px; color: var(--muted); }
.risk-badge {
  font-size: 11px; font-weight: 600; padding: 2px 8px;
  border-radius: 10px; text-transform: uppercase; letter-spacing: .04em;
}
.risk-safe        { background: #1cc47e22; color: var(--success); }
.risk-moderate    { background: #f5a62322; color: var(--warn); }
.risk-destructive { background: #e8464622; color: var(--danger); }
.category-body { display: none; border-top: 1px solid var(--border); }
.category-body.open { display: block; }
.tool-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px; border-bottom: 1px solid var(--border);
  transition: background .1s;
}
.tool-row:last-child { border-bottom: none; }
.tool-row:hover { background: var(--surface2); }
.tool-name { font-family: monospace; font-size: 13px; flex: 1; color: var(--text2); }
.rate-wrap { display: flex; align-items: center; gap: 6px; }
.rate-wrap label { font-size: 12px; color: var(--muted); white-space: nowrap; }
.rate-input {
  width: 72px; padding: 4px 8px;
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: 4px; color: var(--text); font-size: 13px;
  text-align: center; outline: none;
}
.rate-input:focus { border-color: var(--primary); }
.rate-input:disabled { opacity: .35; }

/* ── Toast ── */
#toast {
  position: fixed; bottom: 24px; right: 24px;
  background: var(--surface2); border: 1px solid var(--border);
  padding: 12px 18px; border-radius: var(--radius);
  font-size: 14px; max-width: 360px;
  opacity: 0; transform: translateY(12px);
  transition: opacity .25s, transform .25s;
  z-index: 200; pointer-events: none;
  box-shadow: var(--shadow-md);
}
#toast.show { opacity: 1; transform: translateY(0); }
#toast.ok   { border-color: var(--success); color: var(--success); }
#toast.err  { border-color: var(--danger);  color: var(--danger); }

/* ── Code block ── */
.code-block {
  background: #06060f; border: 1px solid var(--border);
  border-radius: var(--radius-sm); padding: 14px 16px;
  font-family: monospace; font-size: 12px; line-height: 1.7;
  overflow-x: auto; white-space: pre; color: #b8c4e0;
}
.copy-row { display: flex; justify-content: flex-end; margin-top: 8px; }

/* ── Info table ── */
.info-table { width: 100%; border-collapse: collapse; }
.info-table td { padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
.info-table td:first-child { color: var(--muted); width: 180px; }
.info-table tr:last-child td { border-bottom: none; }
.info-table code {
  background: var(--surface2); padding: 2px 6px; border-radius: 4px;
  font-family: monospace; font-size: 12px;
}

/* ── Alert boxes ── */
.alert {
  padding: 12px 16px; border-radius: var(--radius-sm); font-size: 13px;
  margin-bottom: 14px; display: flex; gap: 10px; align-items: flex-start;
}
.alert-warn { background: var(--warn-bg);    border: 1px solid #f5a62340; color: var(--warn); }
.alert-info { background: var(--primary-bg); border: 1px solid #6d4aff40; color: #a080ff; }

/* ── Spinner ── */
.spinner {
  display: inline-block; width: 14px; height: 14px;
  border: 2px solid rgba(255,255,255,.25); border-top-color: #fff;
  border-radius: 50%; animation: spin .7s linear infinite; flex-shrink: 0;
}
.spinner-dark {
  display: inline-block; width: 14px; height: 14px;
  border: 2px solid rgba(109,74,255,.25); border-top-color: var(--primary);
  border-radius: 50%; animation: spin .7s linear infinite; flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Preset buttons (Permissions tab) ── */
.presets { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
.preset-btn {
  padding: 7px 14px; border-radius: var(--radius-sm); border: 1.5px solid var(--border);
  background: var(--surface2); color: var(--text2);
  font-size: 13px; font-weight: 500; cursor: pointer; transition: all .15s;
}
.preset-btn:hover { border-color: var(--primary); color: var(--primary); background: var(--primary-bg); }
.preset-btn.active { background: var(--primary); border-color: var(--primary); color: #fff; }

/* ── Escalation cards ── */
#escalation-banner {
  background: #1e0c0c; border: 2px solid var(--danger);
  border-radius: var(--radius); padding: 0; margin-bottom: 16px; display: none;
}
.escalation-banner-title {
  background: var(--danger); color: #fff; font-weight: 700;
  padding: 10px 16px; font-size: 14px;
  display: flex; align-items: center; gap: 8px;
}
.escalation-card-body { padding: 16px 20px; }
.escalation-meta { font-size: 12px; color: var(--muted); margin-bottom: 14px; }
.escalation-field { margin-bottom: 12px; }
.escalation-field label {
  display: block; font-size: 12px; font-weight: 600;
  color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px;
}
.escalation-reason {
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: var(--radius-xs); padding: 10px 14px;
  font-size: 13px; font-style: italic; color: var(--text);
}
.escalation-preset-row { display: flex; align-items: center; gap: 12px; font-size: 13px; }
.preset-badge {
  padding: 2px 10px; border-radius: 20px; font-size: 12px; font-weight: 600;
}
.preset-badge.safe     { background: #1cc47e22; color: var(--success); border: 1px solid #1cc47e44; }
.preset-badge.moderate { background: #f5a62322; color: var(--warn);    border: 1px solid #f5a62344; }
.preset-badge.high     { background: #e8464622; color: var(--danger);  border: 1px solid #e8464644; }
.tool-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.tool-chip-new {
  background: #6d4aff22; border: 1px solid #6d4aff55;
  border-radius: 4px; padding: 2px 8px; font-size: 11px;
  font-family: monospace; color: #a090ff;
}
.escalation-confirm-wrap { margin-top: 14px; }
.escalation-confirm-wrap label {
  display: block; font-size: 12px; font-weight: 600;
  color: var(--warn); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 6px;
}
.escalation-confirm-input {
  width: 100%; max-width: 280px;
  padding: 8px 12px; border-radius: var(--radius-xs);
  background: var(--surface2); border: 1px solid var(--warn);
  color: var(--text); font-size: 14px; font-weight: 600; letter-spacing: .08em; outline: none;
}
.escalation-confirm-input:focus { border-color: var(--danger); }
.escalation-actions { display: flex; gap: 10px; margin-top: 14px; }
.btn-deny    { background: #e8464622; border: 1px solid var(--danger); color: var(--danger); }
.btn-deny:hover    { background: var(--danger); color: #fff; }
.btn-approve { background: #1cc47e22; border: 1px solid var(--success); color: var(--success); }
.btn-approve:not(:disabled):hover { background: var(--success); color: #000; }
.btn-approve:disabled { opacity: .35; cursor: not-allowed; }
.escalation-countdown { font-size: 12px; color: var(--muted); align-self: center; margin-left: auto; }
.escalation-countdown.urgent { color: var(--danger); font-weight: 600; }

/* ── Audit log ── */
.audit-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.audit-table th {
  text-align: left; padding: 6px 10px; color: var(--muted);
  border-bottom: 1px solid var(--border); font-weight: 600;
  text-transform: uppercase; letter-spacing: .04em;
}
.audit-table td { padding: 6px 10px; border-bottom: 1px solid rgba(48,46,80,.5); }
.audit-table tr:last-child td { border-bottom: none; }
.audit-event-approved { color: var(--success); font-weight: 600; }
.audit-event-denied   { color: var(--danger);  font-weight: 600; }
.audit-event-expired  { color: var(--muted); }
.audit-event-requested{ color: var(--warn); }

/* ═══════════════════════════════════════════════════════
   WIZARD STYLES
   ═══════════════════════════════════════════════════════ */

/* Wizard takes over the full viewport */
#wizard-view {
  min-height: calc(100vh - 58px);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 40px 20px 80px;
}

.wiz-shell {
  width: 100%; max-width: 680px;
}

/* ── Progress bar ── */
.wiz-progress {
  display: flex; align-items: center; gap: 0;
  margin-bottom: 36px; position: relative;
}
.wiz-progress::before {
  content: '';
  position: absolute; top: 17px; left: 0; right: 0; height: 2px;
  background: var(--border); z-index: 0;
}
.wiz-progress-fill {
  position: absolute; top: 17px; left: 0; height: 2px;
  background: var(--primary); z-index: 1;
  transition: width .4s ease;
}
.wiz-step-node {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  flex: 1; position: relative; z-index: 2; cursor: default;
}
.wiz-step-circle {
  width: 34px; height: 34px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700;
  border: 2px solid var(--border);
  background: var(--surface2); color: var(--muted);
  transition: all .3s ease;
}
.wiz-step-node.done   .wiz-step-circle { background: var(--success); border-color: var(--success); color: #000; }
.wiz-step-node.active .wiz-step-circle {
  background: var(--primary); border-color: var(--primary); color: #fff;
  box-shadow: 0 0 0 4px rgba(109,74,255,.25);
}
.wiz-step-label {
  font-size: 11px; font-weight: 500; color: var(--muted);
  white-space: nowrap; transition: color .3s;
}
.wiz-step-node.active .wiz-step-label { color: var(--primary); font-weight: 700; }
.wiz-step-node.done   .wiz-step-label { color: var(--success); }

/* ── Wizard card ── */
.wiz-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 36px 40px 32px;
  box-shadow: var(--shadow-lg);
  position: relative; overflow: hidden;
}
.wiz-card::before {
  content: '';
  position: absolute; top: 0; left: 0; right: 0; height: 3px;
  background: linear-gradient(90deg, #6d4aff, #9b6dff, #1cc47e);
}

/* ── Step transitions ── */
.wiz-panel { display: none; animation: panelIn .3s ease; }
.wiz-panel.active { display: block; }
@keyframes panelIn {
  from { opacity: 0; transform: translateX(24px); }
  to   { opacity: 1; transform: translateX(0); }
}

.wiz-title    { font-size: 24px; font-weight: 800; color: var(--text); margin-bottom: 6px; }
.wiz-subtitle { color: var(--muted); font-size: 14px; margin-bottom: 28px; line-height: 1.7; }

/* ── Welcome step ── */
.wiz-feature-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 24px;
}
.wiz-feature-card {
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: var(--radius-sm); padding: 14px 16px;
  display: flex; align-items: flex-start; gap: 10px;
}
.wiz-feature-icon { font-size: 20px; flex-shrink: 0; margin-top: 1px; }
.wiz-feature-title { font-weight: 600; font-size: 13px; color: var(--text); }
.wiz-feature-desc  { font-size: 12px; color: var(--muted); margin-top: 2px; line-height: 1.5; }

.wiz-prereqs { margin-bottom: 24px; }
.wiz-prereqs-title {
  font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .08em; color: var(--muted); margin-bottom: 10px;
}
.wiz-prereq {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-radius: var(--radius-sm);
  background: var(--surface2); border: 1px solid var(--border);
  margin-bottom: 8px; font-size: 13px;
}
.wiz-prereq-icon { font-size: 16px; flex-shrink: 0; }
.wiz-prereq-name { font-weight: 600; color: var(--text); }
.wiz-prereq-desc { font-size: 12px; color: var(--muted); }

/* ── Bridge step ── */
.conn-test-grid {
  display: grid; gap: 10px; margin-bottom: 20px;
}
.conn-row {
  background: var(--surface2); border: 1.5px solid var(--border);
  border-radius: var(--radius-sm); padding: 14px 16px;
  display: flex; align-items: center; gap: 12px;
  transition: border-color .2s;
}
.conn-row.ok   { border-color: var(--success); background: var(--success-bg); }
.conn-row.fail { border-color: var(--danger);  background: var(--danger-bg); }
.conn-row-icon { font-size: 18px; flex-shrink: 0; }
.conn-row-label { flex: 1; }
.conn-row-label strong { display: block; font-size: 13px; font-weight: 600; }
.conn-row-label span   { font-size: 12px; color: var(--muted); }
.conn-row-status {
  font-size: 13px; font-weight: 600; min-width: 100px; text-align: right;
}
.conn-row-status.idle { color: var(--muted); }
.conn-row-status.ok   { color: var(--success); }
.conn-row-status.fail { color: var(--danger); }

.bridge-hint {
  padding: 12px 16px; border-radius: var(--radius-sm); font-size: 13px;
  background: var(--danger-bg); border: 1px solid #e8464640; color: var(--danger);
  display: none; margin-bottom: 16px;
}
.bridge-hint a { color: var(--primary); }

/* ── Auth step ── */
.cred-storage-options {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
  margin-bottom: 20px;
}
.cred-opt {
  padding: 14px 16px; border-radius: var(--radius-sm); cursor: pointer;
  border: 1.5px solid var(--border); background: var(--surface2);
  transition: border-color .15s;
  display: flex; align-items: flex-start; gap: 10px;
}
.cred-opt input[type=radio] { margin-top: 2px; accent-color: var(--primary); flex-shrink: 0; }
.cred-opt:has(input:checked) { border-color: var(--primary); background: var(--primary-bg); }
.cred-opt-icon  { font-size: 20px; flex-shrink: 0; }
.cred-opt-name  { font-weight: 600; font-size: 13px; }
.cred-opt-desc  { font-size: 12px; color: var(--muted); margin-top: 2px; line-height: 1.5; }

/* ── Permissions step ── */
.perm-preset-grid {
  display: grid; gap: 10px; margin-bottom: 24px;
}
.perm-preset-opt {
  padding: 16px 18px; border-radius: var(--radius-sm); cursor: pointer;
  border: 1.5px solid var(--border); background: var(--surface2);
  transition: border-color .15s, background .15s;
  display: flex; align-items: flex-start; gap: 14px;
}
.perm-preset-opt:has(input:checked) { border-color: var(--primary); background: var(--primary-bg); }
.perm-preset-opt input[type=radio]  { margin-top: 3px; accent-color: var(--primary); flex-shrink: 0; }
.perm-preset-badge {
  width: 36px; height: 36px; border-radius: 9px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; font-size: 18px;
}
.perm-preset-name { font-weight: 700; font-size: 14px; }
.perm-preset-desc { font-size: 12px; color: var(--muted); margin-top: 3px; line-height: 1.5; }
.perm-preset-tag  {
  display: inline-block; margin-left: 8px;
  font-size: 10px; font-weight: 600; padding: 2px 7px;
  border-radius: 10px; text-transform: uppercase; letter-spacing: .05em; vertical-align: middle;
}
.tag-safe { background: var(--success-bg); color: var(--success); }
.tag-mod  { background: var(--warn-bg); color: var(--warn); }
.tag-high { background: var(--danger-bg); color: var(--danger); }

/* ── Review step ── */
.review-grid {
  display: grid; gap: 12px; margin-bottom: 24px;
}
.review-row {
  display: flex; align-items: center; gap: 14px;
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: var(--radius-sm); padding: 14px 16px;
}
.review-icon { font-size: 18px; flex-shrink: 0; width: 28px; text-align: center; }
.review-label { font-size: 12px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .05em; }
.review-value { font-size: 14px; color: var(--text); font-weight: 500; margin-top: 2px; }

/* ── Done step ── */
.done-hero { text-align: center; padding: 24px 0 32px; }
.done-hero h2 { font-size: 28px; font-weight: 700; margin: 12px 0 8px; }
.done-hero p { color: var(--text2); max-width: 480px; margin: 0 auto; }
.done-check { width: 64px; height: 64px; border-radius: 50%; background: var(--success); color: #fff; font-size: 32px; display: flex; align-items: center; justify-content: center; margin: 0 auto; }
.done-check-small { display: inline-flex; width: 24px; height: 24px; border-radius: 50%; background: var(--success); color: #fff; font-size: 14px; align-items: center; justify-content: center; margin-right: 8px; }
.done-step-row { display: flex; gap: 16px; padding: 20px 0; border-top: 1px solid var(--border); transition: opacity .3s; }
.done-step-num { width: 32px; height: 32px; border-radius: 50%; background: var(--primary); color: #fff; font-weight: 700; font-size: 15px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px; }
.done-step-title { font-weight: 600; font-size: 15px; margin-bottom: 4px; }
.done-step-desc { font-size: 13px; color: var(--text2); margin-bottom: 12px; }
.done-step-body { flex: 1; }
.done-complete-msg { display: flex; align-items: center; padding: 16px; background: var(--success-bg); border: 1px solid var(--success); border-radius: var(--radius); margin-top: 16px; font-size: 14px; }

.snippet-wrap {
  background: #06060f; border: 1px solid var(--border);
  border-radius: var(--radius-sm); padding: 16px;
  font-family: monospace; font-size: 12px; line-height: 1.7;
  white-space: pre; overflow-x: auto; color: #b8c4e0;
  margin-bottom: 12px; max-height: 260px; overflow-y: auto;
}
.snippet-actions { display: flex; gap: 10px; margin-bottom: 24px; }

.prompt-pills { margin-bottom: 8px; }
.prompt-pills-title {
  font-size: 12px; color: var(--muted); font-weight: 600;
  text-transform: uppercase; letter-spacing: .06em; margin-bottom: 8px;
}
.prompt-pill {
  display: inline-block; background: var(--surface2); border: 1px solid var(--border);
  border-radius: 20px; padding: 5px 14px; font-size: 12px; margin: 3px 4px 3px 0;
  cursor: pointer; transition: border-color .15s; color: var(--text2);
}
.prompt-pill:hover { border-color: var(--primary); color: var(--primary); }

.config-path-locations {
  font-size: 12px; color: var(--muted); line-height: 1.9;
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: var(--radius-sm); padding: 12px 16px; margin-bottom: 24px;
}
.config-path-locations strong { color: var(--text2); }
.config-path-locations code {
  background: var(--surface3); padding: 1px 5px; border-radius: 3px;
  font-family: monospace; font-size: 11px;
}

/* ── Wizard action row ── */
.wiz-actions {
  display: flex; gap: 10px; margin-top: 28px; align-items: center;
}
.wiz-actions .spacer { flex: 1; }
.wiz-skip {
  font-size: 13px; color: var(--muted); background: none; border: none;
  cursor: pointer; padding: 0; text-decoration: underline;
}
.wiz-skip:hover { color: var(--text); }

/* ── Responsive ── */
@media (max-width: 640px) {
  .wiz-card                { padding: 24px 20px 20px; }
  .wiz-feature-grid        { grid-template-columns: 1fr; }
  .cred-storage-options    { grid-template-columns: 1fr; }
  .row-2, .row-3           { grid-template-columns: 1fr; }
  .wiz-step-label          { display: none; }
  header                   { padding: 0 14px; gap: 8px; }
  .header-subtitle         { display: none; }
  .status-pill             { display: none; }
  nav                      { overflow-x: auto; padding: 0 14px; }
  .mode-btns               { flex-direction: column; }
}

/* ── Alert info code: long paths must not overflow ── */
.alert-info code { overflow-wrap: anywhere; word-break: break-all; }

/* ── Audit table: horizontal scroll on narrow screens ── */
#audit-log-wrap { overflow-x: auto; }

/* Connection mode buttons */
.mode-btns { display: flex; gap: 10px; margin-bottom: 20px; }
.mode-btn {
  flex: 1; padding: 12px 16px; border-radius: var(--radius-sm);
  border: 1.5px solid var(--border); background: var(--surface2);
  color: var(--text2); cursor: pointer; font-size: 13px; font-weight: 600;
  transition: all .15s; text-align: center;
}
.mode-btn:hover { border-color: var(--primary); color: var(--primary); }
.mode-btn.active { border-color: var(--primary); background: var(--primary-bg); color: var(--primary); }
</style>`;
}
