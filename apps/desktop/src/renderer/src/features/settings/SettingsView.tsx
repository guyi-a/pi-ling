import type { AppTheme } from "@pi-ling/contracts";
import {
  ArrowLeft,
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
  Cloud,
  Code2,
  CreditCard,
  FlaskConical,
  GitPullRequest,
  Globe2,
  LayoutPanelTop,
  Library,
  Palette,
  Search,
  Settings2,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";

const categories: Array<{
  label: string;
  icon: LucideIcon;
  group?: "account" | "agent" | "workspace" | "application";
}> = [
  { label: "General", icon: Settings2, group: "account" },
  { label: "Profile", icon: UserRound },
  { label: "Appearance", icon: Palette },
  { label: "Plan & Usage", icon: CreditCard, group: "agent" },
  { label: "Agents", icon: Bot },
  { label: "Cloud Agents", icon: Cloud },
  { label: "Models", icon: BrainCircuit },
  { label: "Git & PRs", icon: GitPullRequest, group: "workspace" },
  { label: "Worktrees", icon: BriefcaseBusiness },
  { label: "Browser & Network", icon: Globe2, group: "application" },
  { label: "Tab", icon: LayoutPanelTop },
  { label: "Code Intelligence", icon: Code2 },
  { label: "Beta", icon: FlaskConical },
  { label: "Docs", icon: Library },
];

export function SettingsView(props: {
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const visibleCategories = categories.filter((category) =>
    category.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <section className="settings-page" aria-label="Settings">
      <aside className="settings-sidebar">
        <button
          className="settings-back"
          type="button"
          onClick={props.onClose}
        >
          <ArrowLeft />
          Back
        </button>
        <label className="settings-search">
          <Search />
          <input
            type="search"
            value={query}
            placeholder="Search Settings"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <nav className="settings-navigation" aria-label="Settings categories">
          {visibleCategories.map((category) => {
            const Icon = category.icon;
            const active = category.label === "Appearance";
            return (
              <button
                className={`${active ? "active" : ""} ${
                  category.group ? "group-start" : ""
                }`}
                type="button"
                aria-current={active ? "page" : undefined}
                disabled={!active}
                key={category.label}
              >
                <Icon />
                {category.label}
              </button>
            );
          })}
        </nav>
        <div className="settings-account">
          <span>π</span>
          <small>pi-ling</small>
        </div>
      </aside>
      <main className="settings-content">
        <div className="settings-content-inner">
          <h1>Appearance</h1>
          <section className="settings-group">
            <div className="setting-row">
              <div className="setting-copy">
                <h2>Theme</h2>
                <p>Choose between light and dark themes.</p>
              </div>
              <select
                aria-label="Theme"
                value={props.theme}
                onChange={(event) =>
                  props.onThemeChange(event.target.value as AppTheme)
                }
              >
                <option value="dark">Cursor Dark</option>
                <option value="light">Cursor Light</option>
              </select>
            </div>
          </section>
        </div>
      </main>
    </section>
  );
}
