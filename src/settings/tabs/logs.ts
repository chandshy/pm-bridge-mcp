// src/settings/tabs/logs.ts
export function buildLogsHtml(): string {
  return `
  <div class="section-heading">Debug Logs</div>
  <div class="section-subheading">Live log output from the MCP server process. Only visible when debug mode is on.</div>

  <div class="card" style="padding:0;overflow:hidden">
    <!-- toolbar -->
    <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--border);flex-wrap:wrap">
      <span style="font-size:12px;color:var(--muted)" id="log-page-info">—</span>
      <div style="flex:1"></div>
      <button class="btn btn-ghost btn-sm" id="log-btn-first"  data-action="logGoFirst"       title="First page">«</button>
      <button class="btn btn-ghost btn-sm" id="log-btn-prev"   data-action="logGoPrev"        title="Previous page">‹</button>
      <button class="btn btn-ghost btn-sm" id="log-btn-next"   data-action="logGoNext"        title="Next page">›</button>
      <button class="btn btn-ghost btn-sm" id="log-btn-last"   data-action="logGoLast"        title="Last page — follow">»</button>
      <button class="btn btn-ghost btn-sm" id="log-btn-follow" data-action="logToggleFollow"  title="Auto-follow latest" style="min-width:80px">Follow ●</button>
      <button class="btn btn-ghost btn-sm" data-action="logClear" title="Clear log file">Clear</button>
    </div>
    <!-- output -->
    <pre id="log-output" style="margin:0;padding:14px;font-size:11px;line-height:1.55;min-height:300px;max-height:60vh;overflow-y:auto;background:var(--bg);border-radius:0;white-space:pre-wrap;word-break:break-all">Loading…</pre>
  </div>

  <!-- ── Response Limits ── -->
  <div class="section-heading" style="margin-top:24px">Response Limits</div>
  <div class="section-subheading">
    Claude's MCP client enforces a 1 MB hard limit on tool results.
    These settings let you tune how the server pre-truncates responses to stay within that boundary.
  </div>
  <div class="card">
    <div class="field">
      <label for="rl-max-response">Max response size (KB)</label>
      <input type="number" id="rl-max-response" min="100" max="1024" step="10" value="900" style="width:120px">
      <span style="font-size:11px;color:var(--muted);margin-left:8px">100–1024 KB (Claude limit is 1024 KB)</span>
    </div>
    <div class="field">
      <label for="rl-max-body">Max email body (chars)</label>
      <input type="number" id="rl-max-body" min="1000" max="10000000" step="10000" value="500000" style="width:120px">
      <span style="font-size:11px;color:var(--muted);margin-left:8px">Truncates get_email_by_id body field</span>
    </div>
    <div class="field">
      <label for="rl-max-list">Max email list results</label>
      <input type="number" id="rl-max-list" min="1" max="200" step="1" value="50" style="width:120px">
      <span style="font-size:11px;color:var(--muted);margin-left:8px">Caps get_emails / search_emails / get_contacts</span>
    </div>
    <div class="field">
      <label for="rl-max-attach">Max attachment download (KB)</label>
      <input type="number" id="rl-max-attach" min="0" max="1024" step="10" value="586" style="width:120px">
      <span style="font-size:11px;color:var(--muted);margin-left:8px">0 = disable inline attachment downloads</span>
    </div>
    <div class="field">
      <label class="toggle-wrap">
        <input type="checkbox" id="rl-warn-large" checked>
        <div class="toggle"><div class="slider"></div></div>
        Warn when response exceeds 80% of limit
      </label>
    </div>
    <div style="margin-top:12px;display:flex;gap:8px">
      <button class="btn btn-ghost btn-sm" data-action="rlResetDefaults">Reset Defaults</button>
      <button class="btn btn-primary btn-sm" data-action="rlSave">Save Limits</button>
    </div>
    <div id="rl-status" style="font-size:12px;margin-top:8px;color:var(--muted)"></div>
  </div>
  `;
}
