import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def build_html():
    return """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Agent Forge Web App Starter</title>
    <style>
      :root {
        --bg: #f5f7f8;
        --panel: #ffffff;
        --panel-soft: #f9fbfb;
        --text: #17212b;
        --muted: #667481;
        --line: #dfe6e8;
        --accent: #0f766e;
        --accent-soft: #e2f4f1;
        --green: #12805c;
        --amber: #b45309;
        --red: #b42318;
        --shadow: 0 18px 45px rgba(20, 35, 45, 0.08);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg);
        color: var(--text);
      }
      .shell {
        min-height: 100vh;
        display: grid;
        grid-template-columns: 236px minmax(0, 1fr);
      }
      .sidebar {
        padding: 24px 18px;
        background: var(--panel);
        border-right: 1px solid var(--line);
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 28px;
        font-weight: 760;
      }
      .brand-mark {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        display: grid;
        place-items: center;
        color: #ffffff;
        background: var(--accent);
        font-weight: 800;
      }
      .nav { display: grid; gap: 6px; }
      .nav a {
        color: #35424f;
        text-decoration: none;
        padding: 9px 10px;
        border-radius: 8px;
      }
      .nav a.active, .nav a:hover {
        background: var(--accent-soft);
        color: #064e49;
      }
      main {
        padding: 28px;
        display: grid;
        gap: 18px;
        align-content: start;
      }
      .topbar {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: flex-start;
      }
      h1, h2, h3, p {
        margin: 0;
        letter-spacing: 0;
      }
      h1 {
        font-size: 28px;
        line-height: 1.15;
      }
      .muted { color: var(--muted); }
      .actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      .button {
        min-height: 38px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel);
        color: var(--text);
        padding: 8px 12px;
        cursor: pointer;
      }
      .button.primary {
        background: var(--accent);
        border-color: var(--accent);
        color: #ffffff;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        min-height: 26px;
        padding: 4px 9px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 720;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: currentColor;
      }
      .success { color: var(--green); background: #e8f5ef; }
      .warning { color: var(--amber); background: #fff3df; }
      .neutral { color: #526170; background: #edf1f3; }
      .metrics {
        display: grid;
        grid-template-columns: repeat(4, minmax(150px, 1fr));
        gap: 14px;
      }
      .card, .section {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        box-shadow: var(--shadow);
      }
      .card {
        min-height: 108px;
        padding: 16px;
      }
      .label {
        color: var(--muted);
        font-size: 13px;
        margin-bottom: 12px;
      }
      .value {
        font-size: 30px;
        line-height: 1;
        font-weight: 800;
      }
      .section-header {
        padding: 16px 18px;
        border-bottom: 1px solid var(--line);
        display: flex;
        justify-content: space-between;
        gap: 14px;
      }
      .section-body { padding: 18px; }
      .workflow {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }
      .step {
        padding: 14px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel-soft);
      }
      .step h3 {
        font-size: 15px;
        margin-bottom: 6px;
      }
      .table-wrap { overflow-x: auto; }
      table {
        width: 100%;
        min-width: 720px;
        border-collapse: collapse;
      }
      th, td {
        padding: 12px 10px;
        border-bottom: 1px solid var(--line);
        text-align: left;
        font-size: 14px;
      }
      th {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        background: var(--panel-soft);
      }
      details { border-top: 1px solid var(--line); }
      summary {
        cursor: pointer;
        padding: 14px 18px;
        font-weight: 740;
      }
      pre {
        margin: 0;
        padding: 0 18px 18px;
        max-height: 260px;
        overflow: auto;
        font: 12px/1.55 "Cascadia Code", Consolas, monospace;
      }
      @media (max-width: 960px) {
        .shell { grid-template-columns: 1fr; }
        .sidebar {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: center;
        }
        .brand { margin-bottom: 0; }
        .nav {
          grid-auto-flow: column;
          overflow-x: auto;
        }
        .metrics, .workflow { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 640px) {
        main { padding: 18px; }
        .topbar, .section-header, .sidebar {
          flex-direction: column;
          align-items: stretch;
        }
        .metrics, .workflow { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark">AF</span><span>Web App Starter</span></div>
        <nav class="nav" aria-label="Starter navigation">
          <a class="active" href="#overview">Overview</a>
          <a href="#workflow">Workflow</a>
          <a href="#data">Data</a>
        </nav>
      </aside>
      <main>
        <div class="topbar" id="overview">
          <div>
            <h1>Product Dashboard</h1>
            <p class="muted">A clean starting point for a paid-product user experience.</p>
          </div>
          <div class="actions">
            <span class="badge success"><span class="dot"></span>Running</span>
            <button class="button primary" type="button">Primary Action</button>
            <button class="button" type="button">Secondary</button>
          </div>
        </div>
        <section class="metrics" aria-label="Key metrics">
          <article class="card"><div class="label">Health</div><div class="value">98%</div><p class="muted">Current service score</p></article>
          <article class="card"><div class="label">Records</div><div class="value">1,248</div><p class="muted">Available in the latest view</p></article>
          <article class="card"><div class="label">Warnings</div><div class="value">3</div><p class="muted">Needs operator review</p></article>
          <article class="card"><div class="label">Updated</div><div class="value">12m</div><p class="muted">Since last refresh</p></article>
        </section>
        <section class="section" id="workflow">
          <div class="section-header"><h2>Workflow</h2><span class="badge neutral">Ready</span></div>
          <div class="section-body workflow">
            <div class="step"><h3>Collect</h3><p class="muted">Bring the newest source data into the product.</p></div>
            <div class="step"><h3>Review</h3><p class="muted">Check quality, warnings, and completion state.</p></div>
            <div class="step"><h3>Publish</h3><p class="muted">Send the approved result to the next workflow.</p></div>
          </div>
        </section>
        <section class="section" id="data">
          <div class="section-header"><h2>Recent Results</h2><span class="badge warning">Sample data</span></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Status</th><th>Owner</th><th>Updated</th></tr></thead>
              <tbody>
                <tr><td>Example record</td><td><span class="badge success">Complete</span></td><td>Operations</td><td>Today</td></tr>
                <tr><td>Review queue</td><td><span class="badge warning">Review</span></td><td>Analyst</td><td>Today</td></tr>
                <tr><td>Sync target</td><td><span class="badge neutral">Queued</span></td><td>System</td><td>Yesterday</td></tr>
              </tbody>
            </table>
          </div>
          <details>
            <summary>Details</summary>
            <pre>{"health":"ok","service":"web-app-template","ui_standard":"docs/UI_DESIGN_STANDARD.md"}</pre>
          </details>
        </section>
      </main>
    </div>
  </body>
</html>"""


class RequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({"status": "ok", "service": "web-app-template"}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
        else:
            body = build_html().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")

        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        return


def main():
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), RequestHandler)
    print(f"Web app template listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
