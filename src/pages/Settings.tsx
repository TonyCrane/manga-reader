import { useState } from "react";
import { Link } from "react-router-dom";
import { Sun, Moon, LogOut, Settings2, ChevronRight } from "lucide-react";
import { useAccount } from "../account";
import { PasswordForm } from "../components/PasswordForm";

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
  const [error, setError] = useState("");
  return (
    <>
      <section className="page-heading">
        <h1>设置</h1>
      </section>
      <div className="settings-layout">
        <section className="panel">
          <div className="panel-heading">
            <h2>外观</h2>
          </div>
          <div className="theme-options">
            <button
              aria-pressed={theme === "light"}
              className={theme === "light" ? "selected" : ""}
              onClick={() => setTheme("light")}
            >
              <Sun size={24} />
              <strong>亮色模式</strong>
            </button>
            <button
              aria-pressed={theme === "dark"}
              className={theme === "dark" ? "selected" : ""}
              onClick={() => setTheme("dark")}
            >
              <Moon size={24} />
              <strong>暗色模式</strong>
            </button>
          </div>
        </section>
        <section className="panel">
          <h2>安装到主屏幕</h2>
          <p className="muted">
            在 Safari 中打开本站，选择「分享 → 添加到主屏幕」。
          </p>
          <p className="hint">需要 HTTPS。阅读漫画需要连接服务器。</p>
        </section>
        <section className="panel">
          <h2>修改密码</h2>
          <p className="muted">{user.email}</p>
          <PasswordForm onChanged={setUser} />
        </section>
        <section className="panel">
          <h2>账号</h2>
          <p className="muted">{user.email}</p>
          {user.isAdmin && (
            <Link className="settings-link" to="/settings/system">
              <Settings2 size={20} />
              <span>系统设置</span>
              <ChevronRight size={18} />
            </Link>
          )}
          <button
            className="soft-button"
            onClick={() => onLogout().catch((error) => setError(error.message))}
          >
            <LogOut size={17} />
            退出登录
          </button>
          {error && <p className="error">{error}</p>}
        </section>
      </div>
    </>
  );
}
