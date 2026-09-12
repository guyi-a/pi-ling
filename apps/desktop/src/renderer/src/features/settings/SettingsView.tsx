import type { AppTheme, LlmConfigSnapshot } from "@pi-ling/contracts";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

function runtimeHint(providerId: string): string {
  if (providerId === "deepseek") {
    return "Native / Codex / DSH";
  }
  if (providerId === "anthropic") {
    return "Native / DSH";
  }
  return "仅 Native";
}

export function SettingsView(props: {
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
  onClose: () => void;
}) {
  const [llmConfig, setLlmConfig] = useState<LlmConfigSnapshot | null>(null);
  const [provider, setProvider] = useState("deepseek");
  const [model, setModel] = useState("deepseek-flash");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<LlmConfigSnapshot["models"]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applySnapshot = useCallback((snapshot: LlmConfigSnapshot) => {
    setLlmConfig(snapshot);
    setProvider(snapshot.provider);
    setModel(snapshot.model);
    setBaseUrl(snapshot.baseUrl ?? "");
    setModels(snapshot.models);
    setApiKey("");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await window.piLing.getLlmConfig();
        if (!cancelled) {
          applySnapshot(snapshot);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "无法加载模型配置",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySnapshot]);

  async function handleProviderChange(nextProvider: string) {
    setProvider(nextProvider);
    setError(null);
    try {
      const nextModels = await window.piLing.listLlmModels(nextProvider);
      setModels(nextModels);
      const selectedProvider = llmConfig?.providers.find(
        (entry) => entry.id === nextProvider,
      );
      if (
        nextModels.some((entry) => entry.id === model) &&
        nextProvider === llmConfig?.provider
      ) {
        return;
      }
      setModel(
        selectedProvider?.defaultModel ??
          nextModels[0]?.id ??
          "deepseek-flash",
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "无法加载模型列表",
      );
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await window.piLing.saveLlmConfig({
        provider,
        model: model.trim(),
        baseUrl: baseUrl.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
      });
      applySnapshot(result.snapshot);
      setMessage(
        result.requiresSessionRestart
          ? "已保存。新建会话会立即生效；当前会话建议切换或重启应用。"
          : "已保存。",
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const selectedProvider = llmConfig?.providers.find(
    (entry) => entry.id === provider,
  );

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
        <div className="settings-stack">
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

        <section className="settings-group">
          <div className="settings-group-title">
            <h2>模型与 API</h2>
            <p>在此配置默认 Provider、模型名和 API Key。`.env` 仍可作为后备。</p>
          </div>

          {loading ? (
            <p className="settings-note">正在加载配置…</p>
          ) : (
            <>
              <label className="setting-field">
                <span>Provider</span>
                <select
                  aria-label="Provider"
                  value={provider}
                  onChange={(event) =>
                    void handleProviderChange(event.target.value)
                  }
                >
                  {(llmConfig?.providers ?? []).map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}（{runtimeHint(entry.id)}）
                    </option>
                  ))}
                </select>
              </label>

              <label className="setting-field">
                <span>模型</span>
                <input
                  aria-label="模型"
                  list="llm-model-options"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder={selectedProvider?.defaultModel ?? "model-id"}
                />
                <datalist id="llm-model-options">
                  {models.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </datalist>
              </label>

              <label className="setting-field">
                <span>API Key</span>
                <input
                  aria-label="API Key"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={
                    llmConfig?.apiKeyConfigured
                      ? "留空则保持现有 Key"
                      : "输入 API Key"
                  }
                  autoComplete="off"
                />
                {llmConfig?.apiKeyConfigured && !apiKey ? (
                  <span className="settings-hint">
                    当前已配置 {llmConfig.apiKeyPreview ?? "••••"}
                  </span>
                ) : null}
              </label>

              <label className="setting-field">
                <span>Base URL（可选）</span>
                <input
                  aria-label="Base URL"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder={
                    selectedProvider?.defaultBaseUrl
                      ? `留空则使用 ${selectedProvider.defaultBaseUrl}`
                      : "留空则使用 Provider 默认地址"
                  }
                />
              </label>

              <div className="settings-actions">
                <button
                  type="button"
                  className="settings-save"
                  disabled={saving || !model.trim()}
                  onClick={() => void handleSave()}
                >
                  {saving ? "保存中…" : "保存配置"}
                </button>
              </div>

              {message ? <p className="settings-note">{message}</p> : null}
              {error ? <p className="settings-error">{error}</p> : null}
            </>
          )}
        </section>
        </div>
      </main>
    </section>
  );
}
