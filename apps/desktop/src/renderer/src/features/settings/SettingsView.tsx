import type { AppTheme } from "@pi-ling/contracts";
import { ArrowLeft } from "lucide-react";

export function SettingsView(props: {
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
  onClose: () => void;
}) {
  return (
    <section className="settings-page" aria-label="设置">
      <header className="settings-header">
        <button
          className="settings-back"
          type="button"
          onClick={props.onClose}
        >
          <ArrowLeft />
          返回
        </button>
        <h1>设置</h1>
      </header>
      <main className="settings-content">
        <section className="settings-group">
          <div className="setting-row">
            <div className="setting-copy">
              <h2>主题</h2>
              <p>切换浅色或深色界面。</p>
            </div>
            <select
              aria-label="主题"
              value={props.theme}
              onChange={(event) =>
                props.onThemeChange(event.target.value as AppTheme)
              }
            >
              <option value="dark">深色</option>
              <option value="light">浅色</option>
            </select>
          </div>
        </section>
      </main>
    </section>
  );
}
