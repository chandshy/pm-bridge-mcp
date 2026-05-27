// src/settings/tabs/permissions.ts
export function buildPermissionsHtml(): string {
  return `
  <div class="section-heading">Permissions</div>
  <div class="section-subheading">Control which tools Claude can use and at what rate.</div>

  <div class="card">
    <div class="card-title">Permission Presets</div>
    <div class="card-desc">Apply a preset to quickly configure access, then fine-tune individual tools below.</div>
    <div class="presets" id="preset-btns">
      <button class="preset-btn" data-preset="full"       onclick="applyPreset('full')">Full Access</button>
      <button class="preset-btn" data-preset="supervised" onclick="applyPreset('supervised')">Supervised</button>
      <button class="preset-btn" data-preset="send_only"  onclick="applyPreset('send_only')">Send-Only</button>
      <button class="preset-btn" data-preset="read_only"  onclick="applyPreset('read_only')">Read-Only</button>
      <button class="preset-btn" data-preset="custom" id="custom-preset-btn" style="display:none" onclick="restoreCustom()">Custom</button>
    </div>
    <table style="font-size:12px;color:var(--muted);border-collapse:collapse;width:100%">
      <tr><td style="padding:3px 8px 3px 0;font-weight:600;color:var(--text)">Read-Only</td><td>Reading unlimited. Writing fully blocked.</td></tr>
      <tr><td style="padding:3px 8px 3px 0;font-weight:600;color:var(--text)">Supervised</td><td>All tools enabled. High limits on sending/bulk; stricter caps on deletion and destructive ops. Reading unlimited.</td></tr>
      <tr><td style="padding:3px 8px 3px 0;font-weight:600;color:var(--text)">Send-Only</td><td>Reading unlimited. Send ops rate-limited. Actions, deletion, folder writes, and bulk ops disabled.</td></tr>
      <tr><td style="padding:3px 8px 3px 0;font-weight:600;color:var(--text)">Full Access</td><td>All tools, no rate limits.</td></tr>
    </table>
  </div>

  <div id="categories"></div>

  <div class="actions">
    <button class="btn btn-primary" onclick="savePermissions()">Save Permissions</button>
  </div>
  `;
}
