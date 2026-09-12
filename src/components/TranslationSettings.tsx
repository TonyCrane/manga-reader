import { useEffect, useState } from "react";
import {
  clearTranslationSettings,
  emptyTranslationSettings,
  defaultTranslationModel,
  defaultTranslationPrompt,
  loadTranslationSettings,
  saveTranslationSettings,
} from "../translation";

export function TranslationSettings({ userId }: { userId: string }) {
  const [settings, setSettings] = useState(emptyTranslationSettings);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    loadTranslationSettings(controller.signal)
      .then((value) => {
        setSettings(value);
        setLoading(false);
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [userId, attempt]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  return (
    <section className="translation-settings">
      <p className="hint">
        配置保存在服务器上的当前账号中，可跨设备使用。翻译请求直接发送到
        DeepSeek。
      </p>
      {loading ? (
        <p role="status">
          {error || "正在读取配置…"}
          {error && (
            <button
              className="soft-button"
              onClick={() => setAttempt(attempt + 1)}
            >
              重试
            </button>
          )}
        </p>
      ) : (
        <form
          onChange={() => {
            setMessage("");
            setError("");
          }}
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              const value = {
                apiKey: settings.apiKey.trim(),
                model: settings.model.trim(),
                prompt: settings.prompt.trim(),
              };
              if (!value.apiKey || !value.model || !value.prompt) {
                setError("请填写 API Key、模型和提示词");
                return;
              }
              setBusy(true);
              await saveTranslationSettings(value);
              setSettings(value);
              setMessage("翻译配置已保存");
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy} className="translation-fields">
            <label>
              API Key
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="none"
                required
                maxLength={512}
                value={settings.apiKey}
                placeholder="输入 DeepSeek API Key"
                onChange={(event) =>
                  setSettings({ ...settings, apiKey: event.target.value })
                }
              />
            </label>
            <p className="hint">
              <a
                href="https://platform.deepseek.com/api_keys"
                target="_blank"
                rel="noreferrer"
              >
                获取 API Key
              </a>{" "}
              · 使用 API 账户余额计费
            </p>
            <label>
              模型
              <input
                required
                maxLength={100}
                value={settings.model}
                placeholder={defaultTranslationModel}
                spellCheck={false}
                onChange={(event) =>
                  setSettings({ ...settings, model: event.target.value })
                }
              />
            </label>
            <label>
              翻译提示词
              <textarea
                required
                maxLength={4000}
                rows={9}
                value={settings.prompt}
                onChange={(event) =>
                  setSettings({ ...settings, prompt: event.target.value })
                }
              />
            </label>
            <div className="translation-settings-actions">
              <button
                type="button"
                className="soft-button"
                onClick={() => {
                  setSettings({
                    ...settings,
                    prompt: defaultTranslationPrompt,
                  });
                  setError("");
                  setMessage("已恢复默认提示词，保存后生效");
                }}
              >
                恢复默认提示词
              </button>
              <button className="primary" type="submit">
                保存配置
              </button>
              <button
                type="button"
                className="soft-button"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await clearTranslationSettings();
                    setSettings(emptyTranslationSettings());
                    setError("");
                    setMessage("已清除当前账号的翻译配置");
                  } catch (error) {
                    setMessage("");
                    setError((error as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                清除配置
              </button>
            </div>
          </fieldset>
          {message && (
            <p className="hint" role="status">
              {message}
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
