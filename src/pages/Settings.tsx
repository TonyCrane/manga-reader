import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Sun,
  Moon,
  LogOut,
  Settings2,
  ChevronRight,
  Languages,
  LockKeyhole,
  Info,
} from "lucide-react";
import { useAccount } from "../context/AccountContext";
import { TranslationSettings } from "../components/TranslationSettings";
import { Sheet } from "../components/Sheet";
import { About } from "../components/About";
import { PasswordForm } from "../components/PasswordForm";
import { settingsRouteState } from "../lib/navigation";

export function SettingsPage({
  theme,
  setTheme,
  onLogout,
}: {
  theme: string;
  setTheme: (theme: string) => void;
  onLogout: () => Promise<void>;
}) {
  const { user, setUser } = useAccount();
  const [dialog, setDialog] = useState<
    "translation" | "password" | "about" | null
  >(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <section className="page-heading settings-heading">
        <div>
          <h1>设置</h1>
          <p className="muted settings-account">{user.email}</p>
        </div>
      </section>
      <div className="settings-home">
        <section className="panel">
          <h2>安装到主屏幕</h2>
          <p className="muted">
            在 Safari 中打开本站，选择「分享 → 添加到主屏幕」。
          </p>
          <p className="hint">需要 HTTPS。阅读漫画需要连接服务器。</p>
        </section>
        <section className="settings-group" aria-label="更多设置">
          <div className="settings-row settings-appearance">
            <Sun size={20} aria-hidden="true" />
            <span>外观</span>
            <div className="theme-switch" role="group" aria-label="外观">
              <button
                aria-pressed={theme === "light"}
                onClick={() => setTheme("light")}
              >
                <Sun size={16} />
                亮色
              </button>
              <button
                aria-pressed={theme === "dark"}
                onClick={() => setTheme("dark")}
              >
                <Moon size={16} />
                暗色
              </button>
            </div>
          </div>
          {user.isAdmin && (
            <button
              className="settings-row"
              onClick={() => setDialog("translation")}
              aria-haspopup="dialog"
            >
              <Languages size={20} aria-hidden="true" />
              <span>DeepSeek 翻译设置</span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          )}
          <button
            className="settings-row"
            onClick={() => setDialog("password")}
            aria-haspopup="dialog"
          >
            <LockKeyhole size={20} aria-hidden="true" />
            <span>修改密码</span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          {user.isAdmin && (
            <Link
              className="settings-row"
              to="/settings/system"
              state={settingsRouteState}
            >
              <Settings2 size={20} aria-hidden="true" />
              <span>系统管理</span>
              <ChevronRight size={18} aria-hidden="true" />
            </Link>
          )}
          <button
            className="settings-row"
            onClick={() => setDialog("about")}
            aria-haspopup="dialog"
          >
            <Info size={20} aria-hidden="true" />
            <span>关于</span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </section>
        <button
          className="settings-group settings-row settings-logout"
          disabled={loggingOut}
          onClick={async () => {
            setError("");
            setLoggingOut(true);
            try {
              await onLogout();
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setLoggingOut(false);
            }
          }}
        >
          <LogOut size={18} aria-hidden="true" />
          {loggingOut ? "正在退出…" : "退出登录"}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      {dialog === "translation" && user.isAdmin && (
        <Sheet title="DeepSeek 翻译设置" onClose={() => setDialog(null)}>
          <TranslationSettings key={user.id} userId={user.id} />
        </Sheet>
      )}
      {dialog === "password" && (
        <Sheet title="修改密码" onClose={() => setDialog(null)}>
          <p className="muted settings-account">{user.email}</p>
          <PasswordForm onChanged={setUser} />
        </Sheet>
      )}
      {dialog === "about" && (
        <Sheet title="关于" onClose={() => setDialog(null)}>
          <About />
        </Sheet>
      )}
    </>
  );
}
