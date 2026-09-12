import { useState } from "react";
import {
  clearTranslationSettings,
  defaultTranslationModel,
  defaultTranslationPrompt,
  loadTranslationSettings,
  saveTranslationSettings,
} from "../translation";

export function TranslationSettings({ userId }: { userId: string }) {
  const [settings, setSettings] = useState(() =>
    loadTranslationSettings(userId),
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  return (
    <section className="panel translation-settings">
      <h2>DeepSeek 标题翻译</h2>
      <p className="hint">
        配置仅保存在当前浏览器，并按账号区分。请求直接发送到 DeepSeek，API Key
        不上传 NAS。
      </p>
      <form
        onChange={() => {
          setMessage("");
          setError("");
        }}
        onSubmit={(event) => {
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
            saveTranslationSettings(userId, value);
            setSettings(value);
            setMessage("翻译配置已保存");
          } catch {
            setError("无法保存配置，请检查浏览器是否允许本地存储");
          }
        }}
      >
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
              setSettings({ ...settings, prompt: defaultTranslationPrompt });
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
            onClick={() => {
              try {
                clearTranslationSettings(userId);
                setSettings(loadTranslationSettings(userId));
                setError("");
                setMessage("已清除当前账号在本浏览器的翻译配置");
              } catch {
                setMessage("");
                setError("无法清除配置，请检查浏览器本地存储权限");
              }
            }}
          >
            清除配置
          </button>
        </div>
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
    </section>
  );
}
